"""Manejador de excepciones de DRF: un cuerpo demasiado grande responde 413 y no 400."""

from django.core.exceptions import RequestDataTooBig
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler


def exception_handler(exc, context):
    if isinstance(exc, RequestDataTooBig):
        return Response(
            {"detail": "El cuerpo de la peticion es demasiado grande; divide el lote."},
            status=413,
        )
    return drf_exception_handler(exc, context)
