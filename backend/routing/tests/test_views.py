from unittest.mock import patch

import requests
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase


class GenerateCheckpointsAPITests(APITestCase):
    def setUp(self):
        self.url = reverse("generate-checkpoints")

        self.valid_payload = {
            "origin": "New York, NY",
            "destination": "Boston, MA",
            "departure_datetime": "2026-01-01T10:00:00Z",
            "load_weight": 25000,
            "checkpoint_interval": 25,
        }

        # Approximately 69 miles along the equator.
        self.geometry = {
            "type": "LineString",
            "coordinates": [
                [-74.0, 0.0],
                [-73.0, 0.0],
            ],
        }

        self.mock_route_data = {
            "routes": [
                {
                    "route_id": "route_1",
                    "route_name": "Route 1",
                    "distance_miles": 69.09,
                    "duration_hours": 1.0,
                    "duration_seconds": 3600,
                    "geometry": self.geometry,
                }
            ]
        }

        # Patch external services so tests never call real APIs.
        self.routing_patcher = patch("routing.views.MapboxRoutingService")
        self.weather_patcher = patch("routing.views.WeatherService")

        self.MockRoutingService = self.routing_patcher.start()
        self.MockWeatherService = self.weather_patcher.start()

        self.addCleanup(self.routing_patcher.stop)
        self.addCleanup(self.weather_patcher.stop)

        self.mock_routing_service = self.MockRoutingService.return_value

        self.mock_weather_service = self.MockWeatherService.return_value

        self.mock_routing_service.get_routes.return_value = self.mock_route_data

        self.mock_weather_service.fetch_weather.side_effect = self.make_weather_results

    def make_weather_results(self, checkpoints, departure_datetime=None):
        """
        Simulate weather provider results for every checkpoint.
        """

        results = []

        for checkpoint in checkpoints:
            result = checkpoint.copy()

            result["weather"] = {
                "wind_mph": 10.0,
                "rain_inches_per_hour": 0.0,
                "snow_inches_per_hour": 0.0,
            }

            result["hourly_forecast"] = [
                {
                    "hour_offset": 0,
                    "wind_mph": 10.0,
                    "rain_inches_per_hour": 0.0,
                    "snow_inches_per_hour": 0.0,
                },
                {
                    "hour_offset": 1,
                    "wind_mph": 15.0,
                    "rain_inches_per_hour": 0.0,
                    "snow_inches_per_hour": 0.0,
                },
            ]

            results.append(result)

        return results

    def test_generate_checkpoints_successfully(self):

        response = self.client.post(self.url, self.valid_payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.assertEqual(response.data["status"], "success")

        self.assertEqual(response.data["message"], "Weather checkpoints generated successfully")

        self.assertIn("trip", response.data)
        self.assertIn("routes", response.data)
        self.assertIn("recommendation", response.data)

        self.assertEqual(len(response.data["routes"]), 1)

        route = response.data["routes"][0]

        self.assertEqual(route["route_id"], "route_1")
        self.assertEqual(route["route_name"], "Route 1")

        self.assertGreater(len(route["checkpoints"]), 1)

        self.assertIn("risk_summary", route)

        self.assertEqual(response.data["recommendation"]["recommended_route_id"], "route_1")

    def test_generates_origin_and_destination_checkpoints(self):

        response = self.client.post(self.url, self.valid_payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        checkpoints = response.data["routes"][0]["checkpoints"]

        self.assertAlmostEqual(checkpoints[0]["longitude"], -74.0, places=5)

        self.assertAlmostEqual(checkpoints[0]["latitude"], 0.0, places=5)

        self.assertAlmostEqual(checkpoints[-1]["longitude"], -73.0, places=5)

        self.assertAlmostEqual(checkpoints[-1]["latitude"], 0.0, places=5)

    def test_calculates_checkpoint_weather_risk(self):

        response = self.client.post(self.url, self.valid_payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        checkpoints = response.data["routes"][0]["checkpoints"]

        for checkpoint in checkpoints:
            self.assertIn("weather", checkpoint)
            self.assertIn("risk", checkpoint)

            self.assertEqual(checkpoint["risk"]["overall_risk"], "Low")

            self.assertFalse(checkpoint["risk"]["no_travel"])

    def test_calculates_hourly_forecast_risk(self):

        response = self.client.post(self.url, self.valid_payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        checkpoints = response.data["routes"][0]["checkpoints"]

        for checkpoint in checkpoints:
            hourly_forecast = checkpoint["hourly_forecast"]

            self.assertEqual(len(hourly_forecast), 2)

            for forecast in hourly_forecast:
                self.assertIn("risk", forecast)

                self.assertEqual(forecast["risk"]["overall_risk"], "Low")

    def test_calculates_route_risk_summary(self):

        response = self.client.post(self.url, self.valid_payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        summary = response.data["routes"][0]["risk_summary"]

        self.assertGreater(summary["total_miles"], 0)

        self.assertEqual(summary["low_miles"], summary["total_miles"])

        self.assertEqual(summary["moderate_miles"], 0)
        self.assertEqual(summary["high_miles"], 0)
        self.assertEqual(summary["severe_miles"], 0)
        self.assertEqual(summary["no_travel_miles"], 0)

    def test_passes_trip_information_to_routing_service(self):

        response = self.client.post(self.url, self.valid_payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.mock_routing_service.get_routes.assert_called_once_with("New York, NY", "Boston, MA")

    def test_passes_checkpoints_to_weather_service(self):

        response = self.client.post(self.url, self.valid_payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.mock_weather_service.fetch_weather.assert_called_once()

        call_args = self.mock_weather_service.fetch_weather.call_args

        checkpoints = call_args.args[0]

        self.assertGreater(len(checkpoints), 1)

        for checkpoint in checkpoints:
            self.assertEqual(checkpoint["route_id"], "route_1")

    def test_returns_bad_request_for_missing_origin(self):

        payload = self.valid_payload.copy()
        del payload["origin"]

        response = self.client.post(self.url, payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.assertEqual(response.data["status"], "error")

        self.mock_routing_service.get_routes.assert_not_called()

    def test_returns_bad_request_for_invalid_load_weight(self):

        payload = self.valid_payload.copy()
        payload["load_weight"] = 0

        response = self.client.post(self.url, payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.mock_routing_service.get_routes.assert_not_called()

    def test_returns_bad_request_for_invalid_checkpoint_interval(self):

        payload = self.valid_payload.copy()
        payload["checkpoint_interval"] = 15

        response = self.client.post(self.url, payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.mock_routing_service.get_routes.assert_not_called()

    def test_returns_bad_request_when_origin_equals_destination(self):

        payload = self.valid_payload.copy()
        payload["destination"] = "New York, NY"

        response = self.client.post(self.url, payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.mock_routing_service.get_routes.assert_not_called()

    def test_returns_bad_gateway_when_routing_provider_fails(self):

        self.mock_routing_service.get_routes.side_effect = requests.RequestException(
            "Mapbox unavailable"
        )

        response = self.client.post(self.url, self.valid_payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_502_BAD_GATEWAY)

        self.assertEqual(response.data["status"], "error")

        self.assertEqual(response.data["message"], "External API request failed")

    def test_returns_bad_gateway_when_weather_provider_fails(self):

        self.mock_weather_service.fetch_weather.side_effect = requests.RequestException(
            "Weather provider unavailable"
        )

        response = self.client.post(self.url, self.valid_payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_502_BAD_GATEWAY)

        self.assertEqual(response.data["status"], "error")

        self.assertEqual(response.data["message"], "External API request failed")

    def test_returns_bad_request_for_invalid_route_geometry(self):

        invalid_route_data = {
            "routes": [
                {
                    "route_id": "route_1",
                    "route_name": "Invalid Route",
                    "distance_miles": 69.09,
                    "duration_hours": 1.0,
                    "duration_seconds": 3600,
                    "geometry": {"type": "LineString", "coordinates": []},
                }
            ]
        }

        self.mock_routing_service.get_routes.return_value = invalid_route_data

        response = self.client.post(self.url, self.valid_payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.assertEqual(response.data["status"], "error")

        self.mock_weather_service.fetch_weather.assert_not_called()
