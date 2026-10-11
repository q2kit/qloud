from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from . import moderation_services
from .models import ModerationAction, Report


class CreateReportSerializer(serializers.Serializer[dict[str, Any]]):
    node_id = serializers.UUIDField()
    reason = serializers.ChoiceField(choices=Report.Reason.choices)
    message = serializers.CharField(max_length=2000, required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True, max_length=254)
    turnstile_token = serializers.CharField(
        required=False, allow_blank=True, max_length=2048, write_only=True
    )


class ReportAcceptedSerializer(serializers.Serializer[dict[str, Any]]):
    status = serializers.ChoiceField(choices=["accepted"])


class ResolutionSerializer(serializers.ModelSerializer[ModerationAction]):
    class Meta:
        model = ModerationAction
        fields = ("id", "created_at", "actor_uuid", "action", "note", "targets")
        read_only_fields = fields


class ReportSerializer(serializers.ModelSerializer[Report]):
    node_report_count = serializers.IntegerField(read_only=True)
    node_open_report_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Report
        fields: tuple[str, ...] = (
            "id",
            "created_at",
            "node_uuid",
            "node_name",
            "link_uuid",
            "root_node_uuid",
            "owner_uuid",
            "reason",
            "status",
            "node_report_count",
            "node_open_report_count",
        )
        read_only_fields: tuple[str, ...] = fields


class ModerationNodeSerializer(serializers.Serializer[dict[str, Any]]):
    id = serializers.UUIDField()
    name = serializers.CharField()
    kind = serializers.ChoiceField(choices=["file", "folder"])
    size = serializers.IntegerField()
    mime_type = serializers.CharField(allow_null=True)
    trashed_at = serializers.DateTimeField(allow_null=True)


class ModerationOwnerSerializer(serializers.Serializer[dict[str, Any]]):
    id = serializers.UUIDField()
    display_name = serializers.CharField()
    email = serializers.EmailField()
    is_active = serializers.BooleanField()
    suspended_at = serializers.DateTimeField(allow_null=True)


class ModerationContextSerializer(serializers.Serializer[dict[str, Any]]):
    node = ModerationNodeSerializer(allow_null=True)
    root_node = ModerationNodeSerializer(allow_null=True)
    owner = ModerationOwnerSerializer(allow_null=True)
    link_state = serializers.ChoiceField(
        choices=["active", "revoked", "expired", "deleted", "unavailable"]
    )
    link_revoked_at = serializers.DateTimeField(allow_null=True)
    link_expires_at = serializers.DateTimeField(allow_null=True)
    link_revoke_reason = serializers.CharField(allow_null=True)
    resolver_name = serializers.CharField(allow_null=True)


class ReportDetailSerializer(ReportSerializer):
    subject = serializers.SerializerMethodField()

    @extend_schema_field(ModerationContextSerializer)
    def get_subject(self, report: Report) -> dict[str, Any]:
        actor = self.context["request"].user
        return ModerationContextSerializer(moderation_services.report_subject(actor, report)).data

    resolution = ResolutionSerializer(read_only=True, allow_null=True)
    reporter_user_id = serializers.UUIDField(read_only=True, allow_null=True)
    resolved_by_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta(ReportSerializer.Meta):
        fields = (
            *ReportSerializer.Meta.fields,
            "message",
            "reporter_email",
            "reporter_user_id",
            "resolved_at",
            "resolved_by_id",
            "resolution_note",
            "resolution",
            "subject",
        )
        read_only_fields = fields


class ReportFilterSerializer(serializers.Serializer[dict[str, Any]]):
    status = serializers.ChoiceField(choices=Report.Status.choices, required=False)
    node_uuid = serializers.UUIDField(required=False)


class ResolveReportSerializer(serializers.Serializer[dict[str, Any]]):
    action = serializers.ChoiceField(choices=ModerationAction.Action.choices)
    note = serializers.CharField(max_length=2000, trim_whitespace=True)
