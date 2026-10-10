import pytest

from apps.accounts.models import User
from apps.drive.models import Blob, FileVersion, Node
from apps.storage import s3


@pytest.fixture
def user(db) -> User:
    return User.objects.create_user("owner@example.com")


@pytest.fixture
def root(user) -> Node:
    return Node.objects.get(pk=user.root_folder_id)


@pytest.fixture
def make_file(user, root):
    def make(name: str = "a.txt", parent: Node | None = None, size: int = 3) -> Node:
        node = Node.objects.create(
            owner=user, parent=parent or root, kind=Node.Kind.FILE, name=name
        )
        blob = Blob.objects.create(storage_key=f"blobs/{node.pk}", size=size, etag="e")
        version = FileVersion.objects.create(
            node=node,
            blob=blob,
            version_number=1,
            size=size,
            mime_type="text/plain",
            uploaded_by=user,
            original_name=name,
        )
        node.current_version = version
        node.size, node.mime_type = size, "text/plain"
        node.save()
        return node

    return make


@pytest.fixture
def stored_file(user, root, bucket):
    """A file whose current version really is in the bucket."""

    def make(name: str, body: bytes, mime_type: str) -> Node:
        node = Node.objects.create(
            owner=user, parent=root, kind=Node.Kind.FILE, name=name, mime_type=mime_type,
            size=len(body),
        )  # fmt: skip
        key = s3.new_blob_key()
        s3.client().put_object(Bucket=bucket, Key=key, Body=body, ContentType=mime_type)
        blob = Blob.objects.create(storage_key=key, size=len(body), etag="e")
        node.current_version = FileVersion.objects.create(
            node=node, blob=blob, version_number=1, size=len(body), mime_type=mime_type,
            uploaded_by=user, original_name=name,
        )  # fmt: skip
        node.save()
        return node

    return make
