class RecommendationEngine:
    RISK_RANKS = {
        "Low": 0,
        "Moderate": 1,
        "High": 2,
        "Severe": 3,
        "No Travel": 4,
    }

    def summarize_route(self, route):

        checkpoints = sorted(
            route.get("checkpoints", []), key=lambda checkpoint: float(checkpoint["distance_miles"])
        )

        if len(checkpoints) < 2:
            raise ValueError("A route needs at least two checkpoints.")

        risk_miles = {
            "Low": 0.0,
            "Moderate": 0.0,
            "High": 0.0,
            "Severe": 0.0,
            "No Travel": 0.0,
        }

        weighted_risk = 0.0
        total_miles = 0.0

        # Calculate total checkpoint distance.
        checkpoint_total = float(checkpoints[-1]["distance_miles"])

        if checkpoint_total <= 0:
            raise ValueError("Invalid checkpoint distance.")

        # Use actual Mapbox distance when available.
        # Test fixtures can fall back to checkpoint distance.
        route_total = float(route.get("distance_miles") or checkpoint_total)

        if route_total <= 0:
            raise ValueError("Route distance must be greater than zero.")

        # Scale checkpoint distances to match Mapbox distance.
        scale_factor = route_total / checkpoint_total

        # Each checkpoint's risk represents the segment
        # ending at that checkpoint.
        for index in range(1, len(checkpoints)):
            previous = checkpoints[index - 1]
            current = checkpoints[index]

            raw_segment_miles = float(current["distance_miles"]) - float(previous["distance_miles"])

            if raw_segment_miles < 0:
                raise ValueError("Checkpoint distances must be in ascending order.")

            segment_miles = raw_segment_miles * scale_factor

            risk = current.get("risk", {}).get("overall_risk")

            if risk not in self.RISK_RANKS:
                raise ValueError(f"Invalid or missing checkpoint risk: {risk}")

            risk_miles[risk] += segment_miles

            weighted_risk += segment_miles * self.RISK_RANKS[risk]

            total_miles += segment_miles

        if total_miles <= 0:
            raise ValueError("Route distance must be greater than zero.")

        average_risk = weighted_risk / total_miles

        return {
            "total_miles": round(total_miles, 2),
            "low_miles": round(risk_miles["Low"], 2),
            "moderate_miles": round(risk_miles["Moderate"], 2),
            "high_miles": round(risk_miles["High"], 2),
            "severe_miles": round(risk_miles["Severe"], 2),
            "no_travel_miles": round(risk_miles["No Travel"], 2),
            "average_risk_score": round(average_risk, 2),
        }

    def recommend_route(self, routes):

        if not routes:
            return {"recommended_route_id": None, "message": "No routes are available."}

        # Exclude routes containing No Travel conditions.
        eligible_routes = [
            route for route in routes if route["risk_summary"]["no_travel_miles"] == 0
        ]

        if not eligible_routes:
            return {
                "recommended_route_id": None,
                "message": (
                    "No safe route is available. All available routes contain No Travel conditions."
                ),
            }

        # Ranking priorities:
        # 1. Fewest Severe miles
        # 2. Fewest High miles
        # 3. Lowest average risk
        # 4. Shortest travel time

        ranked_routes = sorted(
            eligible_routes,
            key=lambda route: (
                route["risk_summary"]["severe_miles"],
                route["risk_summary"]["high_miles"],
                route["risk_summary"]["average_risk_score"],
                route.get("duration_seconds", float("inf")),
                route.get("route_id", ""),
            ),
        )

        best_route = ranked_routes[0]

        return {
            "recommended_route_id": best_route["route_id"],
            "message": (
                f"{best_route.get('route_name', best_route['route_id'])} "
                "is the safest available route based on the risk analysis."
            ),
        }
