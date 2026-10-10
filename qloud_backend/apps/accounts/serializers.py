from rest_framework import serializers

from .models import User


class MeSerializer(serializers.ModelSerializer[User]):
    class Meta:
        model = User
        fields = ("id", "email", "display_name", "avatar_url", "locale", "theme")
        read_only_fields = ("id", "email", "avatar_url")
