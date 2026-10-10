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
    # No row lock is needed: set_default_plan commits the switch atomically, so a
    # signup sees either the old or the new default, and the FK check on insert
    # takes FOR KEY SHARE on the plan, which already blocks deleting it.
    # A plan deactivated after this read can still be assigned; that signup simply
    # counts as having happened before the deactivation.
    plans = Plan.objects.using(using)
    if plan_id is None:
        plan = plans.filter(is_default_for_signup=True).first()
        if plan is None:
            raise ValidationError(
                _("No default signup plan is configured."), code="no_default_plan"
            )
        return plan
    plan = plans.filter(pk=plan_id).first()
    if plan is None:
        raise ValidationError(_("The selected plan no longer exists."), code="missing_plan")
    if not plan.is_active:
        raise ValidationError(_("The selected plan is inactive."), code="inactive_plan")
    return plan


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
    # FOR NO KEY UPDATE serializes default switches without blocking the FK check
    # (FOR KEY SHARE) of signups inserting a user on one of these plans.
    plans = list(Plan.objects.select_for_update(no_key=True).order_by("pk"))
    selected = next((item for item in plans if item.pk == plan.pk), None)
    if selected is None:
        raise ValidationError(_("The selected plan no longer exists."), code="missing_plan")
    if not selected.is_active:
        raise ValidationError(_("The default signup plan must be active."), code="inactive_plan")
    Plan.objects.filter(is_default_for_signup=True).update(is_default_for_signup=False)
    selected.is_default_for_signup = True
    selected.save(update_fields=["is_default_for_signup", "updated_at"])


@transaction.atomic
def suspend_users(user_ids: Iterable[UUID | str], *, reason: str, actor: User | None = None) -> int:
    """Suspend the given accounts and return how many were newly suspended."""
    # Normalize so string ids from request data still match the UUID primary keys.
    ids = {UUID(str(pk)) for pk in user_ids}
    if actor is not None and actor.pk in ids:
        raise ValidationError(_("You cannot suspend your own account."), code="self_suspension")
    users = _lock_with_admins(Q(pk__in=ids))
    admins = [user for user in users if _available_admin(user)]
    if any(user.pk in ids for user in admins) and not any(user.pk not in ids for user in admins):
        raise ValidationError(
            _("At least one active superuser must remain."), code="last_superuser"
        )
    now = timezone.now()
    targets = [user for user in users if user.pk in ids and user.suspended_at is None]
    for current in targets:
        current.suspended_at = now
        current.suspended_reason = reason
        current.session_version += 1
        current.save(
            update_fields=["suspended_at", "suspended_reason", "session_version", "updated_at"]
        )
    return len(targets)


def _lock_with_admins(targets: Q) -> list[User]:
    # Superusers are few and these are rare admin operations, so always lock the whole
    # group together with the targets, in one deterministic order to avoid deadlocks.
    return list(
        User.objects.select_for_update().filter(targets | Q(is_superuser=True)).order_by("pk")
    )


def _available_admin(user: User) -> bool:
    return user.is_superuser and user.is_staff and user.is_active and user.suspended_at is None


def validate_admin_access(user: User, *, active: bool, staff: bool, superuser: bool) -> None:
    # The admin change form runs inside a transaction, so these locks are held until
    # its save.
    users = _lock_with_admins(Q(pk=user.pk))
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
