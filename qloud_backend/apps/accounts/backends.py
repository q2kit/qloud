from django.contrib.auth.backends import ModelBackend
from django.contrib.auth.models import AnonymousUser

from .models import User


class AccountBackend(ModelBackend):
    def user_can_authenticate(self, user: User | AnonymousUser | None) -> bool:
        return super().user_can_authenticate(user) and (
            not isinstance(user, User) or user.suspended_at is None
        )
