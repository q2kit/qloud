import uuid
from typing import cast

from allauth.account.adapter import get_adapter
from django.db.models import QuerySet
from drf_spectacular.utils import extend_schema
from rest_framework import generics, permissions
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.core.errors import CaptchaInvalid, ErrorSerializer
from apps.core.turnstile import verify_turnstile

from . import moderation_services, report_services
from .link_selectors import public_link
from .models import Report
from .permissions import get_link_node_or_404
from .report_serializers import (
    CreateReportSerializer,
    ReportAcceptedSerializer,
    ReportDetailSerializer,
    ReportFilterSerializer,
    ReportSerializer,
    ResolveReportSerializer,
)
from .views import BAD_REQUEST, NOT_FOUND


class PublicReportView(APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(
        operation_id="public_reports_create",
        request=CreateReportSerializer,
        responses={
            202: ReportAcceptedSerializer,
            400: BAD_REQUEST,
            403: ErrorSerializer,
            404: NOT_FOUND,
            429: ErrorSerializer,
        },
    )
    def post(self, request: Request, token: str) -> Response:
        data = CreateReportSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        payload = data.validated_data.copy()
        link = public_link(token)
        get_link_node_or_404(link, payload["node_id"])
        client_ip = get_adapter().get_client_ip(request._request) or ""
        if not verify_turnstile(payload.pop("turnstile_token", ""), client_ip):
            raise CaptchaInvalid(
                details={"fields": {"turnstile_token": ["Invalid captcha."]}},
            )
        user = request.user if isinstance(request.user, User) else None
        report_services.create_report(token, **payload, user=user, client_ip=client_ip)
        return Response({"status": "accepted"}, status=202)


class IsSuperuser(permissions.BasePermission):
    def has_permission(self, request: Request, view: APIView) -> bool:
        user = request.user
        return (
            isinstance(user, User)
            and user.is_active
            and user.is_superuser
            and user.suspended_at is None
        )


class ReportListView(generics.ListAPIView[Report]):
    permission_classes = [permissions.IsAuthenticated, IsSuperuser]
    serializer_class = ReportSerializer

    def get_queryset(self) -> QuerySet[Report]:
        filters = ReportFilterSerializer(data=self.request.query_params)
        filters.is_valid(raise_exception=True)
        return moderation_services.reports_for(cast(User, self.request.user)).filter(
            **filters.validated_data
        )

    @extend_schema(
        operation_id="moderation_reports_list",
        parameters=[ReportFilterSerializer],
        responses={200: ReportSerializer(many=True), 400: BAD_REQUEST, 403: ErrorSerializer},
    )
    def get(self, request: Request, *args: object, **kwargs: object) -> Response:
        return super().get(request, *args, **kwargs)


class ReportDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsSuperuser]

    @extend_schema(
        operation_id="moderation_reports_retrieve",
        responses={200: ReportDetailSerializer, 403: ErrorSerializer, 404: NOT_FOUND},
    )
    def get(self, request: Request, report_id: uuid.UUID) -> Response:
        return Response(
            ReportDetailSerializer(
                moderation_services.get_report(cast(User, request.user), report_id)
            ).data
        )


class ResolveReportView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsSuperuser]

    @extend_schema(
        operation_id="moderation_reports_resolve",
        request=ResolveReportSerializer,
        responses={
            200: ReportDetailSerializer,
            400: BAD_REQUEST,
            403: ErrorSerializer,
            404: NOT_FOUND,
            409: ErrorSerializer,
        },
    )
    def post(self, request: Request, report_id: uuid.UUID) -> Response:
        data = ResolveReportSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        report = moderation_services.resolve_report(
            cast(User, request.user), report_id, **data.validated_data
        )
        return Response(ReportDetailSerializer(report).data)
