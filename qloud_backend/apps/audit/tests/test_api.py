"""M8-11a: GET /nodes/{id}/activity reads through the permission layer."""

from typing import Any, cast

import pytest

from apps.accounts.models import User
from apps.audit import services as audit
from apps.audit.models import AuditEvent
from apps.drive import services, trash
from apps.drive.models import Node
from apps.sharing import services as sharing
from apps.sharing.models import Share, ShareLink

pytestmark = pytest.mark.django_db

Action = AuditEvent.Action


@pytest.fixture(autouse=True)
def stored_bytes(user):
    User.objects.filter(pk=user.pk).update(used_bytes=1_000)


@pytest.fixture
def team(user, root, make_file):
    """Drive > Private (unshared) and Team (shared) > Notes, with files."""
    private = services.create_folder(user, root.pk, "Private")
    team = services.create_folder(user, root.pk, "Team")
    notes = services.create_folder(user, team.pk, "Notes")
    plan = make_file("plan.txt", parent=team)
    draft = make_file("draft.txt", parent=private)
    services.rename(user, plan.pk, "plan-v2.txt")
    services.move(user, [draft.pk], team.pk)  # out of a folder recipients cannot see
    return {"private": private, "team": team, "notes": notes, "plan": plan, "draft": draft}


def read(client, node: Node, query: str = "") -> list[dict[str, Any]]:
    response = client.get(f"/api/v1/nodes/{node.pk}/activity{query}")
    assert response.status_code == 200, response.content
    return cast(list[dict[str, Any]], response.json()["results"])


def guest(email: str, display_name: str = "") -> User:
    return User.objects.create_user(email, display_name=display_name)


def test_owner_reads_a_folder_with_its_whole_subtree(user, team, api_client):
    api_client.force_authenticate(user)
    rows = read(api_client, team["team"])
    assert [row["action"] for row in rows] == [
        Action.NODE_MOVE,
        Action.NODE_RENAME,
        Action.NODE_CREATE,  # Notes
        Action.NODE_CREATE,  # Team itself
    ]
    move = rows[0]
    assert move["node"] == {"id": str(team["draft"].pk), "name": "draft.txt", "kind": "file"}
    assert move["metadata"]["from_folder"]["name"] == "Private"
    assert move["actor"] == {
        "id": str(user.pk),
        "display_name": "",
        "email": user.email,
    }
    # The private folder saw the file leave.
    assert [row["action"] for row in read(api_client, team["private"])] == [
        Action.NODE_MOVE,
        Action.NODE_CREATE,
    ]


def test_a_file_reads_only_its_own_events(user, team, api_client):
    api_client.force_authenticate(user)
    assert [row["action"] for row in read(api_client, team["plan"])] == [Action.NODE_RENAME]


def test_trashed_and_purged_children_stay_in_the_folder_history(user, team, api_client):
    trash.trash(user, [team["plan"].pk])
    trash.delete(user, [team["plan"].pk])
    api_client.force_authenticate(user)
    rows = read(api_client, team["team"])
    assert [row["action"] for row in rows[:2]] == [Action.NODE_PURGE, Action.NODE_TRASH]
    assert rows[0]["node"] == {"id": None, "name": "plan-v2.txt", "kind": "file"}


def test_a_subfolder_recipient_reads_from_there_down(user, team, api_client):
    reader = guest("reader@example.com")
    Share.objects.create(node=team["notes"], grantee=reader, created_by=user, role="viewer")
    services.create_folder(user, team["notes"].pk, "Inside")
    api_client.force_authenticate(reader)
    rows = read(api_client, team["notes"])
    assert {row["node"]["name"] for row in rows} == {"Notes", "Inside"}
    assert api_client.get(f"/api/v1/nodes/{team['team'].pk}/activity").status_code == 404


def test_viewers_see_names_but_no_emails_and_no_hidden_folders(user, team, api_client):
    reader = guest("reader@example.com", "Reader")
    Share.objects.create(node=team["team"], grantee=reader, created_by=user, role="viewer")
    guest("friend@example.com", "Friend")
    sharing.create_share(user, team["team"].pk, "friend@example.com", "viewer")
    api_client.force_authenticate(reader)
    rows = read(api_client, team["team"])
    added = next(row for row in rows if row["action"] == Action.SHARE_ADD)
    friend = User.objects.get(email="friend@example.com")
    assert added["metadata"]["grantee"] == {"id": str(friend.pk), "name": "Friend"}
    assert "email" not in added["actor"]
    move = next(row for row in rows if row["action"] == Action.NODE_MOVE)
    # "Private" was never shared with the reader: neither its id nor its name.
    assert move["metadata"]["from_folder"] == {"id": None, "name": None, "is_root": False}
    assert move["metadata"]["to_folder"]["name"] == "Team"


def test_editors_see_emails(user, team, api_client):
    editor = guest("editor@example.com")
    Share.objects.create(node=team["team"], grantee=editor, created_by=user, role="editor")
    guest("friend@example.com", "Friend")
    sharing.create_share(user, team["team"].pk, "friend@example.com", "viewer")
    api_client.force_authenticate(editor)
    added = next(row for row in read(api_client, team["team"]) if row["action"] == "share.add")
    assert added["metadata"]["grantee"]["email"] == "friend@example.com"
    assert added["actor"]["email"] == user.email
    # Editors of Team still do not see Private's name.
    move = next(row for row in read(api_client, team["team"]) if row["action"] == "node.move")
    assert move["metadata"]["from_folder"]["name"] is None


def test_system_and_moderation_events_have_no_actor(user, team, api_client):
    link = ShareLink.objects.create(node=team["plan"], created_by=user)
    audit.record(
        Action.LINK_REVOKE,
        team["plan"],
        actor=None,
        actor_kind=AuditEvent.ActorKind.MODERATOR,
        link_id=str(link.pk),
    )
    api_client.force_authenticate(user)
    row = read(api_client, team["plan"])[0]
    assert (row["actor_kind"], row["actor"]) == ("moderator", None)


@pytest.mark.parametrize("who", ["outside", "anonymous"])
def test_no_access(user, team, api_client, who):
    if who == "outside":
        api_client.force_authenticate(guest("outside@example.com"))
    response = api_client.get(f"/api/v1/nodes/{team['team'].pk}/activity")
    assert response.status_code == (404 if who == "outside" else 403)


def test_a_trashed_node_is_not_found(user, team, api_client):
    trash.trash(user, [team["plan"].pk])
    api_client.force_authenticate(user)
    assert api_client.get(f"/api/v1/nodes/{team['plan'].pk}/activity").status_code == 404


def test_newest_first_with_cursor_pages(user, root, api_client):
    folder = services.create_folder(user, root.pk, "Busy")
    for index in range(5):
        services.create_folder(user, folder.pk, f"Child {index}")
    api_client.force_authenticate(user)
    first = api_client.get(f"/api/v1/nodes/{folder.pk}/activity?page_size=4").json()
    assert [row["node"]["name"] for row in first["results"]] == [
        "Child 4",
        "Child 3",
        "Child 2",
        "Child 1",
    ]
    second = api_client.get(first["next"]).json()
    assert [row["node"]["name"] for row in second["results"]] == ["Child 0", "Busy"]
    assert second["next"] is None


@pytest.mark.parametrize("reader", ["owner", "viewer"])
def test_query_count_does_not_grow_with_events(
    user, team, api_client, reader, django_assert_max_num_queries
):
    for index in range(30):
        services.create_folder(user, team["team"].pk, f"More {index}")
    person = user
    if reader == "viewer":
        person = guest("reader@example.com")
        Share.objects.create(node=team["team"], grantee=person, created_by=user, role="viewer")
    api_client.force_authenticate(person)
    with django_assert_max_num_queries(8):
        rows = read(api_client, team["team"])
    assert len(rows) > 30
