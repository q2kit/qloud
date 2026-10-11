import uuid
from typing import cast

from django.conf import settings
from django.db.models import QuerySet
from django.http import Http404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.drive.downloads import download_link
from apps.drive.models import Node
from apps.drive.pagination import NodeChildrenPagination
from apps.drive.previews import preview_link
from apps.drive.serializers import DownloadLinkSerializer, PreviewLinkSerializer

from . import link_selectors, link_services
from .link_serializers import (
    CreateLinkSerializer,
    PublicChildrenQuerySerializer,
    PublicNodeDetailSerializer,
    PublicNodeQuerySerializer,
    PublicNodeSerializer,
    ShareLinkSerializer,
)
from .models import ShareLink
from .pagination import SharePagination
from .permissions import get_link_node_or_404
from .views import BAD_REQUEST, NOT_FOUND

NODE_PARAM = OpenApiParameter("node_id", uuid.UUID, description="Defaults to the shared root.")
FOLDER_PARAM = OpenApiParameter("folder_id", uuid.UUID, description="Defaults to the shared root.")


class NodeLinksView(generics.ListAPIView[ShareLink]):
    serializer_class = ShareLinkSerializer
    pagination_class = SharePagination

    def get_queryset(self) -> QuerySet[ShareLink]:
        return link_selectors.links_for(cast(User, self.request.user), self.kwargs["node_id"])

    @extend_schema(
        operation_id="nodes_links_list",
        responses={200: ShareLinkSerializer, 400: BAD_REQUEST, 404: NOT_FOUND},
    )
    def get(self, request: Request, *args: object, **kwargs: object) -> Response:
        return super().get(request, *args, **kwargs)

    @extend_schema(
        operation_id="nodes_links_create",
        request=CreateLinkSerializer,
        responses={201: ShareLinkSerializer, 400: BAD_REQUEST, 404: NOT_FOUND},
    )
    def post(self, request: Request, node_id: uuid.UUID) -> Response:
        user = cast(User, request.user)
        link_selectors.owned_node(user, node_id)
        data = CreateLinkSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        link = link_services.create_link(user, node_id, **data.validated_data)
        return Response(ShareLinkSerializer(link).data, status=status.HTTP_201_CREATED)


class LinkDetailView(APIView):
    @extend_schema(
        operation_id="links_destroy", request=None, responses={204: None, 404: NOT_FOUND}
    )
    def delete(self, request: Request, link_id: uuid.UUID) -> Response:
        link_services.revoke_link(cast(User, request.user), link_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PublicLinkView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def scoped_node(self, request: Request, token: str) -> tuple[ShareLink, Node]:
        link = link_selectors.public_link(token)
        query = PublicNodeQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        return link, get_link_node_or_404(link, query.validated_data.get("node_id"))

    @extend_schema(
        operation_id="public_links_retrieve",
        parameters=[NODE_PARAM],
        responses={200: PublicNodeDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND},
    )
    def get(self, request: Request, token: str) -> Response:
        link, node = self.scoped_node(request, token)
        data = PublicNodeSerializer(node, context={"link": link}).data
        data["breadcrumb"] = [
            {"id": str(n.pk), "name": n.name} for n in link_selectors.public_breadcrumb(link, node)
        ]
        data["capabilities"] = {"can_edit": False, "can_trash": False, "can_share": False}
        return Response(data)


def link_ttl(link: ShareLink) -> int:
    ttl = min(300, int(settings.S3_DOWNLOAD_URL_SECONDS))
    if link.expires_at is not None:
        ttl = min(ttl, int((link.expires_at - timezone.now()).total_seconds()))
    if ttl < 1:
        raise Http404
    return ttl


class PublicChildrenView(generics.ListAPIView[Node]):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    serializer_class = PublicNodeSerializer
    pagination_class = NodeChildrenPagination

    def get_queryset(self) -> QuerySet[Node]:
        self.link = link_selectors.public_link(self.kwargs["token"])
        query = PublicChildrenQuerySerializer(data=self.request.query_params)
        query.is_valid(raise_exception=True)
        return link_selectors.public_children(self.link, query.validated_data.get("folder_id"))

    def get_serializer_context(self) -> dict[str, object]:
        return {**super().get_serializer_context(), "link": self.link}

    @extend_schema(
        operation_id="public_links_children_list",
        parameters=[FOLDER_PARAM],
        responses={200: PublicNodeSerializer, 400: BAD_REQUEST, 404: NOT_FOUND},
    )
    def get(self, request: Request, *args: object, **kwargs: object) -> Response:
        return super().get(request, *args, **kwargs)


class PublicDownloadView(PublicLinkView):
    @extend_schema(
        operation_id="public_links_download_retrieve",
        parameters=[NODE_PARAM],
        responses={200: DownloadLinkSerializer, 400: BAD_REQUEST, 404: NOT_FOUND},
    )
    def get(self, request: Request, token: str) -> Response:
        link, node = self.scoped_node(request, token)
        return Response(DownloadLinkSerializer(download_link(node, expires_in=link_ttl(link))).data)


class PublicPreviewView(PublicLinkView):
    @extend_schema(
        operation_id="public_links_preview_retrieve",
        parameters=[NODE_PARAM],
        responses={200: PreviewLinkSerializer, 400: BAD_REQUEST, 404: NOT_FOUND},
    )
    def get(self, request: Request, token: str) -> Response:
        link, node = self.scoped_node(request, token)
        return Response(PreviewLinkSerializer(preview_link(node, expires_in=link_ttl(link))).data)
