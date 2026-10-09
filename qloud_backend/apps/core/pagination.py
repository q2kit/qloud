from rest_framework.pagination import CursorPagination


class DefaultCursorPagination(CursorPagination):
    # `id` (UUIDv7) breaks ties so rows created in the same instant are never skipped or repeated
    ordering = ("-created_at", "-id")
    page_size_query_param = "page_size"
    max_page_size = 200
