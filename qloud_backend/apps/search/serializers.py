from typing import Any

from django.utils.dateparse import parse_datetime
from django.utils.timezone import is_naive
from rest_framework import serializers

from apps.drive.serializers import NodeSerializer
from apps.sharing.serializers import SharedOwnerSerializer

from .selectors import SEARCH_TYPES


class ZonedDateTimeField(serializers.DateTimeField):
    def to_internal_value(self, value: Any) -> Any:
        if isinstance(value, str):
            try:
                parsed = parse_datetime(value)
            except ValueError:
                parsed = None
            if parsed is None or is_naive(parsed):
                raise serializers.ValidationError(
                    "An ISO 8601 datetime with a timezone is required."
                )
        return super().to_internal_value(value)


class SearchQuerySerializer(serializers.Serializer[dict[str, Any]]):
    q = serializers.CharField(max_length=255)
    type = serializers.ChoiceField(choices=SEARCH_TYPES, required=False)
    owner = serializers.ChoiceField(choices=["me", "others"], required=False)
    modified_after = ZonedDateTimeField(required=False)


class SearchNodeSerializer(NodeSerializer):
    owner = SharedOwnerSerializer(read_only=True)
    effective_role = serializers.ChoiceField(choices=["owner", "editor", "viewer"], read_only=True)

    class Meta(NodeSerializer.Meta):
        fields = (*NodeSerializer.Meta.fields, "owner", "effective_role")
        read_only_fields = fields
