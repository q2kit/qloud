from typing import Any

from rest_framework import serializers

from apps.accounts.models import User
from apps.drive.serializers import NodeSerializer

from .models import Share


class CreateShareSerializer(serializers.Serializer[dict[str, Any]]):
    email = serializers.EmailField(max_length=254)
    role = serializers.ChoiceField(choices=Share.Role.choices)


class UpdateShareSerializer(serializers.Serializer[dict[str, Any]]):
    role = serializers.ChoiceField(choices=Share.Role.choices)


class GranteeSerializer(serializers.ModelSerializer[User]):
    class Meta:
        model = User
        fields = ("id", "email", "display_name")
        read_only_fields = fields


class ShareSerializer(serializers.ModelSerializer[Share]):
    node_id = serializers.UUIDField(read_only=True)
    grantee = GranteeSerializer(read_only=True)
    created_by_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = Share
        fields = ("id", "node_id", "grantee", "role", "created_by_id", "created_at", "updated_at")
        read_only_fields = fields


class SharedOwnerSerializer(serializers.ModelSerializer[User]):
    class Meta:
        model = User
        fields = ("id", "display_name")
        read_only_fields = fields


class SharedNodeSerializer(NodeSerializer):
    owner = SharedOwnerSerializer(read_only=True)
    effective_role = serializers.ChoiceField(choices=Share.Role.choices, read_only=True)

    class Meta(NodeSerializer.Meta):
        fields = (*NodeSerializer.Meta.fields, "owner", "effective_role")
        read_only_fields = fields
