"""Assignment requirements, tested through the API with only the network faked.

The real routing, checkpoint, weather, risk, and recommendation code all run here.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
from urllib.parse import urlparse

import requests
from django.core.cache import cache
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

# Every route starts and ends at latitude 40, so only the fastest route enters the storm.
STORMY_LATITUDE = 38.0


def make_route(middle_latitude, hours):
    return {
        "distance": 170000,
        "duration": hours * 3600,
        "geometry": {
            "type": "LineString",
            "coordinates": [[-90.0, 40.0], [-89.0, middle_latitude], [-88.0, 40.0]],
        },
        "legs": [{"summary": f"Road {middle_latitude}"}],
    }


FAST_STORMY_ROUTE = make_route(STORMY_LATITUDE, 2)
SLOW_SAFE_ROUTE = make_route(41.5, 3)
SLOWEST_SAFE_ROUTE = make_route(42.5, 3.2)


def make_response(payload, status_code=200):
    response = MagicMock(status_code=status_code)
    response.json.return_value = payload

    if status_code >= 400:
        response.raise_for_status.side_effect = requests.HTTPError(
            "401 for url: https://api.mapbox.com/x?access_token=secret-token"
        )

    return response


@override_settings(MAPBOX_ACCESS_TOKEN="secret-token")
class TripFlowTests(APITestCase):
    def setUp(self):
        cache.clear()

        self.url = reverse("generate-checkpoints")

        self.departure = (datetime.now(timezone.utc) + timedelta(days=1)).replace(
            minute=0, second=0, microsecond=0
        )

        self.payload = {
            "origin": "Start",
            "destination": "End",
            "departure_datetime": self.departure.isoformat(),
            "load_weight": 25000,
            "checkpoint_interval": 25,
        }

        self.directions = [FAST_STORMY_ROUTE, SLOW_SAFE_ROUTE, SLOWEST_SAFE_ROUTE]
        self.wind_at = lambda latitude, hour: 10.0
        self.forecast_requests = []

        patcher = patch("requests.get", side_effect=self.fake_get)
        patcher.start()
        self.addCleanup(patcher.stop)

    def fake_get(self, url, params=None, timeout=None):
        host_path = urlparse(url).path

        if "geocoding" in host_path:
            longitude = -90.0 if "Start" in host_path else -88.0

            return make_response(
                {
                    "features": [
                        {"center": [longitude, 40.0], "place_name": "Place"},
                    ]
                }
            )

        if "directions" in host_path:
            return make_response({"code": "Ok", "routes": self.directions})

        return make_response(self.fake_forecast(params))

    def fake_forecast(self, params):
        self.forecast_requests.append(params)

        start = datetime.fromisoformat(params["start_date"]).replace(tzinfo=timezone.utc)
        end = datetime.fromisoformat(params["end_date"]).replace(tzinfo=timezone.utc)

        hours = int((end - start).total_seconds() // 3600) + 24
        times = [start + timedelta(hours=index) for index in range(hours)]

        locations = [
            {
                "hourly": {
                    "time": [time.strftime("%Y-%m-%dT%H:%M") for time in times],
                    "wind_speed_10m": [
                        self.wind_at(
                            float(latitude), (time - self.departure).total_seconds() / 3600
                        )
                        for time in times
                    ],
                    "rain": [0.0] * hours,
                    "showers": [0.0] * hours,
                    "snowfall": [0.0] * hours,
                }
            }
            for latitude in params["latitude"].split(",")
        ]

        return locations[0] if len(locations) == 1 else locations

    def post(self, **overrides):
        return self.client.post(self.url, {**self.payload, **overrides}, format="json")

    def storm_on_fast_route(self, wind=50.0):
        self.wind_at = lambda latitude, hour: (
            wind if abs(latitude - STORMY_LATITUDE) < 0.5 else 10.0
        )

    def routes_by_duration(self, response):
        return sorted(response.data["routes"], key=lambda route: route["duration_seconds"])

    def test_returns_three_route_options(self):
        response = self.post()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["routes"]), 3)

    def test_forces_three_routes_when_the_provider_returns_one(self):
        responses = [[FAST_STORMY_ROUTE], [SLOW_SAFE_ROUTE], [SLOWEST_SAFE_ROUTE]]

        def fake_get(url, params=None, timeout=None):
            if "directions" in url:
                return make_response({"code": "Ok", "routes": responses.pop(0)})

            return self.fake_get(url, params, timeout)

        with patch("requests.get", side_effect=fake_get):
            response = self.post()

        self.assertEqual(len(response.data["routes"]), 3)

    def test_samples_at_each_supported_interval(self):
        for interval in (10, 25, 50):
            with self.subTest(interval=interval):
                route = self.post(checkpoint_interval=interval).data["routes"][0]

                distances = [point["distance_miles"] for point in route["checkpoints"]]

                self.assertEqual(distances[0], 0)
                self.assertEqual(distances[1], interval)

                # Every gap is the interval, except the last stretch to the destination.
                for near, far in zip(distances[:-2], distances[1:-1]):
                    self.assertAlmostEqual(far - near, interval, places=1)

                self.assertLessEqual(distances[-1] - distances[-2], interval)

    def test_uses_the_forecast_for_each_checkpoints_arrival_time(self):
        # Only hours two and later are windy. The 2-hour route arrives at hour two, so only
        # its last checkpoints can see that wind if ETAs are respected.
        self.wind_at = lambda latitude, hour: 50.0 if hour >= 2 else 10.0

        route = self.routes_by_duration(self.post())[0]

        checkpoints = route["checkpoints"]

        self.assertEqual(checkpoints[0]["risk"]["overall_risk"], "Low")
        self.assertEqual(checkpoints[-1]["risk"]["overall_risk"], "Severe")

        for checkpoint in checkpoints:
            arrival = datetime.fromisoformat(checkpoint["estimated_arrival"])
            forecast = datetime.fromisoformat(checkpoint["weather"]["forecast_time"])

            self.assertLessEqual(abs((forecast - arrival).total_seconds()), 1800)

    def test_arrival_time_follows_departure_and_route_duration(self):
        route = self.routes_by_duration(self.post())[0]

        arrival = datetime.fromisoformat(route["checkpoints"][-1]["estimated_arrival"])

        self.assertEqual(arrival, self.departure + timedelta(hours=2))

    def test_recommends_the_safer_route_over_the_faster_one(self):
        self.storm_on_fast_route()

        response = self.post()

        fastest, slower, _ = self.routes_by_duration(response)

        self.assertGreater(fastest["risk_summary"]["severe_miles"], 0)
        self.assertEqual(slower["risk_summary"]["severe_miles"], 0)
        self.assertEqual(
            response.data["recommendation"]["recommended_route_id"], slower["route_id"]
        )

    def test_recommends_the_faster_route_when_risk_is_equal(self):
        response = self.post()

        fastest = self.routes_by_duration(response)[0]

        self.assertEqual(
            response.data["recommendation"]["recommended_route_id"], fastest["route_id"]
        )

    def test_load_weight_changes_the_risk(self):
        self.storm_on_fast_route(wind=50.0)

        light = self.routes_by_duration(self.post(load_weight=30000))[0]
        heavy = self.routes_by_duration(self.post(load_weight=30001))[0]

        self.assertGreater(light["risk_summary"]["severe_miles"], 0)
        self.assertEqual(light["risk_summary"]["no_travel_miles"], 0)

        self.assertGreater(heavy["risk_summary"]["no_travel_miles"], 0)

    def test_no_recommendation_when_every_route_is_no_travel(self):
        self.wind_at = lambda latitude, hour: 60.0

        response = self.post()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data["recommendation"]["recommended_route_id"])
        self.assertIn("No safe route", response.data["recommendation"]["message"])

    def test_heatmap_has_a_risk_for_every_hour_from_0_to_48(self):
        self.wind_at = lambda latitude, hour: 50.0 if hour == 48 else 10.0

        heatmap = self.post().data["corridor_heatmap"]

        self.assertEqual(heatmap["hours"], 49)
        self.assertGreater(len(heatmap["points"]), 0)

        for point in heatmap["points"]:
            self.assertEqual(len(point["risks"]), 49)
            self.assertEqual(point["risks"][0], 0)
            self.assertEqual(point["risks"][48], 3)

    def test_heatmap_risk_includes_the_load_rules(self):
        self.wind_at = lambda latitude, hour: 50.0

        heatmap = self.post(load_weight=35000).data["corridor_heatmap"]

        self.assertEqual(heatmap["points"][0]["risks"][0], 4)

    def test_requests_only_the_needed_forecast_dates(self):
        self.post()

        for params in self.forecast_requests:
            self.assertEqual(params["start_date"], self.departure.date().isoformat())

    def test_provider_failure_does_not_leak_the_token(self):
        with patch("requests.get", return_value=make_response({}, status_code=401)):
            response = self.post()

        self.assertEqual(response.status_code, status.HTTP_502_BAD_GATEWAY)
        self.assertNotIn("secret-token", str(response.data))

    def test_impossible_trip_returns_the_provider_message(self):
        def fake_get(url, params=None, timeout=None):
            if "directions" in url:
                return make_response({"message": "Route exceeds maximum distance"}, 422)

            return self.fake_get(url, params, timeout)

        with patch("requests.get", side_effect=fake_get):
            response = self.post()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["message"], "Route exceeds maximum distance")

    def test_unknown_location_returns_a_clear_message(self):
        def fake_get(url, params=None, timeout=None):
            if "geocoding" in url:
                return make_response({"features": []})

            return self.fake_get(url, params, timeout)

        with patch("requests.get", side_effect=fake_get):
            response = self.post()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Could not find location", response.data["message"])

    def test_no_route_found_returns_a_clear_message(self):
        def fake_get(url, params=None, timeout=None):
            if "directions" in url:
                return make_response({"code": "NoRoute", "message": "No route found"})

            return self.fake_get(url, params, timeout)

        with patch("requests.get", side_effect=fake_get):
            response = self.post()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["message"], "No route found")


@override_settings(MAPBOX_ACCESS_TOKEN="secret-token")
class OtherEndpointTests(APITestCase):
    def setUp(self):
        self.payload = {
            "origin": "Start",
            "destination": "End",
            "departure_datetime": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
            "load_weight": 25000,
        }

    def test_health_check(self):
        response = self.client.get(reverse("health-check"))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "success")

    def test_validate_accepts_a_valid_trip_and_defaults_the_interval(self):
        response = self.client.post(reverse("validate-trip"), self.payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["trip"]["checkpoint_interval"], 25)

    def test_validate_rejects_an_invalid_trip(self):
        response = self.client.post(reverse("validate-trip"), {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("origin", response.data["errors"])

    def test_rejects_departure_too_far_in_the_past(self):
        payload = {
            **self.payload,
            "departure_datetime": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat(),
        }

        response = self.client.post(reverse("validate-trip"), payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("past", response.data["message"])

    def test_routes_endpoint_returns_routes(self):
        with patch("routing.views.MapboxRoutingService") as service:
            service.return_value.get_routes.return_value = {"routes": [], "route_count": 0}

            response = self.client.post(reverse("generate-routes"), self.payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["routing"]["route_count"], 0)

    def test_routes_endpoint_rejects_an_invalid_trip(self):
        response = self.client.post(reverse("generate-routes"), {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_routes_endpoint_hides_provider_errors(self):
        with patch("routing.views.MapboxRoutingService") as service:
            service.return_value.get_routes.side_effect = requests.RequestException(
                "failed for url: https://api.mapbox.com/x?access_token=secret-token"
            )

            response = self.client.post(reverse("generate-routes"), self.payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_502_BAD_GATEWAY)
        self.assertNotIn("secret-token", str(response.data))

    def test_routes_endpoint_reports_bad_locations(self):
        with patch("routing.views.MapboxRoutingService") as service:
            service.return_value.get_routes.side_effect = ValueError("Could not find location: X")

            response = self.client.post(reverse("generate-routes"), self.payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["message"], "Could not find location: X")
