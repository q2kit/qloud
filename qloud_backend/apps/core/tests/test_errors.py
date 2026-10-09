import pytest
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.test import APIRequestFactory
from rest_framework.views import APIView

from apps.core.errors import AppError


class QuotaExceeded(AppError):
    status_code = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
    default_code = "quota_exceeded"
    default_detail = "Storage quota exceeded."


def _call(exc: Exception):
    class RaisingView(APIView):
        authentication_classes = ()
        permission_classes = ()

        def get(self, request):
            raise exc

    return RaisingView.as_view()(APIRequestFactory().get("/"))


def test_app_error_uses_its_code_and_details():
    response = _call(QuotaExceeded(details={"needed": 10}))

    assert response.status_code == 413
    assert response.data == {
        "error": {
            "code": "quota_exceeded",
            "message": "Storage quota exceeded.",
            "details": {"needed": 10},
        }
    }


def test_app_error_code_can_be_overridden():
    response = _call(AppError("Name taken", code="name_conflict"))

    assert response.data["error"]["code"] == "name_conflict"
    assert response.data["error"]["message"] == "Name taken"


def test_validation_error_puts_fields_in_details():
    response = _call(exceptions.ValidationError({"name": ["This field is required."]}))

    assert response.status_code == 400
    error = response.data["error"]
    assert error["code"] == "validation_error"
    assert error["details"]["fields"]["name"] == ["This field is required."]


@pytest.mark.parametrize(
    ("exc", "status_code", "code"),
    [
        (exceptions.PermissionDenied(), 403, "permission_denied"),
        (exceptions.Throttled(wait=5), 429, "throttled"),
        (Http404(), 404, "not_found"),
    ],
)
def test_drf_and_django_errors_are_wrapped(exc, status_code, code):
    response = _call(exc)

    assert response.status_code == status_code
    assert response.data["error"]["code"] == code


def test_unhandled_exception_is_not_swallowed():
    with pytest.raises(RuntimeError):
        _call(RuntimeError("bug"))
