from django.core.exceptions import ImproperlyConfigured, ValidationError
from django.core.validators import validate_email

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

# Cloudflare's test secrets (1x…, 2x…, 3x…) accept or reject every token.
if not TURNSTILE_SECRET_KEY or TURNSTILE_SECRET_KEY.startswith(("1x0000", "2x0000", "3x0000")):
    raise ImproperlyConfigured("TURNSTILE_SECRET_KEY must be the real secret key in production.")
if not TURNSTILE_SITE_KEY or TURNSTILE_SITE_KEY.startswith(("1x0000", "2x0000", "3x0000")):
    raise ImproperlyConfigured("TURNSTILE_SITE_KEY must be the real site key in production.")

# Cloudflare → nginx → gunicorn (ADR-0006)
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
# The firewall only admits Cloudflare, so its client IP header can be trusted (rate limits).
ALLAUTH_TRUSTED_CLIENT_IP_HEADER = env("TRUSTED_CLIENT_IP_HEADER", default="CF-Connecting-IP")
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

try:
    validate_email(MODERATION_EMAIL)
except ValidationError as error:
    raise ImproperlyConfigured("MODERATION_EMAIL must be a valid mailbox in production.") from error
