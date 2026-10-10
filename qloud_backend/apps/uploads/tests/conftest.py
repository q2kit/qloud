import urllib.request

import pytest
from allauth.account.models import EmailAddress

from apps.accounts.models import User
from apps.drive.models import Node


@pytest.fixture
def user(db, bucket) -> User:
    user = User.objects.create_user("uploader@example.com")
    EmailAddress.objects.create(user=user, email=user.email, verified=True, primary=True)
    return user


@pytest.fixture
def root(user) -> Node:
    return Node.objects.get(pk=user.root_folder_id)


@pytest.fixture
def client(api_client, user):
    api_client.force_authenticate(user)
    return api_client


def put(url: str, body: bytes) -> str:
    """Like the browser: PUT a part straight to its presigned URL, keep the ETag."""
    request = urllib.request.Request(url, data=body, method="PUT")  # noqa: S310
    with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310
        return str(response.headers["ETag"])


def get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=10) as response:  # noqa: S310
        return bytes(response.read())


@pytest.fixture
def make_file():
    def make(owner: User, parent: Node, name: str = "a.txt") -> Node:
        return Node.objects.create(owner=owner, parent=parent, kind=Node.Kind.FILE, name=name)

    return make
