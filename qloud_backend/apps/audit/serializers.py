from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import AuditEvent


class ActorSerializer(serializers.Serializer[dict[str, Any]]):
    id = serializers.UUIDField()
    display_name = serializers.CharField()
    email = serializers.EmailField(required=False, help_text="Editors and the owner only.")


class EventNodeSerializer(serializers.Serializer[dict[str, Any]]):
    id = serializers.UUIDField(allow_null=True, help_text="Null once the node is deleted.")
    name = serializers.CharField()
    kind = serializers.CharField()


# Context: `can_manage` (editor or owner of the node read) and `visible_folders`
# (folder ids whose names the reader may see, or None for all).
class AuditEventSerializer(serializers.ModelSerializer[AuditEvent]):
    """One activity row. Emails appear for editors and the owner only; a folder the
    reader cannot open appears without id or name."""

    actor = serializers.SerializerMethodField()
    node = serializers.SerializerMethodField()
    metadata = serializers.SerializerMethodField()

    class Meta:
        model = AuditEvent
        fields = ("id", "action", "created_at", "actor_kind", "actor", "node", "metadata")
        read_only_fields = fields

    @extend_schema_field(ActorSerializer(allow_null=True))
    def get_actor(self, event: AuditEvent) -> dict[str, Any] | None:
        if event.actor_kind != AuditEvent.ActorKind.USER or event.actor_id is None:
            return None
        actor: dict[str, Any] = {"id": str(event.actor_id), "display_name": event.actor_name}
        if self.context["can_manage"] and event.actor is not None:
            actor["email"] = event.actor.email
        return actor

    @extend_schema_field(EventNodeSerializer)
    def get_node(self, event: AuditEvent) -> dict[str, Any]:
        return {
            "id": str(event.node_id) if event.node_id else None,
            "name": event.node_name,
            "kind": event.node_kind,
        }

    @extend_schema_field(serializers.DictField(help_text="Per action; see api.md."))
    def get_metadata(self, event: AuditEvent) -> dict[str, Any]:
        metadata = dict(event.metadata)
        grantee = metadata.get("grantee")
        if isinstance(grantee, dict) and not self.context["can_manage"]:
            metadata["grantee"] = {key: grantee.get(key) for key in ("id", "name")}
        visible = self.context["visible_folders"]
        for key in ("from_folder", "to_folder"):
            folder = metadata.get(key)
            if isinstance(folder, dict) and visible is not None and folder["id"] not in visible:
                # A folder outside what the reader can open: say there was one, not which.
                metadata[key] = {"id": None, "name": None, "is_root": False}
        return metadata
