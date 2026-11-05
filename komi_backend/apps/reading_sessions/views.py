from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.garden.serializers import BookSerializer
from apps.reading_sessions import services
from apps.reading_sessions.serializers import SessionPayloadSerializer, serialize_session


class SessionCompleteView(APIView):
    """POST /api/v1/sessions/complete/ (CU-04).

    Idempotente por el UUID de la sesion: el primer envio responde 201 y los reintentos 200 con
    el estado actual, sin duplicar sesion, progreso ni racha.
    """

    def post(self, request):
        serializer = SessionPayloadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = services.complete_session(request.auth.id, dict(serializer.validated_data))

        profile = result.profile
        body = {
            "session": serialize_session(result.session),
            "book": BookSerializer(result.book).data,
            "just_bloomed": result.just_bloomed,
            "streak": {
                "current": profile.current_streak,
                "longest": profile.longest_streak,
                "last_valid_session_date": (
                    profile.last_valid_session_date.isoformat()
                    if profile.last_valid_session_date
                    else None
                ),
            },
        }
        return Response(body, status=status.HTTP_201_CREATED if result.created else 200)
