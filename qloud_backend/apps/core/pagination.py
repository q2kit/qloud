from rest_framework.pagination import CursorPagination


class DefaultCursorPagination(CursorPagination):
    ordering = "-created_at"
    page_size_query_param = "page_size"
    max_page_size = 200
