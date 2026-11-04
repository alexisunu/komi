"""Configuracion del servidor Komi. Los secretos se leen solo del entorno (.env)."""

import os
from pathlib import Path
from urllib.parse import unquote, urlparse

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in {"1", "true", "yes"}


def _database_from_url(url: str) -> dict:
    parsed = urlparse(url)
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": parsed.path.lstrip("/"),
        "USER": unquote(parsed.username or ""),
        "PASSWORD": unquote(parsed.password or ""),
        "HOST": parsed.hostname or "localhost",
        "PORT": str(parsed.port or 5432),
    }


SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
DEBUG = _env_bool("DJANGO_DEBUG", False)
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "inseguro-solo-para-desarrollo-local"
    else:
        raise RuntimeError("Falta DJANGO_SECRET_KEY en el entorno.")

ALLOWED_HOSTS = [h for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "").split(",") if h]

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "rest_framework",
    "apps.profiles",
    "apps.garden",
    "apps.reading_sessions",
    "apps.ai_companion",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]

ROOT_URLCONF = "config.urls"
ASGI_APPLICATION = "config.asgi.application"

if not os.environ.get("DATABASE_URL"):
    raise RuntimeError("Falta DATABASE_URL (PostgreSQL) en el entorno.")
DATABASES = {"default": _database_from_url(os.environ["DATABASE_URL"])}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LANGUAGE_CODE = "es"
# USE_TZ activo y TIME_ZONE en UTC. started_at_local es la excepcion documentada
# en apps/reading_sessions/models.py (hora de pared local, sin zona).
TIME_ZONE = "UTC"
USE_TZ = True

STATIC_URL = "static/"
