from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.garden.serializers import BookSerializer
from apps.reading_sessions import services, stats_selectors
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


class WeeklyStatsView(APIView):
    """GET /api/v1/stats/weekly/ (CU-06).

    `?week=AAAA-Wss` elige la semana ISO. Sin `week`, `?today=AAAA-MM-DD` (la fecha local del
    cliente) elige la semana que la contiene; sin ninguno, la fecha UTC del servidor. `week` y
    `today` a la vez, o valores invalidos, responden 400.
    """

    def get(self, request):
        week = request.query_params.get("week")
        today = request.query_params.get("today")
        if week is not None and today is not None:
            raise serializers.ValidationError({"week": "Usa week o today, no los dos a la vez."})
        try:
            if week is not None:
                monday = stats_selectors.monday_of_week(week)
            elif today is not None:
                monday = stats_selectors.monday_of_date(today)
            else:
                monday = stats_selectors.monday_of_date(timezone.now().date().isoformat())
        except stats_selectors.InvalidWeek as error:
            raise serializers.ValidationError({"week": str(error)}) from None
        except stats_selectors.InvalidDate as error:
            raise serializers.ValidationError({"today": str(error)}) from None
        return Response(stats_selectors.weekly_stats(request.auth, monday))
