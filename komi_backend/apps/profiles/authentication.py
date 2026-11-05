"""Identificacion del lector por la cabecera X-Profile-Id (SRS 17, punto 1).

No hay cookies ni sesiones de Django. El UUID es una credencial: no se escribe en logs ni en
mensajes de error, y un perfil inexistente y un UUID mal formado responden igual.
"""

import uuid

from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from apps.profiles.models import ReaderProfile

PROFILE_ID_HEADER = "X-Profile-Id"
_META_KEY = "HTTP_X_PROFILE_ID"


class ProfilePrincipal:
    """Usuario minimo para DRF: `request.user` autenticado que envuelve al perfil."""

    is_authenticated = True
    is_anonymous = False

    def __init__(self, profile: ReaderProfile):
        self.profile = profile

    def __str__(self) -> str:
        return "ProfilePrincipal"


class ProfileIdAuthentication(BaseAuthentication):
    """Resuelve `request.user` (ProfilePrincipal) y `request.auth` (ReaderProfile)."""

    def authenticate(self, request):
        raw = request.META.get(_META_KEY)
        if not raw:
            return None
        try:
            profile_id = uuid.UUID(raw.strip())
        except ValueError:
            raise AuthenticationFailed("Perfil no valido.") from None
        profile = ReaderProfile.objects.filter(pk=profile_id).first()
        if profile is None:
            raise AuthenticationFailed("Perfil no valido.")
        return ProfilePrincipal(profile), profile

    def authenticate_header(self, request):
        # Hace que DRF responda 401 (y no 403) cuando falta la cabecera.
        return PROFILE_ID_HEADER
