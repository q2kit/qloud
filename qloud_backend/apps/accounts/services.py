from collections.abc import Iterable
from typing import Any
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db import router, transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from apps.drive.models import Node

from .models import Plan, User


def _signup_plan(*, using: str, plan_id: UUID | None) -> Plan:
    # Django exposes exclusive row locks; PostgreSQL FOR SHARE lets signups coexist
    # while still preventing a selected plan from being edited or deleted.
    if plan_id is not None:
        plans = Plan.objects.using(using).raw(
            "SELECT * FROM accounts_plan WHERE id = %s FOR SHARE", [plan_id]
        )
        plan = next(iter(plans), None)
        if plan is None:
            raise ValidationError(_("The selected plan no longer exists."), code="missing_plan")
        if not plan.is_active:
            raise ValidationError(_("The selected plan is inactive."), code="inactive_plan")
        return plan
    while True:
        plans = Plan.objects.using(using).raw(
            "SELECT * FROM accounts_plan WHERE is_default_for_signup AND is_active FOR SHARE"
        )
        plan = next(iter(plans), None)
        if plan is not None:
            return plan
        # A concurrent switch may have changed the row after this statement's
        # snapshot. Retry with a fresh snapshot instead of reporting a missing plan.
        if not Plan.objects.using(using).filter(is_default_for_signup=True).exists():
            raise ValidationError(
                _("No default signup plan is configured."), code="no_default_plan"
            )


def save_new_user(user: User, *args: Any, **kwargs: Any) -> None:
    using = kwargs.get("using") or router.db_for_write(User, instance=user)
    with transaction.atomic(using=using):
        user.plan = _signup_plan(using=using, plan_id=user.plan_id)
        if not user.password:
            user.set_unusable_password()
        super(User, user).save(*args, **kwargs)
        user.root_folder = Node.objects.using(using).create(
            owner=user, kind=Node.Kind.FOLDER, name="Drive"
        )
        super(User, user).save(using=using, update_fields=["root_folder"])


@transaction.atomic
def set_default_plan(plan: Plan) -> None:
    plans = list(Plan.objects.select_for_update().order_by("pk"))
    selected = next((item for item in plans if item.pk == plan.pk), None)
    if selected is None:
        raise ValidationError(_("The selected plan no longer exists."), code="missing_plan")
    if not selected.is_active:
        raise ValidationError(_("The default signup plan must be active."), code="inactive_plan")
    Plan.objects.filter(is_default_for_signup=True).update(is_default_for_signup=False)
    selected.is_default_for_signup = True
    selected.save(update_fields=["is_default_for_signup", "updated_at"])


@transaction.atomic
def suspend_users(user_ids: Iterable[UUID], *, reason: str, actor: User | None = None) -> None:
    ids = set(user_ids)
    if actor is not None and actor.pk in ids:
        raise ValidationError(_("You cannot suspend your own account."), code="self_suspension")
    # Lock the administrator group only when a target is a superuser. If an
    # ordinary target was promoted while we waited, release its lock and retry
    # with the entire group in the same deterministic order.
    include_admins = User.objects.filter(pk__in=ids, is_superuser=True).exists()
    while True:
        try:
            with transaction.atomic():
                selection = Q(pk__in=ids)
                if include_admins:
                    selection |= Q(is_superuser=True)
                users = list(User.objects.select_for_update().filter(selection).order_by("pk"))
                if not include_admins and any(user.is_superuser for user in users):
                    raise _RetryAdminLocks
                admins = [user for user in users if _available_admin(user)]
                if any(user.pk in ids for user in admins) and not any(
                    user.pk not in ids for user in admins
                ):
                    raise ValidationError(
                        _("At least one active superuser must remain."), code="last_superuser"
                    )
                for current in users:
                    if current.pk in ids and current.suspended_at is None:
                        current.suspended_at = timezone.now()
                        current.suspended_reason = reason
                        current.session_version += 1
                        current.save(
                            update_fields=[
                                "suspended_at",
                                "suspended_reason",
                                "session_version",
                                "updated_at",
                            ]
                        )
            return
        except _RetryAdminLocks:
            include_admins = True


class _RetryAdminLocks(Exception):
    pass


def _available_admin(user: User) -> bool:
    return user.is_superuser and user.is_staff and user.is_active and user.suspended_at is None


def validate_admin_access(user: User, *, active: bool, staff: bool, superuser: bool) -> None:
    # The admin change form runs inside a transaction; retain these locks until
    # its save, sharing the same lock order as superuser suspension.
    users = list(
        User.objects.select_for_update().filter(Q(is_superuser=True) | Q(pk=user.pk)).order_by("pk")
    )
    current = next((item for item in users if item.pk == user.pk), None)
    if (
        current is not None
        and _available_admin(current)
        and not (active and staff and superuser)
        and not any(item.pk != user.pk and _available_admin(item) for item in users)
    ):
        raise ValidationError(
            _("At least one active superuser must remain."), code="last_superuser"
        )


def suspend_user(user: User, *, reason: str, actor: User | None = None) -> None:
    suspend_users([user.pk], reason=reason, actor=actor)


@transaction.atomic
def unsuspend_user(user: User) -> None:
    current = User.objects.select_for_update().get(pk=user.pk)
    current.suspended_at = None
    current.suspended_reason = None
    current.save(update_fields=["suspended_at", "suspended_reason", "updated_at"])
