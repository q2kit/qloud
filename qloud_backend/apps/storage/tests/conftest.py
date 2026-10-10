import uuid
from collections.abc import Iterator

import pytest
from botocore.exceptions import ClientError
from django.conf import settings

from apps.storage import s3


@pytest.fixture(scope="session")
def bucket() -> str:
    """The test bucket on LocalStack (docker compose), created once per run."""
    name = str(settings.S3_BUCKET)
    try:
        s3.client().head_bucket(Bucket=name)
    except ClientError:
        s3.client().create_bucket(Bucket=name)
    return name


@pytest.fixture
def key(bucket) -> Iterator[str]:
    """A fresh key; whatever the test left under it is removed afterwards."""
    key = f"tests/{uuid.uuid4()}"
    yield key
    listing = s3.client().list_objects_v2(Bucket=bucket, Prefix=key)
    s3.delete_objects(obj["Key"] for obj in listing.get("Contents", []))
    uploads = s3.client().list_multipart_uploads(Bucket=bucket, Prefix=key)
    for upload in uploads.get("Uploads", []):
        s3.abort_multipart_upload(upload["Key"], upload["UploadId"])
