import pytest


@pytest.fixture(autouse=True)
def immediate_on_commit(request, monkeypatch):
    """Send emails right away: tests run inside a transaction that never commits.

    Tests marked ``real_on_commit`` keep Django's behaviour to check the deferral.
    """
    if request.node.get_closest_marker("real_on_commit"):
        return
    monkeypatch.setattr(
        "apps.accounts.adapter.transaction.on_commit", lambda callback, **kwargs: callback()
    )
