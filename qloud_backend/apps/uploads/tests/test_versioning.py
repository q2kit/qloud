"""M7-01: replacements preserve identity, access and every previous blob."""

import pytest
from allauth.account.models import EmailAddress

from apps.accounts.models import User
from apps.drive.models import Blob, FileVersion, Node
from apps.drive.services import move, rename
from apps.sharing.models import Share, ShareLink
from apps.storage import s3
from apps.uploads.models import UploadSession

from .conftest import get
from .test_api import counters, error, start, trash, upload, url

pytestmark = pytest.mark.django_db


def test_replace_preserves_identity_history_links_and_quota(client, root, user):
    first = upload(client, root, b"old content", name="Note.txt")
    node = Node.objects.get(pk=first["id"])
    previous = node.current_version
    assert previous is not None
    link = ShareLink.objects.create(node=node, created_by=user)
    node.thumbnail_key = f"thumbs/{previous.pk}/256.webp"
    node.save()
    latest = upload(client, root, b"new", name="note.txt", on_conflict="replace")
    node.refresh_from_db()
    assert (latest["id"], latest["name"], latest["size"]) == (first["id"], "Note.txt", 3)
    assert node.thumbnail_key is None
    versions = list(node.versions.order_by("version_number"))
    assert [v.version_number for v in versions] == [1, 2]
    assert versions[0].pk == previous.pk
    assert versions[1].original_name == "note.txt"
    assert counters(user) == (14, 0)
    for endpoint in (f"/api/v1/nodes/{node.pk}/download", f"/api/v1/nodes/{node.pk}/preview"):
        response = client.get(endpoint)
        assert response.status_code == 200
        assert get(response.json()["url"]) == b"new"
    public = client.get(f"/api/v1/public/links/{link.token}/download")
    assert public.status_code == 200
    assert get(public.json()["url"]) == b"new"
    assert (
        get(
            s3.presign_download(
                previous.blob.storage_key, filename="old", content_type="text/plain"
            )
        )
        == b"old content"
    )


def test_explicit_target_follows_rename_and_move_and_is_idempotent(client, root, user):
    first = upload(client, root, b"old")
    node = Node.objects.get(pk=first["id"])
    session = start(client, root, size=0, name="new-name.bin", target_node_id=str(node.pk)).json()
    assert session["on_conflict"] == "replace"
    assert session["target_node_id"] == str(node.pk)
    folder = Node.objects.create(owner=user, parent=root, name="Elsewhere")
    rename(user, node.pk, "renamed.txt")
    move(user, [node.pk], folder.pk)
    first_done = client.post(url(session["id"], "complete"))
    assert first_done.status_code == 200
    assert (first_done.json()["id"], first_done.json()["parent_id"], first_done.json()["name"]) == (
        str(node.pk),
        str(folder.pk),
        "renamed.txt",
    )
    assert client.post(url(session["id"], "complete")).status_code == 200
    assert FileVersion.objects.filter(node=node).count() == 2
    assert counters(user) == (3, 0)


@pytest.mark.parametrize(("grant", "expected"), [("editor", 201), ("viewer", 404), (None, 404)])
def test_direct_file_permission_without_folder_access(
    client, root, user, api_client, grant, expected
):
    node_id = upload(client, root, b"owner")["id"]
    editor = User.objects.create_user("editor@example.com")
    EmailAddress.objects.create(user=editor, email=editor.email, verified=True, primary=True)
    if grant:
        Share.objects.create(node_id=node_id, grantee=editor, role=grant, created_by=user)
    api_client.force_authenticate(editor)
    response = start(api_client, root, size=0, target_node_id=node_id)
    assert response.status_code == expected
    if expected == 201:
        done = api_client.post(url(response.json()["id"], "complete"))
        assert done.status_code == 200
        assert done.json()["id"] == node_id
        assert FileVersion.objects.get(node_id=node_id, version_number=2).uploaded_by == editor
        assert counters(editor) == (0, 0)
        assert counters(user) == (5, 0)


@pytest.mark.parametrize(("grant", "expected"), [("editor", 201), ("viewer", 404)])
def test_replace_by_name_checks_folder_permission(client, root, user, api_client, grant, expected):
    upload(client, root, b"owner")
    editor = User.objects.create_user("editor@example.com")
    EmailAddress.objects.create(user=editor, email=editor.email, verified=True, primary=True)
    Share.objects.create(node=root, grantee=editor, role=grant, created_by=user)
    api_client.force_authenticate(editor)
    response = start(api_client, root, size=0, on_conflict="replace")
    assert response.status_code == expected


@pytest.mark.parametrize("change", ["trash", "purge", "revoke"])
def test_unavailable_target_aborts_instead_of_creating_a_file(
    client, root, user, api_client, monkeypatch, change
):
    node_id = upload(client, root, b"old")["id"]
    node = Node.objects.get(pk=node_id)
    editor = User.objects.create_user("editor@example.com")
    EmailAddress.objects.create(user=editor, email=editor.email, verified=True, primary=True)
    share = Share.objects.create(node=node, grantee=editor, role="editor", created_by=user)
    api_client.force_authenticate(editor)
    session = start(api_client, root, size=10, target_node_id=node_id).json()
    if change == "trash":
        trash(node)
    elif change == "purge":
        node.delete()
    else:
        share.delete()
    # Assemble happened before the permission recheck; the transaction must still refuse.
    monkeypatch.setattr("apps.uploads.services._assemble", lambda session: '"etag"')
    response = api_client.post(url(session["id"], "complete"))
    assert (response.status_code, error(response)) == (409, "target_unavailable")
    assert UploadSession.objects.get(pk=session["id"]).status == "aborted"
    assert counters(user)[1] == 0
    assert not Node.objects.filter(parent=root, name="a (1).txt").exists()
    assert not Blob.objects.filter(
        storage_key=UploadSession.objects.get(pk=session["id"]).storage_key
    ).exists()


def test_target_validation_and_quota_keep_all_versions(client, root, user):
    node_id = upload(client, root, b"old")["id"]
    folder = Node.objects.create(owner=user, parent=root, name="folder")
    for parent, extra in (
        (root, {"target_node_id": str(folder.pk)}),
        (folder, {"target_node_id": node_id}),
        (root, {"name": "missing", "on_conflict": "replace"}),
        (root, {"name": "folder", "on_conflict": "replace"}),
    ):
        response = start(client, parent, size=0, **extra)
        assert (response.status_code, error(response)) == (400, "invalid_target")
    User.objects.filter(pk=user.pk).update(quota_override_bytes=5)
    response = start(client, root, size=3, on_conflict="replace")
    assert (response.status_code, error(response)) == (413, "quota_exceeded")
    assert counters(user) == (3, 0)


def test_completed_replacement_rechecks_permission(client, root, user, api_client):
    node_id = upload(client, root, b"old")["id"]
    editor = User.objects.create_user("editor@example.com")
    EmailAddress.objects.create(user=editor, email=editor.email, verified=True, primary=True)
    share = Share.objects.create(node_id=node_id, grantee=editor, role="editor", created_by=user)
    api_client.force_authenticate(editor)
    session = start(api_client, root, size=0, target_node_id=node_id).json()
    assert api_client.post(url(session["id"], "complete")).status_code == 200
    share.delete()
    assert api_client.post(url(session["id"], "complete")).status_code == 404
