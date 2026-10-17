import uuid
from typing import Any, cast

from django.db.models import QuerySet
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import generics
from rest_framework.request import Request
from rest_framework.response import Response

from apps.accounts.models import User
from apps.core.errors import ErrorSerializer
from apps.sharing.pagination import SharePagination
from apps.sharing.permissions import Role, nodes_for

from . import selectors
from .models import AuditEvent
from .serializers import AuditEventSerializer

NOT_FOUND = OpenApiResponse(ErrorSerializer, description="No such node, or no access to it.")


class NodeActivityView(generics.ListAPIView[AuditEvent]):
    serializer_class = AuditEventSerializer
    pagination_class = SharePagination

    def get_queryset(self) -> QuerySet[AuditEvent]:
        user = cast(User, self.request.user)
        node, role, events = selectors.activity_for(user, self.kwargs["node_id"])
        self.role, self.owner_id = role, node.owner_id
        return events

    def get_serializer(self, *args: Any, **kwargs: Any) -> AuditEventSerializer:
        events = args[0] if args else []
        kwargs["context"] = {
            **self.get_serializer_context(),
            # Schema generation builds a serializer without a request behind it.
            "can_manage": getattr(self, "role", Role.VIEWER) >= Role.EDITOR,
            "visible_folders": self._visible_folders(events),
        }
        return AuditEventSerializer(*args, **kwargs)

    def _visible_folders(self, events: list[AuditEvent]) -> set[str] | None:
        """Folder ids in move metadata the reader may name; None: the owner sees all."""
        user = cast(User, self.request.user)
        if user.pk == getattr(self, "owner_id", None):
            return None
        ids = {
            folder["id"]
            for event in events
            for key in ("from_folder", "to_folder")
            if isinstance(folder := event.metadata.get(key), dict)
        }
        if not ids:
            return set()
        visible = nodes_for(user, trashed=None).filter(pk__in=ids).values_list("pk", flat=True)
        return {str(pk) for pk in visible}

    @extend_schema(
        operation_id="nodes_activity_list",
        responses={200: AuditEventSerializer(many=True), 404: NOT_FOUND},
    )
    def get(self, request: Request, node_id: uuid.UUID) -> Response:
        return super().get(request, node_id=node_id)
