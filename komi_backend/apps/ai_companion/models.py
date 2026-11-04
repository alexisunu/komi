from django.db import models


class ReflectionChat(models.Model):
    """Charla reflexiva con Komi (SRS 11.2, tabla 4; CU-05)."""

    session = models.OneToOneField(
        "reading_sessions.ReadingSession",
        on_delete=models.CASCADE,
        related_name="reflection_chat",
    )
    # Ciclo Zen: 1 a 5 intercambios (RF-05). El limite lo aplica el backend, no el cliente.
    turn_count = models.SmallIntegerField(default=1)
    is_closed = models.BooleanField(default=False)
    key_takeaway = models.TextField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(turn_count__gte=1, turn_count__lte=5),
                name="reflectionchat_turn_count_1_5",
            ),
        ]

    def __str__(self) -> str:
        return f"ReflectionChat {self.pk} (turno {self.turn_count}/5)"


class ReflectionMessage(models.Model):
    """Historial de mensajes del chat (SRS 11.2, tabla 5)."""

    class Sender(models.TextChoices):
        KOMI_AI = "KOMI_AI"
        USER = "USER"

    chat = models.ForeignKey(ReflectionChat, on_delete=models.CASCADE, related_name="messages")
    sender = models.CharField(max_length=8, choices=Sender.choices)
    content = models.TextField()
    turn_number = models.SmallIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(turn_number__gte=1, turn_number__lte=5),
                name="reflectionmessage_turn_number_1_5",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.sender} turno {self.turn_number}"
