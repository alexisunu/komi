import sys

from django.core.management.base import BaseCommand

from apps.reading_sessions.streak_cases import FIXTURE_PATH, render


class Command(BaseCommand):
    help = "Regenera los casos de racha que consume la prueba de Vitest."

    def add_arguments(self, parser):
        parser.add_argument(
            "--check",
            action="store_true",
            help="No escribe: termina con error si el archivo esta desactualizado.",
        )

    def handle(self, *args, **options):
        text = render()
        current = FIXTURE_PATH.read_bytes().decode("utf-8") if FIXTURE_PATH.exists() else None
        if options["check"]:
            if current != text:
                self.stderr.write(
                    "streakCases.json esta desactualizado: "
                    "ejecuta `python manage.py dump_streak_cases`."
                )
                sys.exit(1)
            self.stdout.write("streakCases.json esta al dia.")
            return
        FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE_PATH.write_bytes(text.encode("utf-8"))
        self.stdout.write(f"Escrito {FIXTURE_PATH} ({len(text.splitlines())} lineas).")
