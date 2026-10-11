from django.contrib import admin
from django.http import HttpRequest

from apps.accounts.models import User

from .models import ModerationAction, Report


class ReadOnlyModerationAdmin(admin.ModelAdmin[Report | ModerationAction]):
    def has_module_permission(self, request: HttpRequest) -> bool:
        user = request.user
        return (
            isinstance(user, User)
            and user.is_active
            and user.is_superuser
            and user.suspended_at is None
        )

    def has_view_permission(self, request: HttpRequest, obj: object = None) -> bool:
        return self.has_module_permission(request)

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: object = None) -> bool:
        return False

    def has_delete_permission(self, request: HttpRequest, obj: object = None) -> bool:
        return False

    def get_readonly_fields(self, request: HttpRequest, obj: object = None) -> tuple[str, ...]:
        return tuple(field.name for field in self.model._meta.fields)


@admin.register(Report)
class ReportAdmin(ReadOnlyModerationAdmin):
    list_display = ("node_name", "reason", "status", "created_at")
    list_filter = ("status", "reason")
    search_fields = ("node_name", "reporter_email")
    list_select_related = ("share_link", "node", "reporter_user", "resolved_by")


@admin.register(ModerationAction)
class ModerationActionAdmin(ReadOnlyModerationAdmin):
    list_display = ("report_uuid", "actor_uuid", "action", "created_at")
    list_filter = ("action",)
    list_select_related = ("report", "actor")
