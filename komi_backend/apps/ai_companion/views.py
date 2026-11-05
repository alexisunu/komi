from django.http import StreamingHttpResponse
from rest_framework import status
from rest_framework.negotiation import BaseContentNegotiation
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.ai_companion import services
from apps.ai_companion.serializers import MessageSerializer, StartSerializer, serialize_chat
from apps.ai_companion.streaming import stream_reply_events


class IgnoreAcceptNegotiation(BaseContentNegotiation):
    """Un EventSource envia `Accept: text/event-stream`, que DRF no sabe servir (406)."""

    def select_parser(self, request, parsers):
        return parsers[0]

    def select_renderer(self, request, renderers, format_suffix=None):
        return renderers[0], renderers[0].media_type


class StartView(APIView):
    """POST /api/v1/companion/start/ (CU-05). JSON con el Turno 1 local, sin Gemini."""

    def post(self, request):
        serializer = StartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        chat, created = services.start_chat(request.auth, serializer.validated_data["session_id"])
        code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response(serialize_chat(chat), status=code)


class MessageView(APIView):
    """POST /api/v1/companion/{chat_id}/message/ (RNF-03). Responde por SSE."""

    content_negotiation_class = IgnoreAcceptNegotiation

    def post(self, request, chat_id):
        serializer = MessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        claim = services.claim_reply(
            request.auth,
            chat_id,
            serializer.validated_data["content"],
            serializer.validated_data.get("turn"),
        )
        response = StreamingHttpResponse(
            stream_reply_events(claim), content_type="text/event-stream; charset=utf-8"
        )
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        # Si el generador nunca llega a arrancar (cliente caido), cerrar la respuesta libera
        # igualmente la reserva.
        response._resource_closers.append(
            lambda: services.release_claim(claim.chat_id, claim.token)
        )
        return response
