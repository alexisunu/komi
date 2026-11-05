from django.urls import path

from apps.garden import views

urlpatterns = [
    path("books/", views.BookCollectionView.as_view(), name="garden-books"),
    path("books/<uuid:pk>/", views.BookDetailView.as_view(), name="garden-book-detail"),
]
