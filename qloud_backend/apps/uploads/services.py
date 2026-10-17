"""Upload sessions (upload.md, quota.md).

Network calls to S3 never run inside a database transaction: locks on the owner's row
are held only for the quota arithmetic and the rows that record the result.
"""

import datetime
import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from functools import partial

from django.conf import settings
from django.db import transaction
from django.db.models import F, Max
from django.http import Http404
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.selectors import get_limits, has_verified_email
from apps.audit import services as audit
from apps.drive import selectors as drive_selectors
from apps.drive.errors import InvalidTarget, NameConflict
from apps.drive.models import Blob, FileVersion, Node
from apps.drive.services import available_name
from apps.drive.tasks import enqueue_thumbnail
from apps.drive.thumbnails import supported as thumbnail_supported
from apps.sharing.permissions import Role, get_node_or_404, nodes_for
from apps.storage import s3

from .errors import (
    EmailNotVerified,
    FileTooLarge,
    QuotaExceeded,
    StorageUnavailable,
    TargetUnavailable,
    UploadClosed,
    UploadExpired,
    UploadIncomplete,
)
from .models import UploadSession

logger = logging.getLogger(__name__)

SESSION_LIFETIME = datetime.timedelta(days=7)
PART_URL_BATCH = 100
Status = UploadSession.Status


@dataclass(frozen=True)
class PartUrl:
    part_number: int
    url: str


def part_count(session: UploadSession) -> int:
    return s3.part_count(session.size, session.part_size) if session.size else 0


def _lock_owner(owner_id: uuid.UUID) -> None:
    # Serializes every quota change of one owner (quota.md): reservations, completions.
    User.objects.select_for_update().filter(pk=owner_id).first()


def _release(session: UploadSession, status: str) -> None:
    """Close an active session and hand its reservation back. Caller holds the owner lock."""
    User.objects.filter(pk=session.owner_id).update(
        reserved_bytes=F("reserved_bytes") - session.size
    )
    session.status = status
    session.save(update_fields=["status", "updated_at"])


def _name_taken(parent: Node, name: str) -> bool:
    return available_name(parent, name, Node.Kind.FILE) != name


# --- create -----------------------------------------------------------------


def create_session(
    user: User,
    *,
    parent_id: uuid.UUID,
    filename: str,
    size: int,
    mime_type: str,
    fingerprint: str,
    on_conflict: str = UploadSession.OnConflict.FAIL,
    target_node_id: uuid.UUID | None = None,
) -> UploadSession:
    """Check access, limits and name, reserve quota, then start the multipart upload."""
    target = None
    if target_node_id is not None:
        target = get_node_or_404(user, target_node_id, Role.EDITOR)
        if target.kind != Node.Kind.FILE or target.parent_id != parent_id:
            raise InvalidTarget
        parent = target.parent
        if parent is None or parent.owner_id != target.owner_id:
            raise InvalidTarget
        on_conflict = UploadSession.OnConflict.REPLACE
    else:
        parent = get_node_or_404(user, parent_id, Role.EDITOR)
        if parent.kind != Node.Kind.FOLDER:
            raise InvalidTarget
    if not has_verified_email(user):
        raise EmailNotVerified
    try:
        part_size = s3.part_size_for(size)
    except ValueError as error:
        raise FileTooLarge from error
    path = [] if target is not None else [*drive_selectors.breadcrumb(parent, user), parent]

    with transaction.atomic():
        _lock_owner(parent.owner_id)
        if target is not None:
            target = get_node_or_404(user, target.pk, Role.EDITOR)
            if target.kind != Node.Kind.FILE or target.parent_id != parent_id:
                raise InvalidTarget
        else:
            parent = get_node_or_404(user, parent_id, Role.EDITOR)
            if on_conflict == UploadSession.OnConflict.REPLACE:
                target = (
                    nodes_for(user, Role.EDITOR)
                    .filter(parent=parent, name__iexact=filename, kind=Node.Kind.FILE)
                    .first()
                )
                if target is None:
                    raise InvalidTarget
        # The owner's plan applies, even when someone else uploads (data-model.md).
        owner = User.objects.get(pk=parent.owner_id)
        limits = get_limits(owner)
        if size > limits.max_file_size_bytes:
            raise FileTooLarge
        if owner.used_bytes + owner.reserved_bytes + size > limits.quota_bytes:
            raise QuotaExceeded
        if on_conflict == UploadSession.OnConflict.FAIL and _name_taken(parent, filename):
            raise NameConflict
        session = UploadSession.objects.create(
            user=user,
            owner_id=parent.owner_id,
            parent=parent,
            target_node=target,
            parent_path=[{"id": str(node.pk), "name": node.name} for node in path],
            filename=filename,
            size=size,
            mime_type=mime_type,
            fingerprint=fingerprint,
            on_conflict=on_conflict,
            storage_key=s3.new_blob_key(),
            part_size=part_size,
            expires_at=timezone.now() + SESSION_LIFETIME,
        )
        User.objects.filter(pk=parent.owner_id).update(reserved_bytes=F("reserved_bytes") + size)

    if size:
        try:
            session.s3_upload_id = s3.create_multipart_upload(session.storage_key, mime_type)
        except s3.StorageError as error:
            with transaction.atomic():
                _lock_owner(session.owner_id)
                _release(session, Status.ABORTED)
            raise StorageUnavailable from error
        session.save(update_fields=["s3_upload_id", "updated_at"])
    return session


# --- read and parts -------------------------------------------------------------


def get_session(user: User, session_id: uuid.UUID) -> UploadSession:
    """Only the user who started an upload sees it; anyone else gets the same 404."""
    try:
        return UploadSession.objects.get(pk=session_id, user=user)
    except UploadSession.DoesNotExist as error:
        raise Http404 from error


def _open(session: UploadSession) -> None:
    if session.status != Status.ACTIVE:
        raise UploadClosed
    if session.expires_at <= timezone.now():
        raise UploadExpired


def list_parts(session: UploadSession) -> list[s3.Part]:
    if session.status != Status.ACTIVE or not session.s3_upload_id:
        return []
    try:
        return s3.list_parts(session.storage_key, session.s3_upload_id)
    except s3.StorageError as error:
        raise StorageUnavailable from error


def part_urls(session: UploadSession, part_numbers: Sequence[int]) -> list[PartUrl]:
    _open(session)
    count = part_count(session)
    numbers = sorted(set(part_numbers))
    if not numbers or numbers[0] < 1 or numbers[-1] > count:
        raise UploadIncomplete(f"Part numbers must be between 1 and {count}.", code="invalid_part")
    return [
        PartUrl(n, s3.presign_upload_part(session.storage_key, session.s3_upload_id, n))
        for n in numbers
    ]


def part_urls_expire_at() -> datetime.datetime:
    return timezone.now() + datetime.timedelta(seconds=settings.S3_UPLOAD_PART_URL_SECONDS)


# --- complete -------------------------------------------------------------------


def _assemble(session: UploadSession) -> str:
    """Put the object together in S3 and return its ETag; safe to run again."""
    if not session.size:
        return s3.put_empty_object(session.storage_key, session.mime_type)
    try:
        parts = s3.list_parts(session.storage_key, session.s3_upload_id)
    except s3.StorageError as error:
        if error.code != "NoSuchUpload":
            raise
        # Assembled by an earlier call whose database step failed: the object is there.
        info = s3.head_object(session.storage_key)
        if info.size != session.size:
            raise UploadIncomplete from error
        return info.etag
    expected = list(range(1, part_count(session) + 1))
    if [p.number for p in parts] != expected or sum(p.size for p in parts) != session.size:
        raise UploadIncomplete
    s3.complete_multipart_upload(session.storage_key, session.s3_upload_id, parts)
    info = s3.head_object(session.storage_key)
    if info.size != session.size:
        raise UploadIncomplete
    return info.etag


def _target_folder(user: User, session: UploadSession) -> Node:
    """The target folder, or the path to it recreated where it went missing (upload.md).

    From the deepest folder of the recorded path that is still live and editable, missing
    folders are created again by name; a live folder of that name is reused, so the files
    of one folder upload land together.
    """
    live = {
        str(node.pk): node
        for node in nodes_for(user, Role.EDITOR).filter(
            pk__in=[entry["id"] for entry in session.parent_path], kind=Node.Kind.FOLDER
        )
    }
    path = session.parent_path
    depth = next((i for i in range(len(path) - 1, -1, -1) if path[i]["id"] in live), None)
    if depth is None:
        raise TargetUnavailable
    folder = live[path[depth]["id"]]
    for entry in path[depth + 1 :]:
        existing = (
            nodes_for(user, Role.EDITOR)
            .filter(parent=folder, kind=Node.Kind.FOLDER, name__iexact=entry["name"])
            .first()
        )
        if existing is None:
            name = available_name(folder, entry["name"], Node.Kind.FOLDER)
            existing = Node.objects.create(owner_id=folder.owner_id, parent=folder, name=name)
        folder = existing
    return folder


def complete(user: User, session: UploadSession) -> Node:
    """Assemble the parts, then record Blob, Node and version and move the bytes from
    reserved to used, all in one transaction. A repeated call returns the same node."""
    if session.status == Status.COMPLETED and session.node is not None:
        if session.on_conflict == UploadSession.OnConflict.REPLACE:
            return get_node_or_404(user, session.node.pk, Role.EDITOR)
        return session.node
    _open(session)
    try:
        etag = _assemble(session)
    except s3.StorageError as error:
        raise StorageUnavailable from error

    try:
        with transaction.atomic():
            _lock_owner(session.owner_id)
            session = UploadSession.objects.select_for_update().get(pk=session.pk)
            if session.status == Status.COMPLETED and session.node is not None:
                if session.on_conflict == UploadSession.OnConflict.REPLACE:
                    return get_node_or_404(user, session.node.pk, Role.EDITOR)
                return session.node  # a concurrent call finished first
            _open(session)
            version_number = 1
            if session.on_conflict == UploadSession.OnConflict.REPLACE:
                if session.target_node_id is None:
                    raise TargetUnavailable
                node = (
                    nodes_for(user, Role.EDITOR)
                    .select_for_update()
                    .filter(
                        pk=session.target_node_id, owner_id=session.owner_id, kind=Node.Kind.FILE
                    )
                    .first()
                )
                if node is None:
                    raise TargetUnavailable
                version_number = (
                    node.versions.aggregate(latest=Max("version_number"))["latest"] or 0
                ) + 1
                node.size = session.size
                node.mime_type = session.mime_type
                node.thumbnail_key = None
            else:
                folder = _target_folder(user, session)
                node = Node.objects.create(
                    owner_id=session.owner_id,
                    parent=folder,
                    kind=Node.Kind.FILE,
                    # Taken meanwhile: keep the upload under a ` (n)` name rather than lose it.
                    name=available_name(folder, session.filename, Node.Kind.FILE),
                    mime_type=session.mime_type,
                    size=session.size,
                )
            blob = Blob.objects.create(
                storage_key=session.storage_key, size=session.size, etag=etag
            )
            node.current_version = FileVersion.objects.create(
                node=node,
                blob=blob,
                version_number=version_number,
                size=session.size,
                mime_type=session.mime_type,
                uploaded_by=user,
                original_name=session.filename,
            )
            node.save(
                update_fields=[
                    "current_version",
                    "size",
                    "mime_type",
                    "thumbnail_key",
                    "updated_at",
                ]
            )
            User.objects.filter(pk=session.owner_id).update(
                reserved_bytes=F("reserved_bytes") - session.size,
                used_bytes=F("used_bytes") + session.size,
            )
            session.status, session.node = Status.COMPLETED, node
            session.save(update_fields=["status", "node", "updated_at"])
            if version_number > 1:
                audit.record(audit.Action.VERSION_CREATE, node, actor=user, version=version_number)
            else:
                audit.record(audit.Action.NODE_UPLOAD, node, actor=user)
            if thumbnail_supported(session.mime_type):
                transaction.on_commit(partial(enqueue_thumbnail, str(node.current_version.pk)))
    except TargetUnavailable:
        abort(user, session)
        raise
    return node


# --- abort ------------------------------------------------------------------------


def abort(user: User, session: UploadSession) -> None:
    """Cancel and hand the reservation back. Repeating it is fine; a finished upload is not
    undone (delete the file instead)."""
    with transaction.atomic():
        _lock_owner(session.owner_id)
        locked = UploadSession.objects.select_for_update().get(pk=session.pk)
        if locked.status == Status.COMPLETED:
            raise UploadClosed
        if locked.status != Status.ACTIVE:
            return
        _release(locked, Status.ABORTED)
    _drop_from_storage(locked)


def _drop_from_storage(session: UploadSession) -> None:
    """Remove the parts, and an object assembled before the upload was given up."""
    try:
        if session.s3_upload_id:
            s3.abort_multipart_upload(session.storage_key, session.s3_upload_id)
        s3.delete_objects([session.storage_key])
    except s3.StorageError:
        # The quota is already back; the bucket's lifecycle rule (abort incomplete
        # multipart uploads after 8 days) removes what is left.
        logger.warning("Could not clean up upload %s in S3", session.pk, exc_info=True)


# --- expiry (M2-06) -------------------------------------------------------------------


def expire(session_id: uuid.UUID) -> bool:
    """Close one session past `expires_at` and hand its reservation back.

    Takes the same locks in the same order as `complete` and `abort` (owner, then
    session), so a completion that is running finishes first or not at all.
    """
    owner_id = (
        UploadSession.objects.filter(pk=session_id).values_list("owner_id", flat=True).first()
    )
    if owner_id is None:
        return False
    with transaction.atomic():
        _lock_owner(owner_id)
        session = UploadSession.objects.select_for_update().get(pk=session_id)
        if session.status != Status.ACTIVE or session.expires_at > timezone.now():
            return False
        _release(session, Status.EXPIRED)
    _drop_from_storage(session)
    return True


def expired_session_ids(limit: int) -> list[uuid.UUID]:
    return list(
        UploadSession.objects.filter(status=Status.ACTIVE, expires_at__lte=timezone.now())
        .order_by("expires_at")
        .values_list("pk", flat=True)[:limit]
    )
