import uuid

from django.conf import settings
from django.db import models


class ReaderProfile(models.Model):
    """Perfil y motor de habitos (SRS 11.2, tabla 1; CU-01)."""

    class PreferredMoment(models.TextChoices):
        MORNING = "MORNING"
        AFTERNOON = "AFTERNOON"
        NIGHT = "NIGHT"
        COMMUTE = "COMMUTE"

    class AiReflectionStyle(models.TextChoices):
        MEMORY_QUIZ = "MEMORY_QUIZ"
        DEEP_ANALYSIS = "DEEP_ANALYSIS"
        KEY_SUMMARY = "KEY_SUMMARY"

    # UUID generado en el cliente PWA (offline-first); el default solo cubre otros usos.
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Nulo en modo local anonimo; se vincula al autenticar (RF-07).
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reader_profile",
    )
    daily_goal_minutes = models.IntegerField(default=15)
    preferred_moment = models.CharField(max_length=16, choices=PreferredMoment.choices)
    ai_reflection_style = models.CharField(max_length=16, choices=AiReflectionStyle.choices)
    current_streak = models.IntegerField(default=0)
    longest_streak = models.IntegerField(default=0)
    # Fecha calendario LOCAL de la ultima sesion valida (RF-06).
    last_valid_session_date = models.DateField(null=True, blank=True)

    def __str__(self) -> str:
        return f"ReaderProfile {self.id}"
