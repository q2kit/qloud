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
