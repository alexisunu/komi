from rest_framework import serializers

from apps.garden.models import BookGarden

MAX_TOTAL_PAGES = 100_000


class BookSerializer(serializers.ModelSerializer):
    """Representacion de un libro/girasol. El progreso y la etapa son solo de lectura."""

    progress_percentage = serializers.DecimalField(
        max_digits=5, decimal_places=2, coerce_to_string=False, read_only=True
    )

    class Meta:
        model = BookGarden
        fields = [
            "id",
            "title",
            "author",
            "format_type",
            "sunflower_variant",
            "growth_stage",
            "status",
            "progress_percentage",
            "total_pages",
            "current_page",
            "last_epub_cfi",
            "created_at",
            "completed_at",
            "updated_at",
        ]
        read_only_fields = fields


class BookCreateSerializer(serializers.Serializer):
    """Datos para plantar un libro (CU-02). El libro nace con 0% y estado ACTIVE."""

    # UUID generado en el cliente (offline-first); si falta, lo genera el servidor.
    id = serializers.UUIDField(required=False)
    title = serializers.CharField(max_length=255)
    author = serializers.CharField(max_length=255)
    format_type = serializers.ChoiceField(choices=BookGarden.FormatType.choices)
    sunflower_variant = serializers.ChoiceField(choices=BookGarden.SunflowerVariant.choices)
    total_pages = serializers.IntegerField(
        required=False, allow_null=True, min_value=1, max_value=MAX_TOTAL_PAGES
    )

    def validate(self, attrs):
        if attrs["format_type"] == BookGarden.FormatType.PHYSICAL:
            if attrs.get("total_pages") is None:
                raise serializers.ValidationError(
                    {"total_pages": "Es obligatorio para un libro fisico."}
                )
        else:
            # En EPUB el total de paginas no se usa: el progreso viene del lector.
            attrs["total_pages"] = None
        return attrs


class BookUpdateSerializer(serializers.Serializer):
    """Cambios permitidos con PATCH: titulo, autor y estado (SRS 17, punto 16).

    Cualquier otro campo (progreso, etapa, formato, paginas...) se rechaza: el progreso solo lo
    modifican las sesiones y la sincronizacion.
    """

    title = serializers.CharField(max_length=255, required=False)
    author = serializers.CharField(max_length=255, required=False)
    status = serializers.ChoiceField(
        choices=[BookGarden.Status.ACTIVE, BookGarden.Status.FALLOW], required=False
    )

    def to_internal_value(self, data):
        unknown = sorted(set(data) - set(self.fields))
        if unknown:
            raise serializers.ValidationError(
                {name: "Este campo no se puede modificar." for name in unknown}
            )
        return super().to_internal_value(data)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Indica al menos un campo para modificar.")
        if attrs.get("status") == BookGarden.Status.FALLOW and (
            self.instance.status == BookGarden.Status.BLOOMED
            or self.instance.progress_percentage >= 100
        ):
            raise serializers.ValidationError(
                {"status": "Un libro florecido no se puede poner en barbecho."}
            )
        return attrs
