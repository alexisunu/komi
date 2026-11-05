from rest_framework import serializers

MAX_MESSAGE_CHARS = 2000  # SRS 17, punto 12.


class StartSerializer(serializers.Serializer):
    session_id = serializers.UUIDField()


class MessageSerializer(serializers.Serializer):
    content = serializers.CharField(max_length=MAX_MESSAGE_CHARS)
    # Turno de Komi al que responde el lector (1 a 4). Opcional: si llega y no coincide con el
    # estado de la charla, 409 `turn_mismatch`. Hace seguro reintentar un envio cuya respuesta
    # se perdio por red.
    turn = serializers.IntegerField(required=False, min_value=1, max_value=4)


def serialize_chat(chat) -> dict:
    return {
        "chat_id": str(chat.id),
        "session_id": str(chat.session_id),
        "turn_count": chat.turn_count,
        "is_closed": chat.is_closed,
        "key_takeaway": chat.key_takeaway,
        "messages": [
            {
                "id": message.id,
                "sender": message.sender,
                "content": message.content,
                "turn_number": message.turn_number,
                "created_at": message.created_at.isoformat(),
            }
            for message in chat.messages.all()
        ],
    }
