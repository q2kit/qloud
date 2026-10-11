import uuid

import pytest
from django.contrib.auth.models import AnonymousUser
from django.http import Http404
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.services import suspend_user
from apps.drive.models import Node
from apps.sharing.permissions import Role, get_node_or_404, nodes_for, role_of

pytestmark = pytest.mark.django_db


@pytest.fixture
def owner() -> User:
    return User.objects.create_user("owner@example.com")


@pytest.fixture
def stranger() -> User:
    return User.objects.create_user("stranger@example.com")


@pytest.fixture
def docs(owner) -> Node:
    return Node.objects.create(owner=owner, parent=owner.root_folder, name="Docs")


def trash(node: Node) -> None:
    node.trashed_at, node.trashed_root = timezone.now(), node
    node.save()


def test_owner_has_every_role(owner, docs):
    for role in Role:
        assert docs in nodes_for(owner, role)
        assert get_node_or_404(owner, docs.pk, role) == docs
    assert role_of(owner, docs) is Role.OWNER


def test_others_see_nothing(owner, stranger, docs):
    # Only their own Drive.
    assert list(nodes_for(stranger)) == [stranger.root_folder]
    assert role_of(stranger, docs) is None
    for role in Role:
        with pytest.raises(Http404):
            get_node_or_404(stranger, docs.pk, role)


def test_anonymous_and_inactive_users_see_nothing(owner, docs):
    assert not nodes_for(AnonymousUser()).exists()
    assert role_of(AnonymousUser(), docs) is None
    owner.is_active = False
    owner.save(update_fields=["is_active"])
    assert not nodes_for(owner).exists()


def test_suspended_owner_loses_access(owner, docs):
    suspend_user(owner, reason="abuse")
    owner.refresh_from_db()
    assert not nodes_for(owner).exists()
    assert role_of(owner, docs) is None
    with pytest.raises(Http404):
        get_node_or_404(owner, docs.pk)


def test_missing_and_malformed_ids_are_404(owner):
    for node_id in (uuid.uuid7(), "not-a-uuid"):
        with pytest.raises(Http404):
            get_node_or_404(owner, node_id)


def test_trashed_nodes_only_when_asked(owner, docs):
    trash(docs)
    assert docs not in nodes_for(owner)
    assert docs in nodes_for(owner, trashed=True)
    assert docs in nodes_for(owner, trashed=None)
    assert owner.root_folder not in nodes_for(owner, trashed=True)
    with pytest.raises(Http404):
        get_node_or_404(owner, docs.pk)
    assert get_node_or_404(owner, docs.pk, trashed=True) == docs


def test_nodes_for_is_one_query(owner, docs, django_assert_num_queries):
    with django_assert_num_queries(1):
        list(nodes_for(owner))


@pytest.mark.parametrize(
    ("grant_role", "required"), [("viewer", Role.VIEWER), ("editor", Role.EDITOR)]
)
@pytest.mark.parametrize("inherited", [False, True])
def test_share_roles_and_query_count(
    owner, stranger, docs, grant_role, required, inherited, django_assert_num_queries
):
    from apps.sharing.models import Share

    child = Node.objects.create(owner=owner, parent=docs, name="Child")
    leaf = Node.objects.create(owner=owner, parent=child, name="Leaf", kind="file")
    node = leaf if inherited else docs
    Share.objects.create(node=docs, grantee=stranger, created_by=owner, role=grant_role)
    for role in Role:
        with django_assert_num_queries(1):
            visible = list(nodes_for(stranger, role).filter(pk=node.pk))
        assert bool(visible) == (role <= required)
        if role <= required:
            assert get_node_or_404(stranger, node.pk, role) == node
        else:
            with pytest.raises(Http404):
                get_node_or_404(stranger, node.pk, role)
    with django_assert_num_queries(1):
        assert role_of(stranger, node) == required
    assert role_of(stranger, owner.root_folder) is None


def test_highest_role_revocation_and_downgrade(owner, stranger, docs):
    from apps.sharing.models import Share

    child = Node.objects.create(owner=owner, parent=docs, name="Child")
    inherited = Share.objects.create(node=docs, grantee=stranger, created_by=owner, role="editor")
    direct = Share.objects.create(node=child, grantee=stranger, created_by=owner, role="viewer")
    assert role_of(stranger, child) == Role.EDITOR
    inherited.role = "viewer"
    inherited.save()
    assert role_of(stranger, child) == Role.VIEWER
    inherited.delete()
    assert role_of(stranger, child) == Role.VIEWER
    direct.delete()
    assert role_of(stranger, child) is None
    with pytest.raises(Http404):
        get_node_or_404(stranger, child.pk)


@pytest.mark.parametrize("trashed", [False, True, None])
def test_shares_never_grant_trash_access(owner, stranger, docs, trashed):
    from apps.drive.trash import restore
    from apps.drive.trash import trash as trash_nodes
    from apps.sharing.models import Share

    child = Node.objects.create(owner=owner, parent=docs, name="Child")
    Share.objects.create(node=docs, grantee=stranger, created_by=owner, role="editor")
    Share.objects.create(node=child, grantee=stranger, created_by=owner, role="editor")
    trash_nodes(owner, [docs.pk])
    for node in [docs, child]:
        assert not nodes_for(stranger, trashed=trashed).filter(pk=node.pk).exists()
        assert role_of(stranger, node) is None
        with pytest.raises(Http404):
            get_node_or_404(stranger, node.pk, trashed=trashed)
    restore(owner, [docs.pk])
    assert role_of(stranger, child) == Role.EDITOR


@pytest.mark.parametrize("state", ["inactive", "suspended", "anonymous"])
def test_disabled_grantee_has_no_access(owner, stranger, docs, state):
    from apps.sharing.models import Share

    Share.objects.create(node=docs, grantee=stranger, created_by=owner, role="editor")
    if state == "inactive":
        stranger.is_active = False
        stranger.save(update_fields=["is_active"])
    elif state == "suspended":
        suspend_user(stranger, reason="abuse")
        stranger.refresh_from_db()
    else:
        stranger = AnonymousUser()
    assert not nodes_for(stranger).exists()
    assert role_of(stranger, docs) is None


def test_overlapping_shares_do_not_duplicate_nodes(owner, stranger, docs):
    from apps.sharing.models import Share

    child = Node.objects.create(owner=owner, parent=docs, name="Child")
    for node in [docs, child]:
        Share.objects.create(node=node, grantee=stranger, created_by=owner, role="editor")
    assert list(nodes_for(stranger).filter(pk=child.pk)) == [child]


def test_deep_tree_and_live_move_recompute_inheritance(
    owner, stranger, docs, django_assert_num_queries
):
    from apps.drive.services import move
    from apps.sharing.models import Share

    Share.objects.create(node=docs, grantee=stranger, created_by=owner, role="viewer")
    leaf = docs
    for i in range(60):
        leaf = Node.objects.create(owner=owner, parent=leaf, name=f"Level {i}")
    with django_assert_num_queries(1):
        assert get_node_or_404(stranger, leaf.pk) == leaf
    move(owner, [docs.pk], owner.root_folder_id)  # no-op retains access
    move(owner, [leaf.pk], owner.root_folder_id)
    assert role_of(stranger, leaf) is None


def test_file_share_cannot_grant_children(owner, stranger, docs):
    from apps.sharing.models import Share

    file = Node.objects.create(owner=owner, parent=docs, kind="file", name="File")
    malformed = Node.objects.create(owner=owner, parent=file, name="Bad child")
    Share.objects.create(node=file, grantee=stranger, created_by=owner, role="editor")
    assert role_of(stranger, file) == Role.EDITOR
    assert role_of(stranger, malformed) is None


def test_move_scope_is_one_query_for_a_batch(owner, stranger, docs, django_assert_num_queries):
    from apps.sharing.models import Share
    from apps.sharing.permissions import can_move_within

    Share.objects.create(node=docs, grantee=stranger, created_by=owner, role="editor")
    children = [Node.objects.create(owner=owner, parent=docs, name=f"Child {i}") for i in range(10)]
    with django_assert_num_queries(1):
        assert can_move_within(stranger, children, docs)
    with django_assert_num_queries(1):
        assert not can_move_within(stranger, [*children, docs], docs)
    stranger.is_active = False
    assert not can_move_within(stranger, children, docs)


def test_share_does_not_cross_owner_boundary(owner, stranger, docs):
    from apps.sharing.models import Share

    malformed = Node.objects.create(owner=stranger, parent=docs, name="Wrong owner")
    third = User.objects.create_user("third@example.com")
    Share.objects.create(node=docs, grantee=third, created_by=owner, role="editor")
    assert role_of(third, malformed) is None
    assert not nodes_for(third).filter(pk=malformed.pk).exists()


def test_recursive_permission_query_terminates_on_malformed_cycle(owner, stranger, docs):
    from apps.sharing.models import Share

    child = Node.objects.create(owner=owner, parent=docs, name="Child")
    Node.objects.filter(pk=docs.pk).update(parent=child)
    Share.objects.create(node=docs, grantee=stranger, created_by=owner, role="viewer")
    assert set(nodes_for(stranger).filter(owner=owner).values_list("pk", flat=True)) == {
        docs.pk,
        child.pk,
    }
