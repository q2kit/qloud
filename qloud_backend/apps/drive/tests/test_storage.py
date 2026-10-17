import uuid

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.drive import services, trash
from apps.drive.models import Blob, FileVersion, Node
from apps.sharing.models import Share

pytestmark = pytest.mark.django_db

STORAGE = "/api/v1/me/storage"
LARGEST = "/api/v1/me/storage/largest"


@pytest.fixture
def client(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def add_version(user):
    def add(node: Node, size: int, mime_type: str, *, current: bool = True) -> FileVersion:
        blob = Blob.objects.create(storage_key=f"blobs/{uuid.uuid4()}", size=size, etag="e")
        number = node.versions.count() + 1
        version = FileVersion.objects.create(
            node=node, blob=blob, version_number=number, size=size, mime_type=mime_type,
            uploaded_by=user, original_name=node.name,
        )  # fmt: skip
        if current:
            node.current_version, node.size, node.mime_type = version, size, mime_type
            node.save()
        return version

    return add


@pytest.fixture
def stranger(db):
    return User.objects.create_user("stranger@example.com")


@pytest.fixture
def shared_in(stranger):
    """A large file someone else owns and shares: it counts against their quota."""
    root = Node.objects.get(pk=stranger.root_folder_id)
    node = Node.objects.create(owner=stranger, parent=root, kind=Node.Kind.FILE, name="big.iso")
    blob = Blob.objects.create(storage_key=f"blobs/{node.pk}", size=1000, etag="e")
    node.current_version = FileVersion.objects.create(
        node=node, blob=blob, version_number=1, size=1000, mime_type="application/x-iso9660-image",
        original_name="big.iso",
    )  # fmt: skip
    node.size = 1000
    node.save()
    return node


def test_breakdown_counts_each_blob_once_in_its_group(
    client, user, make_file, add_version, shared_in, django_assert_num_queries
):
    Share.objects.create(node=shared_in, grantee=user, created_by=shared_in.owner, role="editor")
    document = make_file("notes.txt", size=3)
    old = add_version(document, 5, "image/png", current=False)
    photo = make_file("photo.png")
    add_version(photo, 10, "image/png")
    for name, size, mime in [
        ("clip.mp4", 20, "video/mp4"),
        ("song.mp3", 30, "audio/mpeg"),
        ("pack.zip", 40, "application/zip"),
        ("report.pdf", 50, "application/pdf"),
        ("data.bin", 60, "application/octet-stream"),
    ]:
        add_version(make_file(name), size, mime)
    services.restore_version(user, document.pk, old.pk)  # shares the old blob
    binned = make_file("binned.txt", size=7)
    trash.trash(user, [binned.pk])
    User.objects.filter(pk=user.pk).update(used_bytes=999, reserved_bytes=11)

    with django_assert_num_queries(3):
        response = client.get(STORAGE)

    assert response.status_code == 200
    assert response.data == {
        "quota_bytes": user.plan.quota_bytes,
        "used_bytes": 999,
        "reserved_bytes": 11,
        "max_file_size_bytes": user.plan.max_file_size_bytes,
        "breakdown": {
            # notes.txt is an image again after the restore; every file's 3-byte
            # text v1 is now an old version.
            "document": 50,
            "image": 15,
            "video": 20,
            "audio": 30,
            "archive": 40,
            "other": 60,
            "old_versions": 3 * 7,
            "trash": 7,
        },
    }


def test_trash_keeps_its_old_versions_in_trash(client, user, make_file, add_version):
    node = make_file("a.txt", size=3)
    add_version(node, 4, "text/plain")
    trash.trash(user, [node.pk])

    assert client.get(STORAGE).data["breakdown"]["trash"] == 7


def test_quota_override_and_empty_account(client, user):
    User.objects.filter(pk=user.pk).update(quota_override_bytes=123)

    data = client.get(STORAGE).data

    assert data["quota_bytes"] == 123
    assert data["used_bytes"] == 0
    assert set(data["breakdown"].values()) == {0}


def test_largest_lists_only_own_live_files(
    client, user, make_file, add_version, shared_in, django_assert_num_queries
):
    Share.objects.create(node=shared_in, grantee=user, created_by=shared_in.owner, role="editor")
    small, medium, large = (make_file(f"{n}.txt", size=n) for n in (1, 2, 4))
    services.create_folder(user, user.root_folder_id, "folder")
    binned = make_file("binned.txt", size=100)
    trash.trash(user, [binned.pk])

    with django_assert_num_queries(1):
        first = client.get(LARGEST, {"page_size": 2})
    second = client.get(first.data["next"])

    assert first.status_code == 200
    assert [item["id"] for item in first.data["results"]] == [str(large.pk), str(medium.pk)]
    assert [item["id"] for item in second.data["results"]] == [str(small.pk)]
    assert second.data["next"] is None
    assert first.data["results"][0]["parent_id"] == str(user.root_folder_id)


def test_largest_rejects_other_orderings(client):
    response = client.get(LARGEST, {"ordering": "name"})

    assert response.status_code == 400


@pytest.mark.parametrize("url", [STORAGE, LARGEST])
def test_requires_authentication(url):
    assert APIClient().get(url).status_code == 403


def test_each_user_sees_only_their_own_usage(user, stranger, shared_in, make_file):
    make_file("mine.txt", size=3)
    client = APIClient()
    client.force_authenticate(stranger)

    assert client.get(STORAGE).data["breakdown"]["other"] == 1000
    assert client.get(STORAGE).data["breakdown"]["document"] == 0
    assert [item["id"] for item in client.get(LARGEST).data["results"]] == [str(shared_in.pk)]
