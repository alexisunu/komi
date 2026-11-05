from django.urls import path

from apps.ai_companion import views

urlpatterns = [
    path("start/", views.StartView.as_view(), name="companion-start"),
    path("<uuid:chat_id>/message/", views.MessageView.as_view(), name="companion-message"),
]
