from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import requests
from django.core.cache import cache
from django.test import SimpleTestCase

from routing.services.weather_service import WeatherService


def make_location(hours=("2026-11-02T10:00", "2026-11-02T11:00")):
    count = len(hours)

    return {
        "hourly": {
            "time": list(hours),
            "wind_speed_10m": [30.0] * count,
            "rain": [2.54] * count,
            "showers": [2.54] * count,
            "snowfall": [2.54] * count,
        }
    }


def make_response(payload, status_code=200):
    response = MagicMock(status_code=status_code)
    response.json.return_value = payload
    return response


class WeatherServiceTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

        self.service = WeatherService()

        self.checkpoint = {
            "latitude": 41.0,
            "longitude": -87.0,
            "estimated_arrival": "2026-11-02T10:20:00+00:00",
        }

    def test_converts_units_and_includes_showers_in_rain(self):
        result = self.service.extract_checkpoint_weather(self.checkpoint, make_location())

        self.assertEqual(result["weather"]["wind_mph"], 30.0)
        # 2.54 mm rain + 2.54 mm showers = 0.2 in; 2.54 cm snow = 1 in.
        self.assertEqual(result["weather"]["rain_inches_per_hour"], 0.2)
        self.assertEqual(result["weather"]["snow_inches_per_hour"], 1.0)

    def test_uses_nearest_forecast_hour_to_eta(self):
        checkpoint = {**self.checkpoint, "estimated_arrival": "2026-11-02T10:40:00+00:00"}

        result = self.service.extract_checkpoint_weather(checkpoint, make_location())

        self.assertEqual(result["weather"]["forecast_time"], "2026-11-02T11:00:00+00:00")

    def test_rejects_eta_outside_forecast(self):
        checkpoint = {**self.checkpoint, "estimated_arrival": "2026-11-05T10:00:00+00:00"}

        with self.assertRaises(ValueError):
            self.service.extract_checkpoint_weather(checkpoint, make_location())

    def test_treats_missing_showers_as_zero(self):
        location = make_location()
        location["hourly"]["showers"] = [None, None]

        result = self.service.extract_checkpoint_weather(self.checkpoint, location)

        self.assertEqual(result["weather"]["rain_inches_per_hour"], 0.1)

    @patch("routing.services.weather_service.requests.get")
    def test_shares_a_lookup_between_identical_locations(self, mock_get):
        mock_get.return_value = make_response(make_location())

        results = self.service.fetch_weather([self.checkpoint, dict(self.checkpoint)])

        self.assertEqual(mock_get.call_count, 1)
        self.assertEqual(len(results), 2)

    @patch("routing.services.weather_service.time.sleep")
    @patch("routing.services.weather_service.requests.get")
    def test_retries_when_rate_limited(self, mock_get, _sleep):
        mock_get.side_effect = [make_response({}, 429), make_response(make_location())]

        results = self.service.fetch_weather([self.checkpoint])

        self.assertEqual(mock_get.call_count, 2)
        self.assertEqual(len(results), 1)

    @patch("routing.services.weather_service.requests.get")
    def test_late_evening_eta_requests_the_next_day(self, mock_get):
        checkpoint = {**self.checkpoint, "estimated_arrival": "2026-11-02T23:45:00+00:00"}
        mock_get.return_value = make_response(
            make_location(("2026-11-02T23:00", "2026-11-03T00:00"))
        )

        result = self.service.fetch_weather([checkpoint])

        self.assertEqual(mock_get.call_args.kwargs["params"]["end_date"], "2026-11-03")
        self.assertEqual(result[0]["weather"]["forecast_time"], "2026-11-03T00:00:00+00:00")

    @patch("routing.services.weather_service.requests.get")
    def test_repeat_lookups_use_the_cache(self, mock_get):
        mock_get.return_value = make_response(make_location())

        self.service.fetch_weather([self.checkpoint])
        self.service.fetch_weather([self.checkpoint])

        self.assertEqual(mock_get.call_count, 1)

    def test_long_trips_stay_within_the_lookup_budget(self):
        points = [{"latitude": 40.0, "longitude": -120.0 + index * 0.05} for index in range(800)]

        keys = self.service.lookup_keys(points)

        self.assertEqual(len(keys), 800)
        self.assertLessEqual(len(set(keys)), self.service.MAX_LOCATIONS_PER_LOOKUP)

    def test_short_trips_keep_the_finest_lookup_grid(self):
        points = [{"latitude": 40.0, "longitude": -120.0 + index * 0.2} for index in range(20)]

        self.assertEqual(len(set(self.service.lookup_keys(points))), 20)

    def test_hourly_forecast_is_relative_to_departure(self):
        departure = datetime(2026, 11, 2, 11, 0, tzinfo=timezone.utc)

        forecast = self.service.extract_hourly_forecast(make_location(), departure)

        self.assertEqual(len(forecast), 1)
        self.assertEqual(forecast[0]["hour_offset"], 0)
        self.assertEqual(forecast[0]["forecast_time"], "2026-11-02T11:00:00+00:00")

    def test_rejects_a_location_with_no_forecast(self):
        with self.assertRaises(ValueError):
            self.service.extract_checkpoint_weather(self.checkpoint, {"hourly": {}})

    def test_rejects_incomplete_weather_at_the_eta(self):
        location = make_location()
        location["hourly"]["wind_speed_10m"] = [None, None]

        with self.assertRaises(ValueError):
            self.service.extract_checkpoint_weather(self.checkpoint, location)

    def test_rejects_an_eta_without_a_timezone(self):
        checkpoint = {**self.checkpoint, "estimated_arrival": "2026-11-02T10:20:00"}

        with self.assertRaises(ValueError):
            self.service.extract_checkpoint_weather(checkpoint, make_location())

    def test_hourly_forecast_skips_incomplete_hours(self):
        location = make_location()
        location["hourly"]["wind_speed_10m"] = [None, 30.0]

        departure = datetime(2026, 11, 2, 10, 0, tzinfo=timezone.utc)

        forecast = self.service.extract_hourly_forecast(location, departure)

        self.assertEqual([entry["hour_offset"] for entry in forecast], [1])

    def test_hourly_forecast_rejects_a_departure_outside_the_forecast(self):
        departure = datetime(2026, 11, 9, 10, 0, tzinfo=timezone.utc)

        with self.assertRaises(ValueError):
            self.service.extract_hourly_forecast(make_location(), departure)

    @patch("routing.services.weather_service.requests.get")
    def test_rejects_a_mismatched_location_count(self, mock_get):
        mock_get.return_value = make_response([make_location(), make_location()])

        with self.assertRaises(ValueError):
            self.service.fetch_weather([self.checkpoint])

    @patch("routing.services.weather_service.time.sleep")
    @patch("routing.services.weather_service.requests.get")
    def test_gives_up_after_repeated_rate_limits(self, mock_get, _sleep):
        response = make_response({}, 429)
        response.raise_for_status.side_effect = requests.HTTPError("429")
        mock_get.return_value = response

        with self.assertRaises(requests.HTTPError):
            self.service.fetch_weather([self.checkpoint])

        self.assertEqual(mock_get.call_count, self.service.MAX_ATTEMPTS)

    def test_empty_inputs_need_no_lookup(self):
        departure = datetime(2026, 11, 2, 10, 0, tzinfo=timezone.utc)

        self.assertEqual(self.service.fetch_weather([]), [])
        self.assertEqual(self.service.fetch_hourly_grid([], departure), [])
