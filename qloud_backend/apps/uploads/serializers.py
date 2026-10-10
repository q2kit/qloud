import re
from typing import Any

from rest_framework import serializers

from apps.drive.serializers import NameField
from apps.storage.s3 import MAX_PARTS

from .models import UploadSession
from .services import PART_URL_BATCH, part_count

# `type/subtype`, as browsers report File.type; empty means unknown.
_MIME = re.compile(r"^[\w.+-]+/[\w.+-]+$")
DEFAULT_MIME = "application/octet-stream"


class CreateUploadSerializer(serializers.Serializer[dict[str, Any]]):
    parent_id = serializers.UUIDField()
    filename = NameField()
    size = serializers.IntegerField(min_value=0)
    mime_type = serializers.CharField(max_length=255, allow_blank=True, default="")
    fingerprint = serializers.CharField(max_length=128)
    on_conflict = serializers.ChoiceField(
        choices=UploadSession.OnConflict.choices, default=UploadSession.OnConflict.FAIL
    )

    def validate_mime_type(self, value: str) -> str:
        value = value.strip().lower()
        if not value:
            return DEFAULT_MIME
        if not _MIME.match(value):
            raise serializers.ValidationError("Expected `type/subtype`.")
        return value


class UploadSessionSerializer(serializers.ModelSerializer[UploadSession]):
    parent_id = serializers.UUIDField(read_only=True, allow_null=True)
    node_id = serializers.UUIDField(read_only=True, allow_null=True)
    part_count = serializers.SerializerMethodField()

    class Meta:
        model = UploadSession
        fields: tuple[str, ...] = (
            "id",
            "parent_id",
            "filename",
            "size",
            "mime_type",
            "fingerprint",
            "on_conflict",
            "part_size",
            "part_count",
            "status",
            "expires_at",
            "created_at",
            "node_id",
        )
        read_only_fields: tuple[str, ...] = fields

    def get_part_count(self, session: UploadSession) -> int:
        return part_count(session)


class PartSerializer(serializers.Serializer[Any]):
    part_number = serializers.IntegerField(source="number")
    size = serializers.IntegerField()
    etag = serializers.CharField()


class UploadSessionDetailSerializer(UploadSessionSerializer):
    parts = PartSerializer(many=True, read_only=True, help_text="Parts already in storage.")

    class Meta(UploadSessionSerializer.Meta):
        fields = (*UploadSessionSerializer.Meta.fields, "parts")
        read_only_fields = fields


class PartUrlsRequestSerializer(serializers.Serializer[dict[str, Any]]):
    part_numbers = serializers.ListField(
        child=serializers.IntegerField(min_value=1, max_value=MAX_PARTS),
        min_length=1,
        max_length=PART_URL_BATCH,
    )


class PartUrlSerializer(serializers.Serializer[Any]):
    part_number = serializers.IntegerField()
    url = serializers.URLField()


class PartUrlsSerializer(serializers.Serializer[dict[str, Any]]):
    parts = PartUrlSerializer(many=True)
    expires_at = serializers.DateTimeField()


class UploadListQuerySerializer(serializers.Serializer[dict[str, Any]]):
    status = serializers.ChoiceField(choices=UploadSession.Status.choices, required=False)
