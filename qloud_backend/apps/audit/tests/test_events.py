"""M8-11a: each action writes one event in its own transaction."""

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from apps.audit.tasks import RETENTION, expire_events
from apps.core.errors import InvalidShareRecipient
from apps.drive import retention, services, trash
from apps.drive.errors import NameConflict
from apps.drive.models import Blob, FileVersion, Node
from apps.sharing import link_services
from apps.sharing import services as sharing

pytestmark = pytest.mark.django_db

Action = AuditEvent.Action


@pytest.fixture(autouse=True)
def stored_bytes(user):
    # make_file skips quota accounting; deleting versions releases their bytes.
    User.objects.filter(pk=user.pk).update(used_bytes=1_000)


def actions(**filters: object) -> list[str]:
    return list(
        AuditEvent.objects.filter(**filters)
        .order_by("created_at", "id")
        .values_list("action", flat=True)
    )


def add_version(node: Node, number: int, user: User) -> FileVersion:
    blob = Blob.objects.create(storage_key=f"blobs/{node.pk}/{number}", size=1, etag="e")
    return FileVersion.objects.create(
        node=node,
        blob=blob,
        version_number=number,
        size=1,
        mime_type="text/plain",
        uploaded_by=user,
        original_name=node.name,
    )


def test_create_folder_records_only_new_folders(user, root):
    folder = services.create_folder(user, root.pk, "Plans")
    services.create_folder(user, root.pk, "plans", on_conflict="reuse")
    event = AuditEvent.objects.get()
    assert (event.action, event.node_id, event.parent_id) == (
        Action.NODE_CREATE,
        folder.pk,
        root.pk,
    )
    assert (event.actor_id, event.actor_kind, event.owner_id) == (user.pk, "user", user.pk)
    assert (event.node_name, event.node_kind) == ("Plans", "folder")


def test_rename_keeps_the_old_name_and_failures_leave_nothing(user, root, make_file):
    node = make_file("a.txt")
    make_file("taken.txt")
    services.rename(user, node.pk, "b.txt")
    services.rename(user, node.pk, "b.txt")  # unchanged: no event
    with pytest.raises(NameConflict):
        services.rename(user, node.pk, "taken.txt")
    event = AuditEvent.objects.get()
    assert (event.action, event.node_name, event.metadata) == (
        Action.NODE_RENAME,
        "b.txt",
        {"from_name": "a.txt"},
    )


def test_move_records_both_folders_for_each_item(user, root, make_file):
    source = services.create_folder(user, root.pk, "Source")
    target = services.create_folder(user, root.pk, "Target")
    files = [make_file(f"{n}.txt", parent=source) for n in range(2)]
    make_file("0.txt", parent=target)
    AuditEvent.objects.all().delete()
    services.move(user, [f.pk for f in files], target.pk)
    events = list(AuditEvent.objects.order_by("node_name"))
    assert [e.action for e in events] == [Action.NODE_MOVE] * 2
    clash = events[0]
    assert (clash.node_name, clash.parent_id, clash.source_parent_id) == (
        "0 (1).txt",
        target.pk,
        source.pk,
    )
    assert clash.metadata == {
        "from_folder": {"id": str(source.pk), "name": "Source", "is_root": False},
        "to_folder": {"id": str(target.pk), "name": "Target", "is_root": False},
    }


def test_trash_restore_and_purge_record_each_selected_root(user, root, make_file):
    folder = services.create_folder(user, root.pk, "Folder")
    make_file("inside.txt", parent=folder)
    loose = make_file("loose.txt")
    AuditEvent.objects.all().delete()
    trash.trash(user, [folder.pk, loose.pk])
    assert sorted(actions()) == [Action.NODE_TRASH] * 2
    trash.restore(user, [loose.pk])
    trash.trash(user, [loose.pk])
    trash.delete(user)  # empty the trash: one event per root, none for "inside.txt"
    purged = AuditEvent.objects.filter(action=Action.NODE_PURGE)
    assert sorted(purged.values_list("node_name", flat=True)) == ["Folder", "loose.txt"]
    # The nodes are gone; the events keep their names and the folder they were in.
    assert set(purged.values_list("node_id", "parent_id")) == {(None, root.pk)}
    assert actions(action=Action.NODE_RESTORE) == [Action.NODE_RESTORE]


def test_trash_expiry_is_recorded_as_the_system(user, make_file):
    node = make_file()
    trash.trash(user, [node.pk])
    later = timezone.now() + timedelta(days=user.plan.trash_retention_days + 1)
    assert trash.expire_root(node.pk, user.pk, later)
    event = AuditEvent.objects.get(action=Action.NODE_PURGE)
    assert (event.actor_id, event.actor_kind, event.actor_name) == (None, "system", "")


def test_version_actions(user, make_file):
    node = make_file()
    old = node.current_version
    assert old is not None
    newest = add_version(node, 2, user)
    node.current_version = newest
    node.save()
    services.set_version_retention(user, node.pk, old.pk, True)
    services.set_version_retention(user, node.pk, old.pk, True)  # unchanged
    services.set_version_retention(user, node.pk, old.pk, False)
    services.restore_version(user, node.pk, old.pk)
    services.delete_version(user, node.pk, newest.pk)
    assert actions() == [
        Action.VERSION_LOCK,
        Action.VERSION_UNLOCK,
        Action.VERSION_RESTORE,
        Action.VERSION_DELETE,
    ]
    restored = AuditEvent.objects.get(action=Action.VERSION_RESTORE)
    assert restored.metadata == {"from_version": 1, "version": 3}
    assert AuditEvent.objects.get(action=Action.VERSION_DELETE).metadata == {"version": 2}


def test_version_cleanup_is_recorded_as_the_system(user, make_file):
    node = make_file()
    for number in range(2, 5):
        node.current_version = add_version(node, number, user)
    node.save()
    user.plan.max_versions_per_file = 1
    user.plan.save()
    assert retention.expire_file(node.pk, user.pk, timezone.now()) == 2
    event = AuditEvent.objects.get()
    assert (event.action, event.actor_kind, event.metadata) == (
        Action.VERSION_EXPIRE,
        "system",
        {"versions": [1, 2]},
    )


def test_share_actions_name_the_recipient(user, make_file):
    node = make_file()
    guest = User.objects.create_user("guest@example.com", display_name="Guest")
    share = sharing.create_share(user, node.pk, "guest@example.com", "viewer")
    sharing.update_share(user, share.pk, "viewer")  # unchanged
    sharing.update_share(user, share.pk, "editor")
    sharing.revoke_share(user, share.pk)
    with pytest.raises(InvalidShareRecipient):
        sharing.create_share(user, node.pk, "nobody@example.com", "viewer")
    assert actions() == [Action.SHARE_ADD, Action.SHARE_ROLE_CHANGE, Action.SHARE_REMOVE]
    grantee = {"id": str(guest.pk), "name": "Guest", "email": "guest@example.com"}
    change = AuditEvent.objects.get(action=Action.SHARE_ROLE_CHANGE)
    assert change.metadata == {"grantee": grantee, "from_role": "viewer", "role": "editor"}


def test_link_actions_never_store_the_token(user, make_file):
    node = make_file()
    link = link_services.create_link(user, node.pk)
    link_services.revoke_link(user, link.pk)
    link_services.revoke_link(user, link.pk)  # already revoked
    assert actions() == [Action.LINK_CREATE, Action.LINK_REVOKE]
    for event in AuditEvent.objects.all():
        assert link.token not in str(event.metadata)
        assert event.metadata["link_id"] == str(link.pk)


def test_actor_name_is_never_the_email(user, root):
    services.create_folder(user, root.pk, "Plans")
    assert AuditEvent.objects.get().actor_name == ""
    user.display_name = "Owner Name"
    user.save()
    services.create_folder(user, root.pk, "More")
    assert AuditEvent.objects.get(node_name="More").actor_name == "Owner Name"


def test_old_events_expire_after_a_year(user, root):
    services.create_folder(user, root.pk, "Old")
    services.create_folder(user, root.pk, "Recent")
    AuditEvent.objects.filter(node_name="Old").update(
        created_at=timezone.now() - RETENTION - timedelta(minutes=1)
    )
    assert expire_events(batch=1) == 1
    assert actions() == [Action.NODE_CREATE]
    assert AuditEvent.objects.get().node_name == "Recent"


def test_deleting_the_owner_deletes_their_history(user, root):
    services.create_folder(user, root.pk, "Mine")
    user.delete()
    assert not AuditEvent.objects.exists()
