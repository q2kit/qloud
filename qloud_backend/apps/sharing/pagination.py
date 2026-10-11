from rest_framework.exceptions import ValidationError
from rest_framework.pagination import CursorPagination
from rest_framework.request import Request


class SharePagination(CursorPagination):
    ordering = ("-created_at", "-id")
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200

    def get_page_size(self, request: Request) -> int:
        raw = request.query_params.get(self.page_size_query_param)
        if raw is None:
            return self.page_size
        try:
            size = int(raw)
        except ValueError:
            size = 0
        if size < 1:
            raise ValidationError({"page_size": ["A positive integer."]})
        return min(size, self.max_page_size)
