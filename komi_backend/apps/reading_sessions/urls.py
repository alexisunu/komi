from django.urls import path

from apps.reading_sessions import views

urlpatterns = [
    path("complete/", views.SessionCompleteView.as_view(), name="sessions-complete"),
]
