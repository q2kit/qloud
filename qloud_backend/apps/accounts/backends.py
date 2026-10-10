from allauth.account.auth_backends import AuthenticationBackend
from django.contrib.auth.models import AnonymousUser

from .models import User


class AccountBackend(AuthenticationBackend):
    """allauth's email backend that also rejects suspended users.

    Django calls user_can_authenticate both when logging in and when loading the
    user of an existing session, so suspension also cuts off live sessions.
    """

    def user_can_authenticate(self, user: User | AnonymousUser | None) -> bool:
        return super().user_can_authenticate(user) and (
            not isinstance(user, User) or user.suspended_at is None
        )
