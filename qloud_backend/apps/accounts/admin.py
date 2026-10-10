from django import forms
from django.contrib import admin
from django.core.exceptions import PermissionDenied, ValidationError
from django.db.models import QuerySet
from django.http import HttpRequest
from django.utils.translation import gettext_lazy as _

from .models import Plan, User
from .services import set_default_plan, suspend_users, unsuspend_user, validate_admin_access


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin[Plan]):
    list_display = ("code", "name", "quota_bytes", "is_default_for_signup", "is_active")
    list_filter = ("is_active", "is_default_for_signup")
    search_fields = ("code", "name")
    readonly_fields = ("id", "created_at", "updated_at", "is_default_for_signup")
    actions = ("make_default",)

    @admin.action(description=_("Use this plan for new accounts"), permissions=["change"])
    def make_default(self, request: HttpRequest, queryset: QuerySet[Plan]) -> None:
        if queryset.count() != 1:
            self.message_user(request, _("Select exactly one active plan."), level="error")
            return
        try:
            set_default_plan(queryset.get())
        except ValidationError as error:
            self.message_user(request, error.messages[0], level="error")
        except Plan.DoesNotExist:
            self.message_user(request, _("The selected plan no longer exists."), level="error")

    def has_delete_permission(self, request: HttpRequest, obj: Plan | None = None) -> bool:
        # Default plans and plans assigned to users cannot be removed through admin.
        return super().has_delete_permission(request, obj) and (
            obj is not None and not obj.is_default_for_signup and not obj.user_set.exists()
        )


class UserAdminForm(forms.ModelForm[User]):
    class Meta:
        model = User
        fields = (
            "email",
            "display_name",
            "avatar_url",
            "locale",
            "theme",
            "plan",
            "quota_override_bytes",
            "is_active",
            "is_staff",
            "is_superuser",
            "groups",
            "user_permissions",
        )

    def clean(self) -> dict[str, object]:
        data = super().clean()
        if data is None:
            return {}
        if not self.instance._state.adding:
            validate_admin_access(
                self.instance,
                active=bool(data.get("is_active")),
                staff=bool(data.get("is_staff")),
                superuser=bool(data.get("is_superuser")),
            )
        return data


@admin.register(User)
class UserAdmin(admin.ModelAdmin[User]):
    form = UserAdminForm
    list_display = ("email", "display_name", "plan", "suspended_at", "is_active", "is_staff")
    list_filter = ("is_active", "is_staff", "plan")
    search_fields = ("email", "display_name")
    ordering = ("-created_at",)
    readonly_fields = (
        "id",
        "created_at",
        "updated_at",
        "last_login",
        "root_folder",
        "used_bytes",
        "reserved_bytes",
        "suspended_at",
        "suspended_reason",
    )
    exclude = ("password",)
    list_select_related = ("plan",)
    actions = ("suspend_accounts", "unsuspend_accounts")

    def save_model(
        self, request: HttpRequest, obj: User, form: forms.ModelForm[User], change: bool
    ) -> None:
        if change:
            obj.save(
                update_fields=[
                    name
                    for name in form.changed_data
                    if name in {field.name for field in obj._meta.concrete_fields}
                ]
                + ["updated_at"]
            )
        else:
            super().save_model(request, obj, form, change)

    @admin.action(description=_("Suspend selected accounts"), permissions=["change"])
    def suspend_accounts(self, request: HttpRequest, queryset: QuerySet[User]) -> None:
        if not isinstance(request.user, User):
            raise PermissionDenied
        try:
            suspend_users(
                queryset.values_list("pk", flat=True),
                reason="Suspended by administrator.",
                actor=request.user,
            )
        except ValidationError as error:
            self.message_user(request, error.messages[0], level="error")

    @admin.action(description=_("Unsuspend selected accounts"), permissions=["change"])
    def unsuspend_accounts(self, request: HttpRequest, queryset: QuerySet[User]) -> None:
        for user in queryset:
            unsuspend_user(user)
