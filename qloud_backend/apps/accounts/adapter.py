from typing import Any, cast

from allauth.account.adapter import DefaultAccountAdapter
from django.conf import settings
from django.contrib.auth.base_user import AbstractBaseUser
from django.http import HttpRequest, HttpResponse

from .models import Plan, User


class AccountAdapter(DefaultAccountAdapter):
    def is_open_for_signup(self, request: HttpRequest) -> bool:
        # Without a default plan, provisioning would fail mid-signup; refuse up front.
        return bool(settings.SIGNUP_ENABLED) and (
            Plan.objects.filter(is_default_for_signup=True).exists()
        )

    def save_user(
        self, request: HttpRequest, user: AbstractBaseUser, form: Any, commit: bool = True
    ) -> AbstractBaseUser:
        user = cast(User, super().save_user(request, user, form, commit=False))
        # LocaleMiddleware has already resolved Accept-Language to a supported language.
        language = getattr(request, "LANGUAGE_CODE", "")
        if language in User.Locale.values:
            user.locale = language
        if commit:
            user.save()
        return user

    def pre_login(
        self, request: HttpRequest, user: AbstractBaseUser, **kwargs: Any
    ) -> HttpResponse | None:
        # Password logins are already refused by AccountBackend; this covers flows
        # that log in without authenticate(), such as social and login-by-code.
        if isinstance(user, User) and user.suspended_at is not None:
            return self.respond_user_inactive(request, user)
        return super().pre_login(request, user, **kwargs)
