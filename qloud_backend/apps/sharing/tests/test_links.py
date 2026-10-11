import base64
import datetime
import urllib.request
import uuid
from urllib.parse import parse_qs, urlparse

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.drive.models import Blob, FileVersion, Node
from apps.drive.services import move
from apps.drive.trash import trash
from apps.sharing import link_services
from apps.sharing.models import Share, ShareLink
from apps.storage import s3

pytestmark = pytest.mark.django_db


@pytest.fixture
def tree(api_client):
    users = {
        role: User.objects.create_user(f"{role}@example.com")
        for role in ["owner", "editor", "viewer", "outside"]
    }
    owner = users["owner"]
    parent = Node.objects.create(owner=owner, parent=owner.root_folder, name="Private parent")
    root = Node.objects.create(owner=owner, parent=parent, name="Public root")
    child = Node.objects.create(owner=owner, parent=root, name="Child")
    outside = Node.objects.create(owner=owner, parent=owner.root_folder, name="Secret")
    for role in ["editor", "viewer"]:
        Share.objects.create(node=root, grantee=users[role], role=role, created_by=owner)
    api_client.force_authenticate(owner)
    link = link_services.create_link(owner, root.pk)
    return users, root, child, outside, link, api_client


def public(link: ShareLink, suffix: str = "") -> str:
    return f"/api/v1/public/links/{link.token}{suffix}"


def management(root: Node) -> str:
    return f"/api/v1/nodes/{root.pk}/links"


@pytest.mark.parametrize("actor", ["owner", "editor", "viewer", "outside", None])
def test_management_permissions(tree, actor):
    users, root, child, _outside, link, client = tree
    client.force_authenticate(users[actor] if actor else None)
    status = 200 if actor == "owner" else (403 if actor is None else 404)
    for node in [root, child]:
        assert client.get(management(node)).status_code == status
        assert client.post(management(node), {}, format="json").status_code == (
            201 if status == 200 else status
        )
    assert client.delete(f"/api/v1/links/{link.pk}").status_code == (
        204 if status == 200 else status
    )


def test_link_creation_validation_revocation_and_pagination(tree, django_assert_num_queries):
    users, root, _child, _outside, link, client = tree
    expiry = timezone.now() + datetime.timedelta(hours=1)
    for value in ["bad", (timezone.now() - datetime.timedelta(seconds=1)).isoformat()]:
        assert (
            client.post(management(root), {"expires_at": value}, format="json").status_code == 400
        )
    for payload in [{}, {"expires_at": None}, {"expires_at": expiry.isoformat()}]:
        response = client.post(management(root), payload, format="json")
        assert response.status_code == 201
        body = response.json()
        assert body["role"] == "viewer"
        assert body["node_id"] == str(root.pk)
        assert len(body["token"]) == 43
        assert len(base64.urlsafe_b64decode(body["token"] + "=")) == 32
    assert ShareLink.objects.values("token").distinct().count() == 4
    with django_assert_num_queries(2):
        page = client.get(management(root), {"page_size": 2}).json()
    second = client.get(page["next"]).json()
    assert client.get(second["previous"]).json()["results"] == page["results"]
    assert len({r["id"] for r in page["results"] + second["results"]}) == 4
    for params, status in [({"page_size": 0}, 400), ({"cursor": "bad"}, 404)]:
        assert client.get(management(root), params).status_code == status
    endpoint = f"/api/v1/links/{link.pk}"
    assert client.delete(endpoint).status_code == 204
    link.refresh_from_db()
    first = (link.revoked_at, link.revoked_by_id, link.revoke_reason, link.updated_at)
    assert first[1:3] == (users["owner"].pk, "owner")
    assert client.delete(endpoint).status_code == 204
    link.refresh_from_db()
    assert first == (link.revoked_at, link.revoked_by_id, link.revoke_reason, link.updated_at)
    link.revoke_reason = "moderation"
    link.save()
    assert client.delete(endpoint).status_code == 204
    link.refresh_from_db()
    assert link.revoke_reason == "moderation"
    assert client.post(management(users["owner"].root_folder), {}, format="json").status_code == 400
    assert client.delete(f"/api/v1/links/{uuid.uuid7()}").status_code == 404
    with pytest.raises(IntegrityError), transaction.atomic():
        ShareLink.objects.create(node=root, created_by=users["owner"], role="editor")
    with pytest.raises(IntegrityError), transaction.atomic():
        ShareLink.objects.create(node=root, created_by=users["owner"], token=link.token)
    with pytest.raises(IntegrityError), transaction.atomic():
        ShareLink.objects.create(node=root, created_by=users["owner"], revoked_at=timezone.now())


@pytest.mark.parametrize("logged_in", [False, True])
def test_public_tree_isolation_details_pagination(tree, logged_in, django_assert_max_num_queries):
    users, root, child, outside, link, client = tree
    client.force_authenticate(users["owner"] if logged_in else None)
    response = client.get(public(link))
    assert response.status_code == 200
    data = response.json()
    assert data["parent_id"] is None
    assert data["breadcrumb"] == []
    assert not any(data["capabilities"].values())
    assert "owner" not in data
    assert "token" not in data
    assert "storage_key" not in data
    data = client.get(public(link), {"node_id": str(child.pk)}).json()
    assert data["breadcrumb"] == [{"id": str(root.pk), "name": root.name}]
    assert data["parent_id"] == str(root.pk)
    for i in range(7):
        Node.objects.create(owner=users["owner"], parent=root, name=f"Page {i}")
    with django_assert_max_num_queries(3):
        page = client.get(public(link, "/children"), {"page_size": 3}).json()
    ids = [r["id"] for r in page["results"]]
    while page["next"]:
        previous = page
        page = client.get(page["next"]).json()
        assert client.get(page["previous"]).json()["results"] == previous["results"]
        ids += [r["id"] for r in page["results"]]
    assert len(set(ids)) == 8
    for suffix, parameter in [
        ("", "node_id"),
        ("/children", "folder_id"),
        ("/download", "node_id"),
        ("/preview", "node_id"),
    ]:
        for pk in [outside.pk, root.parent_id, users["outside"].root_folder_id, uuid.uuid7()]:
            assert client.get(public(link, suffix), {parameter: str(pk)}).status_code == 404
        assert client.get(public(link, suffix), {parameter: "bad"}).status_code == 400
        assert client.post(public(link, suffix), {}, format="json").status_code == 405
    for params in [{"ordering": "bad"}, {"page_size": 0}]:
        assert client.get(public(link, "/children"), params).status_code == 400
    assert client.get(public(link, "/children"), {"cursor": "bad"}).status_code == 404
    for suffix in ["/download", "/preview"]:
        response = client.get(public(link, suffix))
        assert (response.status_code, response.json()["error"]["code"]) == (400, "not_a_file")


@pytest.mark.parametrize(
    "state", ["expired", "revoked", "moderation", "inactive", "suspended", "trash"]
)
def test_public_invalid_link_uniform_404(tree, state):
    users, root, _child, _outside, link, client = tree
    owner = users["owner"]
    if state == "expired":
        ShareLink.objects.filter(pk=link.pk).update(expires_at=timezone.now())
    elif state in ["revoked", "moderation"]:
        link_services.revoke_link(owner, link.pk)
        if state == "moderation":
            ShareLink.objects.filter(pk=link.pk).update(revoke_reason="moderation")
    elif state == "inactive":
        User.objects.filter(pk=owner.pk).update(is_active=False)
    elif state == "suspended":
        User.objects.filter(pk=owner.pk).update(suspended_at=timezone.now())
    else:
        trash(owner, [root.pk])
    client.force_authenticate(None)
    unknown = client.get("/api/v1/public/links/unknown").json()
    for suffix in ["", "/children", "/download", "/preview"]:
        response = client.get(public(link, suffix))
        assert response.status_code == 404
        assert response.json() == unknown


def test_move_and_trash_change_link_scope(tree):
    users, root, child, outside, link, client = tree
    move(users["owner"], [child.pk], outside.pk)
    assert client.get(public(link), {"node_id": str(child.pk)}).status_code == 404
    move(users["owner"], [child.pk], root.pk)
    assert client.get(public(link), {"node_id": str(child.pk)}).status_code == 200
    trash(users["owner"], [child.pk])
    assert client.get(public(link), {"node_id": str(child.pk)}).status_code == 404
    assert client.get(public(link, "/children")).json()["results"] == []
    trash(users["owner"], [root.pk])
    assert client.get(management(root)).status_code == 404
    assert client.delete(f"/api/v1/links/{link.pk}").status_code == 404


def test_public_file_download_preview_localstack_and_deadline(tree, bucket):
    users, root, _child, _outside, _link, client = tree
    node = Node.objects.create(
        owner=users["owner"],
        parent=root,
        kind="file",
        name="hello.txt",
        size=5,
        mime_type="text/plain",
    )
    key = s3.new_blob_key()
    s3.client().put_object(Bucket=bucket, Key=key, Body=b"hello", ContentType="text/plain")
    blob = Blob.objects.create(storage_key=key, size=5, etag="e")
    version = FileVersion.objects.create(
        node=node,
        blob=blob,
        version_number=1,
        size=5,
        mime_type="text/plain",
        uploaded_by=users["owner"],
        original_name=node.name,
    )
    node.current_version = version
    node.save()
    expiry = timezone.now() + datetime.timedelta(seconds=40)
    link = link_services.create_link(users["owner"], node.pk, expiry)
    client.force_authenticate(None)
    for suffix in ["/download", "/preview"]:
        response = client.get(public(link, suffix))
        assert response.status_code == 200
        body = response.json()
        assert datetime.datetime.fromisoformat(body["expires_at"].replace("Z", "+00:00")) <= expiry
        query = parse_qs(urlparse(body["url"]).query)
        assert 1 <= int(query["X-Amz-Expires"][0]) <= 40
        with urllib.request.urlopen(body["url"], timeout=10) as file:  # noqa: S310 - LocalStack presigned URL
            assert file.read() == b"hello"
    response = client.get(public(link, "/children"))
    assert (response.status_code, response.json()["error"]["code"]) == (400, "not_a_folder")
    version.mime_type = "text/html"
    version.save()
    body = client.get(public(link, "/preview")).json()
    assert body["kind"] == "unsupported"
    assert body["url"] is None
    assert parse_qs(urlparse(client.get(public(link, "/download")).json()["url"]).query)[
        "response-content-type"
    ] == ["application/octet-stream"]
    ShareLink.objects.filter(pk=link.pk).update(
        expires_at=timezone.now() + datetime.timedelta(milliseconds=100)
    )
    assert client.get(public(link, "/download")).status_code == 404


def test_thumbnail_urls_share_deadline_and_stale_scope_is_rechecked(tree):
    from django.http import Http404

    from apps.sharing.link_selectors import public_children
    from apps.sharing.permissions import get_link_node_or_404, nodes_for_link

    users, root, _child, _outside, link, client = tree
    node = Node.objects.create(
        owner=users["owner"],
        parent=root,
        kind="file",
        name="photo.png",
        mime_type="image/png",
        size=3,
    )
    blob = Blob.objects.create(storage_key="test-photo", size=3, etag="e")
    version = FileVersion.objects.create(
        node=node,
        blob=blob,
        version_number=1,
        size=3,
        mime_type="image/png",
        uploaded_by=users["owner"],
        original_name=node.name,
    )
    node.current_version = version
    node.thumbnail_key = f"thumbs/{version.pk}/256.webp"
    node.save()
    link.expires_at = timezone.now() + datetime.timedelta(seconds=20)
    link.save()
    body = client.get(public(link, "/preview"), {"node_id": str(node.pk)}).json()
    assert body["kind"] == "image"
    for url in [body["url"], body["thumbnail"]["url"], body["thumbnail"]["large_url"]]:
        assert 1 <= int(parse_qs(urlparse(url).query)["X-Amz-Expires"][0]) <= 20
    assert datetime.datetime.fromisoformat(body["thumbnail"]["expires_at"]) <= link.expires_at
    # A previously obtained model/queryset does not retain authority after revoke.
    children = public_children(link, None)
    link_services.revoke_link(users["owner"], link.pk)
    assert not children.exists()
    assert not nodes_for_link(link).exists()
    with pytest.raises(Http404):
        get_link_node_or_404(link)
    with pytest.raises(Http404):
        get_link_node_or_404(link, "not-a-uuid")


def test_link_scope_rechecks_expiry_inside_transaction_and_caps_ttl(tree, settings):
    from apps.sharing.link_views import link_ttl
    from apps.sharing.permissions import nodes_for_link

    _users, _root, _child, _outside, link, _client = tree
    settings.S3_DOWNLOAD_URL_SECONDS = 3600
    assert link_ttl(link) == 300
    from django.db import connection

    # Use the database clock: the Docker host and Python may differ by milliseconds.
    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE sharing_share_link SET expires_at = "
            "STATEMENT_TIMESTAMP() - INTERVAL '1 microsecond' WHERE id = %s",
            [link.pk],
        )
    assert not nodes_for_link(link).exists()
