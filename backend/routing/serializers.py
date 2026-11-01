from rest_framework import serializers


class TripRequestSerializer(serializers.Serializer):
    origin = serializers.CharField(max_length=255)

    destination = serializers.CharField(max_length=255)

    departure_datetime = serializers.DateTimeField()

    load_weight = serializers.FloatField(min_value=1)

    checkpoint_interval = serializers.ChoiceField(choices=[10, 25, 50], default=25)

    def validate(self, data):

        if data["origin"].strip().lower() == data["destination"].strip().lower():
            raise serializers.ValidationError("Origin and destination cannot be the same.")

        data["origin"] = data["origin"].strip()
        data["destination"] = data["destination"].strip()

        return data
