import uuid

from django.db import models


class ReadingSession(models.Model):
    """Sesion de lectura / Focus Mode (SRS 11.2, tabla 3; CU-03, CU-04)."""

    class SessionStatus(models.TextChoices):
        COMPLETED = "COMPLETED"
        EARLY_VALID = "EARLY_VALID"
        INVALIDATED_GRACE_EXPIRED = "INVALIDATED_GRACE_EXPIRED"

    # UUID generado por el cliente: base de la sync aditiva e idempotente (SRS 11.4).
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    book = models.ForeignKey(
        "garden.BookGarden", on_delete=models.CASCADE, related_name="reading_sessions"
    )
    planned_duration_sec = models.PositiveIntegerField()
    actual_duration_sec = models.PositiveIntegerField()
    # DECISION DE SPRINT 1 (docs/SRS_Komi_v1.md, "Decisiones de Sprint 1", punto 1):
    # guarda la HORA DE PARED LOCAL del dispositivo al iniciar la sesion, SIN zona horaria.
    # Con USE_TZ=True, Django lo almacena como timestamptz: el valor se asigna como datetime
    # consciente en UTC cuyo reloj es la hora local (ej. 23:50 en Bogota se guarda 23:50 UTC).
    # NO es un instante real: nunca convertirlo con astimezone() ni compararlo con instantes
    # reales. El desfase del cliente se descarta; las rachas usan solo started_at_local.date()
    # (streak_engine) para no romper lecturas que cruzan la medianoche (RF-06).
    started_at_local = models.DateTimeField()
    session_status = models.CharField(max_length=32, choices=SessionStatus.choices)
    progress_delta = models.DecimalField(max_digits=5, decimal_places=2)
    granted_solar_bonus = models.BooleanField(default=False)
    extracted_epub_excerpt = models.TextField(null=True, blank=True)

    def __str__(self) -> str:
        return f"ReadingSession {self.id}"
