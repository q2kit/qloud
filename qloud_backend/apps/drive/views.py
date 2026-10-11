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
from apps.sharing.permissions import Role, get_node_or_404, nodes_for, role_of

from . import downloads, previews, selectors, services, trash
from .models import Node
from .pagination import NodeChildrenPagination, RecentPagination
from .serializers import (
    CreateFolderSerializer,
    DownloadLinkSerializer,
    MoveResultSerializer,
    MoveSerializer,
    NodeDetailSerializer,
    NodeSerializer,
    PreviewLinkSerializer,
    PreviewQuerySerializer,
    RenameSerializer,
    TrashNodeSerializer,
    TrashResultSerializer,
    TrashSelectionSerializer,
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


class NodeDownloadView(APIView):
    @extend_schema(
        operation_id="nodes_download",
        responses={
            200: DownloadLinkSerializer,
            400: OpenApiResponse(ErrorSerializer, description="`not_a_file`."),
            404: NOT_FOUND,
        },
    )
    def get(self, request: Request, node_id: uuid.UUID) -> Response:
        node = get_node_or_404(_user(request), node_id)
        return Response(DownloadLinkSerializer(downloads.download_link(node)).data)


class NodePreviewView(APIView):
    @extend_schema(
        operation_id="nodes_preview",
        parameters=[PreviewQuerySerializer],
        responses={
            200: PreviewLinkSerializer,
            400: OpenApiResponse(ErrorSerializer, description="Invalid query or `not_a_file`."),
            404: NOT_FOUND,
        },
    )
    def get(self, request: Request, node_id: uuid.UUID) -> Response:
        query = PreviewQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        thumbnail_only = query.validated_data["trashed_thumbnail"]
        node = get_node_or_404(
            _user(request),
            node_id,
            Role.OWNER if thumbnail_only else Role.VIEWER,
            trashed=thumbnail_only,
        )
        return Response(
            PreviewLinkSerializer(previews.preview_link(node, thumbnail_only=thumbnail_only)).data
        )


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
            serializer.validated_data["on_conflict"],
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


class RecentView(generics.ListAPIView[Node]):
    serializer_class = NodeSerializer
    pagination_class = RecentPagination

    def get_queryset(self) -> QuerySet[Node]:
        return selectors.recent_files(_user(self.request))

    @extend_schema(operation_id="recent_list", responses={200: NodeSerializer(many=True)})
    def get(self, request: Request, *args: object, **kwargs: object) -> Response:
        return super().get(request, *args, **kwargs)


class NodeTrashView(APIView):
    @extend_schema(
        operation_id="nodes_trash",
        request=TrashSelectionSerializer,
        responses={200: TrashResultSerializer, 400: BAD_REQUEST, 404: NOT_FOUND},
    )
    def post(self, request: Request) -> Response:
        serializer = TrashSelectionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        nodes = trash.trash(_user(request), serializer.validated_data["node_ids"])
        return Response(TrashResultSerializer({"nodes": nodes}).data)


class TrashListView(generics.ListAPIView[Node]):
    serializer_class = TrashNodeSerializer
    pagination_class = NodeChildrenPagination

    def get_queryset(self) -> QuerySet[Node]:
        return trash.roots_for(_user(self.request))

    @extend_schema(operation_id="trash_list", responses={200: TrashNodeSerializer(many=True)})
    def get(self, request: Request, *args: object, **kwargs: object) -> Response:
        return super().get(request, *args, **kwargs)


class TrashRestoreView(APIView):
    @extend_schema(
        operation_id="trash_restore",
        request=TrashSelectionSerializer,
        responses={200: MoveResultSerializer, 400: BAD_REQUEST, 404: NOT_FOUND},
    )
    def post(self, request: Request) -> Response:
        serializer = TrashSelectionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        nodes = trash.restore(_user(request), serializer.validated_data["node_ids"])
        return Response(MoveResultSerializer({"nodes": nodes}).data)


class TrashDeleteView(APIView):
    @extend_schema(
        operation_id="trash_delete",
        request=TrashSelectionSerializer,
        responses={204: None, 400: BAD_REQUEST, 404: NOT_FOUND},
    )
    def post(self, request: Request) -> Response:
        serializer = TrashSelectionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        trash.delete(_user(request), serializer.validated_data["node_ids"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class TrashEmptyView(APIView):
    @extend_schema(operation_id="trash_empty", request=None, responses={204: None})
    def post(self, request: Request) -> Response:
        trash.delete(_user(request))
        return Response(status=status.HTTP_204_NO_CONTENT)
