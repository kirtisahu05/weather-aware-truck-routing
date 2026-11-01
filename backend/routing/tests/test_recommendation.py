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

        self.assertEqual(summary["low_miles"], 10)
        self.assertEqual(summary["high_miles"], 10)
        self.assertEqual(summary["severe_miles"], 10)

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

        self.assertEqual(summary["low_miles"], 0)
        self.assertEqual(summary["moderate_miles"], 10)
        self.assertEqual(summary["high_miles"], 10)
        self.assertEqual(summary["severe_miles"], 10)

    def test_uses_mapbox_route_distance(self):
        route = self.make_route("route_1", ["Low", "High", "Severe"])
        route["distance_miles"] = 60

        summary = self.engine.summarize_route(route)

        self.assertEqual(summary["total_miles"], 60)
        self.assertEqual(summary["low_miles"], 20)
        self.assertEqual(summary["high_miles"], 20)
        self.assertEqual(summary["severe_miles"], 20)

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
