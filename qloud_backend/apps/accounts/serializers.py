from rest_framework import serializers

from .models import User


class MeSerializer(serializers.ModelSerializer[User]):
    # Where the Drive starts (S-05); always set once the account exists.
    root_folder_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = User
        fields = ("id", "email", "display_name", "avatar_url", "locale", "theme", "root_folder_id")
        read_only_fields = ("id", "email", "avatar_url", "root_folder_id")
