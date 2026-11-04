import uuid
from decimal import Decimal

from django.db import models


class GrowthStage(models.TextChoices):
    SEED_1 = "SEED_1"
    STEM_2 = "STEM_2"
    BUD_3 = "BUD_3"
    BLOOM_4 = "BLOOM_4"


def stage_for_progress(progress: Decimal | float | int) -> str:
    """Etapa del girasol segun el avance.

    Umbrales: <25 semilla, <60 tallo, <100 capullo, 100 flor. Se usan umbrales y no rangos
    enteros porque progress_percentage es decimal.
    """
    if progress >= 100:
        return GrowthStage.BLOOM_4
    if progress >= 60:
        return GrowthStage.BUD_3
    if progress >= 25:
        return GrowthStage.STEM_2
    return GrowthStage.SEED_1


class BookGarden(models.Model):
    """Entidad unificada libro-girasol (SRS 11.2, tabla 2; CU-02, RF-01)."""

    class FormatType(models.TextChoices):
        EPUB = "EPUB"
        PHYSICAL = "PHYSICAL"

    class SunflowerVariant(models.TextChoices):
        CLASSIC = "CLASSIC"
        SOLAR = "SOLAR"
        AUTUMN = "AUTUMN"

    class Status(models.TextChoices):
        # ACTIVE y GROWING estan en el SRS sin diferenciar; aun sin logica propia.
        ACTIVE = "ACTIVE"
        GROWING = "GROWING"
        BLOOMED = "BLOOMED"
        FALLOW = "FALLOW"  # archivado "en barbecho"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    profile = models.ForeignKey(
        "profiles.ReaderProfile", on_delete=models.CASCADE, related_name="books"
    )
    title = models.CharField(max_length=255)
    author = models.CharField(max_length=255)
    format_type = models.CharField(max_length=16, choices=FormatType.choices)
    sunflower_variant = models.CharField(max_length=16, choices=SunflowerVariant.choices)
    growth_stage = models.CharField(
        max_length=16, choices=GrowthStage.choices, default=GrowthStage.SEED_1
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    progress_percentage = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("0.00")
    )
    total_pages = models.IntegerField(null=True, blank=True)  # requerido si es PHYSICAL
    current_page = models.IntegerField(default=0)
    last_epub_cfi = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    # No esta en la tabla 11.2 pero la exige la regla de sync de 11.4 (marca temporal mas reciente).
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(progress_percentage__gte=0, progress_percentage__lte=100),
                name="bookgarden_progress_0_100",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.title} ({self.author})"

    def save(self, *args, **kwargs):
        # growth_stage es derivado de progress_percentage: se mantiene coherente al guardar.
        self.growth_stage = stage_for_progress(self.progress_percentage)
        update_fields = kwargs.get("update_fields")
        if update_fields is not None and "progress_percentage" in update_fields:
            kwargs["update_fields"] = {*update_fields, "growth_stage"}
        super().save(*args, **kwargs)
