import uuid
from typing import cast

from django.db.models import QuerySet
from django.utils import timezone
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import generics, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.core.errors import ErrorSerializer
from apps.drive.serializers import NodeSerializer

from . import services
from .models import UploadSession
from .serializers import (
    CreateUploadSerializer,
    PartUrlsRequestSerializer,
    PartUrlsSerializer,
    UploadListQuerySerializer,
    UploadSessionDetailSerializer,
    UploadSessionSerializer,
)


def _error(description: str) -> OpenApiResponse:
    return OpenApiResponse(ErrorSerializer, description=description)


NOT_FOUND = _error("No such upload, or not yours.")
CLOSED = _error("`upload_closed` (409) or `upload_expired` (410).")


def _user(request: Request) -> User:
    return cast(User, request.user)


class UploadListCreateView(generics.ListAPIView[UploadSession]):
    serializer_class = UploadSessionSerializer

    def get_queryset(self) -> QuerySet[UploadSession]:
        query = UploadListQuerySerializer(data=self.request.query_params)
        query.is_valid(raise_exception=True)
        sessions = UploadSession.objects.filter(user=_user(self.request))
        if wanted := query.validated_data.get("status"):
            sessions = sessions.filter(status=wanted)
            if wanted == UploadSession.Status.ACTIVE:
                # Not yet swept by the cleanup task (M2-06), but no longer resumable.
                sessions = sessions.filter(expires_at__gt=timezone.now())
        return sessions

    @extend_schema(
        operation_id="uploads_list",
        parameters=[UploadListQuerySerializer],
        responses={200: UploadSessionSerializer},
    )
    def get(self, request: Request, *args: object, **kwargs: object) -> Response:
        return super().get(request, *args, **kwargs)

    @extend_schema(
        operation_id="uploads_create",
        request=CreateUploadSerializer,
        responses={
            201: UploadSessionSerializer,
            400: _error("Invalid input, or the parent is not a folder."),
            403: _error("`email_not_verified`."),
            404: _error("No such folder, or no access to it."),
            409: _error("`name_conflict` (with `on_conflict=fail`)."),
            413: _error("`file_too_large` or `quota_exceeded`."),
            503: _error("`storage_unavailable`."),
        },
    )
    def post(self, request: Request) -> Response:
        serializer = CreateUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = services.create_session(_user(request), **serializer.validated_data)
        return Response(UploadSessionSerializer(session).data, status=status.HTTP_201_CREATED)


class UploadDetailView(APIView):
    @extend_schema(
        operation_id="uploads_retrieve",
        responses={200: UploadSessionDetailSerializer, 404: NOT_FOUND},
    )
    def get(self, request: Request, upload_id: uuid.UUID) -> Response:
        session = services.get_session(_user(request), upload_id)
        session.parts = services.list_parts(session)  # type: ignore[attr-defined]
        return Response(UploadSessionDetailSerializer(session).data)

    @extend_schema(
        operation_id="uploads_destroy",
        responses={204: None, 404: NOT_FOUND, 409: _error("`upload_closed`: already completed.")},
    )
    def delete(self, request: Request, upload_id: uuid.UUID) -> Response:
        user = _user(request)
        services.abort(user, services.get_session(user, upload_id))
        return Response(status=status.HTTP_204_NO_CONTENT)


class UploadPartsView(APIView):
    @extend_schema(
        operation_id="uploads_parts",
        request=PartUrlsRequestSerializer,
        responses={
            200: PartUrlsSerializer,
            400: _error("`invalid_part`."),
            404: NOT_FOUND,
            409: CLOSED,
            410: CLOSED,
        },
    )
    def post(self, request: Request, upload_id: uuid.UUID) -> Response:
        serializer = PartUrlsRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = services.get_session(_user(request), upload_id)
        expires_at = services.part_urls_expire_at()
        parts = services.part_urls(session, serializer.validated_data["part_numbers"])
        return Response(PartUrlsSerializer({"parts": parts, "expires_at": expires_at}).data)


class UploadCompleteView(APIView):
    @extend_schema(
        operation_id="uploads_complete",
        request=None,
        responses={
            200: NodeSerializer,
            400: _error("`upload_incomplete`: parts missing or size mismatch."),
            404: NOT_FOUND,
            409: _error("`upload_closed`, or `target_unavailable` (the upload is cancelled)."),
            410: CLOSED,
            503: _error("`storage_unavailable`."),
        },
    )
    def post(self, request: Request, upload_id: uuid.UUID) -> Response:
        user = _user(request)
        node = services.complete(user, services.get_session(user, upload_id))
        return Response(NodeSerializer(node).data)
