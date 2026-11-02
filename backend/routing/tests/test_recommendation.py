from django.test import SimpleTestCase

from routing.services.recommendation import RecommendationEngine


class RecommendationEngineTests(SimpleTestCase):
    def setUp(self):
        self.engine = RecommendationEngine()

    def make_route(self, route_id, risks, duration=3600):

        checkpoints = [{"distance_miles": 0, "risk": {"overall_risk": "Low"}}]

        for index, risk in enumerate(risks, start=1):
            checkpoints.append({"distance_miles": index * 10, "risk": {"overall_risk": risk}})

        return {
            "route_id": route_id,
            "route_name": f"Route {route_id}",
            "duration_seconds": duration,
            "checkpoints": checkpoints,
        }

    def test_calculates_risk_miles(self):

        route = self.make_route("route_1", ["Low", "High", "Severe"])

        summary = self.engine.summarize_route(route)

        # Each checkpoint covers the road closest to it, so the two ends get half a segment.
        self.assertEqual(summary["low_miles"], 15)
        self.assertEqual(summary["high_miles"], 10)
        self.assertEqual(summary["severe_miles"], 5)

    def test_no_travel_at_origin_is_not_ignored(self):
        route = {
            "route_id": "route_1",
            "checkpoints": [
                {"distance_miles": 0, "risk": {"overall_risk": "No Travel"}},
                {"distance_miles": 10, "risk": {"overall_risk": "Low"}},
            ],
        }

        route["risk_summary"] = self.engine.summarize_route(route)

        self.assertEqual(route["risk_summary"]["no_travel_miles"], 5)
        self.assertIsNone(self.engine.recommend_route([route])["recommended_route_id"])

    def test_explains_the_deciding_factor(self):
        route1 = self.make_route("route_1", ["Severe", "Low", "Low"])
        route2 = self.make_route("route_2", ["Low", "Low", "Low"])

        routes = [route1, route2]

        for route in routes:
            route["risk_summary"] = self.engine.summarize_route(route)

        message = self.engine.recommend_route(routes)["message"]

        self.assertIn("Route route_2 is recommended", message)
        self.assertIn("0 Severe miles versus 10 on Route route_1", message)

    def test_selects_route_with_fewer_severe_miles(self):

        route1 = self.make_route("route_1", ["Severe", "Severe", "Severe"])

        route2 = self.make_route("route_2", ["Low", "Low", "High"])

        routes = [route1, route2]

        for route in routes:
            route["risk_summary"] = self.engine.summarize_route(route)

        result = self.engine.recommend_route(routes)

        self.assertEqual(result["recommended_route_id"], "route_2")

    def test_excludes_no_travel_routes(self):

        route1 = self.make_route("route_1", ["No Travel", "Low", "Low"])

        route2 = self.make_route("route_2", ["Moderate", "Low", "Low"])

        routes = [route1, route2]

        for route in routes:
            route["risk_summary"] = self.engine.summarize_route(route)

        result = self.engine.recommend_route(routes)

        self.assertEqual(result["recommended_route_id"], "route_2")

    def test_returns_no_recommendation_if_all_routes_unsafe(self):

        route = self.make_route("route_1", ["No Travel", "Low", "Low"])

        route["risk_summary"] = self.engine.summarize_route(route)

        result = self.engine.recommend_route([route])

        self.assertIsNone(result["recommended_route_id"])

    def test_sorts_unsorted_checkpoints(self):
        route = {
            "route_id": "route_1",
            "distance_miles": 30,
            "checkpoints": [
                {"distance_miles": 30, "risk": {"overall_risk": "Severe"}},
                {"distance_miles": 0, "risk": {"overall_risk": "Low"}},
                {"distance_miles": 20, "risk": {"overall_risk": "High"}},
                {"distance_miles": 10, "risk": {"overall_risk": "Moderate"}},
            ],
        }

        summary = self.engine.summarize_route(route)

        self.assertEqual(summary["low_miles"], 5)
        self.assertEqual(summary["moderate_miles"], 10)
        self.assertEqual(summary["high_miles"], 10)
        self.assertEqual(summary["severe_miles"], 5)

    def test_uses_mapbox_route_distance(self):
        route = self.make_route("route_1", ["Low", "High", "Severe"])
        route["distance_miles"] = 60

        summary = self.engine.summarize_route(route)

        self.assertEqual(summary["total_miles"], 60)
        self.assertEqual(summary["low_miles"], 30)
        self.assertEqual(summary["high_miles"], 20)
        self.assertEqual(summary["severe_miles"], 10)

    def test_returns_no_recommendation_for_empty_routes(self):
        result = self.engine.recommend_route([])

        self.assertIsNone(result["recommended_route_id"])
        self.assertEqual(result["message"], "No routes are available.")

    def test_high_miles_break_tie_after_severe_miles(self):
        route1 = self.make_route("route_1", ["Severe", "High", "High"])
        route2 = self.make_route("route_2", ["Severe", "Low", "Low"])

        routes = [route1, route2]

        for route in routes:
            route["risk_summary"] = self.engine.summarize_route(route)

        result = self.engine.recommend_route(routes)

        self.assertEqual(result["recommended_route_id"], "route_2")

    def test_shorter_duration_breaks_equal_risk_tie(self):
        route1 = self.make_route("route_1", ["Low", "Moderate", "High"], duration=5000)
        route2 = self.make_route("route_2", ["Low", "Moderate", "High"], duration=3000)

        routes = [route1, route2]

        for route in routes:
            route["risk_summary"] = self.engine.summarize_route(route)

        result = self.engine.recommend_route(routes)

        self.assertEqual(result["recommended_route_id"], "route_2")

    def test_average_risk_breaks_tie_after_severe_and_high_miles(self):
        route1 = self.make_route("route_1", ["Moderate", "Moderate", "Low"])
        route2 = self.make_route("route_2", ["Low", "Low", "Moderate"])

        routes = [route1, route2]

        for route in routes:
            route["risk_summary"] = self.engine.summarize_route(route)

        result = self.engine.recommend_route(routes)

        self.assertEqual(result["recommended_route_id"], "route_2")

    def rank(self, *routes):
        for route in routes:
            route["risk_summary"] = self.engine.summarize_route(route)

        return self.engine.recommend_route(list(routes))

    def test_fewer_severe_miles_beat_more_high_miles_and_longer_time(self):
        safer = self.make_route("safer", ["High", "High", "High"], duration=9000)
        faster = self.make_route("faster", ["Severe", "Low", "Low"], duration=1000)

        self.assertEqual(self.rank(faster, safer)["recommended_route_id"], "safer")

    def test_fewer_high_miles_beat_a_higher_average_and_longer_time(self):
        calmer = self.make_route("calmer", ["Moderate", "Moderate", "Moderate"], duration=9000)
        spiky = self.make_route("spiky", ["High", "Low", "Low"], duration=1000)

        self.assertEqual(self.rank(spiky, calmer)["recommended_route_id"], "calmer")

    def test_lower_average_risk_beats_shorter_time(self):
        calmer = self.make_route("calmer", ["Low", "Low", "Low"], duration=9000)
        faster = self.make_route("faster", ["Moderate", "Moderate", "Moderate"], duration=1000)

        self.assertEqual(self.rank(faster, calmer)["recommended_route_id"], "calmer")

    def test_explains_each_deciding_factor(self):
        cases = [
            (["High", "Low", "Low"], ["Low", "Low", "Low"], "High miles"),
            (["Moderate", "Low", "Low"], ["Low", "Low", "Low"], "average risk"),
            (["Low", "Low", "Low"], ["Low", "Low", "Low"], "faster than"),
        ]

        for worse, better, expected in cases:
            with self.subTest(expected=expected):
                result = self.rank(
                    self.make_route("worse", worse, duration=5000),
                    self.make_route("better", better, duration=3000),
                )

                self.assertEqual(result["recommended_route_id"], "better")
                self.assertIn(expected, result["message"])

    def test_explains_when_other_routes_are_no_travel(self):
        result = self.rank(
            self.make_route("blocked", ["No Travel", "Low", "Low"]),
            self.make_route("open", ["Severe", "Low", "Low"]),
        )

        self.assertEqual(result["recommended_route_id"], "open")
        self.assertIn("every other route has No Travel", result["message"])

    def test_explains_when_only_one_route_exists(self):
        result = self.rank(self.make_route("only", ["Low", "Low", "Low"]))

        self.assertIn("only route", result["message"])

    def test_rejects_a_route_without_enough_checkpoints(self):
        with self.assertRaises(ValueError):
            self.engine.summarize_route({"route_id": "x", "checkpoints": []})

    def test_rejects_a_route_with_no_distance(self):
        checkpoint = {"distance_miles": 0, "risk": {"overall_risk": "Low"}}

        with self.assertRaises(ValueError):
            self.engine.summarize_route({"route_id": "x", "checkpoints": [checkpoint, checkpoint]})

    def test_rejects_an_unknown_risk_level(self):
        route = self.make_route("x", ["Unknown"])

        with self.assertRaises(ValueError):
            self.engine.summarize_route(route)
