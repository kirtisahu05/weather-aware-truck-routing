import math

from .geo import MILES_PER_DEGREE_LATITUDE, sample_line

NO_FORECAST = -1


class CorridorService:
    """Builds the evenly spaced grid of weather samples behind the corridor heatmap.

    Spacing grows with trip length so that a coast-to-coast trip costs about as many
    weather lookups as a short one. Open-Meteo's model resolution makes spacing below
    10 miles pointless.
    """

    MIN_HALF_WIDTH_MILES = 30
    MIN_SPACING_MILES = 10
    MAX_POINTS = 120
    ROUTE_SAMPLE_MILES = 5

    def build_grid(self, routes):
        samples = [
            point
            for route in routes
            for point in sample_line(route["geometry"]["coordinates"], self.ROUTE_SAMPLE_MILES)
        ]

        if not samples:
            return {"spacing_miles": self.MIN_SPACING_MILES, "points": []}

        # A flat projection is accurate enough to lay out a display grid.
        latitudes = [point[1] for point in samples]
        reference_latitude = (min(latitudes) + max(latitudes)) / 2
        miles_per_degree_longitude = MILES_PER_DEGREE_LATITUDE * max(
            math.cos(math.radians(reference_latitude)), 0.1
        )

        projected = [
            (point[0] * miles_per_degree_longitude, point[1] * MILES_PER_DEGREE_LATITUDE)
            for point in samples
        ]

        spacing = self.MIN_SPACING_MILES
        cells = self._corridor_cells(projected, spacing)

        while len(cells) > self.MAX_POINTS:
            spacing *= 1.15
            cells = self._corridor_cells(projected, spacing)

        points = [
            {
                "longitude": round(column * spacing / miles_per_degree_longitude, 4),
                "latitude": round(row * spacing / MILES_PER_DEGREE_LATITUDE, 4),
            }
            for column, row in sorted(cells)
        ]

        return {"spacing_miles": round(spacing, 2), "points": points}

    def _corridor_cells(self, projected, spacing):
        half_width = max(self.MIN_HALF_WIDTH_MILES, spacing)
        reach = math.ceil(half_width / spacing)
        cells = set()

        for x, y in projected:
            base_column = round(x / spacing)
            base_row = round(y / spacing)

            for column in range(base_column - reach, base_column + reach + 1):
                for row in range(base_row - reach, base_row + reach + 1):
                    if math.hypot(column * spacing - x, row * spacing - y) <= half_width:
                        cells.add((column, row))

        return cells

    def build_heatmap(self, grid, hourly_forecasts, load_weight, risk_engine, hours=49):
        """Attach one risk rank per forecast hour to every grid point."""
        points = []

        for point, forecast in zip(grid["points"], hourly_forecasts):
            risks = [NO_FORECAST] * hours

            for entry in forecast:
                if entry["hour_offset"] < hours:
                    risk = risk_engine.calculate_checkpoint_risk(entry, load_weight)
                    risks[entry["hour_offset"]] = risk_engine.RISK_LEVELS[risk["overall_risk"]]

            points.append({**point, "risks": risks})

        return {"spacing_miles": grid["spacing_miles"], "hours": hours, "points": points}
