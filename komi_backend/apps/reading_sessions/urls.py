from django.urls import path

from apps.reading_sessions import views

urlpatterns = [
    path("sessions/complete/", views.SessionCompleteView.as_view(), name="sessions-complete"),
    path("stats/weekly/", views.WeeklyStatsView.as_view(), name="stats-weekly"),
]
