import logging

import redis
from django.conf import settings
from django.db import connection
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger(__name__)


def _check_database() -> bool:
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception:
        logger.exception("Health check: database unavailable")
        return False
    return True


def _check_redis() -> bool:
    try:
        client = redis.Redis.from_url(settings.REDIS_URL, socket_timeout=1)
        return bool(client.ping())
    except Exception:
        logger.exception("Health check: redis unavailable")
        return False


HEALTH = inline_serializer(
    "Health",
    fields={
        "status": serializers.ChoiceField(choices=["ok", "error"]),
        "checks": serializers.DictField(child=serializers.ChoiceField(choices=["ok", "error"])),
    },
)


class HealthView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)

    @extend_schema(operation_id="health_retrieve", responses={200: HEALTH, 503: HEALTH})
    def get(self, request: Request) -> Response:
        checks = {"database": _check_database(), "redis": _check_redis()}
        healthy = all(checks.values())
        return Response(
            {
                "status": "ok" if healthy else "error",
                "checks": {name: "ok" if ok else "error" for name, ok in checks.items()},
            },
            status=status.HTTP_200_OK if healthy else status.HTTP_503_SERVICE_UNAVAILABLE,
        )


CONFIG = inline_serializer(
    "PublicConfig",
    fields={
        "turnstile_site_key": serializers.CharField(
            allow_null=True,
            help_text="Cloudflare Turnstile site key; null when the server does not check it.",
        ),
    },
)


class ConfigView(APIView):
    """Runtime settings the SPA needs before anyone signs in.

    Served by the backend so the Turnstile site key always matches the secret
    the server verifies with, without rebuilding the frontend.
    """

    authentication_classes = ()
    permission_classes = (AllowAny,)

    @extend_schema(operation_id="config_retrieve", responses={200: CONFIG})
    def get(self, request: Request) -> Response:
        enabled = bool(settings.TURNSTILE_SECRET_KEY and settings.TURNSTILE_SITE_KEY)
        return Response({"turnstile_site_key": settings.TURNSTILE_SITE_KEY if enabled else None})
