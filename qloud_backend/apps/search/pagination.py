"""Keyset cursor covering all rank fields, bound to the search and user."""

import datetime
import uuid
from typing import Any

from django.core import signing
from django.db.models import Q, QuerySet
from rest_framework.exceptions import NotFound
from rest_framework.request import Request
from rest_framework.utils.urls import replace_query_param
from rest_framework.views import APIView

from apps.drive.models import Node
from apps.drive.pagination import NodeChildrenPagination

ORDER = ("match_rank", "-similarity_rank", "-updated_at", "-id")
SALT = "qloud.search.cursor.v1"


class SearchPagination(NodeChildrenPagination):
    def paginate_queryset(  # type: ignore[override]
        self,
        queryset: QuerySet[Node],
        request: Request,
        view: APIView | None = None,
    ) -> list[Node]:
        self.request = request
        self.size = self._page_size(request)
        self.scope = {
            "user": str(request.user.pk),
            **{
                name: request.query_params.get(name, "")
                for name in ("q", "type", "owner", "modified_after")
            },
        }
        raw = request.query_params.get("cursor")
        cursor = self._read(raw) if raw else None
        backwards = bool(cursor and cursor["back"])
        order = (
            [field.removeprefix("-") if field.startswith("-") else f"-{field}" for field in ORDER]
            if backwards
            else ORDER
        )
        if cursor:
            later = Q()
            same = Q()
            for field, value in zip(ORDER, cursor["values"], strict=True):
                name = field.removeprefix("-")
                operator = "lt" if field.startswith("-") != backwards else "gt"
                later |= same & Q(**{f"{name}__{operator}": value})
                same &= Q(**{name: value})
            queryset = queryset.filter(later)
        page = list(queryset.order_by(*order)[: self.size + 1])
        more = len(page) > self.size
        self.page = page[: self.size]
        if backwards:
            self.page.reverse()
        self.has_next = bool(cursor) if backwards else more
        self.has_previous = more if backwards else bool(cursor)
        return self.page

    def _read(self, raw: str) -> dict[str, Any]:
        try:
            data = signing.loads(raw, salt=SALT)
            values = data["values"]
            if data["scope"] != self.scope or type(data["back"]) is not bool:
                raise ValueError
            if len(values) != 4 or type(values[0]) is not int or type(values[1]) is not int:
                raise ValueError
            values[2] = datetime.datetime.fromisoformat(values[2])
            if values[2].tzinfo is None:
                raise ValueError
            values[3] = uuid.UUID(str(values[3]))
            return {"values": values, "back": data["back"]}
        except (signing.BadSignature, ValueError, TypeError, KeyError, IndexError) as error:
            raise NotFound("Invalid cursor.") from error

    def _link(self, node: Node, back: bool) -> str:
        values = [getattr(node, field.removeprefix("-")) for field in ORDER]
        values[2], values[3] = values[2].isoformat(), str(values[3])
        token = signing.dumps({"scope": self.scope, "values": values, "back": back}, salt=SALT)
        return replace_query_param(self.request.build_absolute_uri(), "cursor", token)

    def get_schema_operation_parameters(self, view: APIView) -> list[dict[str, Any]]:
        return super().get_schema_operation_parameters(view)[:2]
