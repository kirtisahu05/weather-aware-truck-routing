from datetime import datetime, timezone

import requests


class WeatherService:
    BASE_URL = "https://api.open-meteo.com/v1/forecast"

    def parse_utc_datetime(self, value):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))

        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)

        return parsed.astimezone(timezone.utc)

    def fetch_weather(self, checkpoints, departure_datetime=None):

        if not checkpoints:
            return []

        results = []

        # Batch coordinates to reduce external API requests.
        # Open-Meteo supports multiple locations in one request.
        batch_size = 50

        for start in range(0, len(checkpoints), batch_size):
            batch = checkpoints[start : start + batch_size]

            latitudes = ",".join(str(point["latitude"]) for point in batch)

            longitudes = ",".join(str(point["longitude"]) for point in batch)

            params = {
                "latitude": latitudes,
                "longitude": longitudes,
                "hourly": ("wind_speed_10m,rain,snowfall"),
                "wind_speed_unit": "mph",
                "timezone": "UTC",
                "forecast_days": 16,
                "past_days": 1,
            }

            response = requests.get(self.BASE_URL, params=params, timeout=60)

            response.raise_for_status()

            data = response.json()

            # Open-Meteo returns a list for multiple locations.
            if isinstance(data, dict):
                weather_locations = [data]
            else:
                weather_locations = data

            if len(weather_locations) != len(batch):
                raise ValueError("Weather response location count mismatch")

            for checkpoint, weather_data in zip(batch, weather_locations):
                # Extract weather for the checkpoint's ETA.
                checkpoint_result = self.extract_checkpoint_weather(checkpoint, weather_data)

                # Attach hourly weather from departure through +48 hours.
                if departure_datetime is not None:
                    checkpoint_result["hourly_forecast"] = self.extract_hourly_forecast(
                        weather_data, departure_datetime, hours=49
                    )

                results.append(checkpoint_result)

        return results

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

        wind_values = hourly.get("wind_speed_10m", [])
        rain_values = hourly.get("rain", [])
        snow_values = hourly.get("snowfall", [])

        wind = wind_values[nearest_index]
        rain = rain_values[nearest_index]
        snow = snow_values[nearest_index]

        if wind is None or rain is None or snow is None:
            raise ValueError("Weather data is incomplete for checkpoint")

        return {
            **checkpoint,
            "weather": {
                "forecast_time": nearest_time.isoformat(),
                "wind_mph": round(float(wind), 2),
                "rain_inches_per_hour": round(float(rain) / 25.4, 4),
                "snow_inches_per_hour": round(float(snow) / 2.54, 4),
            },
        }

    def extract_hourly_forecast(self, weather_data, departure_datetime, hours=49):

        hourly = weather_data.get("hourly", {})

        times = hourly.get("time", [])
        winds = hourly.get("wind_speed_10m", [])
        rains = hourly.get("rain", [])
        snows = hourly.get("snowfall", [])

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
            # Skip incomplete weather records.
            if winds[index] is None or rains[index] is None or snows[index] is None:
                continue

            forecast.append(
                {
                    "hour_offset": index - start_index,
                    "forecast_time": forecast_times[index].isoformat(),
                    "wind_mph": round(float(winds[index]), 2),
                    "rain_inches_per_hour": round(float(rains[index]) / 25.4, 4),
                    "snow_inches_per_hour": round(float(snows[index]) / 2.54, 4),
                }
            )

        return forecast
