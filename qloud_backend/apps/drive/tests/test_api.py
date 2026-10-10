import uuid
from typing import Any

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.accounts.models import User
from apps.drive.models import Node
from apps.drive.services import MOVE_LIMIT

pytestmark = pytest.mark.django_db

FOLDERS = "/api/v1/folders"
MOVE = "/api/v1/nodes/move"


def detail(node_id) -> str:
    return f"/api/v1/nodes/{node_id}"


def children(node_id) -> str:
    return f"/api/v1/nodes/{node_id}/children"


def folder(parent: Node, name: str) -> Node:
    return Node.objects.create(owner_id=parent.owner_id, parent=parent, name=name)


def error(response: Any) -> str:
    return str(response.json()["error"]["code"])


@pytest.fixture
def client(api_client, user):
    api_client.force_authenticate(user)
    return api_client


@pytest.fixture
def stranger(db) -> User:
    return User.objects.create_user("stranger@example.com")


@pytest.fixture
def stranger_client(api_client, stranger):
    api_client.force_authenticate(stranger)
    return api_client


# --- access ---------------------------------------------------------------


def test_every_endpoint_requires_sign_in(api_client, root):
    for response in (
        api_client.get(detail(root.pk)),
        api_client.patch(detail(root.pk), {"name": "x"}, format="json"),
        api_client.get(children(root.pk)),
        api_client.post(FOLDERS, {"parent_id": str(root.pk), "name": "x"}, format="json"),
        api_client.post(
            MOVE, {"node_ids": [str(root.pk)], "target_parent_id": str(root.pk)}, format="json"
        ),
    ):
        assert response.status_code == 403
        assert error(response) == "not_authenticated"


def test_someone_else_gets_404_everywhere(stranger_client, stranger, root):
    docs = folder(root, "Docs")
    mine = stranger.root_folder
    for response in (
        stranger_client.get(detail(docs.pk)),
        stranger_client.patch(detail(docs.pk), {"name": "x"}, format="json"),
        stranger_client.get(children(docs.pk)),
        stranger_client.post(FOLDERS, {"parent_id": str(docs.pk), "name": "x"}, format="json"),
        # Their node into my folder, and my node into their folder.
        stranger_client.post(
            MOVE, {"node_ids": [str(docs.pk)], "target_parent_id": str(mine.pk)}, format="json"
        ),
    ):
        assert response.status_code == 404, response.json()
        assert error(response) == "not_found"
    docs.refresh_from_db()
    assert (docs.name, docs.parent_id) == ("Docs", root.pk)


def test_unknown_ids_are_404(client):
    assert client.get(detail(uuid.uuid7())).status_code == 404
    assert client.get("/api/v1/nodes/not-a-uuid").status_code == 404


# --- detail ---------------------------------------------------------------


def test_root_detail(client, root):
    body = client.get(detail(root.pk)).json()
    assert body["is_root"] is True
    assert body["parent_id"] is None
    assert body["breadcrumb"] == []
    assert body["capabilities"] == {"can_edit": False, "can_trash": False, "can_share": False}


def test_nested_detail_has_breadcrumb_and_capabilities(client, root, django_assert_num_queries):
    a = folder(root, "A")
    b = folder(a, "B")
    c = folder(b, "C")
    with django_assert_num_queries(2):  # the node, then the whole breadcrumb at any depth
        body = client.get(detail(c.pk)).json()
    assert body["breadcrumb"] == [
        {"id": str(root.pk), "name": "Drive"},
        {"id": str(a.pk), "name": "A"},
        {"id": str(b.pk), "name": "B"},
    ]
    assert body["capabilities"] == {"can_edit": True, "can_trash": True, "can_share": True}
    assert body["kind"] == "folder"
    assert body["is_root"] is False


def test_file_detail(client, make_file):
    node = make_file("notes.txt", size=12)
    body = client.get(detail(node.pk)).json()
    assert (body["kind"], body["size"], body["mime_type"]) == ("file", 12, "text/plain")


# --- children -------------------------------------------------------------


def names(response: Any) -> list[str]:
    return [node["name"] for node in response.json()["results"]]


def test_children_list_folders_first_in_natural_order(client, root, make_file):
    for name in ("file10.txt", "file2.txt", "B.txt"):
        make_file(name)
    for name in ("photos", "Ảnh", "anh", "2024", "10"):
        folder(root, name)
    response = client.get(children(root.pk))
    assert response.status_code == 200
    assert names(response) == [
        "10",
        "2024",
        "anh",
        "Ảnh",
        "photos",
        "B.txt",
        "file2.txt",
        "file10.txt",
    ]
    assert response.json()["previous"] is None
    assert response.json()["next"] is None


@pytest.mark.parametrize(
    ("ordering", "expected"),
    [
        ("-name", ["b", "a", "z.txt", "y.txt"]),
        ("size", ["a", "b", "z.txt", "y.txt"]),
        ("-size", ["b", "a", "y.txt", "z.txt"]),
        ("updated_at", ["a", "b", "y.txt", "z.txt"]),
        ("-updated_at", ["b", "a", "z.txt", "y.txt"]),
    ],
)
def test_children_orderings_keep_folders_first(client, root, make_file, ordering, expected):
    folder(root, "a")
    folder(root, "b")
    make_file("y.txt", size=50)
    make_file("z.txt", size=10)
    assert names(client.get(children(root.pk), {"ordering": ordering})) == expected


def walk(client: Any, url: str, params: dict[str, Any]) -> tuple[list[str], list[Any]]:
    seen, responses = [], []
    response = client.get(url, params)
    while True:
        responses.append(response)
        seen += names(response)
        if not response.json()["next"]:
            return seen, responses
        response = client.get(response.json()["next"])


@pytest.mark.parametrize("ordering", ["name", "-name", "size", "-updated_at"])
def test_pages_neither_skip_nor_repeat(client, root, make_file, ordering):
    for i in range(7):
        folder(root, f"folder {i}")
        make_file(f"file {i}.txt", size=i % 3)  # equal sizes exercise the id tie-break
    everything = names(client.get(children(root.pk), {"ordering": ordering, "page_size": 200}))
    seen, responses = walk(client, children(root.pk), {"ordering": ordering, "page_size": 3})
    assert seen == everything
    assert len(responses) == 5
    # And back again from the last page.
    back: list[str] = []
    response = responses[-1]
    while response.json()["previous"]:
        response = client.get(response.json()["previous"])
        back = names(response) + back
    assert back + names(responses[-1]) == everything


def test_children_rejects_bad_parameters(client, root):
    assert error(client.get(children(root.pk), {"ordering": "kind"})) == "validation_error"
    assert error(client.get(children(root.pk), {"page_size": "0"})) == "validation_error"
    assert client.get(children(root.pk), {"cursor": "garbage"}).status_code == 404
    for i in range(3):
        folder(root, f"f{i}")
    cursor_url = client.get(children(root.pk), {"page_size": 1}).json()["next"]
    # A cursor from another ordering points at a different row order.
    assert client.get(cursor_url + "&ordering=size").status_code == 404


def test_page_size_is_capped(client, root):
    Node.objects.bulk_create(
        [Node(owner_id=root.owner_id, parent=root, name=f"f{i}") for i in range(201)]
    )
    assert len(names(client.get(children(root.pk), {"page_size": 1000}))) == 200


def test_children_skip_trashed_nodes_and_files_have_none(client, root, make_file):
    gone = folder(root, "gone")
    gone.trashed_at, gone.trashed_root = timezone.now(), gone
    gone.save()
    node = make_file()
    assert names(client.get(children(root.pk))) == ["a.txt"]
    assert names(client.get(children(node.pk))) == []


def test_children_query_count_does_not_grow(client, root, django_assert_num_queries):
    Node.objects.bulk_create(
        [Node(owner_id=root.owner_id, parent=root, name=f"f{i}") for i in range(60)]
    )
    with django_assert_num_queries(2):  # the folder, one page
        client.get(children(root.pk))


def test_ten_thousand_children(client, root):
    """NF-01: deep pages cost the same as the first; walk them all once."""
    Node.objects.bulk_create(
        [Node(owner_id=root.owner_id, parent=root, name=f"item {i}") for i in range(10_000)],
        batch_size=2000,
    )
    seen, responses = walk(client, children(root.pk), {"page_size": 200})
    assert len(responses) == 50
    assert len(seen) == len(set(seen)) == 10_000
    assert seen[:3] == ["item 0", "item 1", "item 2"]
    assert seen[-1] == "item 9999"


# --- create folder --------------------------------------------------------


def test_create_folder(client, root):
    response = client.post(
        FOLDERS, {"parent_id": str(root.pk), "name": "  Báo cáo  "}, format="json"
    )
    assert response.status_code == 201
    body = response.json()
    assert (body["name"], body["parent_id"], body["kind"]) == ("Báo cáo", str(root.pk), "folder")
    assert Node.objects.get(pk=body["id"]).owner_id == root.owner_id


def test_create_folder_name_conflict_ignores_case(client, root):
    folder(root, "Docs")
    response = client.post(FOLDERS, {"parent_id": str(root.pk), "name": "docs"}, format="json")
    assert response.status_code == 409
    assert error(response) == "name_conflict"


@pytest.mark.parametrize("name", ["", "  ", ".", "..", "a/b", "x" * 256])
def test_create_folder_rejects_invalid_names(client, root, name):
    response = client.post(FOLDERS, {"parent_id": str(root.pk), "name": name}, format="json")
    assert response.status_code == 400
    assert "name" in response.json()["error"]["details"]["fields"]


def test_create_folder_inside_a_file_or_trashed_folder(client, root, make_file):
    node = make_file()
    response = client.post(FOLDERS, {"parent_id": str(node.pk), "name": "x"}, format="json")
    assert (response.status_code, error(response)) == (400, "invalid_target")
    gone = folder(root, "gone")
    gone.trashed_at, gone.trashed_root = timezone.now(), gone
    gone.save()
    response = client.post(FOLDERS, {"parent_id": str(gone.pk), "name": "x"}, format="json")
    assert response.status_code == 404


# --- rename ---------------------------------------------------------------


def test_rename(client, root):
    docs = folder(root, "Docs")
    response = client.patch(detail(docs.pk), {"name": "Papers"}, format="json")
    assert response.status_code == 200
    assert response.json()["name"] == "Papers"
    # Changing only the case of its own name is not a conflict.
    assert client.patch(detail(docs.pk), {"name": "PAPERS"}, format="json").status_code == 200


def test_rename_conflict_and_root(client, root):
    folder(root, "Docs")
    other = folder(root, "Other")
    response = client.patch(detail(other.pk), {"name": "DOCS"}, format="json")
    assert (response.status_code, error(response)) == (409, "name_conflict")
    response = client.patch(detail(root.pk), {"name": "Mine"}, format="json")
    assert (response.status_code, error(response)) == (400, "root_folder")
    assert error(client.patch(detail(other.pk), {"name": "a/b"}, format="json")) == (
        "validation_error"
    )


# --- move -----------------------------------------------------------------


def move(client: Any, nodes: list[Node], target: Node) -> Any:
    return client.post(
        MOVE,
        {"node_ids": [str(node.pk) for node in nodes], "target_parent_id": str(target.pk)},
        format="json",
    )


def test_move_fifty_items_in_one_request(client, root, make_file):
    source = folder(root, "source")
    target = folder(root, "target")
    nodes = [folder(source, f"f{i}") for i in range(25)]
    nodes += [make_file(f"doc {i}.txt", parent=source) for i in range(25)]
    with CaptureQueriesContext(connection) as one:
        assert move(client, nodes[:1], target).status_code == 200
    with CaptureQueriesContext(connection) as fifty:
        response = move(client, nodes[1:], target)
    assert response.status_code == 200
    # The same few queries (target, lock, nodes, cycle check, names, update) at any count.
    assert len(fifty) == len(one)
    assert len(response.json()["nodes"]) == 49
    assert Node.objects.filter(parent=target).count() == 50
    assert not Node.objects.filter(parent=source).exists()


def test_move_adds_suffixes_on_name_clashes(client, root, make_file):
    target = folder(root, "target")
    folder(target, "Docs")
    make_file("report.pdf", parent=target)
    make_file("report (1).pdf", parent=target)
    source = folder(root, "source")
    moved = [folder(source, "docs"), make_file("Report.pdf", parent=source)]
    other = folder(root, "other")
    moved.append(make_file("report.pdf", parent=other))
    response = move(client, moved, target)
    assert response.status_code == 200
    # Which of report.pdf / Report.pdf takes (2) depends on the collation order.
    assert sorted(node["name"].lower() for node in response.json()["nodes"]) == [
        "docs (1)",
        "report (2).pdf",
        "report (3).pdf",
    ]


def test_move_keeps_dotfiles_and_long_names_valid(client, root, make_file):
    target = folder(root, "target")
    make_file(".env", parent=target)
    long = "x" * 251 + ".txt"
    make_file(long, parent=target)
    source = folder(root, "source")
    moved = [make_file(".env", parent=source), make_file(long, parent=source)]
    body = move(client, moved, target).json()
    result = sorted(node["name"] for node in body["nodes"])
    assert result[0] == ".env (1)"
    assert len(result[1]) == 255
    assert result[1].endswith(" (1).txt")


def test_move_into_itself_or_a_subfolder_is_refused(client, root):
    a = folder(root, "A")
    b = folder(a, "B")
    c = folder(b, "C")
    for target in (a, c):
        response = move(client, [a], target)
        assert (response.status_code, error(response)) == (400, "invalid_move")
    assert Node.objects.get(pk=a.pk).parent_id == root.pk


def test_move_refuses_root_files_as_target_and_bad_lists(client, root, make_file):
    a = folder(root, "A")
    response = move(client, [root], a)
    assert (response.status_code, error(response)) == (400, "root_folder")
    response = move(client, [a], make_file())
    assert (response.status_code, error(response)) == (400, "invalid_target")
    response = client.post(MOVE, {"node_ids": [], "target_parent_id": str(root.pk)}, format="json")
    assert error(response) == "validation_error"
    too_many = [str(uuid.uuid7()) for _ in range(MOVE_LIMIT + 1)]
    response = client.post(
        MOVE, {"node_ids": too_many, "target_parent_id": str(a.pk)}, format="json"
    )
    assert error(response) == "validation_error"


def test_move_with_an_unknown_id_moves_nothing(client, root):
    a, target = folder(root, "A"), folder(root, "target")
    response = client.post(
        MOVE,
        {"node_ids": [str(a.pk), str(uuid.uuid7())], "target_parent_id": str(target.pk)},
        format="json",
    )
    assert response.status_code == 404
    assert Node.objects.get(pk=a.pk).parent_id == root.pk


def test_move_dedupes_and_skips_nodes_already_there(client, root):
    target = folder(root, "target")
    inside = folder(target, "inside")
    outside = folder(root, "outside")
    response = move(client, [inside, outside, outside], target)
    assert response.status_code == 200
    assert sorted(node["name"] for node in response.json()["nodes"]) == ["inside", "outside"]
    assert Node.objects.get(pk=outside.pk).parent_id == target.pk
