from rest_framework import serializers

from apps.profiles import services

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
