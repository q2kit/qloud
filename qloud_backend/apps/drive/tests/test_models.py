import pytest
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.utils import timezone

from apps.drive.models import Blob, FileVersion, Node

pytestmark = pytest.mark.django_db


def folder(user, parent, name, **fields) -> Node:
    return Node.objects.create(owner=user, parent=parent, name=name, **fields)


def test_sibling_names_are_unique_case_insensitively(user, root):
    folder(user, root, "Docs")
    with pytest.raises(IntegrityError), transaction.atomic():
        folder(user, root, "docs")
    # Another folder may hold the same name.
    other = folder(user, root, "Other")
    folder(user, other, "docs")


def test_trashed_nodes_do_not_block_their_name(user, root):
    old = folder(user, root, "Docs")
    old.trashed_at, old.trashed_root, old.trashed_by = timezone.now(), old, user
    old.save()
    folder(user, root, "Docs")
    with pytest.raises(IntegrityError), transaction.atomic():
        # Restoring it without a new name would clash.
        Node.objects.filter(pk=old.pk).update(trashed_at=None, trashed_root=None)


@pytest.mark.parametrize("name", ["", ".", "..", "a/b", " pad", "pad ", "tab\tx"])
def test_database_rejects_invalid_names(user, root, name):
    with pytest.raises(IntegrityError), transaction.atomic():
        folder(user, root, name)


def test_folders_have_no_content(user, root, make_file):
    version = make_file().current_version
    for fields in ({"size": 1}, {"mime_type": "text/plain"}, {"current_version": version}):
        with pytest.raises(IntegrityError), transaction.atomic():
            folder(user, root, "f", **fields)


def test_files_need_a_parent(user):
    with pytest.raises(IntegrityError), transaction.atomic():
        Node.objects.create(owner=user, parent=None, kind=Node.Kind.FILE, name="loose.txt")


def test_trashed_at_and_trashed_root_go_together(user, root):
    node = folder(user, root, "Docs")
    with pytest.raises(IntegrityError), transaction.atomic():
        Node.objects.filter(pk=node.pk).update(trashed_at=timezone.now())
    with pytest.raises(IntegrityError), transaction.atomic():
        Node.objects.filter(pk=node.pk).update(trashed_root=node)


def test_version_numbers_are_unique_per_node_and_positive(user, make_file):
    node = make_file()
    version = node.current_version
    assert version is not None
    with pytest.raises(IntegrityError), transaction.atomic():
        FileVersion.objects.create(
            node=node, blob=version.blob, version_number=1, size=1, mime_type="x/y",
            original_name="a.txt",
        )  # fmt: skip
    with pytest.raises(IntegrityError), transaction.atomic():
        FileVersion.objects.create(
            node=node, blob=version.blob, version_number=0, size=1, mime_type="x/y",
            original_name="a.txt",
        )  # fmt: skip


def test_blobs_outlive_their_versions_until_removed_explicitly(make_file):
    node = make_file()
    blob = Blob.objects.get(versions__node=node)
    node.delete()
    assert not FileVersion.objects.filter(blob=blob).exists()
    # The object in the bucket must be removed first, so the row stays.
    assert Blob.objects.filter(pk=blob.pk).exists()


def test_a_blob_in_use_cannot_be_deleted(make_file):
    blob = Blob.objects.get(versions__node=make_file())
    with pytest.raises(ProtectedError):
        blob.delete()


def test_deleting_the_uploader_keeps_the_version(user, make_file, django_user_model):
    other = django_user_model.objects.create_user("uploader@example.com")
    node = make_file()
    FileVersion.objects.filter(node=node).update(uploaded_by=other)
    other.delete()
    assert FileVersion.objects.get(node=node).uploaded_by is None


def test_string_forms(make_file):
    node = make_file("notes.txt")
    version = FileVersion.objects.get(node=node)
    assert (str(node), str(version), str(version.blob)) == (
        "notes.txt",
        "notes.txt v1",
        f"blobs/{node.pk}",
    )
