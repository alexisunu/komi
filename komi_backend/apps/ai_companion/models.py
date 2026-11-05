import uuid

from django.db import models


class ReflectionChat(models.Model):
    """Charla reflexiva con Komi (SRS 11.2, tabla 4; CU-05)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.OneToOneField(
        "reading_sessions.ReadingSession",
        on_delete=models.CASCADE,
        related_name="reflection_chat",
    )
    # Ciclo Zen: 1 a 5 intercambios (RF-05). El limite lo aplica el backend, no el cliente.
    turn_count = models.SmallIntegerField(default=1)
    is_closed = models.BooleanField(default=False)
    key_takeaway = models.TextField(null=True, blank=True)
    # Candado de "respuesta en curso" (SRS 17, punto 20): marca de tiempo del envio que esta
    # esperando a Gemini. Nulo cuando nadie esta respondiendo. Un candado de mas de 90 s se
    # considera vencido (proceso caido).
    pending_since = models.DateTimeField(null=True, blank=True)

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
            # Red de seguridad: un solo mensaje por autor y turno dentro de una charla.
            models.UniqueConstraint(
                fields=["chat", "sender", "turn_number"],
                name="reflectionmessage_one_per_sender_and_turn",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.sender} turno {self.turn_number}"
