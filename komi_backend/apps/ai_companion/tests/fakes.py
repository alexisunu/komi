"""Cliente de Gemini falso para las pruebas del compañero: sin red, con llamadas contadas."""

import asyncio
import json
import warnings
from datetime import UTC, datetime
from decimal import Decimal

from apps.ai_companion.gemini_client import Finished, TextChunk
from apps.garden.models import BookGarden
from apps.profiles.models import ReaderProfile
from apps.reading_sessions.models import ReadingSession

SEED = "Leer despacio tambien es avanzar."


class FakeGemini:
    """Cada llamada consume un paso de `steps`:

    - texto: se emite por palabras y termina bien (con semilla si `extract_seed`)
    - Exception (clase o instancia): emite un texto parcial y luego falla
    - "hang": emite un fragmento y espera para siempre (cliente desconectado, timeout)
    """

    def __init__(self, *steps, seed=SEED):
        self.steps = list(steps)
        self.seed = seed
        self.calls = []
        self.cancelled = False
        self.closed = 0

    async def aclose(self):
        self.closed += 1

    async def stream_reply(self, system_prompt, history, *, extract_seed=False):
        self.calls.append(
            {"prompt": system_prompt, "history": list(history), "extract_seed": extract_seed}
        )
        step = self.steps.pop(0) if self.steps else "Una respuesta serena de Komi."
        if isinstance(step, Exception) or (isinstance(step, type) and issubclass(step, Exception)):
            yield TextChunk("Texto parcial ")
            raise step
        if step == "hang":
            yield TextChunk("Texto parcial ")
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                self.cancelled = True
                raise
        words = step.split(" ")
        for index, word in enumerate(words):
            yield TextChunk(word + ("" if index == len(words) - 1 else " "))
        yield Finished(
            text=step, key_takeaway=self.seed if extract_seed else None, model="fake-model"
        )


def make_profile():
    return ReaderProfile.objects.create(
        preferred_moment="NIGHT", ai_reflection_style="DEEP_ANALYSIS"
    )


def make_session(
    profile, status=ReadingSession.SessionStatus.COMPLETED, started="2025-03-10T08:00"
):
    book = BookGarden.objects.create(
        profile=profile,
        title="Kokoro",
        author="Soseki",
        format_type="PHYSICAL",
        sunflower_variant="CLASSIC",
        total_pages=300,
    )
    return ReadingSession.objects.create(
        book=book,
        planned_duration_sec=900,
        actual_duration_sec=900,
        started_at_local=datetime.fromisoformat(started).replace(tzinfo=UTC),
        session_status=status,
        progress_delta=Decimal("0"),
    )


def parse_sse(response) -> list[tuple[str, dict]]:
    """Consume un StreamingHttpResponse y devuelve [(evento, datos)]."""
    if hasattr(response, "sse_events"):  # ya consumido dentro del parche del cliente falso
        return response.sse_events
    # Iterar la respuesta consume el generador asincrono (Django avisa con un Warning).
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        raw = b"".join(response).decode("utf-8")
    events = []
    for block in filter(None, raw.split("\n\n")):
        lines = dict(line.split(": ", 1) for line in block.split("\n"))
        events.append((lines["event"], json.loads(lines["data"])))
    return events
