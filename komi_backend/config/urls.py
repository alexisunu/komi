"""Enrutador principal (/api/v1/...). Cada bloque del Sprint 2 agrega sus rutas."""

from django.urls import include, path

urlpatterns = [
    path("api/v1/profile/", include("apps.profiles.urls")),
    path("api/v1/garden/", include("apps.garden.urls")),
    path("api/v1/", include("apps.reading_sessions.urls")),
]
