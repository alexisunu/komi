"""Convierte `DATABASE_URL` en la configuracion de Django (PostgreSQL).

Acepta `postgres://` y `postgresql://`, usuario y clave con caracteres escapados (el usuario del
pooler de Supabase lleva un punto: `postgres.<proyecto>`) y los parametros de consulta que
importan al desplegar: `sslmode` y `connect_timeout`. Cualquier otro parametro se rechaza para
que un error de escritura no pase en silencio.
"""

from urllib.parse import parse_qs, unquote, urlparse

SCHEMES = {"postgres", "postgresql"}
SSL_MODES = {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}
# Con el pooler en modo sesion cada conexion persistente ocupa un hueco del pooler (limitado en
# el plan gratuito). 0 cierra la conexion al terminar cada peticion.
DEFAULT_CONN_MAX_AGE = 0


class DatabaseUrlError(ValueError):
    """La URL no se puede usar. Nunca incluye la clave."""


def database_from_url(url: str, *, conn_max_age: int = DEFAULT_CONN_MAX_AGE) -> dict:
    parsed = urlparse(url)
    if parsed.scheme not in SCHEMES:
        raise DatabaseUrlError("DATABASE_URL debe empezar por postgres:// o postgresql://.")
    name = parsed.path.lstrip("/")
    if not parsed.hostname or not name:
        raise DatabaseUrlError("DATABASE_URL necesita servidor y nombre de base de datos.")

    options: dict[str, str | int] = {}
    for key, values in parse_qs(parsed.query, keep_blank_values=True).items():
        value = values[-1]
        if key == "sslmode":
            if value not in SSL_MODES:
                raise DatabaseUrlError("sslmode de DATABASE_URL no es valido.")
            options["sslmode"] = value
        elif key == "connect_timeout":
            if not value.isdigit() or int(value) < 1:
                raise DatabaseUrlError("connect_timeout de DATABASE_URL debe ser un entero > 0.")
            options["connect_timeout"] = int(value)
        else:
            raise DatabaseUrlError(f"Parametro no admitido en DATABASE_URL: {key}.")

    config = {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": name,
        "USER": unquote(parsed.username or ""),
        "PASSWORD": unquote(parsed.password or ""),
        "HOST": parsed.hostname,
        "PORT": str(parsed.port or 5432),
        "CONN_MAX_AGE": conn_max_age,
    }
    if options:
        config["OPTIONS"] = options
    return config
