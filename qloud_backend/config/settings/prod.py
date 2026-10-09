from django.core.exceptions import ImproperlyConfigured

from .base import *

DEBUG = False

# No localhost fallback in production: a missing or dev domain must fail at startup.
APP_DOMAIN = env("APP_DOMAIN")
if APP_DOMAIN in {"localhost", "127.0.0.1"}:
    raise ImproperlyConfigured("APP_DOMAIN must be the public domain in production.")
APP_BASE_URL = env("APP_BASE_URL", default=f"https://{APP_DOMAIN}")
ALLOWED_HOSTS = [APP_DOMAIN]
CSRF_TRUSTED_ORIGINS = [APP_BASE_URL]

if len(SECRET_KEY) < 50 or SECRET_KEY.startswith(("dev-insecure", "test-insecure")):
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY is missing or a placeholder; generate one with "
        '`python -c "import secrets; print(secrets.token_urlsafe(50))"`.'
    )

# Cloudflare → nginx → gunicorn (ADR-0006)
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = True
# Lets an internal plain-HTTP health probe reach the app without a redirect.
SECURE_REDIRECT_EXEMPT = [r"^api/v1/health$"]
SECURE_HSTS_SECONDS = env.int("DJANGO_HSTS_SECONDS", default=60 * 60 * 24 * 365)
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_CONTENT_TYPE_NOSNIFF = True

# HSTS stays on this host only: other subdomains of APP_DOMAIN are not ours to force to HTTPS,
# and preload is hard to undo.
SILENCED_SYSTEM_CHECKS = ["security.W005", "security.W021"]

SPECTACULAR_SETTINGS["SERVE_PERMISSIONS"] = ["rest_framework.permissions.IsAdminUser"]
