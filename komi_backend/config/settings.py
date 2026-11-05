"""Configuracion del servidor Komi. Los secretos se leen solo del entorno (.env)."""

import os
from pathlib import Path
from urllib.parse import unquote, urlparse

from corsheaders.defaults import default_headers as default_cors_headers
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
    "corsheaders",
    "rest_framework",
    "apps.profiles",
    "apps.garden",
    "apps.reading_sessions",
    "apps.ai_companion",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
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

# Gemini (solo backend). Los nombres de modelo nunca se escriben en el codigo.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_PRIMARY_MODEL = os.environ.get("GEMINI_PRIMARY_MODEL", "")
GEMINI_FALLBACK_MODEL = os.environ.get("GEMINI_FALLBACK_MODEL", "")

# CORS estricto (SRS 17, punto 1): solo los origenes del frontend listados en el entorno.
# Sin cookies ni sesiones: la identificacion va en la cabecera X-Profile-Id.
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
CORS_ALLOW_CREDENTIALS = False
CORS_ALLOW_HEADERS = (*default_cors_headers, "x-profile-id")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["apps.profiles.authentication.ProfileIdAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "UNAUTHENTICATED_USER": None,
    "EXCEPTION_HANDLER": "config.exception_handler.exception_handler",
}

# El SQL registrado por django.db.backends incluye los parametros (entre ellos el UUID del
# perfil, que funciona como credencial). Se fija en INFO para que nunca llegue a los logs.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "loggers": {"django.db.backends": {"level": "INFO"}},
}

# Cuerpo maximo de una peticion JSON: 2,5 MB (valor por defecto de Django, fijado de forma
# explicita). Un lote de /profile/sync/ que lo supere responde 413 (SRS 17, punto 18).
DATA_UPLOAD_MAX_MEMORY_SIZE = 2_621_440
