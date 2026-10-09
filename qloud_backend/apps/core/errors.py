"""Unified API error format (see qloud_docs/api.md):

    {"error": {"code": "quota_exceeded", "message": "...", "details": {...}}}

`code` is a stable identifier the frontend maps to an i18n message.
"""

from typing import Any

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.settings import api_settings
from rest_framework.views import exception_handler as drf_exception_handler


class AppError(exceptions.APIException):
    """Base class for domain errors with a stable error code."""

    status_code: int = status.HTTP_400_BAD_REQUEST
    default_code = "error"
    default_detail = "Request could not be processed."

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(detail=message, code=code)
        self.code = code or self.default_code
        self.details = details or {}


def exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    # DRF converts these too, but only inside its handler; convert first so the branches
    # below see an APIException and read its detail, not the repr of response.data.
    if isinstance(exc, Http404):
        exc = exceptions.NotFound(*exc.args)
    elif isinstance(exc, DjangoPermissionDenied):
        exc = exceptions.PermissionDenied(*exc.args)

    response = drf_exception_handler(exc, context)
    if response is None or not isinstance(exc, exceptions.APIException):
        return response

    if isinstance(exc, AppError):
        code, message, details = exc.code, str(exc.detail), exc.details
    elif isinstance(exc, exceptions.ValidationError):
        fields = exc.detail
        if not isinstance(fields, dict):
            fields = {api_settings.NON_FIELD_ERRORS_KEY: fields}
        code, message, details = "validation_error", "Invalid input.", {"fields": fields}
    else:
        codes = exc.get_codes()
        code = codes if isinstance(codes, str) else exc.default_code
        message, details = str(exc.detail), {}

    response.data = {"error": {"code": code, "message": message, "details": details}}
    return response
