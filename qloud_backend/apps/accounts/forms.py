from typing import Any

from django import forms
from django.http import HttpRequest
from django.utils.translation import gettext_lazy as _

from apps.core.turnstile import verify_turnstile


def check_turnstile(token: str) -> str:
    # Imported lazily: this module is loaded while allauth builds its form classes.
    from allauth.account.adapter import get_adapter
    from allauth.core import context

    request = context.request
    remote_ip = get_adapter().get_client_ip(request) if request is not None else None
    if not verify_turnstile(token, remote_ip):
        raise forms.ValidationError(
            _("Bot verification failed. Please try again."), code="captcha_invalid"
        )
    return token


class TurnstileSignupForm(forms.Form):
    """Base of every allauth signup form (ACCOUNT_SIGNUP_FORM_CLASS).

    allauth derives both the email signup and the OAuth "complete signup" forms
    from this class, so both require a Turnstile token.
    """

    turnstile_token = forms.CharField(required=False)

    def clean_turnstile_token(self) -> str:
        return check_turnstile(self.cleaned_data.get("turnstile_token", ""))

    def signup(self, request: HttpRequest, user: Any) -> None:
        pass
