import requests
from django.conf import settings


class MapboxRoutingService:
    BASE_URL = "https://api.mapbox.com"

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

    def get_routes(self, origin, destination):

        origin_coords = self.geocode(origin)
        destination_coords = self.geocode(destination)

        coordinates = (
            f"{origin_coords['longitude']},"
            f"{origin_coords['latitude']};"
            f"{destination_coords['longitude']},"
            f"{destination_coords['latitude']}"
        )

        url = f"{self.BASE_URL}/directions/v5/mapbox/driving/{coordinates}"

        params = {
            "access_token": self.access_token,
            "alternatives": "true",
            "geometries": "geojson",
            "overview": "full",
            "steps": "true",
            "language": "en",
        }

        response = requests.get(url, params=params, timeout=30)

        response.raise_for_status()

        data = response.json()

        if data.get("code") != "Ok":
            raise ValueError(data.get("message", "Unable to calculate routes"))

        routes = data.get("routes", [])

        if not routes:
            raise ValueError("No driving routes found")

        result = []

        for index, route in enumerate(routes):
            distance_miles = route["distance"] / 1609.344

            duration_hours = route["duration"] / 3600

            result.append(
                {
                    "route_id": f"route_{index + 1}",
                    "route_name": f"Route {index + 1}",
                    "distance_miles": round(distance_miles, 2),
                    "duration_hours": round(duration_hours, 2),
                    "duration_seconds": route["duration"],
                    "distance_meters": route["distance"],
                    "geometry": route["geometry"],
                    "legs": route.get("legs", []),
                }
            )

        return {
            "origin": origin_coords,
            "destination": destination_coords,
            "routes": result,
            "route_count": len(result),
            "requested_route_count": 3,
            "route_count_message": (
                "Three or more routes were returned."
                if len(result) >= 3
                else (
                    f"Only {len(result)} distinct route(s) were returned by the routing provider."
                )
            ),
        }
