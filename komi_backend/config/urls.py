"""Enrutador principal (/api/v1/...). Cada bloque del Sprint 2 agrega sus rutas."""

from django.urls import include, path

from config import health

urlpatterns = [
    path("api/v1/health/", health.health, name="health"),
    path("api/v1/health/db/", health.health_db, name="health-db"),
    path("api/v1/profile/", include("apps.profiles.urls")),
    path("api/v1/garden/", include("apps.garden.urls")),
    path("api/v1/companion/", include("apps.ai_companion.urls")),
    path("api/v1/", include("apps.reading_sessions.urls")),
]
