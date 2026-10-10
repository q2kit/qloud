import uuid
from typing import cast

from django.db.models import QuerySet
from django.http import Http404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import generics, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.core.errors import ErrorSerializer
from apps.sharing.permissions import get_node_or_404, nodes_for, role_of

from . import selectors, services
from .models import Node
from .pagination import NodeChildrenPagination
from .serializers import (
    CreateFolderSerializer,
    MoveResultSerializer,
    MoveSerializer,
    NodeDetailSerializer,
    NodeSerializer,
    RenameSerializer,
    capabilities,
)

NOT_FOUND = OpenApiResponse(ErrorSerializer, description="No such node, or no access to it.")
BAD_REQUEST = OpenApiResponse(ErrorSerializer, description="Invalid input or operation.")
CONFLICT = OpenApiResponse(ErrorSerializer, description="`name_conflict`.")


def _user(request: Request) -> User:
    # IsAuthenticated (the default) has already turned anonymous requests away.
    return cast(User, request.user)


def _detail(user: User, node: Node) -> Response:
    role = role_of(user, node)
    if role is None:  # cannot happen for a node loaded through the permission layer
        raise Http404
    node.breadcrumb = selectors.breadcrumb(node)  # type: ignore[attr-defined]
    node.capabilities = capabilities(node, role)  # type: ignore[attr-defined]
    return Response(NodeDetailSerializer(node).data)


class NodeDetailView(APIView):
    @extend_schema(
        operation_id="nodes_retrieve",
        responses={200: NodeDetailSerializer, 404: NOT_FOUND},
    )
    def get(self, request: Request, node_id: uuid.UUID) -> Response:
        user = _user(request)
        return _detail(user, get_node_or_404(user, node_id))

    @extend_schema(
        operation_id="nodes_rename",
        request=RenameSerializer,
        responses={200: NodeDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, 409: CONFLICT},
    )
    def patch(self, request: Request, node_id: uuid.UUID) -> Response:
        user = _user(request)
        serializer = RenameSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        node = services.rename(user, node_id, serializer.validated_data["name"])
        return _detail(user, node)


class NodeChildrenView(generics.ListAPIView[Node]):
    serializer_class = NodeSerializer
    pagination_class = NodeChildrenPagination

    def get_queryset(self) -> QuerySet[Node]:
        user = _user(self.request)
        folder = get_node_or_404(user, self.kwargs["node_id"])
        # A file has no children: an empty page, like an empty folder.
        return nodes_for(user).filter(parent=folder)

    @extend_schema(
        operation_id="nodes_children_list", responses={200: NodeSerializer, 404: NOT_FOUND}
    )
    def get(self, request: Request, *args: object, **kwargs: object) -> Response:
        return super().get(request, *args, **kwargs)


class FolderCreateView(APIView):
    @extend_schema(
        operation_id="folders_create",
        request=CreateFolderSerializer,
        responses={201: NodeSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, 409: CONFLICT},
    )
    def post(self, request: Request) -> Response:
        serializer = CreateFolderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        folder = services.create_folder(
            _user(request),
            serializer.validated_data["parent_id"],
            serializer.validated_data["name"],
        )
        return Response(NodeSerializer(folder).data, status=status.HTTP_201_CREATED)


class NodeMoveView(APIView):
    @extend_schema(
        operation_id="nodes_move",
        request=MoveSerializer,
        responses={200: MoveResultSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, 409: CONFLICT},
    )
    def post(self, request: Request) -> Response:
        serializer = MoveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        nodes = services.move(
            _user(request),
            serializer.validated_data["node_ids"],
            serializer.validated_data["target_parent_id"],
        )
        return Response(MoveResultSerializer({"nodes": nodes}).data)
