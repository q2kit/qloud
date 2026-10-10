import hashlib
import os
import urllib.request
from io import BytesIO
from typing import Any
from unittest.mock import Mock

import pytest
from botocore.stub import ANY, Stubber

from apps.storage import s3
from apps.storage.s3 import MiB

GiB = 1024 * MiB
TiB = 1024 * GiB


def http(method: str, url: str, data: bytes | None = None, headers=None):
    # Like the browser: straight to the presigned http(s) URL on LocalStack.
    request = urllib.request.Request(url, data=data, method=method, headers=headers or {})  # noqa: S310
    return urllib.request.urlopen(request, timeout=10)  # noqa: S310


# --- pure helpers -----------------------------------------------------------


@pytest.mark.parametrize(
    ("size", "part_size"),
    [
        (0, 8 * MiB),
        (1, 8 * MiB),
        (80_000 * MiB, 8 * MiB),
        (80 * GiB, 9 * MiB),
        (5 * TiB, 525 * MiB),
    ],
)
def test_part_size_keeps_within_ten_thousand_parts(size, part_size):
    assert s3.part_size_for(size) == part_size
    assert s3.part_count(size, part_size) <= s3.MAX_PARTS
    assert s3.part_count(size, part_size) * part_size >= size


def test_part_size_rejects_impossible_sizes():
    with pytest.raises(ValueError, match="negative"):
        s3.part_size_for(-1)
    with pytest.raises(ValueError, match="exceeds"):
        s3.part_size_for(s3.MAX_PARTS * s3.MAX_PART_SIZE + 1)


def test_blob_keys_hold_no_file_name():
    first, second = s3.new_blob_key(), s3.new_blob_key()
    assert first.startswith("blobs/")
    assert first != second


def test_content_disposition_keeps_vietnamese_names():
    assert s3.content_disposition('Báo cáo "Q3".pdf') == (
        'attachment; filename="B_o c_o _Q3_.pdf"; '
        "filename*=UTF-8''B%C3%A1o%20c%C3%A1o%20%22Q3%22.pdf"
    )
    assert s3.content_disposition("a.png", inline=True).startswith('inline; filename="a.png"')


# --- against LocalStack -------------------------------------------------------


def test_multipart_upload_round_trip(key):
    # S3 needs every part but the last to be at least 5 MiB.
    first, last = os.urandom(5 * MiB), os.urandom(1234)
    upload_id = s3.create_multipart_upload(key, "application/pdf")
    etags = []
    for number, body in ((1, first), (2, last)):
        response = http("PUT", s3.presign_upload_part(key, upload_id, number), body)
        etags.append(response.headers["ETag"])

    parts = s3.list_parts(key, upload_id)
    assert [(p.number, p.size, p.etag) for p in parts] == [
        (1, len(first), etags[0]),
        (2, len(last), etags[1]),
    ]
    etag = s3.complete_multipart_upload(key, upload_id, parts)
    assert s3.head_object(key) == s3.ObjectInfo(size=len(first) + len(last), etag=etag)

    url = s3.presign_download(key, filename="Báo cáo.pdf", content_type="application/pdf")
    partial = http("GET", url, headers={"Range": "bytes=0-9"})
    assert partial.status == 206
    assert partial.read() == first[:10]
    assert "filename*=UTF-8''B%C3%A1o%20c%C3%A1o.pdf" in partial.headers["Content-Disposition"]
    full = http("GET", url).read()
    assert hashlib.sha256(full).digest() == hashlib.sha256(first + last).digest()


def test_abort_is_idempotent_and_drops_parts(key):
    upload_id = s3.create_multipart_upload(key, "text/plain")
    http("PUT", s3.presign_upload_part(key, upload_id, 1), b"hello")
    s3.abort_multipart_upload(key, upload_id)
    s3.abort_multipart_upload(key, upload_id)
    with pytest.raises(s3.StorageError) as error:
        s3.list_parts(key, upload_id)
    assert error.value.code == "NoSuchUpload"


def test_empty_object(key):
    etag = s3.put_empty_object(key, "text/plain")
    assert s3.head_object(key) == s3.ObjectInfo(size=0, etag=etag)


def test_missing_object_is_a_storage_error(key):
    with pytest.raises(s3.StorageError) as error:
        s3.head_object(key)
    assert error.value.code == "404"


def test_worker_object_round_trip_and_byte_limit(key):
    s3.put_object(key, b"thumbnail", "image/webp")
    assert s3.read_object(key, max_bytes=9) == b"thumbnail"
    with pytest.raises(ValueError, match="byte limit"):
        s3.read_object(key, max_bytes=8)


@pytest.mark.parametrize(("length", "data"), [(100, b"x"), (1, b"12345")])
def test_worker_read_bounds_actual_body_and_always_closes(monkeypatch, length, data):
    body = BytesIO(data)
    fake = Mock()
    fake.get_object.return_value = {"Body": body, "ContentLength": length}
    monkeypatch.setattr(s3, "client", lambda: fake)
    with pytest.raises(ValueError, match="byte limit"):
        s3.read_object("k", max_bytes=3)
    assert body.closed


def test_worker_reads_and_writes_wrap_storage_errors(bucket):
    with Stubber(s3.client()) as stub:
        stub.add_client_error("get_object", service_error_code="NoSuchKey")
        with pytest.raises(s3.StorageError) as error:
            s3.read_object("absent", max_bytes=10)
        assert error.value.code == "NoSuchKey"
        stub.add_client_error("put_object", service_error_code="ServiceUnavailable")
        with pytest.raises(s3.StorageError) as error:
            s3.put_object("k", b"x", "image/webp")
        assert error.value.code == "ServiceUnavailable"


def test_delete_objects_ignores_missing_keys(key):
    for name in ("a", "b"):
        s3.put_empty_object(f"{key}/{name}", "text/plain")
    s3.delete_objects([f"{key}/a", f"{key}/b", f"{key}/never-existed"])
    assert "Contents" not in s3.client().list_objects_v2(Bucket=s3._bucket(), Prefix=key)


def test_part_url_rejects_out_of_range_numbers():
    for number in (0, s3.MAX_PARTS + 1):
        with pytest.raises(ValueError, match="part_number"):
            s3.presign_upload_part("blobs/x", "upload", number)


# --- paging and batching (stubbed: thousands of real parts would be slow) ---


def test_list_parts_reads_every_page(bucket):
    def page(numbers: range, truncated: bool) -> dict[str, Any]:
        response = {
            "Parts": [{"PartNumber": n, "Size": 8 * MiB, "ETag": f'"{n}"'} for n in numbers],
            "IsTruncated": truncated,
        }
        if truncated:
            response["NextPartNumberMarker"] = numbers[-1]
        return response

    with Stubber(s3.client()) as stub:
        stub.add_response(
            "list_parts",
            page(range(1, 1001), True),
            {"Bucket": bucket, "Key": "k", "UploadId": "u", "PartNumberMarker": 0},
        )
        stub.add_response(
            "list_parts",
            page(range(1001, 1201), False),
            {"Bucket": bucket, "Key": "k", "UploadId": "u", "PartNumberMarker": 1000},
        )
        parts = s3.list_parts("k", "u")
    assert [p.number for p in parts] == list(range(1, 1201))


def test_delete_objects_batches_by_a_thousand(bucket):
    with Stubber(s3.client()) as stub:
        for _ in range(2):
            stub.add_response("delete_objects", {}, {"Bucket": bucket, "Delete": ANY})
        s3.delete_objects(f"k{i}" for i in range(1001))
        stub.assert_no_pending_responses()


def test_delete_objects_reports_refused_keys(bucket):
    with Stubber(s3.client()) as stub:
        stub.add_response(
            "delete_objects",
            {"Errors": [{"Key": "k", "Code": "AccessDenied", "Message": "no"}]},
            {"Bucket": bucket, "Delete": ANY},
        )
        with pytest.raises(s3.StorageError) as error:
            s3.delete_objects(["k"])
    assert error.value.code == "AccessDenied"
