from apps.core.tasks import ping


def test_ping_task_runs_through_celery():
    assert ping.delay().get(timeout=5) == "pong"
