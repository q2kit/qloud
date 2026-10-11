from typing import Any

from rest_framework import serializers

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
        )
        read_only_fields: tuple[str, ...] = fields


class ReportDetailSerializer(ReportSerializer):
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
        )
        read_only_fields = fields


class ReportFilterSerializer(serializers.Serializer[dict[str, Any]]):
    status = serializers.ChoiceField(choices=Report.Status.choices, required=False)


class ResolveReportSerializer(serializers.Serializer[dict[str, Any]]):
    action = serializers.ChoiceField(choices=ModerationAction.Action.choices)
    note = serializers.CharField(max_length=2000, trim_whitespace=True)
