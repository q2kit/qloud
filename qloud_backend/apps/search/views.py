from typing import cast

from django.db import transaction
from django.db.models import QuerySet
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import generics
from rest_framework.request import Request
from rest_framework.response import Response

from apps.accounts.models import User
from apps.core.errors import ErrorSerializer
from apps.drive.models import Node

from .pagination import SearchPagination
from .selectors import normalized_query, search_nodes
from .serializers import SearchNodeSerializer, SearchQuerySerializer


class SearchView(generics.ListAPIView[Node]):
    serializer_class = SearchNodeSerializer
    pagination_class = SearchPagination

    def get_queryset(self) -> QuerySet[Node]:
        params = SearchQuerySerializer(data=self.request.query_params)
        params.is_valid(raise_exception=True)
        data = params.validated_data
        return search_nodes(
            cast(User, self.request.user),
            normalized_query(data["q"]),
            node_type=data.get("type", ""),
            owner=data.get("owner", ""),
            modified_after=data.get("modified_after"),
        )

    @extend_schema(
        operation_id="search_list",
        parameters=[SearchQuerySerializer],
        responses={
            200: SearchNodeSerializer,
            400: OpenApiResponse(ErrorSerializer),
            403: OpenApiResponse(ErrorSerializer),
            404: OpenApiResponse(ErrorSerializer),
        },
    )
    @transaction.atomic
    def get(self, request: Request, *args: object, **kwargs: object) -> Response:
        return super().get(request, *args, **kwargs)
