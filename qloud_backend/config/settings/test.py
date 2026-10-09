import os
from pathlib import Path

import environ

# Tests must run without a .env file (CI), but honour local overrides when present.
_env_file = Path(__file__).resolve().parent.parent.parent / ".env"
if _env_file.exists():
    environ.Env.read_env(_env_file)

os.environ.setdefault("DJANGO_SECRET_KEY", "test-insecure-secret-key")
os.environ.setdefault("DATABASE_URL", "postgres://qloud:qloud@localhost:5432/qloud")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("CELERY_BROKER_URL", "redis://localhost:6379/1")

from .base import *  # noqa: E402

DEBUG = False
ALLOWED_HOSTS = ["testserver", "localhost"]

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
MAILERS = {"default": {"BACKEND": "django.core.mail.backends.locmem.EmailBackend"}}

CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
