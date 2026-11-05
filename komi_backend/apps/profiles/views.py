from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.profiles import services
from apps.profiles.models import ReaderProfile
from apps.profiles.serializers import OnboardingSerializer


def _profile_payload(profile: ReaderProfile, preconfigure_tsukimi: bool | None) -> dict:
    return {
        "profile_id": str(profile.id),
        "daily_goal_minutes": profile.daily_goal_minutes,
        "preferred_moment": profile.preferred_moment,
        "ai_reflection_style": profile.ai_reflection_style,
        "preconfigure_tsukimi": preconfigure_tsukimi,
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
