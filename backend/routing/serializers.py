from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

# The forecast covers about 16 days, and the 48-hour heatmap and the drive must fit inside it.
MAX_DAYS_AHEAD = 13
MAX_HOURS_PAST = 24


class TripRequestSerializer(serializers.Serializer):
    origin = serializers.CharField(max_length=255)

    destination = serializers.CharField(max_length=255)

    departure_datetime = serializers.DateTimeField()

    load_weight = serializers.FloatField(min_value=1)

    checkpoint_interval = serializers.ChoiceField(choices=[10, 25, 50], default=25)

    def validate_departure_datetime(self, value):

        now = timezone.now()

        if value < now - timedelta(hours=MAX_HOURS_PAST):
            raise serializers.ValidationError("Departure cannot be more than a day in the past.")

        if value > now + timedelta(days=MAX_DAYS_AHEAD):
            raise serializers.ValidationError(
                f"Weather forecasts only allow departures up to {MAX_DAYS_AHEAD} days ahead."
            )

        return value

    def validate(self, data):

        if data["origin"].strip().lower() == data["destination"].strip().lower():
            raise serializers.ValidationError("Origin and destination cannot be the same.")

        data["origin"] = data["origin"].strip()
        data["destination"] = data["destination"].strip()

        return data
