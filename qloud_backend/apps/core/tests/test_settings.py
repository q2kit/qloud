"""Entrypoint defaults and production guards, checked in a clean interpreter."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[3]
PROD_SECRET = "x" * 50
PROD_SETTINGS = "config.settings.prod"
PROD_ENV = {
    "DATABASE_URL": "postgres://qloud:qloud@localhost:5432/qloud",
    "REDIS_URL": "redis://localhost:6379/0",
    "CELERY_BROKER_URL": "redis://localhost:6379/1",
}


def _run(code: str, **env: str) -> subprocess.CompletedProcess[str]:
    # Explicit variables win over qloud_backend/.env, which base.py reads without overriding.
    base = {"PATH": os.environ["PATH"], "HOME": os.environ.get("HOME", "")}
    return subprocess.run(  # noqa: S603 - fixed argv built from test constants
        [sys.executable, "-c", code],
        cwd=BACKEND_DIR,
        env={**base, **PROD_ENV, **env},
        capture_output=True,
        text=True,
        check=False,
    )


def test_wsgi_defaults_to_production_settings():
    result = _run(
        "import config.wsgi, os; from django.conf import settings; "
        "print(os.environ['DJANGO_SETTINGS_MODULE'], settings.DEBUG)",
        DJANGO_SECRET_KEY=PROD_SECRET,
        APP_DOMAIN="qloud.example.com",
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.split() == ["config.settings.prod", "False"]


@pytest.mark.parametrize(
    ("env", "error"),
    [
        ({"DJANGO_SECRET_KEY": PROD_SECRET, "APP_DOMAIN": "localhost"}, "APP_DOMAIN"),
        (
            {"DJANGO_SECRET_KEY": "dev-insecure-change-me", "APP_DOMAIN": "qloud.example.com"},
            "DJANGO_SECRET_KEY",
        ),
    ],
)
def test_production_settings_refuse_missing_config(env, error):
    result = _run(
        "import django; django.setup()", DJANGO_SETTINGS_MODULE="config.settings.prod", **env
    )

    assert result.returncode != 0
    assert error in result.stderr
