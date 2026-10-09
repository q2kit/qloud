"""Unified API error format (see qloud_docs/api.md):

    {"error": {"code": "quota_exceeded", "message": "...", "details": {...}}}

`code` is a stable identifier the frontend maps to an i18n message.
"""

from typing import Any

from rest_framework import exceptions, status
from rest_framework.response import Response
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
    response = drf_exception_handler(exc, context)
    if response is None:
        return None

    if isinstance(exc, AppError):
        code, message, details = exc.code, str(exc.detail), exc.details
    elif isinstance(exc, exceptions.ValidationError):
        code, message, details = "validation_error", "Invalid input.", {"fields": exc.detail}
    elif isinstance(exc, exceptions.APIException):
        codes = exc.get_codes()
        code = codes if isinstance(codes, str) else exc.default_code
        message, details = str(exc.detail), {}
    else:
        # Http404 / PermissionDenied already converted by DRF's handler
        code, message, details = _code_for_status(response.status_code), str(response.data), {}

    response.data = {"error": {"code": code, "message": message, "details": details}}
    return response


def _code_for_status(status_code: int) -> str:
    return {404: "not_found", 403: "permission_denied"}.get(status_code, "error")
