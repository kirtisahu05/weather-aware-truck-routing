import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import requests
from django.core.cache import cache


class WeatherService:
    BASE_URL = "https://api.open-meteo.com/v1/forecast"

    # Open-Meteo accepts many locations in one request.
    BATCH_SIZE = 50
    MAX_WORKERS = 4

    MAX_ATTEMPTS = 3
    RETRY_DELAY_SECONDS = 1.0
    RETRY_STATUS_CODES = {429, 500, 502, 503, 504}

    FORECAST_HORIZON_DAYS = 15

    # Open-Meteo's free tier allows 600 locations a minute, so one request must stay well
    # below that. Long trips sampled every 10 miles would otherwise need about 1,000. They
    # share lookups on a coarser grid instead, and each checkpoint still uses its own ETA hour.
    MAX_LOCATIONS_PER_LOOKUP = 250
    LOOKUP_GRID_DEGREES = (0.01, 0.05, 0.1, 0.25, 0.5)

    CACHE_SECONDS = 30 * 60

    def parse_utc_datetime(self, value):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))

        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)

        return parsed.astimezone(timezone.utc)

    def request_batch(self, batch, start_date, end_date):

        params = {
            "latitude": ",".join(str(latitude) for latitude, _ in batch),
            "longitude": ",".join(str(longitude) for _, longitude in batch),
            "hourly": "wind_speed_10m,rain,showers,snowfall",
            "wind_speed_unit": "mph",
            "timezone": "UTC",
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
        }

        for attempt in range(1, self.MAX_ATTEMPTS + 1):
            response = requests.get(self.BASE_URL, params=params, timeout=60)

            if response.status_code not in self.RETRY_STATUS_CODES or attempt == self.MAX_ATTEMPTS:
                break

            time.sleep(self.RETRY_DELAY_SECONDS * attempt)

        response.raise_for_status()

        data = response.json()

        # Open-Meteo returns a list for multiple locations.
        weather_locations = [data] if isinstance(data, dict) else data

        if len(weather_locations) != len(batch):
            raise ValueError("Weather response location count mismatch")

        return weather_locations

    def lookup_keys(self, points):
        """Snap points to the finest grid that fits the lookup budget.

        Routes share long stretches of road, so even the finest grid (about 0.7 mile)
        removes many duplicates.
        """
        for degrees in self.LOOKUP_GRID_DEGREES:
            keys = [
                (
                    round(round(point["latitude"] / degrees) * degrees, 2),
                    round(round(point["longitude"] / degrees) * degrees, 2),
                )
                for point in points
            ]

            if len(set(keys)) <= self.MAX_LOCATIONS_PER_LOOKUP:
                break

        return keys

    def fetch_locations(self, points, start, end):
        """Return one forecast per point, covering start through end."""
        keys = self.lookup_keys(points)

        start_date = start.astimezone(timezone.utc).date()

        # The provider rejects dates past its horizon. Times beyond it are reported
        # when the hours are looked up instead.
        latest_date = datetime.now(timezone.utc).date() + timedelta(days=self.FORECAST_HORIZON_DAYS)

        # A time after 23:30 rounds to midnight, which belongs to the next day.
        end_date = min((end + timedelta(hours=1)).astimezone(timezone.utc).date(), latest_date)

        def cache_key(key):
            return f"weather:{key[0]}:{key[1]}:{start_date}:{end_date}"

        unique_keys = list(dict.fromkeys(keys))

        cached = cache.get_many([cache_key(key) for key in unique_keys])

        by_key = {key: cached[cache_key(key)] for key in unique_keys if cache_key(key) in cached}

        missing_keys = [key for key in unique_keys if key not in by_key]

        batches = [
            missing_keys[index : index + self.BATCH_SIZE]
            for index in range(0, len(missing_keys), self.BATCH_SIZE)
        ]

        with ThreadPoolExecutor(max_workers=self.MAX_WORKERS) as pool:
            responses = pool.map(
                lambda batch: self.request_batch(batch, start_date, end_date), batches
            )

            for batch, locations in zip(batches, responses):
                fetched = dict(zip(batch, locations))

                by_key.update(fetched)

                cache.set_many(
                    {cache_key(key): value for key, value in fetched.items()}, self.CACHE_SECONDS
                )

        return [by_key[key] for key in keys]

    def fetch_weather(self, checkpoints):
        """Attach the forecast for each checkpoint's estimated arrival hour."""

        if not checkpoints:
            return []

        arrivals = [datetime.fromisoformat(point["estimated_arrival"]) for point in checkpoints]

        locations = self.fetch_locations(checkpoints, min(arrivals), max(arrivals))

        return [
            self.extract_checkpoint_weather(checkpoint, weather_data)
            for checkpoint, weather_data in zip(checkpoints, locations)
        ]

    def fetch_hourly_grid(self, points, departure_datetime, hours=49):
        """Return an hourly forecast per point, from departure through hours - 1."""

        if not points:
            return []

        end = departure_datetime + timedelta(hours=hours)

        locations = self.fetch_locations(points, departure_datetime, end)

        return [
            self.extract_hourly_forecast(weather_data, departure_datetime, hours)
            for weather_data in locations
        ]

    def read_hour(self, hourly, index):
        """Read one forecast hour in the units the risk rules use, or None if incomplete."""

        wind = hourly.get("wind_speed_10m", [])[index]
        rain = hourly.get("rain", [])[index]
        snow = hourly.get("snowfall", [])[index]

        # "rain" only covers large-scale rain; convective rain is reported as "showers".
        # Not every weather model reports showers.
        showers = hourly.get("showers", [])[index] or 0

        if wind is None or rain is None or snow is None:
            return None

        return {
            "wind_mph": round(float(wind), 2),
            "rain_inches_per_hour": round((float(rain) + float(showers)) / 25.4, 4),
            "snow_inches_per_hour": round(float(snow) / 2.54, 4),
        }

    def extract_checkpoint_weather(self, checkpoint, weather_data):

        hourly = weather_data.get("hourly", {})

        times = hourly.get("time", [])

        if not times:
            raise ValueError("No hourly weather forecast available")

        arrival_time = datetime.fromisoformat(checkpoint["estimated_arrival"])

        if arrival_time.tzinfo is None:
            raise ValueError("Checkpoint arrival time must be timezone-aware")

        arrival_time = arrival_time.astimezone(timezone.utc)

        # Select the nearest hourly forecast.
        forecast_times = [self.parse_utc_datetime(value) for value in times]

        nearest_index = min(
            range(len(forecast_times)),
            key=lambda i: abs((forecast_times[i] - arrival_time).total_seconds()),
        )

        nearest_time = forecast_times[nearest_index]

        # Avoid silently using weather from a distant forecast hour.
        difference_hours = abs((nearest_time - arrival_time).total_seconds()) / 3600

        if difference_hours > 0.5:
            raise ValueError("No matching hourly weather forecast for checkpoint ETA")

        weather = self.read_hour(hourly, nearest_index)

        if weather is None:
            raise ValueError("Weather data is incomplete for checkpoint")

        return {
            **checkpoint,
            "weather": {"forecast_time": nearest_time.isoformat(), **weather},
        }

    def extract_hourly_forecast(self, weather_data, departure_datetime, hours=49):

        hourly = weather_data.get("hourly", {})

        times = hourly.get("time", [])

        if not times:
            raise ValueError("Hourly forecast data is unavailable.")

        if departure_datetime.tzinfo is None:
            raise ValueError("Departure datetime must be timezone-aware.")

        departure_datetime = departure_datetime.astimezone(timezone.utc)

        forecast_times = [self.parse_utc_datetime(value) for value in times]

        start_index = min(
            range(len(forecast_times)),
            key=lambda index: abs((forecast_times[index] - departure_datetime).total_seconds()),
        )

        if abs((forecast_times[start_index] - departure_datetime).total_seconds()) > 1800:
            raise ValueError("No hourly forecast is available near the departure time.")

        forecast = []

        end_index = min(start_index + hours, len(forecast_times))

        for index in range(start_index, end_index):
            weather = self.read_hour(hourly, index)

            # Skip incomplete weather records.
            if weather is None:
                continue

            forecast.append(
                {
                    "hour_offset": index - start_index,
                    "forecast_time": forecast_times[index].isoformat(),
                    **weather,
                }
            )

        return forecast
