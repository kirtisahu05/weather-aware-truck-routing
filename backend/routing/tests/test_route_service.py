from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from routing.services.corridor_service import CorridorService
from routing.services.route_service import MapboxRoutingService


def make_route(latitude_offset, duration=3600):
    return {
        "distance": 160934,
        "duration": duration,
        "geometry": {
            "type": "LineString",
            "coordinates": [[-90.0, 40.0], [-89.0, 40.0 + latitude_offset], [-88.0, 40.0]],
        },
        "legs": [{"summary": f"Highway {latitude_offset}"}],
    }


@override_settings(MAPBOX_ACCESS_TOKEN="test-token")
class RouteServiceTests(SimpleTestCase):
    def setUp(self):
        self.service = MapboxRoutingService()

        geocode = patch.object(
            self.service,
            "geocode",
            side_effect=lambda address: {
                "name": address,
                "longitude": -90.0 if address == "A" else -88.0,
                "latitude": 40.0,
            },
        )

        geocode.start()
        self.addCleanup(geocode.stop)

    def test_forces_extra_routes_until_three_exist(self):
        with patch.object(
            self.service,
            "fetch_directions",
            side_effect=[[make_route(0)], [make_route(0.5)], [make_route(-0.5)]],
        ) as fetch:
            result = self.service.get_routes("A", "B")

        self.assertEqual(result["route_count"], 3)
        self.assertEqual(fetch.call_count, 3)

    def test_skips_forced_routes_that_duplicate_a_known_route(self):
        with patch.object(
            self.service,
            "fetch_directions",
            side_effect=[[make_route(0)]] + [[make_route(0)] for _ in self.service.VIA_POINTS],
        ):
            result = self.service.get_routes("A", "B")

        self.assertEqual(result["route_count"], 1)
        self.assertIn("Only 1", result["route_count_message"])

    def test_skips_forced_routes_that_are_far_slower(self):
        too_slow = make_route(0.5, duration=3600 * 2)

        with patch.object(
            self.service,
            "fetch_directions",
            side_effect=[[make_route(0)]] + [[too_slow] for _ in self.service.VIA_POINTS],
        ):
            result = self.service.get_routes("A", "B")

        self.assertEqual(result["route_count"], 1)

    def test_makes_no_extra_calls_when_provider_returns_three(self):
        with patch.object(
            self.service,
            "fetch_directions",
            return_value=[make_route(0), make_route(0.5), make_route(-0.5)],
        ) as fetch:
            result = self.service.get_routes("A", "B")

        self.assertEqual(result["route_count"], 3)
        self.assertEqual(fetch.call_count, 1)


class CorridorServiceTests(SimpleTestCase):
    def setUp(self):
        self.service = CorridorService()

    def test_grid_stays_within_point_budget_on_long_trips(self):
        route = {
            "geometry": {"coordinates": [[-122.0 + i * 0.5, 40.0] for i in range(100)]},
        }

        grid = self.service.build_grid([route])

        self.assertLessEqual(len(grid["points"]), self.service.MAX_POINTS)
        self.assertGreater(len(grid["points"]), 20)
        self.assertGreater(grid["spacing_miles"], self.service.MIN_SPACING_MILES)

    def test_grid_follows_the_route(self):
        route = {"geometry": {"coordinates": [[-90.0, 40.0], [-89.0, 40.0]]}}

        grid = self.service.build_grid([route])

        for point in grid["points"]:
            self.assertLess(abs(point["latitude"] - 40.0), 0.5)
