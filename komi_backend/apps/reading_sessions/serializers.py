from datetime import UTC, datetime, timedelta

from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ErrorDetail

from apps.reading_sessions.models import ReadingSession

MIN_PLANNED_SEC = 5 * 60  # CU-03: de 5:00 a 120:00 minutos.
MAX_PLANNED_SEC = 120 * 60
MAX_EXCERPT_CHARS = 20_000  # SRS 17, punto 12.
MAX_CFI_CHARS = 2_000
# La hora local mas adelantada del planeta es UTC+14; se tolera un margen de 5 minutos.
MAX_LOCAL_CLOCK_LEAD = timedelta(hours=14, minutes=5)


class LocalWallClockField(serializers.Field):
    """Hora de pared local del dispositivo (convencion de ReadingSession.started_at_local).

    Se conservan los digitos del reloj y se descarta cualquier desfase (`-05:00`, `Z`): la
    racha usa solo la fecha local, y convertir a UTC la moveria de dia. El valor se guarda
    etiquetado como UTC, sin convertir. Se devuelve sin zona.
    """

    default_error_messages = {"invalid": "Fecha y hora local no valida (formato ISO 8601)."}

    def to_internal_value(self, value):
        if not isinstance(value, str) or len(value) < 11:
            self.fail("invalid")
        try:
            parsed = datetime.fromisoformat(value.strip())
        except ValueError:
            self.fail("invalid")
        return parsed.replace(tzinfo=UTC)

    def to_representation(self, value):
        return value.replace(tzinfo=None).isoformat()


class SessionPayloadSerializer(serializers.Serializer):
    """Cierre de una sesion de lectura (CU-04). El progreso se valida segun el formato."""

    # UUID de la sesion, generado por el cliente: hace idempotente el reintento (SRS 11.4).
    id = serializers.UUIDField()
    book_id = serializers.UUIDField()
    planned_duration_sec = serializers.IntegerField(
        min_value=MIN_PLANNED_SEC, max_value=MAX_PLANNED_SEC
    )
    actual_duration_sec = serializers.IntegerField(min_value=0)
    started_at_local = LocalWallClockField()
    session_status = serializers.ChoiceField(choices=ReadingSession.SessionStatus.choices)
    # Libro fisico: pagina alcanzada. EPUB: porcentaje, CFI y extracto de la sesion.
    current_page = serializers.IntegerField(required=False, min_value=0)
    progress_percentage = serializers.DecimalField(
        required=False, max_digits=5, decimal_places=2, min_value=0, max_value=100
    )
    last_epub_cfi = serializers.CharField(
        required=False, allow_blank=True, max_length=MAX_CFI_CHARS
    )
    extracted_epub_excerpt = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
        max_length=MAX_EXCERPT_CHARS,
        trim_whitespace=False,
    )

    def validate(self, attrs):
        if attrs["actual_duration_sec"] > attrs["planned_duration_sec"]:
            raise serializers.ValidationError(
                {"actual_duration_sec": "No puede superar la duracion programada."}
            )
        limit = timezone.now() + MAX_LOCAL_CLOCK_LEAD
        if attrs["started_at_local"] > limit:
            raise serializers.ValidationError(
                {
                    "started_at_local": ErrorDetail(
                        "La hora de inicio esta en el futuro.", code="future_start"
                    )
                }
            )
        return attrs


def serialize_session(session: ReadingSession) -> dict:
    return {
        "id": str(session.id),
        "book_id": str(session.book_id),
        "planned_duration_sec": session.planned_duration_sec,
        "actual_duration_sec": session.actual_duration_sec,
        "started_at_local": LocalWallClockField().to_representation(session.started_at_local),
        "session_status": session.session_status,
        "progress_delta": float(session.progress_delta),
        "granted_solar_bonus": session.granted_solar_bonus,
    }
