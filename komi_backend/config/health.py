"""Rutas de salud: sin autenticacion, sin datos del lector, sin cache.

- `GET /api/v1/health/`: el proceso responde (no toca la base de datos). La app la llama al abrir
  para despertar el servicio del plan gratuito y para saber si ya esta listo.
- `GET /api/v1/health/db/`: ademas hace `SELECT 1`; responde 503 si la base de datos no contesta.
  Sirve para las pruebas de humo del despliegue, no como comprobacion de salud de la plataforma
  (un fallo puntual de la base de datos no debe reiniciar el servicio).
"""

import logging

from asgiref.sync import sync_to_async
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.http import require_GET

logger = logging.getLogger(__name__)


def _json(payload: dict, status: int = 200) -> JsonResponse:
    response = JsonResponse(payload, status=status)
    response["Cache-Control"] = "no-store"
    return response


def _ping_database() -> None:
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
        cursor.fetchone()


@require_GET
async def health(request):
    return _json({"status": "ok"})


@require_GET
async def health_db(request):
    try:
        await sync_to_async(_ping_database)()
    except Exception as exc:
        # Solo el tipo: el mensaje puede incluir el servidor o el usuario de la base de datos.
        logger.error("Salud: la base de datos no responde (%s).", type(exc).__name__)
        return _json({"status": "error", "database": "unavailable"}, status=503)
    return _json({"status": "ok", "database": "ok"})
