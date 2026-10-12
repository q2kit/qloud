import uuid

from django.db.models import QuerySet
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import generics, serializers, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.core.errors import ErrorSerializer
from apps.core.pagination import DefaultCursorPagination

from . import downloads, selectors, services
from .models import FileVersion
from .serializers import DownloadLinkSerializer, NodeSerializer
from .views import BAD_REQUEST, NOT_FOUND, _user


class VersionUploaderSerializer(serializers.ModelSerializer[User]):
    class Meta:
        model = User
        fields = ("id", "display_name")
        read_only_fields = fields


class FileVersionSerializer(serializers.ModelSerializer[FileVersion]):
    uploaded_by = VersionUploaderSerializer(read_only=True, allow_null=True)
    is_current = serializers.BooleanField(read_only=True)

    class Meta:
        model = FileVersion
        fields = (
            "id",
            "version_number",
            "size",
            "mime_type",
            "original_name",
            "uploaded_by",
            "created_at",
            "keep_forever",
            "is_current",
        )
        read_only_fields = fields


class VersionPagination(DefaultCursorPagination):
    ordering = ("-version_number", "-id")


class VersionListView(generics.ListAPIView[FileVersion]):
    serializer_class = FileVersionSerializer
    pagination_class = VersionPagination

    def get_queryset(self) -> QuerySet[FileVersion]:
        return selectors.version_history(
            selectors.file_for(_user(self.request), self.kwargs["node_id"])
        )

    @extend_schema(
        operation_id="versions_list",
        responses={200: FileVersionSerializer(many=True), 400: BAD_REQUEST, 404: NOT_FOUND},
    )
    def get(self, request: Request, *args: object, **kwargs: object) -> Response:
        return super().get(request, *args, **kwargs)


class VersionDownloadView(APIView):
    @extend_schema(
        operation_id="versions_download",
        responses={200: DownloadLinkSerializer, 400: BAD_REQUEST, 404: NOT_FOUND},
    )
    def get(self, request: Request, node_id: uuid.UUID, version_id: uuid.UUID) -> Response:
        node = selectors.file_for(_user(request), node_id)
        version = selectors.version_for(node, version_id)
        return Response(DownloadLinkSerializer(downloads.version_download_link(node, version)).data)


CURRENT = OpenApiResponse(
    ErrorSerializer, description="`current_version`: the selected version is current."
)


class VersionRestoreView(APIView):
    @extend_schema(
        operation_id="versions_restore",
        request=None,
        responses={200: NodeSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, 409: CURRENT},
    )
    def post(self, request: Request, node_id: uuid.UUID, version_id: uuid.UUID) -> Response:
        node = services.restore_version(_user(request), node_id, version_id)
        return Response(NodeSerializer(node).data)


class VersionDeleteView(APIView):
    @extend_schema(
        operation_id="versions_delete",
        responses={204: None, 400: BAD_REQUEST, 404: NOT_FOUND, 409: CURRENT},
    )
    def delete(self, request: Request, node_id: uuid.UUID, version_id: uuid.UUID) -> Response:
        services.delete_version(_user(request), node_id, version_id)
        return Response(status=status.HTTP_204_NO_CONTENT)
