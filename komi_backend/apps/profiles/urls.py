from django.urls import path

from apps.profiles import views

urlpatterns = [
    path("onboarding/", views.OnboardingView.as_view(), name="profile-onboarding"),
    path("sync/", views.SyncView.as_view(), name="profile-sync"),
    path("sync/restore/", views.RestoreView.as_view(), name="profile-restore"),
]
