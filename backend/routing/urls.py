from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health_check, name="health-check"),
    path("trips/validate/", views.validate_trip, name="validate-trip"),
    path("trips/routes/", views.generate_routes, name="generate-routes"),
    path("trips/checkpoints/", views.generate_checkpoints, name="generate-checkpoints"),
]
