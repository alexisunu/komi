from rest_framework import serializers

from apps.garden.models import BookGarden
from apps.garden.serializers import MAX_TOTAL_PAGES
from apps.profiles import services
from apps.reading_sessions.serializers import MAX_CFI_CHARS

_ABCD = ["A", "B", "C", "D"]


class OnboardingAnswersSerializer(serializers.Serializer):
    q1 = serializers.ChoiceField(choices=_ABCD)
    q2 = serializers.ChoiceField(choices=list(services.BASE_MINUTES))
    q3 = serializers.ChoiceField(choices=list(services.MOMENTS))
    q4 = serializers.ChoiceField(choices=_ABCD)
    q5 = serializers.ChoiceField(choices=list(services.STYLES))


class OnboardingSerializer(serializers.Serializer):
    # UUID generado en el cliente (offline-first, SRS 11.2).
    profile_id = serializers.UUIDField()
    answers = OnboardingAnswersSerializer()


# --- Sincronizacion offline-first (SRS 11.4 y 17, punto 18) ---

MAX_SYNC_BOOKS = 100
MAX_SYNC_SESSIONS = 200


class SyncBookSerializer(serializers.Serializer):
    """Un libro del lote. El servidor recalcula el progreso fisico a partir de las paginas."""

    id = serializers.UUIDField()
    title = serializers.CharField(max_length=255)
    author = serializers.CharField(max_length=255)
    format_type = serializers.ChoiceField(choices=BookGarden.FormatType.choices)
    sunflower_variant = serializers.ChoiceField(choices=BookGarden.SunflowerVariant.choices)
    # BLOOMED y GROWING los deriva el servidor; el cliente solo pide ACTIVE o FALLOW.
    status = serializers.ChoiceField(
        choices=[BookGarden.Status.ACTIVE, BookGarden.Status.FALLOW],
        default=BookGarden.Status.ACTIVE,
    )
    total_pages = serializers.IntegerField(
        required=False, allow_null=True, min_value=1, max_value=MAX_TOTAL_PAGES
    )
    current_page = serializers.IntegerField(required=False, min_value=0, default=0)
    progress_percentage = serializers.DecimalField(
        required=False, max_digits=5, decimal_places=2, min_value=0, max_value=100, default=0
    )
    last_epub_cfi = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, max_length=MAX_CFI_CHARS
    )
    updated_at = serializers.DateTimeField()


class SyncBatchSerializer(serializers.Serializer):
    """Lote completo. Los elementos se validan uno a uno para rechazarlos por separado."""

    books = serializers.ListField(
        child=serializers.JSONField(), max_length=MAX_SYNC_BOOKS, required=False, default=list
    )
    sessions = serializers.ListField(
        child=serializers.JSONField(), max_length=MAX_SYNC_SESSIONS, required=False, default=list
    )
