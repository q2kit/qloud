from typing import Any

from django.contrib.auth import SESSION_KEY
from django.contrib.sessions.models import Session
from django.core.exceptions import ValidationError
from django.db import router, transaction
from django.utils import timezone

from apps.drive.models import Node

from .models import Plan, User


def save_new_user(user: User, *args: Any, **kwargs: Any) -> None:
    using = kwargs.get("using") or router.db_for_write(User, instance=user)
    with transaction.atomic(using=using):
        # Lock in the same order as default-plan changes, including inactive plans.
        plans = list(Plan.objects.using(using).select_for_update().order_by("pk"))
        if user.plan_id is None:
            default = next((plan for plan in plans if plan.is_default_for_signup), None)
            if default is None:
                raise ValidationError("No default signup plan is configured.")
            user.plan = default
        elif not any(plan.pk == user.plan_id and plan.is_active for plan in plans):
            raise ValidationError("The selected plan is inactive.")
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
    selected = next(item for item in plans if item.pk == plan.pk)
    if not selected.is_active:
        raise ValidationError("The default signup plan must be active.")
    Plan.objects.filter(is_default_for_signup=True).update(is_default_for_signup=False)
    selected.is_default_for_signup = True
    selected.save(update_fields=["is_default_for_signup", "updated_at"])


@transaction.atomic
def suspend_user(user: User, *, reason: str) -> None:
    current = User.objects.select_for_update().get(pk=user.pk)
    current.suspended_at = timezone.now()
    current.suspended_reason = reason
    current.save(update_fields=["suspended_at", "suspended_reason", "updated_at"])
    for session in Session.objects.filter(expire_date__gt=timezone.now()).iterator():
        if session.get_decoded().get(SESSION_KEY) == str(user.pk):
            session.delete()


@transaction.atomic
def unsuspend_user(user: User) -> None:
    current = User.objects.select_for_update().get(pk=user.pk)
    current.suspended_at = None
    current.suspended_reason = None
    current.save(update_fields=["suspended_at", "suspended_reason", "updated_at"])
