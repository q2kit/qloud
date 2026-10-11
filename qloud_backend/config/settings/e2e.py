"""Settings for the Playwright E2E run (see qloud_frontend/playwright.config.ts).

The test settings plus the outside world of the auth flows: email goes to
Mailpit over SMTP, and Google/GitHub point at the fake OAuth provider in
qloud_frontend/e2e/oauth-provider.ts. Playwright sets APP_BASE_URL so links
in emails lead to the frontend it serves.
"""

# .test first: it sets the environment defaults that .base reads.
from .test import *  # noqa: I001
from .base import _OAUTH_PROVIDERS, env

# Django runserver handles concurrent E2E requests in short-lived threads;
# retained connections can exhaust PostgreSQL during API-seeded pagination tests.
DATABASES["default"]["CONN_MAX_AGE"] = 0

# Created with CORS for the `vite preview` origin by infra/localstack/init-s3.sh, so
# the browser can PUT parts straight to it (the pytest bucket has no CORS).
S3_BUCKET = env("E2E_S3_BUCKET", default="qloud-e2e")

# Default to eager for CI; opt in to a real worker on an isolated E2E queue.
CELERY_TASK_ALWAYS_EAGER = env.bool("E2E_CELERY_EAGER", default=True)
CELERY_TASK_DEFAULT_QUEUE = "qloud-e2e"

# Auth emails use Mailpit in both eager and real-worker runs.
MAILERS = {
    "default": {
        "BACKEND": "django.core.mail.backends.smtp.EmailBackend",
        "OPTIONS": {
            "host": env("E2E_EMAIL_HOST", default="localhost"),
            "port": env.int("E2E_EMAIL_PORT", default=1025),
        },
    }
}

# Replaces the providers from .env entirely: E2E never reaches Google or GitHub.
_OAUTH_URL = env("E2E_OAUTH_URL", default="http://127.0.0.1:8002")
SOCIALACCOUNT_PROVIDERS = {
    "google": {
        "APPS": [{"client_id": "e2e-google", "secret": "e2e-secret"}],
        **_OAUTH_PROVIDERS["google"][1],
        "AUTHORIZE_URL": f"{_OAUTH_URL}/google/authorize",
        "ACCESS_TOKEN_URL": f"{_OAUTH_URL}/google/token",
        "IDENTITY_URL": f"{_OAUTH_URL}/google/userinfo",
    },
    "github": {
        "APPS": [{"client_id": "e2e-github", "secret": "e2e-secret"}],
        **_OAUTH_PROVIDERS["github"][1],
        # allauth's GitHub Enterprise setting: web pages at the root, API under /api/v3.
        "GITHUB_URL": f"{_OAUTH_URL}/github",
    },
}

MODERATION_EMAIL = "moderation@qloud.test"

# Each isolated browser gets its own test IP for report throttling.
ACCOUNT_ADAPTER = "apps.accounts.e2e_adapter.E2EAccountAdapter"
