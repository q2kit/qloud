from typing import cast

from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import User
from .serializers import MeSerializer


class MeView(APIView):
    """The signed-in user's profile and preferences (S-13)."""

    def _user(self, request: Request) -> User:
        # The default IsAuthenticated permission has already rejected anonymous users.
        return cast(User, request.user)

    @extend_schema(operation_id="me_retrieve", responses={200: MeSerializer})
    def get(self, request: Request) -> Response:
        return Response(MeSerializer(self._user(request)).data)

    @extend_schema(
        operation_id="me_partial_update", request=MeSerializer, responses={200: MeSerializer}
    )
    def patch(self, request: Request) -> Response:
        user = self._user(request)
        serializer = MeSerializer(user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        for field, value in serializer.validated_data.items():
            setattr(user, field, value)
        user.save(update_fields=[*serializer.validated_data, "updated_at"])
        return Response(MeSerializer(user).data)
