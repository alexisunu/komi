from django.urls import path

from apps.profiles import views

urlpatterns = [
    path("onboarding/", views.OnboardingView.as_view(), name="profile-onboarding"),
]
