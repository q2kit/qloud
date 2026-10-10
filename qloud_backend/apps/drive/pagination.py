"""Keyset pagination for folder listings (api.md, "Phân trang" and "Sắp xếp").

DRF's CursorPagination positions on the first ordering field only, which cannot express
"folders first, then by name". This keys on the whole row order (kind, field, id): every
page is one indexed range query, however deep, with no skipped or repeated rows.
"""

import base64
import binascii
import datetime
import json
import uuid
from typing import Any

from django.db.models import Q, QuerySet
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.pagination import BasePagination
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.utils.urls import remove_query_param, replace_query_param
from rest_framework.views import APIView

from .models import Node

ORDERINGS = ("name", "-name", "updated_at", "-updated_at", "size", "-size")
DEFAULT_ORDERING = "name"


def _encode(value: Any) -> Any:
    return value.isoformat() if isinstance(value, datetime.datetime) else value


def _decode(field: str, value: Any) -> Any:
    if field == "updated_at":
        return datetime.datetime.fromisoformat(value)
    if field == "size" and not isinstance(value, int):
        raise TypeError
    if field == "name" and not isinstance(value, str):
        raise TypeError
    return value


class NodeChildrenPagination(BasePagination):
    page_size = 50
    max_page_size = 200
    cursor_query_param = "cursor"
    page_size_query_param = "page_size"
    ordering_query_param = "ordering"

    def paginate_queryset(  # type: ignore[override]  # keyset needs a QuerySet
        self, queryset: QuerySet[Node], request: Request, view: APIView | None = None
    ) -> list[Node]:
        self.request = request
        ordering = request.query_params.get(self.ordering_query_param, DEFAULT_ORDERING)
        if ordering not in ORDERINGS:
            raise ValidationError({self.ordering_query_param: [f"One of {', '.join(ORDERINGS)}."]})
        self.field = ordering.lstrip("-")
        self.descending = ordering.startswith("-")
        self.size = self._page_size(request)
        cursor = self._cursor(request)

        backwards = bool(cursor and cursor["back"])
        # Folders first: "folder" > "file", so kind descends in the forward direction.
        order = [
            "-kind" if not backwards else "kind",
            self._direction(self.field, backwards),
            self._direction("id", backwards),
        ]
        rows = queryset.order_by(*order)
        if cursor:
            rows = rows.filter(self._after(cursor, backwards))
        page = list(rows[: self.size + 1])
        more = len(page) > self.size
        page = page[: self.size]
        if backwards:
            page.reverse()
        # Going back from a cursor means rows exist after this page, and vice versa.
        self.has_next = more if not backwards else bool(cursor)
        self.has_previous = bool(cursor) if not backwards else more
        self.page = page
        return page

    def _direction(self, field: str, backwards: bool) -> str:
        return f"-{field}" if self.descending != backwards else field

    def _after(self, cursor: dict[str, Any], backwards: bool) -> Q:
        kind, value, pk = cursor["kind"], cursor["value"], cursor["id"]
        later = "gt" if self.descending == backwards else "lt"
        kind_later = "lt" if not backwards else "gt"
        field = self.field
        return (
            Q(**{f"kind__{kind_later}": kind})
            | Q(kind=kind, **{f"{field}__{later}": value})
            | Q(kind=kind, **{field: value, f"id__{later}": pk})
        )

    def _page_size(self, request: Request) -> int:
        raw = request.query_params.get(self.page_size_query_param)
        if raw is None:
            return self.page_size
        try:
            size = int(raw)
        except ValueError:
            size = 0
        if size < 1:
            raise ValidationError({self.page_size_query_param: ["A positive integer."]})
        return min(size, self.max_page_size)

    def _cursor(self, request: Request) -> dict[str, Any] | None:
        raw = request.query_params.get(self.cursor_query_param)
        if not raw:
            return None
        try:
            data = json.loads(base64.urlsafe_b64decode(raw.encode()))
            if data["f"] != self.field + ("-" if self.descending else ""):
                raise ValueError
            return {
                "kind": Node.Kind(data["k"]),
                "value": _decode(self.field, data["v"]),
                "id": uuid.UUID(data["i"]),
                "back": bool(data["b"]),
            }
        except (binascii.Error, ValueError, KeyError, TypeError) as error:
            # Includes a cursor from another ordering: it points at a different row order.
            raise NotFound("Invalid cursor.") from error

    def _link(self, node: Node, back: bool) -> str:
        data = {
            "f": self.field + ("-" if self.descending else ""),
            "k": node.kind,
            "v": _encode(getattr(node, self.field)),
            "i": str(node.pk),
            "b": back,
        }
        token = base64.urlsafe_b64encode(json.dumps(data).encode()).decode()
        url = self.request.build_absolute_uri()
        return replace_query_param(url, self.cursor_query_param, token)

    def get_next_link(self) -> str | None:
        if not self.has_next or not self.page:
            return None
        return self._link(self.page[-1], back=False)

    def get_previous_link(self) -> str | None:
        if not self.has_previous:
            return None
        if not self.page:
            return remove_query_param(self.request.build_absolute_uri(), self.cursor_query_param)
        return self._link(self.page[0], back=True)

    def get_paginated_response(self, data: Any) -> Response:
        return Response(
            {"next": self.get_next_link(), "previous": self.get_previous_link(), "results": data}
        )

    def get_paginated_response_schema(self, schema: dict[str, Any]) -> dict[str, Any]:
        link = {"type": "string", "nullable": True, "format": "uri"}
        return {
            "type": "object",
            "required": ["results", "next", "previous"],
            "properties": {"next": link, "previous": link, "results": schema},
        }

    def get_schema_operation_parameters(self, view: APIView) -> list[dict[str, Any]]:
        return [
            {
                "name": self.cursor_query_param,
                "required": False,
                "in": "query",
                "description": "Opaque value from `next` or `previous`.",
                "schema": {"type": "string"},
            },
            {
                "name": self.page_size_query_param,
                "required": False,
                "in": "query",
                "description": f"Items per page, at most {self.max_page_size}.",
                "schema": {"type": "integer", "default": self.page_size},
            },
            {
                "name": self.ordering_query_param,
                "required": False,
                "in": "query",
                "description": "Folders always come before files.",
                "schema": {"type": "string", "enum": list(ORDERINGS), "default": DEFAULT_ORDERING},
            },
        ]
