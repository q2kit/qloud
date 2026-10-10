from typing import Any

from allauth.account.adapter import get_adapter
from allauth.headless.account.inputs import LoginInput, RequestPasswordResetInput, SignupInput
from allauth.headless.account.views import LoginView, RequestPasswordResetView, SignupView
from allauth.headless.base.response import RateLimitResponse
from allauth.headless.internal.restkit import inputs
from django import forms
from django.conf import settings
from django.http import HttpRequest, HttpResponse

from .forms import check_turnstile
from .models import User


class RememberLoginInput(LoginInput):
    remember = inputs.BooleanField(required=False)


class RememberLoginView(LoginView):
    """Headless login with the "remember me" option allauth only offers to forms.

    Sessions end when the browser closes (SESSION_EXPIRE_AT_BROWSER_CLOSE) unless
    the user asks to be remembered, which keeps them for SESSION_COOKIE_AGE.
    """

    input_class = RememberLoginInput
    input: RememberLoginInput

    def handle_invalid_input(self, input: RememberLoginInput) -> HttpResponse:
        # allauth reports the per-email failed-login limit as a form error (400);
        # answer 429 like every other rate limit so clients handle them alike.
        codes = {error.code for errors in input.errors.as_data().values() for error in errors}
        if "too_many_login_attempts" in codes:
            return RateLimitResponse(self.request)
        response: HttpResponse = super().handle_invalid_input(input)
        return response

    def post(self, request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
        response = super().post(request, *args, **kwargs)
        if request.user.is_authenticated and self.input.cleaned_data.get("remember"):
            request.session.set_expiry(settings.SESSION_COOKIE_AGE)
        return response


class EmailAwareSignupInput(SignupInput):
    """Headless signup that validates the password against the email too.

    allauth's headless input validates the password without a user, which skips
    UserAttributeSimilarityValidator; the form-based signup passes a dummy user.
    """

    def clean(self) -> dict[str, Any]:
        cleaned: dict[str, Any] = super().clean()
        password, email = cleaned.get("password"), cleaned.get("email")
        if password and email:
            try:
                get_adapter().clean_password(password, user=User(email=email))
            except forms.ValidationError as error:
                self.add_error("password", error)
        return cleaned


class EmailAwareSignupView(SignupView):
    input_class = {"POST": EmailAwareSignupInput}


class TurnstilePasswordResetInput(RequestPasswordResetInput):
    turnstile_token = inputs.CharField(required=False)

    def clean_turnstile_token(self) -> str:
        return check_turnstile(self.cleaned_data.get("turnstile_token", ""))


class TurnstilePasswordResetView(RequestPasswordResetView):
    input_class = TurnstilePasswordResetInput
