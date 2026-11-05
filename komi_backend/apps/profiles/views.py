from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.ai_companion.serializers import serialize_chat
from apps.garden.serializers import BookSerializer
from apps.profiles import services, sync
from apps.profiles.models import ReaderProfile
from apps.profiles.serializers import OnboardingSerializer, SyncBatchSerializer
from apps.reading_sessions.serializers import serialize_session


def _profile_payload(profile: ReaderProfile, preconfigure_tsukimi: bool | None) -> dict:
    return {
        "profile_id": str(profile.id),
        "daily_goal_minutes": profile.daily_goal_minutes,
        "preferred_moment": profile.preferred_moment,
        "ai_reflection_style": profile.ai_reflection_style,
        "preconfigure_tsukimi": preconfigure_tsukimi,
    }


def streak_payload(profile: ReaderProfile) -> dict:
    last = profile.last_valid_session_date
    return {
        "current": profile.current_streak,
        "longest": profile.longest_streak,
        "last_valid_session_date": last.isoformat() if last else None,
    }


class OnboardingView(APIView):
    """POST /api/v1/profile/onboarding/ (CU-01). Unico endpoint sin X-Profile-Id.

    Crea el perfil con el UUID del cliente. Es idempotente: si el perfil ya existe devuelve sus
    datos guardados con 200 y NO los modifica (asi nadie puede reescribir un perfil ajeno
    conociendo solo su UUID). En ese caso `preconfigure_tsukimi` es null, porque las respuestas
    del cuestionario no se guardan.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = OnboardingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        profile_id = serializer.validated_data["profile_id"]
        plan = services.calculate_habit_plan(**serializer.validated_data["answers"])

        profile, created = ReaderProfile.objects.get_or_create(
            id=profile_id,
            defaults={
                "daily_goal_minutes": plan.daily_goal_minutes,
                "preferred_moment": plan.preferred_moment,
                "ai_reflection_style": plan.ai_reflection_style,
            },
        )
        if created:
            return Response(
                _profile_payload(profile, plan.preconfigure_tsukimi),
                status=status.HTTP_201_CREATED,
            )
        return Response(_profile_payload(profile, None), status=status.HTTP_200_OK)


class SyncView(APIView):
    """POST /api/v1/profile/sync/ (CU-06, RNF-04). Ver `apps.profiles.sync`."""

    def post(self, request):
        batch = SyncBatchSerializer(data=request.data)
        batch.is_valid(raise_exception=True)
        report = sync.sync_batch(
            request.auth.id, batch.validated_data["books"], batch.validated_data["sessions"]
        )
        profile = report.pop("profile")
        report["server_books"] = BookSerializer(report["server_books"], many=True).data
        report["streak"] = streak_payload(profile)
        return Response(report)


class RestoreView(APIView):
    """GET /api/v1/profile/sync/restore/: hidrata un cliente que perdio su IndexedDB."""

    def get(self, request):
        data = sync.restore_profile(request.auth.id)
        profile = data["profile"]
        return Response(
            {
                "profile": {
                    "profile_id": str(profile.id),
                    "daily_goal_minutes": profile.daily_goal_minutes,
                    "preferred_moment": profile.preferred_moment,
                    "ai_reflection_style": profile.ai_reflection_style,
                },
                "streak": streak_payload(profile),
                "books": BookSerializer(data["books"], many=True).data,
                "sessions": [serialize_session(s) for s in data["sessions"]],
                "chats": [serialize_chat(c) for c in data["chats"]],
            }
        )
