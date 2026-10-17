import uuid
from typing import cast

from django.db.models import QuerySet
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import generics, serializers, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.core.errors import ErrorSerializer
from apps.drive.models import Node
from apps.drive.pagination import NodeChildrenPagination

from . import selectors, services
from .models import Share
from .pagination import SharePagination
from .serializers import (
    CreateShareSerializer,
    SharedNodeSerializer,
    ShareSerializer,
    UpdateShareSerializer,
)

NOT_FOUND = OpenApiResponse(
    ErrorSerializer, description="No such resource, or insufficient access."
)
BAD_REQUEST = OpenApiResponse(
    ErrorSerializer, description="Invalid input, recipient or root folder."
)


class NodeSharesView(generics.ListAPIView[Share]):
    serializer_class = ShareSerializer
    pagination_class = SharePagination

    def get_queryset(self) -> QuerySet[Share]:
        user = cast(User, self.request.user)
        # Access precedes input validation (api.md, Share).
        node = selectors.editable_node(user, self.kwargs["node_id"])
        include_inherited = serializers.BooleanField(default=False).run_validation(
            self.request.query_params.get("include_inherited", serializers.empty)
        )
        return selectors.shares_on(user, node, include_inherited=include_inherited)

    @extend_schema(
        operation_id="nodes_shares_list",
        parameters=[
            OpenApiParameter(
                "include_inherited",
                bool,
                description="Also list grants on ancestor folders the caller can see "
                "(`node_id` tells them apart).",
            )
        ],
        responses={200: ShareSerializer, 400: BAD_REQUEST, 404: NOT_FOUND},
    )
    def get(self, request: Request, *args: object, **kwargs: object) -> Response:
        return super().get(request, *args, **kwargs)

    @extend_schema(
        operation_id="nodes_shares_create",
        request=CreateShareSerializer,
        responses={
            201: ShareSerializer,
            400: BAD_REQUEST,
            404: NOT_FOUND,
            409: OpenApiResponse(ErrorSerializer, description="share_exists"),
        },
    )
    def post(self, request: Request, node_id: uuid.UUID) -> Response:
        # Access precedes recipient lookup and payload validation.
        user = cast(User, request.user)
        selectors.editable_node(user, node_id)
        serializer = CreateShareSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        share = services.create_share(user, node_id, **serializer.validated_data)
        return Response(ShareSerializer(share).data, status=status.HTTP_201_CREATED)


class ShareDetailView(APIView):
    @extend_schema(
        operation_id="shares_update",
        request=UpdateShareSerializer,
        responses={200: ShareSerializer, 400: BAD_REQUEST, 404: NOT_FOUND},
    )
    def patch(self, request: Request, share_id: uuid.UUID) -> Response:
        user = cast(User, request.user)
        selectors.share_for(user, share_id)
        serializer = UpdateShareSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        share = services.update_share(user, share_id, **serializer.validated_data)
        return Response(ShareSerializer(share).data)

    @extend_schema(
        operation_id="shares_destroy",
        request=None,
        responses={204: None, 400: BAD_REQUEST, 404: NOT_FOUND},
    )
    def delete(self, request: Request, share_id: uuid.UUID) -> Response:
        services.revoke_share(cast(User, request.user), share_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SharedWithMeView(generics.ListAPIView[Node]):
    serializer_class = SharedNodeSerializer
    pagination_class = NodeChildrenPagination

    def get_queryset(self) -> QuerySet[Node]:
        return selectors.shared_with_me(cast(User, self.request.user))

    @extend_schema(
        operation_id="shared_with_me_list",
        responses={200: SharedNodeSerializer, 400: BAD_REQUEST, 404: NOT_FOUND},
    )
    def get(self, request: Request, *args: object, **kwargs: object) -> Response:
        return super().get(request, *args, **kwargs)
