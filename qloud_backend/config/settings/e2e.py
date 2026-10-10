"""Settings for the Playwright E2E run (see qloud_frontend/playwright.config.ts).

The test settings plus the outside world of the auth flows: email goes to
Mailpit over SMTP, and Google/GitHub point at the fake OAuth provider in
qloud_frontend/e2e/oauth-provider.ts. Playwright sets APP_BASE_URL so links
in emails lead to the frontend it serves.
"""

# .test first: it sets the environment defaults that .base reads.
from .test import *  # noqa: I001
from .base import _OAUTH_PROVIDERS, env

# Celery stays eager, so the email reaches Mailpit within the request.
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
