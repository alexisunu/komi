"""Reglas del jardin compartidas por el PATCH de libros y la sincronizacion."""

from apps.garden.models import BookGarden


def resolve_status(book: BookGarden, requested: str) -> str:
    """ACTIVE devuelve el libro a su estado natural: BLOOMED si esta al 100%."""
    if requested != BookGarden.Status.ACTIVE:
        return requested
    if book.progress_percentage >= 100:
        return BookGarden.Status.BLOOMED
    if book.status == BookGarden.Status.GROWING:
        return BookGarden.Status.GROWING
    return BookGarden.Status.ACTIVE
