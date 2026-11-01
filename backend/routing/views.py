import requests
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .serializers import TripRequestSerializer
from .services.checkpoint_service import CheckpointService
from .services.recommendation import RecommendationEngine
from .services.risk_engine import RiskEngine
from .services.route_service import MapboxRoutingService
from .services.weather_service import WeatherService


@api_view(["GET"])
def health_check(request):
    return Response(
        {"status": "success", "message": "Truck Route Safety API is running", "version": "1.0"}
    )


@api_view(["POST"])
def validate_trip(request):
    serializer = TripRequestSerializer(data=request.data)

    if serializer.is_valid():
        return Response(
            {
                "status": "success",
                "message": "Trip information validated successfully",
                "trip": serializer.validated_data,
            },
            status=status.HTTP_200_OK,
        )

    return Response(
        {"status": "error", "errors": serializer.errors}, status=status.HTTP_400_BAD_REQUEST
    )


@api_view(["POST"])
def generate_routes(request):
    serializer = TripRequestSerializer(data=request.data)

    if not serializer.is_valid():
        return Response(
            {"status": "error", "errors": serializer.errors}, status=status.HTTP_400_BAD_REQUEST
        )

    trip = serializer.validated_data

    try:
        routing_service = MapboxRoutingService()

        route_data = routing_service.get_routes(trip["origin"], trip["destination"])

        return Response(
            {
                "status": "success",
                "message": "Routes generated successfully",
                "trip": {
                    "origin": trip["origin"],
                    "destination": trip["destination"],
                    "departure_datetime": trip["departure_datetime"],
                    "load_weight": trip["load_weight"],
                    "checkpoint_interval": trip["checkpoint_interval"],
                },
                "routing": route_data,
            },
            status=status.HTTP_200_OK,
        )

    except requests.RequestException as error:
        return Response(
            {
                "status": "error",
                "message": "Routing provider request failed",
                "details": str(error),
            },
            status=status.HTTP_502_BAD_GATEWAY,
        )

    except ValueError as error:
        return Response(
            {"status": "error", "message": str(error)}, status=status.HTTP_400_BAD_REQUEST
        )


@api_view(["POST"])
def generate_checkpoints(request):
    serializer = TripRequestSerializer(data=request.data)

    if not serializer.is_valid():
        return Response(
            {"status": "error", "errors": serializer.errors}, status=status.HTTP_400_BAD_REQUEST
        )

    trip = serializer.validated_data

    try:
        # Step 1: Generate routes
        routing_service = MapboxRoutingService()

        route_data = routing_service.get_routes(trip["origin"], trip["destination"])

        checkpoint_service = CheckpointService()

        all_checkpoints = []
        route_results = {}

        # Step 2: Generate checkpoints for each route
        for route in route_data["routes"]:
            checkpoint_data = checkpoint_service.generate_checkpoints(
                geometry=route["geometry"],
                interval_miles=trip["checkpoint_interval"],
                duration_seconds=route["duration_seconds"],
                departure_datetime=trip["departure_datetime"],
            )

            route_id = route["route_id"]

            route_results[route_id] = {
                "route_id": route_id,
                "route_name": route["route_name"],
                "distance_miles": route["distance_miles"],
                "duration_hours": route["duration_hours"],
                "duration_seconds": route["duration_seconds"],
                "geometry": route["geometry"],
                "checkpoints": [],
            }

            for checkpoint in checkpoint_data["checkpoints"]:
                checkpoint["route_id"] = route_id
                all_checkpoints.append(checkpoint)

        # Step 3: Fetch checkpoint weather and hourly forecasts
        weather_service = WeatherService()

        weather_results = weather_service.fetch_weather(
            all_checkpoints, departure_datetime=trip["departure_datetime"]
        )

        # Step 4: Calculate checkpoint and hourly forecast risks
        risk_engine = RiskEngine()

        for checkpoint in weather_results:
            route_id = checkpoint["route_id"]

            # Risk at the checkpoint's estimated arrival time
            checkpoint["risk"] = risk_engine.calculate_checkpoint_risk(
                weather=checkpoint["weather"], load_weight=trip["load_weight"]
            )

            # Risk at each hour from departure (0–48)
            for forecast in checkpoint.get("hourly_forecast", []):
                forecast["risk"] = risk_engine.calculate_checkpoint_risk(
                    weather=forecast, load_weight=trip["load_weight"]
                )

            route_results[route_id]["checkpoints"].append(checkpoint)

        # Step 5: Calculate route risk summaries
        recommendation_engine = RecommendationEngine()

        for route in route_results.values():
            route["risk_summary"] = recommendation_engine.summarize_route(route)

        # Step 6: Select the safest route
        recommendation = recommendation_engine.recommend_route(list(route_results.values()))

        # Step 7: Return the response
        return Response(
            {
                "status": "success",
                "message": "Weather checkpoints generated successfully",
                "trip": {
                    "origin": trip["origin"],
                    "destination": trip["destination"],
                    "departure_datetime": (trip["departure_datetime"].isoformat()),
                    "load_weight": trip["load_weight"],
                    "checkpoint_interval": trip["checkpoint_interval"],
                },
                "routes": list(route_results.values()),
                "recommendation": recommendation,
            },
            status=status.HTTP_200_OK,
        )

    except requests.RequestException as error:
        return Response(
            {"status": "error", "message": "External API request failed", "details": str(error)},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    except ValueError as error:
        return Response(
            {"status": "error", "message": str(error)}, status=status.HTTP_400_BAD_REQUEST
        )
