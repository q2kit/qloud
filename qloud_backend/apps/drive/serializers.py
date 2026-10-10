from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from apps.sharing.permissions import Role

from .models import Node
from .names import MAX_LENGTH, normalize_name
from .services import MOVE_LIMIT


class NodeSerializer(serializers.ModelSerializer[Node]):
    parent_id = serializers.UUIDField(read_only=True, allow_null=True)
    is_root = serializers.SerializerMethodField()

    class Meta:
        model = Node
        fields: tuple[str, ...] = (
            "id",
            "kind",
            "name",
            "parent_id",
            "is_root",
            "size",
            "mime_type",
            "created_at",
            "updated_at",
        )
        read_only_fields: tuple[str, ...] = fields

    def get_is_root(self, node: Node) -> bool:
        # The root's stored name is technical; the frontend shows a translated one.
        return node.parent_id is None


class BreadcrumbSerializer(serializers.ModelSerializer[Node]):
    class Meta:
        model = Node
        fields = ("id", "name")
        read_only_fields = fields


class CapabilitiesSerializer(serializers.Serializer[dict[str, bool]]):
    can_edit = serializers.BooleanField(help_text="Rename, move; create inside a folder.")
    can_trash = serializers.BooleanField()
    can_share = serializers.BooleanField()


def capabilities(node: Node, role: Role) -> dict[str, bool]:
    root = node.parent_id is None
    return {
        "can_edit": role >= Role.EDITOR and not root,
        "can_trash": role >= Role.EDITOR and not root,
        "can_share": role >= Role.OWNER and not root,
    }


class NodeDetailSerializer(NodeSerializer):
    breadcrumb = BreadcrumbSerializer(many=True, read_only=True)
    capabilities = CapabilitiesSerializer(read_only=True)

    class Meta(NodeSerializer.Meta):
        fields = (*NodeSerializer.Meta.fields, "breadcrumb", "capabilities")
        read_only_fields = fields


class NameField(serializers.CharField):
    """A node name, normalized by drive.names."""

    def __init__(self, **kwargs: Any) -> None:
        # CharField trims before max_length runs, matching normalize_name.
        super().__init__(max_length=MAX_LENGTH, **kwargs)

    def to_internal_value(self, data: Any) -> str:
        try:
            return normalize_name(super().to_internal_value(data))
        except DjangoValidationError as error:
            raise serializers.ValidationError(error.messages, code=error.code) from error


class CreateFolderSerializer(serializers.Serializer[dict[str, Any]]):
    parent_id = serializers.UUIDField()
    name = NameField()
    on_conflict = serializers.ChoiceField(choices=["fail", "rename", "reuse"], default="fail")


class RenameSerializer(serializers.Serializer[dict[str, Any]]):
    name = NameField()


class MoveSerializer(serializers.Serializer[dict[str, Any]]):
    node_ids = serializers.ListField(
        child=serializers.UUIDField(), min_length=1, max_length=MOVE_LIMIT
    )
    target_parent_id = serializers.UUIDField()


class DownloadLinkSerializer(serializers.Serializer[Any]):
    url = serializers.URLField(help_text="Presigned GET URL; send the browser straight to it.")
    expires_at = serializers.DateTimeField()


class MoveResultSerializer(serializers.Serializer[dict[str, Any]]):
    nodes = NodeSerializer(many=True)


class ThumbnailLinkSerializer(serializers.Serializer[Any]):
    url = serializers.URLField()
    large_url = serializers.URLField()
    expires_at = serializers.DateTimeField()


class PreviewLinkSerializer(serializers.Serializer[Any]):
    kind = serializers.ChoiceField(
        choices=["image", "pdf", "video", "audio", "text", "unsupported"]
    )
    url = serializers.URLField(allow_null=True)
    expires_at = serializers.DateTimeField(allow_null=True)
    thumbnail = ThumbnailLinkSerializer(allow_null=True)
