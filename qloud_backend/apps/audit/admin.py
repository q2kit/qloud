from django.contrib import admin
from django.http import HttpRequest

from .models import AuditEvent


@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin[AuditEvent]):
    """Read-only: the log is written by the actions themselves."""

    list_display = ("created_at", "action", "actor_kind", "actor_name", "node_name", "owner")
    list_filter = ("action", "actor_kind", ("created_at", admin.DateFieldListFilter))
    search_fields = ("node_name", "actor_name", "owner__email", "actor__email")
    list_select_related = ("owner",)
    raw_id_fields = ("actor", "owner", "node", "parent", "source_parent")
    date_hierarchy = "created_at"

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: object = None) -> bool:
        return False

    def has_delete_permission(self, request: HttpRequest, obj: object = None) -> bool:
        return False
