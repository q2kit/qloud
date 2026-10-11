import uuid

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.drive.models import Node
from apps.drive.trash import trash
from apps.sharing import selectors, services
from apps.sharing.models import Share
from apps.sharing.permissions import Role, role_of

pytestmark = pytest.mark.django_db


@pytest.fixture
def world(api_client):
    users = {
        name: User.objects.create_user(f"{name}@example.com")
        for name in ["owner", "editor", "viewer", "recipient", "outside"]
    }
    owner = users["owner"]
    parent = Node.objects.create(owner=owner, parent=owner.root_folder, name="Parent")
    node = Node.objects.create(owner=owner, parent=parent, name="Shared")
    for role in ["editor", "viewer"]:
        Share.objects.create(node=parent, grantee=users[role], created_by=owner, role=role)
    api_client.force_authenticate(owner)
    return users, parent, node, api_client


def shares(node: Node) -> str:
    return f"/api/v1/nodes/{node.pk}/shares"


def detail(share: Share) -> str:
    return f"/api/v1/shares/{share.pk}"


@pytest.mark.parametrize("actor", ["owner", "editor", "viewer", "outside", None])
@pytest.mark.parametrize("inherited", [False, True])
@pytest.mark.parametrize("kind", ["folder", "file"])
def test_manage_share_permissions(world, actor, inherited, kind):
    users, parent, node, client = world
    node.kind = kind
    node.save(update_fields=["kind"])
    if not inherited:
        Share.objects.filter(node=parent).update(node=node)
    client.force_authenticate(users[actor] if actor else None)
    expected = 200 if actor in ["owner", "editor"] else (403 if actor is None else 404)
    assert client.get(shares(node)).status_code == expected
    response = client.post(
        shares(node), {"email": users["recipient"].email, "role": "viewer"}, format="json"
    )
    assert response.status_code == (201 if expected == 200 else expected)
    if expected == 200:
        body = response.json()
        assert body["node_id"] == str(node.pk)
        assert body["grantee"]["email"] == users["recipient"].email
        assert body["created_by_id"] == str(users[actor].pk)
    else:
        assert not Share.objects.filter(node=node, grantee=users["recipient"]).exists()
    grant = Share.objects.get_or_create(
        node=node,
        grantee=users["recipient"],
        defaults={"created_by": users["owner"], "role": "viewer"},
    )[0]
    assert client.patch(detail(grant), {"role": "editor"}, format="json").status_code == expected
    grant.refresh_from_db()
    assert grant.role == ("editor" if expected == 200 else "viewer")
    assert client.delete(detail(grant)).status_code == (204 if expected == 200 else expected)
    assert Share.objects.filter(pk=grant.pk).exists() == (expected != 200)


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"email": "bad", "role": "viewer"},
        {"email": "recipient@example.com", "role": "owner"},
        {"email": "recipient@example.com", "role": "bogus"},
    ],
)
def test_invalid_payload(world, payload):
    users, _parent, node, client = world
    assert client.post(shares(node), payload, format="json").status_code == 400
    grant = services.create_share(users["owner"], node.pk, users["recipient"].email, "viewer")
    assert client.patch(detail(grant), {"role": "owner"}, format="json").status_code == 400
    assert client.patch(detail(grant), {}, format="json").status_code == 400
    assert Share.objects.get(pk=grant.pk).role == "viewer"


def test_recipient_validation_duplicate_and_root(world):
    users, _parent, node, client = world
    owner, recipient = users["owner"], users["recipient"]
    for email, code in [
        ("missing@example.com", "invalid_share_recipient"),
        (owner.email, "invalid_share_target"),
    ]:
        response = client.post(shares(node), {"email": email, "role": "viewer"}, format="json")
        assert (response.status_code, response.json()["error"]["code"]) == (400, code)
    for state in ["inactive", "suspended"]:
        recipient.is_active = state != "inactive"
        recipient.suspended_at = timezone.now() if state == "suspended" else None
        recipient.save(update_fields=["is_active", "suspended_at"])
        assert (
            client.post(
                shares(node), {"email": recipient.email, "role": "viewer"}, format="json"
            ).status_code
            == 400
        )
    recipient.is_active, recipient.suspended_at = True, None
    recipient.save(update_fields=["is_active", "suspended_at"])
    body = {"email": "  RECIPIENT@EXAMPLE.COM  ", "role": "viewer"}
    assert client.post(shares(node), body, format="json").status_code == 201
    response = client.post(shares(node), body, format="json")
    assert (response.status_code, response.json()["error"]["code"]) == (409, "share_exists")
    assert client.post(shares(owner.root_folder), body, format="json").status_code == 400
    client.force_authenticate(users["editor"])
    for email in [users["editor"].email, owner.email]:
        assert (
            client.post(shares(node), {"email": email, "role": "editor"}, format="json").status_code
            == 400
        )
    client.force_authenticate(users["viewer"])
    # Unauthorized callers receive no payload or recipient-existence hints.
    assert client.post(shares(node), {}, format="json").status_code == 404


def test_revoke_retains_other_sources_and_independent_delegation(world):
    users, parent, node, client = world
    owner, editor, recipient = users["owner"], users["editor"], users["recipient"]
    inherited = services.create_share(owner, parent.pk, recipient.email, "viewer")
    grant = services.create_share(editor, node.pk, recipient.email, "editor")
    assert role_of(recipient, node) == Role.EDITOR
    services.update_share(owner, grant.pk, "viewer")
    assert role_of(recipient, node) == Role.VIEWER
    services.revoke_share(owner, inherited.pk)
    editor_grant = Share.objects.get(node=parent, grantee=editor)
    services.revoke_share(owner, editor_grant.pk)
    assert role_of(editor, node) is None
    assert role_of(recipient, node) == Role.VIEWER
    client.force_authenticate(editor)
    assert client.delete(detail(grant)).status_code == 404
    services.revoke_share(owner, grant.pk)
    client.force_authenticate(recipient)
    assert client.get(f"/api/v1/nodes/{node.pk}").status_code == 404


def test_trash_and_unknown_resources(world):
    users, _parent, node, client = world
    grant = services.create_share(users["owner"], node.pk, users["recipient"].email, "viewer")
    trash(users["owner"], [node.pk])
    assert client.get(shares(node)).status_code == 404
    assert (
        client.post(
            shares(node), {"email": users["outside"].email, "role": "viewer"}, format="json"
        ).status_code
        == 404
    )
    assert client.patch(detail(grant), {"role": "editor"}, format="json").status_code == 404
    assert client.delete(detail(grant)).status_code == 404
    assert client.get(f"/api/v1/nodes/{uuid.uuid7()}/shares").status_code == 404
    for action in ["patch", "delete"]:
        assert getattr(client, action)(f"/api/v1/shares/{uuid.uuid7()}").status_code == 404
    client.force_authenticate(users["recipient"])
    assert client.get("/api/v1/shared-with-me").json()["results"] == []


def test_direct_shares_pagination_and_query_count(world, django_assert_num_queries):
    users, _parent, node, client = world
    for i in range(12):
        recipient = User.objects.create_user(f"r{i}@example.com")
        services.create_share(users["owner"], node.pk, recipient.email, "viewer")
    with django_assert_num_queries(2):
        page = client.get(shares(node), {"page_size": 5}).json()
    first = [item["id"] for item in page["results"]]
    second = client.get(page["next"]).json()
    assert client.get(second["previous"]).json()["results"] == page["results"]
    seen = first + [item["id"] for item in second["results"]]
    while second["next"]:
        second = client.get(second["next"]).json()
        seen.extend(item["id"] for item in second["results"])
    assert len(set(seen)) == 12
    assert client.get(shares(node), {"cursor": "bad"}).status_code == 404
    assert client.get(shares(node), {"page_size": 999}).status_code == 200
    for value in ["0", "bad"]:
        assert client.get(shares(node), {"page_size": value}).status_code == 400
    # Grants on ancestors are not included in a child's management list.
    assert len(list(selectors.shares_for(users["owner"], node.pk))) == 12


def test_shared_with_me_effective_role_and_pagination(world, django_assert_num_queries):
    users, parent, node, client = world
    owner, recipient = users["owner"], users["recipient"]
    services.create_share(owner, parent.pk, recipient.email, "editor")
    services.create_share(owner, node.pk, recipient.email, "viewer")
    Node.objects.create(owner=owner, parent=node, name="Inherited only")
    client.force_authenticate(recipient)
    with django_assert_num_queries(1):
        page = client.get("/api/v1/shared-with-me", {"page_size": 1}).json()
    rows = page["results"] + client.get(page["next"]).json()["results"]
    assert {item["id"] for item in rows} == {str(parent.pk), str(node.pk)}
    assert {item["effective_role"] for item in rows} == {"editor"}
    assert all(
        item["owner"] == {"id": str(owner.pk), "display_name": owner.display_name} for item in rows
    )
    own = Share.objects.create(
        node=recipient.root_folder, grantee=recipient, created_by=recipient, role="viewer"
    )
    assert len(client.get("/api/v1/shared-with-me").json()["results"]) == 2
    own.delete()
    assert client.get("/api/v1/shared-with-me", {"page_size": 0}).status_code == 400
    assert client.get("/api/v1/shared-with-me", {"ordering": "invalid"}).status_code == 400
    assert client.get("/api/v1/shared-with-me", {"cursor": "bad"}).status_code == 404
    client.force_authenticate(None)
    assert client.get("/api/v1/shared-with-me").status_code == 403


@pytest.mark.django_db(transaction=True)
def test_concurrent_duplicate_grant_is_serialized(world):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connections

    from apps.core.errors import ShareExists

    users, _parent, node, _client = world
    barrier = Barrier(2)

    def create() -> int:
        close_old_connections()
        try:
            barrier.wait(timeout=5)
            services.create_share(users["owner"], node.pk, users["recipient"].email, "viewer")
            return 201
        except ShareExists:
            return 409
        finally:
            connections["default"].close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(lambda _: create(), range(2))) == [201, 409]
    assert Share.objects.filter(node=node, grantee=users["recipient"]).count() == 1
