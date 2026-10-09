from django.contrib import admin

from .models import User


@admin.register(User)
class UserAdmin(admin.ModelAdmin[User]):
    list_display = ("email", "display_name", "is_active", "is_staff", "created_at")
    list_filter = ("is_active", "is_staff")
    search_fields = ("email", "display_name")
    ordering = ("-created_at",)
    readonly_fields = ("id", "created_at", "updated_at", "last_login")
    exclude = ("password",)
