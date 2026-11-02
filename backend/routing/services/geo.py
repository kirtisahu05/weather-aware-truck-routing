import math

EARTH_RADIUS_MILES = 3958.8
MILES_PER_DEGREE_LATITUDE = 69.0


def haversine_miles(point1, point2):
    """Great-circle distance between two [longitude, latitude] points."""
    lon1, lat1 = point1
    lon2, lat2 = point2

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)

    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )

    # Protect against floating-point rounding errors.
    a = max(0.0, min(1.0, a))

    return 2 * EARTH_RADIUS_MILES * math.asin(math.sqrt(a))


def sample_line(coordinates, every_miles):
    """Thin a polyline so kept points are at least `every_miles` apart."""
    if not coordinates:
        return []

    samples = [coordinates[0]]
    travelled = 0.0

    for previous, current in zip(coordinates, coordinates[1:]):
        travelled += haversine_miles(previous, current)

        if travelled >= every_miles:
            samples.append(current)
            travelled = 0.0

    if samples[-1] != coordinates[-1]:
        samples.append(coordinates[-1])

    return samples


def point_along_line(coordinates, fraction):
    """Return the vertex closest to `fraction` of the way along a polyline."""
    lengths = [haversine_miles(a, b) for a, b in zip(coordinates, coordinates[1:])]
    target = sum(lengths) * fraction

    travelled = 0.0

    for index, length in enumerate(lengths):
        travelled += length

        if travelled >= target:
            return coordinates[index + 1]

    return coordinates[-1]


def offset_point(point, heading_from, heading_to, miles):
    """Move `point` sideways by `miles`, perpendicular to the heading between two points.

    Positive miles go left of the direction of travel, negative miles go right.
    """
    cos_latitude = max(math.cos(math.radians(point[1])), 0.01)

    east = (heading_to[0] - heading_from[0]) * cos_latitude
    north = heading_to[1] - heading_from[1]
    length = math.hypot(east, north) or 1.0

    offset_degrees = miles / MILES_PER_DEGREE_LATITUDE

    longitude = point[0] - (north / length) * offset_degrees / cos_latitude
    latitude = point[1] + (east / length) * offset_degrees

    return [longitude, max(-90.0, min(90.0, latitude))]
