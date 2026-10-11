from typing import Any

from rest_framework import serializers

from apps.drive.models import Node
from apps.drive.serializers import BreadcrumbSerializer, CapabilitiesSerializer

from .models import ShareLink


class CreateLinkSerializer(serializers.Serializer[dict[str, Any]]):
    expires_at = serializers.DateTimeField(required=False, allow_null=True, default=None)


class ShareLinkSerializer(serializers.ModelSerializer[ShareLink]):
    node_id = serializers.UUIDField(read_only=True)
    created_by_id = serializers.UUIDField(read_only=True)
    revoked_by_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta:
        model = ShareLink
        fields: tuple[str, ...] = (
            "id",
            "node_id",
            "token",
            "role",
            "expires_at",
            "revoked_at",
            "revoked_by_id",
            "revoke_reason",
            "created_by_id",
            "created_at",
            "updated_at",
        )
        read_only_fields: tuple[str, ...] = fields


class PublicNodeSerializer(serializers.ModelSerializer[Node]):
    parent_id = serializers.SerializerMethodField()

    class Meta:
        model = Node
        fields: tuple[str, ...] = (
            "id",
            "kind",
            "name",
            "parent_id",
            "size",
            "mime_type",
            "created_at",
            "updated_at",
        )
        read_only_fields: tuple[str, ...] = fields

    def get_parent_id(self, node: Node) -> str | None:
        return None if node.pk == self.context["link"].node_id else str(node.parent_id)


class PublicNodeDetailSerializer(PublicNodeSerializer):
    breadcrumb = BreadcrumbSerializer(many=True, read_only=True)
    capabilities = CapabilitiesSerializer(read_only=True)

    class Meta(PublicNodeSerializer.Meta):
        fields: tuple[str, ...] = (*PublicNodeSerializer.Meta.fields, "breadcrumb", "capabilities")
        read_only_fields: tuple[str, ...] = fields


class PublicNodeQuerySerializer(serializers.Serializer[dict[str, Any]]):
    node_id = serializers.UUIDField(required=False)


class PublicChildrenQuerySerializer(serializers.Serializer[dict[str, Any]]):
    folder_id = serializers.UUIDField(required=False)
