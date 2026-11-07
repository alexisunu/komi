"""`config.settings` leido en un proceso aparte, con un entorno controlado."""

import json
import os
import subprocess
import sys
from pathlib import Path

from django.test import SimpleTestCase

BACKEND = Path(__file__).resolve().parents[2]
SCRIPT = (
    "import json; from config import settings as s; "
    "print(json.dumps({'db': s.DATABASES['default'], 'hosts': s.ALLOWED_HOSTS}))"
)


def load_settings(**env):
    base = {k: v for k, v in os.environ.items() if not k.startswith(("DB_", "DATABASE_"))}
    base.update(
        {
            "DJANGO_SECRET_KEY": "clave-de-prueba",
            "DJANGO_SETTINGS_MODULE": "config.settings",
            "PYTHONIOENCODING": "utf-8",
        }
    )
    base.update(env)
    # `-I` ignoraria el directorio actual: se fija el del backend como cwd y como PYTHONPATH.
    base["PYTHONPATH"] = str(BACKEND)
    result = subprocess.run(
        [sys.executable, "-c", SCRIPT],
        cwd=BACKEND,
        env=base,
        capture_output=True,
        text=True,
        timeout=60,
    )
    return result


class SettingsEnvironmentTests(SimpleTestCase):
    URL = "postgres://u:p@h:5432/db?sslmode=require"

    def test_db_conn_max_age_comes_from_the_environment(self):
        result = load_settings(DATABASE_URL=self.URL, DB_CONN_MAX_AGE="60")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["db"]["CONN_MAX_AGE"], 60)

    def test_connections_close_per_request_when_the_variable_is_missing_or_empty(self):
        for value in (None, ""):
            with self.subTest(value=value):
                env = {"DATABASE_URL": self.URL}
                if value is not None:
                    env["DB_CONN_MAX_AGE"] = value
                result = load_settings(**env)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout)["db"]["CONN_MAX_AGE"], 0)

    def test_the_ssl_option_reaches_the_database_settings(self):
        result = load_settings(DATABASE_URL=self.URL)
        self.assertEqual(json.loads(result.stdout)["db"]["OPTIONS"], {"sslmode": "require"})

    def test_a_missing_database_url_stops_the_start(self):
        # Vacia, no ausente: `settings` carga `.env` y rellenaria la que falte.
        result = load_settings(DATABASE_URL="")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Falta DATABASE_URL", result.stderr)

    def test_an_invalid_database_url_stops_the_start_without_printing_the_password(self):
        result = load_settings(DATABASE_URL="mysql://u:clave-secreta@h/db")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("clave-secreta", result.stdout + result.stderr)
