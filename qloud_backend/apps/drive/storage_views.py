from django.db.models import QuerySet
from drf_spectacular.utils import extend_schema
from rest_framework import generics, serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from . import storage
from .models import Node
from .pagination import LargestPagination
from .serializers import NodeSerializer
from .views import _user


class StorageBreakdownSerializer(serializers.Serializer[dict[str, int]]):
    document = serializers.IntegerField()
    image = serializers.IntegerField()
    video = serializers.IntegerField()
    audio = serializers.IntegerField()
    archive = serializers.IntegerField()
    other = serializers.IntegerField()
    old_versions = serializers.IntegerField(help_text="Blobs kept only by old versions.")
    trash = serializers.IntegerField(help_text="Blobs kept only by trashed files.")


class StorageUsageSerializer(serializers.Serializer[storage.StorageUsage]):
    quota_bytes = serializers.IntegerField(help_text="Plan quota or the account override.")
    used_bytes = serializers.IntegerField()
    reserved_bytes = serializers.IntegerField(help_text="Held for uploads in progress.")
    max_file_size_bytes = serializers.IntegerField()
    breakdown = StorageBreakdownSerializer(
        help_text="Each blob counted once; the groups add up to the stored bytes."
    )


class StorageView(APIView):
    @extend_schema(operation_id="me_storage_retrieve", responses={200: StorageUsageSerializer})
    def get(self, request: Request) -> Response:
        return Response(StorageUsageSerializer(storage.usage(_user(request))).data)


class LargestFilesView(generics.ListAPIView[Node]):
    serializer_class = NodeSerializer
    pagination_class = LargestPagination

    def get_queryset(self) -> QuerySet[Node]:
        return storage.largest_files(_user(self.request))

    @extend_schema(
        operation_id="me_storage_largest_list", responses={200: NodeSerializer(many=True)}
    )
    def get(self, request: Request, *args: object, **kwargs: object) -> Response:
        return super().get(request, *args, **kwargs)
