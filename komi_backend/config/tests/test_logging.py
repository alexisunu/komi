"""Configuracion del registro (`settings.LOGGING`), leida en un proceso aparte.

Se comprueba lo que de verdad sale a stderr: la linea INFO de la charla (que modelo respondio)
debe verse, y el SQL (que lleva el UUID del perfil) no.
"""

import logging
import os
import subprocess
import sys
from pathlib import Path

from django.test import SimpleTestCase

BACKEND = Path(__file__).resolve().parents[2]

SCRIPT = """
import logging, logging.config
from config import settings as s
# Creado ANTES de configurar, como los de las librerias que ya se importaron.
logging.getLogger("otra.libreria")
logging.config.dictConfig(s.LOGGING)
logging.getLogger("apps.ai_companion.streaming").info("APPS-INFO")
logging.getLogger("apps.ai_companion.streaming").warning("APPS-WARNING")
logging.getLogger("apps.ai_companion.gemini_client").error("APPS-ERROR")
logging.getLogger("apps.ai_companion.streaming").debug("APPS-DEBUG")
logging.getLogger("django.db.backends").debug("SQL-DEBUG uuid-secreto")
logging.getLogger("django.db.backends").info("SQL-INFO")
logging.getLogger("otra.libreria").info("AJENO-INFO")
logging.getLogger("otra.libreria").warning("AJENO-WARNING")
"""


def run_logging_script():
    env = {k: v for k, v in os.environ.items() if not k.startswith(("DB_", "DATABASE_"))}
    env.update(
        {
            "DJANGO_SECRET_KEY": "clave-de-prueba",
            "DJANGO_SETTINGS_MODULE": "config.settings",
            "PYTHONIOENCODING": "utf-8",
            "PYTHONPATH": str(BACKEND),
        }
    )
    return subprocess.run(
        [sys.executable, "-c", SCRIPT],
        cwd=BACKEND,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


class LoggingConfigTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.result = run_logging_script()

    def test_the_script_runs(self):
        self.assertEqual(self.result.returncode, 0, self.result.stderr)

    def test_the_app_logs_info_warning_and_error_to_stderr(self):
        for marker in ("APPS-INFO", "APPS-WARNING", "APPS-ERROR"):
            self.assertIn(marker, self.result.stderr)

    def test_the_app_does_not_log_debug(self):
        self.assertNotIn("APPS-DEBUG", self.result.stderr)

    def test_each_app_line_appears_once(self):
        for marker in ("APPS-INFO", "APPS-WARNING", "APPS-ERROR"):
            self.assertEqual(self.result.stderr.count(marker), 1, marker)

    def test_the_line_names_the_level_and_the_logger(self):
        self.assertIn("INFO apps.ai_companion.streaming: APPS-INFO", self.result.stderr)
        self.assertIn("ERROR apps.ai_companion.gemini_client: APPS-ERROR", self.result.stderr)

    def test_sql_never_reaches_the_logs(self):
        self.assertNotIn("SQL-DEBUG", self.result.stderr)
        self.assertNotIn("uuid-secreto", self.result.stderr)

    def test_the_app_logger_does_not_propagate(self):
        # Hoy no duplicaria (el handler propio ya cuenta), pero si alguien agrega un handler a
        # la raiz cada linea saldria dos veces y el SQL tendria un camino mas.
        from django.conf import settings

        self.assertIs(settings.LOGGING["loggers"]["apps"]["propagate"], False)

    def test_existing_loggers_are_not_disabled(self):
        from django.conf import settings

        self.assertIs(settings.LOGGING["disable_existing_loggers"], False)

    def test_the_sql_logger_stays_at_info_or_above_and_has_no_handler_of_its_own(self):
        # Invariante de configuracion: si alguien agrega un handler en la raiz, el nivel es la
        # unica barrera que impide que el SQL (con el UUID del perfil) llegue a los logs.
        from django.conf import settings

        sql = settings.LOGGING["loggers"]["django.db.backends"]
        self.assertGreaterEqual(logging.getLevelName(sql["level"]), logging.INFO)
        self.assertNotIn("handlers", sql)
        self.assertNotIn(
            "django.db.backends", settings.LOGGING["loggers"]["apps"].get("handlers", [])
        )

    def test_other_libraries_keep_the_default_behavior(self):
        self.assertIn("AJENO-WARNING", self.result.stderr)
        self.assertNotIn("AJENO-INFO", self.result.stderr)
