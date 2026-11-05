"""Cliente de Gemini con streaming y cambio de modelo ante cuota agotada (SRS 14.3 y 14.4).

- Los nombres de modelo y la clave vienen solo de la configuracion (.env), nunca del codigo.
- Ante un HTTP 429 del modelo principal, antes de emitir texto, se reintenta con el de respaldo
  en la misma peticion. Un 429 a mitad de respuesta no cambia de modelo para no duplicar texto.
- El marcador `[SEMILLA_DEL_DIA]:` del Turno 5 se separa en el servidor con un bufer que lo
  detecta aunque llegue partido entre fragmentos (SRS 17, punto 9).
- No se registra el contenido de prompts ni de respuestas, ni la clave.
"""

import logging
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from functools import lru_cache

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from google import genai
from google.genai import errors, types

from apps.ai_companion.models import ReflectionMessage
from apps.ai_companion.prompt_builder import SEED_MARKER, SESSION_START_USER_TURN

logger = logging.getLogger(__name__)

# Parametros de generacion de SRS 14.4.
# max_output_tokens incluye los tokens de razonamiento; 1024 es un colchon (SRS 17, punto 14).
# La longitud de 50 a 90 palabras la controla el prompt, no este tope.
MAX_OUTPUT_TOKENS = 1024
TEMPERATURE = 0.65
# Los modelos 3.x se controlan con thinking_level (no thinking_budget). "minimal" es el nivel
# mas bajo documentado; no existe un valor para apagar el razonamiento por completo.
THINKING_LEVEL = types.ThinkingLevel.MINIMAL

_ROLE_BY_SENDER = {
    ReflectionMessage.Sender.KOMI_AI: "model",
    ReflectionMessage.Sender.USER: "user",
}


class GeminiError(Exception):
    """Error base del cliente de Gemini."""


class GeminiQuotaError(GeminiError):
    """Cuota agotada (HTTP 429) sin modelo de respaldo disponible."""

    def __init__(self, retry_after: float | None = None):
        super().__init__("Cuota de Gemini agotada.")
        self.retry_after = retry_after


class GeminiUnavailableError(GeminiError):
    """Fallo de red, de la API o respuesta vacia."""


class GeminiTruncatedError(GeminiError):
    """La respuesta se corto por alcanzar max_output_tokens (finish_reason MAX_TOKENS).

    El texto parcial no debe guardarse ni mostrarse como respuesta valida de Komi.
    """


@dataclass(frozen=True)
class TextChunk:
    text: str


@dataclass(frozen=True)
class Finished:
    text: str
    key_takeaway: str | None
    model: str | None


class SeedMarkerFilter:
    """Separa `[SEMILLA_DEL_DIA]:` del texto visible durante el streaming.

    `feed` devuelve el texto que ya es seguro mostrar. Retiene lo que podria ser el inicio del
    marcador y los espacios finales, para que ni el marcador ni la separacion previa lleguen
    al lector. `finish` devuelve el resto visible y la frase de la semilla (o None).
    """

    def __init__(self, marker: str = SEED_MARKER):
        self._marker = marker
        self._pending = ""
        self._seed = ""
        self._found = False

    @property
    def found(self) -> bool:
        return self._found

    def _partial_marker_suffix_len(self, text: str) -> int:
        for size in range(min(len(self._marker) - 1, len(text)), 0, -1):
            if text.endswith(self._marker[:size]):
                return size
        return 0

    def feed(self, chunk: str) -> str:
        if self._found:
            self._seed += chunk
            return ""

        self._pending += chunk
        index = self._pending.find(self._marker)
        if index >= 0:
            self._found = True
            before = self._pending[:index]
            self._seed = self._pending[index + len(self._marker) :]
            self._pending = ""
            return before.rstrip()

        hold = self._partial_marker_suffix_len(self._pending)
        safe = self._pending[: len(self._pending) - hold]
        visible = safe.rstrip()
        self._pending = self._pending[len(visible) :]
        return visible

    def finish(self) -> tuple[str, str | None]:
        if self._found:
            return "", (self._seed.strip() or None)
        tail, self._pending = self._pending.rstrip(), ""
        return tail, None


def build_contents(history: Sequence[tuple[str, str]]) -> list[types.Content]:
    """Convierte (sender, texto) en contenidos de Gemini, empezando siempre por el usuario."""
    contents = [
        types.Content(role=_ROLE_BY_SENDER[sender], parts=[types.Part(text=text)])
        for sender, text in history
    ]
    if not contents or contents[0].role != "user":
        contents.insert(
            0, types.Content(role="user", parts=[types.Part(text=SESSION_START_USER_TURN)])
        )
    return contents


def _hit_max_tokens(chunk) -> bool:
    return any(
        getattr(candidate, "finish_reason", None) == types.FinishReason.MAX_TOKENS
        for candidate in (getattr(chunk, "candidates", None) or [])
    )


def _retry_after_seconds(exc: errors.APIError) -> float | None:
    headers = getattr(getattr(exc, "response", None), "headers", None)
    if headers:
        try:
            return float(headers.get("retry-after"))
        except (TypeError, ValueError):
            pass
    try:
        for detail in exc.details["error"]["details"]:
            delay = detail.get("retryDelay")
            if isinstance(delay, str) and delay.endswith("s"):
                return float(delay[:-1])
    except (KeyError, TypeError, AttributeError, ValueError):
        pass
    return None


class GeminiClient:
    def __init__(
        self,
        *,
        client=None,
        api_key: str | None = None,
        primary_model: str | None = None,
        fallback_model: str | None = None,
    ):
        self.primary_model = primary_model or settings.GEMINI_PRIMARY_MODEL
        self.fallback_model = fallback_model or settings.GEMINI_FALLBACK_MODEL
        if not self.primary_model:
            raise ImproperlyConfigured("Falta GEMINI_PRIMARY_MODEL en el entorno.")
        if client is None:
            key = api_key or settings.GEMINI_API_KEY
            if not key:
                raise ImproperlyConfigured("Falta GEMINI_API_KEY en el entorno.")
            client = genai.Client(api_key=key)
        self._client = client

    def _models_in_order(self) -> list[str]:
        models = [self.primary_model]
        if self.fallback_model and self.fallback_model != self.primary_model:
            models.append(self.fallback_model)
        return models

    async def _raw_stream(self, contents, config) -> AsyncIterator[tuple[str, str]]:
        models = self._models_in_order()
        for position, model in enumerate(models):
            emitted = False
            try:
                stream = await self._client.aio.models.generate_content_stream(
                    model=model, contents=contents, config=config
                )
                async for chunk in stream:
                    text = chunk.text
                    if text:
                        emitted = True
                        yield model, text
                    if _hit_max_tokens(chunk):
                        logger.error("Respuesta de Gemini cortada por MAX_TOKENS.")
                        raise GeminiTruncatedError("Respuesta cortada por max_output_tokens.")
                if not emitted:
                    raise GeminiUnavailableError("Gemini devolvio una respuesta vacia.")
                return
            except GeminiError:
                raise
            except errors.APIError as exc:
                if exc.code == 429:
                    if not emitted and position + 1 < len(models):
                        logger.warning(
                            "Cuota agotada en el modelo principal; usando el de respaldo."
                        )
                        continue
                    raise GeminiQuotaError(_retry_after_seconds(exc)) from exc
                logger.error("Error de la API de Gemini (codigo %s).", exc.code)
                raise GeminiUnavailableError(f"Error de Gemini ({exc.code}).") from exc
            except Exception as exc:
                logger.error("Fallo al contactar con Gemini (%s).", type(exc).__name__)
                raise GeminiUnavailableError("No se pudo contactar con Gemini.") from exc

    async def stream_reply(
        self,
        system_prompt: str,
        history: Sequence[tuple[str, str]],
        *,
        extract_seed: bool = False,
    ) -> AsyncIterator[TextChunk | Finished]:
        """Emite `TextChunk` con el texto visible y un `Finished` final.

        Con `extract_seed=True` (Turno 5) el marcador de la semilla no llega al texto visible;
        su frase se entrega en `Finished.key_takeaway`.
        """
        contents = build_contents(history)
        config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            max_output_tokens=MAX_OUTPUT_TOKENS,
            temperature=TEMPERATURE,
            thinking_config=types.ThinkingConfig(thinking_level=THINKING_LEVEL),
        )
        seed_filter = SeedMarkerFilter() if extract_seed else None
        parts: list[str] = []
        model_used: str | None = None

        async for model, text in self._raw_stream(contents, config):
            model_used = model
            visible = seed_filter.feed(text) if seed_filter else text
            if visible:
                parts.append(visible)
                yield TextChunk(visible)

        key_takeaway = None
        if seed_filter:
            tail, key_takeaway = seed_filter.finish()
            if tail:
                parts.append(tail)
                yield TextChunk(tail)

        yield Finished(text="".join(parts), key_takeaway=key_takeaway, model=model_used)


@lru_cache(maxsize=1)
def get_gemini_client() -> GeminiClient:
    """Cliente compartido, construido con la configuracion del entorno."""
    return GeminiClient()
