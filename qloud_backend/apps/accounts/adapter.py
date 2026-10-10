from typing import Any, cast

from allauth.account.adapter import DefaultAccountAdapter
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from allauth.socialaccount.models import SocialLogin
from django.conf import settings
from django.contrib.auth.base_user import AbstractBaseUser
from django.http import HttpRequest, HttpResponse

from .models import Plan, User


def apply_request_locale(request: HttpRequest, user: User) -> None:
    # LocaleMiddleware has already resolved Accept-Language to a supported language.
    language = getattr(request, "LANGUAGE_CODE", "")
    if language in User.Locale.values:
        user.locale = language


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
        apply_request_locale(request, user)
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


class SocialAccountAdapter(DefaultSocialAccountAdapter):
    """Fills the profile of accounts created through Google or GitHub.

    Signup availability comes from AccountAdapter.is_open_for_signup (allauth's
    default delegates to it), and suspended users are refused by its pre_login.
    """

    def populate_user(
        self, request: HttpRequest, sociallogin: SocialLogin, data: dict[str, Any]
    ) -> User:
        user = cast(User, super().populate_user(request, sociallogin, data))
        # Prefer the provider's own full name (Google keeps it only in extra_data).
        name = (
            data.get("name")
            or sociallogin.account.extra_data.get("name")
            or " ".join(part for part in (data.get("first_name"), data.get("last_name")) if part)
        )
        max_length = User._meta.get_field("display_name").max_length
        user.display_name = (name or "").strip()[:max_length]
        user.avatar_url = sociallogin.account.get_avatar_url() or None
        apply_request_locale(request, user)
        return user
