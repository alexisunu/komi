from django.db import IntegrityError, transaction
from rest_framework import serializers, status
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.garden.models import BookGarden
from apps.garden.serializers import BookCreateSerializer, BookSerializer, BookUpdateSerializer
from apps.garden.services import resolve_status


def _profile_books(request):
    return BookGarden.objects.filter(profile=request.auth)


class BookCollectionView(APIView):
    """GET y POST /api/v1/garden/books/."""

    def get(self, request):
        books = _profile_books(request)
        wanted = request.query_params.get("status")
        if wanted is not None:
            if wanted not in BookGarden.Status.values:
                raise serializers.ValidationError({"status": "Estado no valido."})
            books = books.filter(status=wanted)
        books = books.order_by("-created_at", "id")
        return Response(BookSerializer(books, many=True).data)

    def post(self, request):
        serializer = BookCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        book_id = data.pop("id", None)

        if book_id is not None:
            existing = BookGarden.objects.filter(pk=book_id).first()
            if existing is not None:
                return self._replay(request, existing)

        try:
            with transaction.atomic():
                book = BookGarden.objects.create(
                    profile=request.auth, **data, **({"id": book_id} if book_id else {})
                )
        except IntegrityError:
            # Otra peticion con el mismo id se adelanto (reintento concurrente).
            return self._replay(request, BookGarden.objects.get(pk=book_id))
        return Response(BookSerializer(book).data, status=status.HTTP_201_CREATED)

    @staticmethod
    def _replay(request, existing):
        """Reintento idempotente: devuelve el libro ya plantado sin modificarlo."""
        if existing.profile_id != request.auth.id:
            return Response(
                {"detail": "Identificador de libro no disponible."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(BookSerializer(existing).data, status=status.HTTP_200_OK)


class BookDetailView(APIView):
    """PATCH /api/v1/garden/books/{id}/ (cambia titulo, autor o pone en barbecho)."""

    http_method_names = ["patch", "options"]

    def patch(self, request, pk):
        book = get_object_or_404(_profile_books(request), pk=pk)
        serializer = BookUpdateSerializer(book, data=request.data)
        serializer.is_valid(raise_exception=True)
        changes = serializer.validated_data

        for field in ("title", "author"):
            if field in changes:
                setattr(book, field, changes[field])
        if "status" in changes:
            book.status = resolve_status(book, changes["status"])
        book.save()
        return Response(BookSerializer(book).data)
