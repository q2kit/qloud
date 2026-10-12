"""Write-side operations on folders and nodes (files-folders.md)."""

import uuid
from collections.abc import Iterator, Sequence
from functools import partial
from typing import Literal

from django.db import IntegrityError, transaction
from django.db.models import F, Max, Q
from django.http import Http404
from django.utils import timezone

from apps.accounts.models import User
from apps.core.errors import CurrentVersion
from apps.sharing.permissions import Role, can_move_within, get_node_or_404, nodes_for

from . import selectors
from .errors import InvalidMove, InvalidTarget, NameConflict, RootFolder
from .models import Blob, FileVersion, Node, ObjectDeletion
from .names import MAX_LENGTH
from .tasks import enqueue_object_cleanup, enqueue_thumbnail
from .thumbnails import SIZES, thumbnail_key

SIBLING_NAME = "node_sibling_name"
MOVE_LIMIT = 1000


def _is_name_conflict(error: IntegrityError) -> bool:
    return SIBLING_NAME in str(error)


def _target_folder(user: User, folder_id: uuid.UUID) -> Node:
    folder = get_node_or_404(user, folder_id, Role.EDITOR)
    if folder.kind != Node.Kind.FOLDER:
        raise InvalidTarget
    return folder


def create_folder(
    user: User,
    parent_id: uuid.UUID,
    name: str,
    on_conflict: Literal["fail", "rename", "reuse"] = "fail",
) -> Node:
    """Create or reuse a live folder; never reuse a file with the same name."""
    with transaction.atomic():
        parent = _target_folder(user, parent_id)
        # Serialize conflict choices with other tree writes for this owner.
        User.objects.select_for_update().get(pk=parent.owner_id)
        parent = _target_folder(user, parent_id)
        if on_conflict == "reuse":
            existing = nodes_for(user, Role.EDITOR).filter(parent=parent, name__iexact=name).first()
            if existing is not None:
                if existing.kind != Node.Kind.FOLDER:
                    raise NameConflict
                return existing
        elif on_conflict == "rename":
            name = available_name(parent, name, Node.Kind.FOLDER)
        try:
            with transaction.atomic():
                return Node.objects.create(owner_id=parent.owner_id, parent=parent, name=name)
        except IntegrityError as error:
            if _is_name_conflict(error):
                raise NameConflict from error
            raise


def rename(user: User, node_id: uuid.UUID, name: str) -> Node:
    node = get_node_or_404(user, node_id, Role.EDITOR)
    if node.parent_id is None:
        raise RootFolder
    if node.name == name:
        return node
    node.name = name
    try:
        with transaction.atomic():
            node.save(update_fields=["name", "updated_at"])
    except IntegrityError as error:
        if _is_name_conflict(error):
            raise NameConflict from error
        raise
    return node


def _split(node: Node) -> tuple[str, str]:
    """Stem and extension; only files have one, and a leading dot is not one."""
    if node.kind == Node.Kind.FILE:
        stem, dot, ext = node.name.rpartition(".")
        if dot and stem:
            return stem, f".{ext}"
    return node.name, ""


def _candidates(node: Node) -> Iterator[str]:
    """`report.pdf`, `report (1).pdf`, `report (2).pdf`, …, never over MAX_LENGTH."""
    yield node.name
    stem, ext = _split(node)
    n = 1
    while True:
        suffix = f" ({n}){ext}"
        yield stem[: MAX_LENGTH - len(suffix)].rstrip() + suffix
        n += 1


def _free_names(target: Node, nodes: Sequence[Node]) -> dict[uuid.UUID, str]:
    """A name for each node that clashes with nothing live in `target` or each other."""
    stems = {_split(node)[0] for node in nodes}
    prefix = Q()
    for stem in stems:
        prefix |= Q(name__istartswith=stem[:100])
    # Only names that could collide with a candidate, not the whole folder.
    taken = {
        name.lower()
        for name in Node.objects.filter(prefix, parent=target, trashed_at__isnull=True)
        .exclude(pk__in=[node.pk for node in nodes])
        .values_list("name", flat=True)
    }
    names = {}
    for node in nodes:
        name = next(c for c in _candidates(node) if c.lower() not in taken)
        taken.add(name.lower())
        names[node.pk] = name
    return names


def available_name(target: Node, name: str, kind: str) -> str:
    """`name`, or its first ` (n)` variant that no live child of `target` uses."""
    node = Node(kind=kind, name=name)  # unsaved: only feeds the candidate names
    return _free_names(target, [node])[node.pk]


def move(user: User, node_ids: Sequence[uuid.UUID], target_id: uuid.UUID) -> list[Node]:
    """Move nodes into a folder in one transaction; clashing names get ` (n)` suffixes."""
    ids = list(dict.fromkeys(node_ids))
    with transaction.atomic():
        target = _target_folder(user, target_id)
        # One mover per tree at a time, so two crossing moves cannot build a cycle.
        User.objects.select_for_update().filter(pk=target.owner_id).first()
        target = _target_folder(user, target_id)
        nodes = list(nodes_for(user, Role.EDITOR).filter(pk__in=ids).order_by("name", "id"))
        if len(nodes) != len(ids):
            # Same answer as for a single node: no hint about which ids exist.
            raise Http404
        if any(node.parent_id is None for node in nodes):
            raise RootFolder
        if any(node.owner_id != target.owner_id for node in nodes):
            raise InvalidMove("Items can only be moved within the same Drive.")
        if selectors.is_within(target.pk, ids):
            raise InvalidMove
        moving = [node for node in nodes if node.parent_id != target.pk]
        if not moving:
            return nodes
        if not can_move_within(user, moving, target):
            raise InvalidMove
        names = _free_names(target, moving)
        now = timezone.now()
        for node in moving:
            node.parent, node.name, node.updated_at = target, names[node.pk], now
        try:
            with transaction.atomic():
                Node.objects.bulk_update(moving, ["parent", "name", "updated_at"])
        except IntegrityError as error:
            # A folder was created or renamed into the target meanwhile; retrying works.
            if _is_name_conflict(error):
                raise NameConflict from error
            raise
    return nodes


def _locked_file(user: User, node_id: uuid.UUID, role: Role) -> Node:
    node = selectors.file_for(user, node_id, role)
    User.objects.select_for_update().get(pk=node.owner_id)
    # Recheck grants and trash after waiting for the owner lock.
    try:
        node = nodes_for(user, role).select_for_update().get(pk=node_id)
    except Node.DoesNotExist as error:
        raise Http404 from error
    return node


@transaction.atomic
def restore_version(user: User, node_id: uuid.UUID, version_id: uuid.UUID) -> Node:
    node = _locked_file(user, node_id, Role.EDITOR)
    source = selectors.version_for(node, version_id)
    if source.pk == node.current_version_id:
        raise CurrentVersion
    blob = Blob.objects.select_for_update().get(pk=source.blob_id)
    number = (
        FileVersion.objects.filter(node=node).aggregate(last=Max("version_number"))["last"] or 0
    ) + 1
    version = FileVersion.objects.create(
        node=node,
        blob=blob,
        version_number=number,
        size=source.size,
        mime_type=source.mime_type,
        uploaded_by=user,
        original_name=source.original_name,
    )
    node.current_version = version
    node.size, node.mime_type, node.thumbnail_key = source.size, source.mime_type, None
    node.save(update_fields=["current_version", "size", "mime_type", "thumbnail_key", "updated_at"])
    transaction.on_commit(partial(enqueue_thumbnail, str(version.pk)))
    return node


@transaction.atomic
def delete_version(user: User, node_id: uuid.UUID, version_id: uuid.UUID) -> None:
    node = _locked_file(user, node_id, Role.OWNER)
    version = selectors.version_for(node, version_id)
    if version.pk == node.current_version_id:
        raise CurrentVersion
    blob = Blob.objects.select_for_update().get(pk=version.blob_id)
    keys = {thumbnail_key(version.pk, size) for size in SIZES}
    version.delete()
    if not FileVersion.objects.filter(blob=blob).exists():
        keys.add(blob.storage_key)
        User.objects.filter(pk=node.owner_id).update(used_bytes=F("used_bytes") - blob.size)
    ObjectDeletion.objects.bulk_create(
        [ObjectDeletion(storage_key=key) for key in keys], ignore_conflicts=True
    )
    transaction.on_commit(partial(enqueue_object_cleanup))
