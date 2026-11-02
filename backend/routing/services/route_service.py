import requests
from django.conf import settings

from .geo import haversine_miles, offset_point, point_along_line, sample_line


class MapboxRoutingService:
    BASE_URL = "https://api.mapbox.com"

    REQUIRED_ROUTES = 3

    # Mapbox often returns only one or two alternatives, so further options are
    # forced through a waypoint to the side of the fastest route. Each entry is
    # (position along the route, sideways offset as a share of the trip distance).
    VIA_POINTS = [
        (0.5, 0.12),
        (0.5, -0.12),
        (0.35, 0.2),
        (0.65, -0.2),
        (0.65, 0.2),
        (0.35, -0.2),
    ]

    MIN_VIA_OFFSET_MILES = 5
    MAX_VIA_OFFSET_MILES = 100

    # Reject forced routes that are pointlessly slow or barely differ from a known one.
    MAX_DURATION_RATIO = 1.6
    MAX_SHARED_ROUTE_RATIO = 0.85
    SAME_ROAD_MILES = 1.0

    def __init__(self):

        self.access_token = settings.MAPBOX_ACCESS_TOKEN

        if not self.access_token:
            raise ValueError("MAPBOX_ACCESS_TOKEN is missing. Check your backend .env file.")

    def geocode(self, address):

        url = f"{self.BASE_URL}/geocoding/v5/mapbox.places/{requests.utils.quote(address)}.json"

        params = {"access_token": self.access_token, "limit": 1}

        response = requests.get(url, params=params, timeout=20)

        response.raise_for_status()

        data = response.json()

        features = data.get("features", [])

        if not features:
            raise ValueError(f"Could not find location: {address}")

        # Mapbox returns [longitude, latitude]
        longitude, latitude = features[0]["center"]

        return {"name": features[0]["place_name"], "longitude": longitude, "latitude": latitude}

    def fetch_directions(self, waypoints, alternatives):

        coordinates = ";".join(f"{longitude},{latitude}" for longitude, latitude in waypoints)

        url = f"{self.BASE_URL}/directions/v5/mapbox/driving/{coordinates}"

        params = {
            "access_token": self.access_token,
            "alternatives": "true" if alternatives else "false",
            "geometries": "geojson",
            "overview": "full",
            "language": "en",
        }

        # Stops a forced route from making a U-turn at its waypoint.
        if len(waypoints) > 2:
            params["continue_straight"] = "true"

        response = requests.get(url, params=params, timeout=30)

        # 422 means the trip itself is impossible, such as one crossing an ocean.
        if response.status_code == 422:
            raise ValueError(response.json().get("message", "Unable to calculate routes"))

        response.raise_for_status()

        data = response.json()

        if data.get("code") != "Ok":
            raise ValueError(data.get("message", "Unable to calculate routes"))

        return data.get("routes", [])

    def shared_route_ratio(self, candidate, existing):
        """Share of the candidate's length that runs along the existing route."""
        candidate_points = sample_line(candidate["geometry"]["coordinates"], 5)
        existing_points = sample_line(existing["geometry"]["coordinates"], 1)

        shared = sum(
            1
            for point in candidate_points
            if any(
                haversine_miles(point, other) <= self.SAME_ROAD_MILES for other in existing_points
            )
        )

        return shared / len(candidate_points)

    def is_distinct(self, candidate, routes):
        return all(
            self.shared_route_ratio(candidate, route) < self.MAX_SHARED_ROUTE_RATIO
            for route in routes
        )

    def add_forced_alternatives(self, routes, start, end):

        fastest = min(routes, key=lambda route: route["duration"])
        coordinates = fastest["geometry"]["coordinates"]

        straight_miles = haversine_miles(start, end)

        for fraction, offset_share in self.VIA_POINTS:
            if len(routes) >= self.REQUIRED_ROUTES:
                break

            offset_miles = max(
                self.MIN_VIA_OFFSET_MILES,
                min(self.MAX_VIA_OFFSET_MILES, straight_miles * abs(offset_share)),
            )

            via = offset_point(
                point_along_line(coordinates, fraction),
                start,
                end,
                offset_miles if offset_share > 0 else -offset_miles,
            )

            # A waypoint can land somewhere unroutable; the next one may still work.
            try:
                candidates = self.fetch_directions([start, via, end], alternatives=False)
            except (requests.RequestException, ValueError):
                continue

            for candidate in candidates:
                if candidate["duration"] <= fastest[
                    "duration"
                ] * self.MAX_DURATION_RATIO and self.is_distinct(candidate, routes):
                    routes.append(candidate)

        return routes

    def get_routes(self, origin, destination):

        origin_coords = self.geocode(origin)
        destination_coords = self.geocode(destination)

        start = [origin_coords["longitude"], origin_coords["latitude"]]
        end = [destination_coords["longitude"], destination_coords["latitude"]]

        routes = self.fetch_directions([start, end], alternatives=True)

        if not routes:
            raise ValueError("No driving routes found")

        if len(routes) < self.REQUIRED_ROUTES:
            routes = self.add_forced_alternatives(routes, start, end)

        routes = sorted(routes, key=lambda route: route["duration"])[: self.REQUIRED_ROUTES]

        result = []

        for index, route in enumerate(routes):
            distance_miles = route["distance"] / 1609.344

            duration_hours = route["duration"] / 3600

            road_names = [
                name.strip()
                for leg in route.get("legs", [])
                for name in leg.get("summary", "").split(",")
                if name.strip()
            ]

            result.append(
                {
                    "route_id": f"route_{index + 1}",
                    "route_name": f"Route {index + 1}",
                    "via": ", ".join(dict.fromkeys(road_names)),
                    "distance_miles": round(distance_miles, 2),
                    "duration_hours": round(duration_hours, 2),
                    "duration_seconds": route["duration"],
                    "distance_meters": route["distance"],
                    "geometry": route["geometry"],
                }
            )

        return {
            "origin": origin_coords,
            "destination": destination_coords,
            "routes": result,
            "route_count": len(result),
            "requested_route_count": self.REQUIRED_ROUTES,
            "route_count_message": (
                "Three routes were found."
                if len(result) >= self.REQUIRED_ROUTES
                else f"Only {len(result)} distinct route(s) could be found for this trip."
            ),
        }
