import math
from datetime import timedelta


class CheckpointService:
    EARTH_RADIUS_MILES = 3958.8

    def haversine(self, point1, point2):
        lon1, lat1 = point1
        lon2, lat2 = point2

        lat1 = math.radians(lat1)
        lat2 = math.radians(lat2)

        delta_lat = math.radians(lat2 - lat1)
        delta_lon = math.radians(lon2 - lon1)

        a = (
            math.sin(delta_lat / 2) ** 2
            + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
        )

        # Protect against floating-point rounding errors.
        a = max(0.0, min(1.0, a))

        return 2 * self.EARTH_RADIUS_MILES * math.asin(math.sqrt(a))

    def interpolate(self, point1, point2, fraction):
        lon = point1[0] + (point2[0] - point1[0]) * fraction

        lat = point1[1] + (point2[1] - point1[1]) * fraction

        return [lon, lat]

    def generate_checkpoints(self, geometry, interval_miles, duration_seconds, departure_datetime):

        # Validate departure datetime.
        if (
            departure_datetime is None
            or departure_datetime.tzinfo is None
            or departure_datetime.utcoffset() is None
        ):
            raise ValueError("Departure datetime must be timezone-aware")

        # Validate route duration.
        try:
            duration_seconds = float(duration_seconds)
        except (TypeError, ValueError) as error:
            raise ValueError("Route duration must be a valid number") from error

        if not math.isfinite(duration_seconds) or duration_seconds <= 0:
            raise ValueError("Route duration must be positive")

        # Validate checkpoint interval.
        if interval_miles not in [10, 25, 50]:
            raise ValueError("Invalid checkpoint interval")

        # Get route coordinates.
        coordinates = geometry.get("coordinates", [])

        if not isinstance(coordinates, list) or len(coordinates) < 2:
            raise ValueError("Invalid route geometry")

        # Validate every coordinate.
        validated_coordinates = []

        for coordinate in coordinates:
            if not isinstance(coordinate, (list, tuple)) or len(coordinate) < 2:
                raise ValueError("Invalid route coordinate")

            try:
                longitude = float(coordinate[0])
                latitude = float(coordinate[1])
            except (TypeError, ValueError) as error:
                raise ValueError("Invalid route coordinate") from error

            if not math.isfinite(longitude) or not math.isfinite(latitude):
                raise ValueError("Invalid route coordinate")

            if not (-180 <= longitude <= 180):
                raise ValueError("Invalid longitude")

            if not (-90 <= latitude <= 90):
                raise ValueError("Invalid latitude")

            validated_coordinates.append([longitude, latitude])

        # Calculate distance of every geometry segment.
        segments = []
        cumulative_distance = 0.0

        for index in range(len(validated_coordinates) - 1):
            start = validated_coordinates[index]
            end = validated_coordinates[index + 1]

            segment_distance = self.haversine(start, end)

            segments.append(
                {
                    "start": start,
                    "end": end,
                    "start_distance": cumulative_distance,
                    "end_distance": (cumulative_distance + segment_distance),
                }
            )

            cumulative_distance += segment_distance

        total_distance = cumulative_distance

        if total_distance <= 0:
            raise ValueError("Route distance must be positive")

        # Generate checkpoint distances.
        distances = [0.0]

        current_distance = float(interval_miles)

        while current_distance < total_distance:
            distances.append(current_distance)
            current_distance += interval_miles

        # Always include the destination.
        distances.append(total_distance)

        checkpoints = []
        segment_index = 0

        for checkpoint_number, target_distance in enumerate(distances, start=1):
            # Find the geometry segment containing this checkpoint.
            while (
                segment_index < len(segments) - 1
                and segments[segment_index]["end_distance"] < target_distance
            ):
                segment_index += 1

            segment = segments[segment_index]

            segment_length = segment["end_distance"] - segment["start_distance"]

            if segment_length == 0:
                fraction = 0
            else:
                fraction = (target_distance - segment["start_distance"]) / segment_length

            fraction = max(0, min(1, fraction))

            coordinates_at_checkpoint = self.interpolate(segment["start"], segment["end"], fraction)

            # Estimate arrival time using route progress.
            progress = target_distance / total_distance

            elapsed_seconds = duration_seconds * progress

            eta = departure_datetime + timedelta(seconds=elapsed_seconds)

            checkpoints.append(
                {
                    "checkpoint_id": checkpoint_number,
                    "distance_miles": round(target_distance, 2),
                    "longitude": coordinates_at_checkpoint[0],
                    "latitude": coordinates_at_checkpoint[1],
                    "estimated_arrival": eta.isoformat(),
                }
            )

        return {
            "total_distance_miles": round(total_distance, 2),
            "checkpoint_count": len(checkpoints),
            "checkpoints": checkpoints,
        }
