from pathlib import Path

import django_stubs_ext
import environ

# Allows generic annotations such as ModelAdmin[User] at runtime
django_stubs_ext.monkeypatch()

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()
if (BASE_DIR / ".env").exists():
    environ.Env.read_env(BASE_DIR / ".env")

# --- Core ---
SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env.bool("DJANGO_DEBUG", default=False)

APP_DOMAIN = env("APP_DOMAIN", default="localhost")
APP_BASE_URL = env("APP_BASE_URL", default=f"https://{APP_DOMAIN}")
ALLOWED_HOSTS = [APP_DOMAIN]
CSRF_TRUSTED_ORIGINS = [APP_BASE_URL]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "drf_spectacular",
    # Before allauth so our email templates and translations take precedence over its own.
    "apps.accounts",
    "allauth",
    "allauth.account",
    "allauth.headless",
    "allauth.socialaccount",
    "allauth.socialaccount.providers.google",
    "allauth.socialaccount.providers.github",
    "apps.core",
    "apps.drive",
    "apps.sharing",
    "apps.storage",
    "apps.uploads",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "allauth.account.middleware.AccountMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# --- Database / cache ---
DATABASES = {"default": env.db("DATABASE_URL")}
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DB_CONN_MAX_AGE", default=60)
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REDIS_URL = env("REDIS_URL")
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
    }
}

# --- Auth ---
AUTH_USER_MODEL = "accounts.User"
AUTHENTICATION_BACKENDS = ["apps.accounts.backends.AccountBackend"]
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 8},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Sessions end when the browser closes unless the user ticks "remember me" at login,
# which extends them to SESSION_COOKIE_AGE (see apps.accounts.auth_views).
SESSION_COOKIE_AGE = 60 * 60 * 24 * 30
SESSION_EXPIRE_AT_BROWSER_CLOSE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
# The SPA reads the CSRF cookie and sends it back as X-CSRFToken
CSRF_COOKIE_HTTPONLY = False

# --- allauth (headless; the SPA owns every auth screen) ---
SIGNUP_ENABLED = env.bool("SIGNUP_ENABLED", default=True)
ACCOUNT_ADAPTER = "apps.accounts.adapter.AccountAdapter"
ACCOUNT_USER_DISPLAY = "apps.accounts.adapter.user_display"
ACCOUNT_USER_MODEL_USERNAME_FIELD = None
ACCOUNT_LOGIN_METHODS = {"email"}
ACCOUNT_SIGNUP_FIELDS = ["email*", "password1*"]
ACCOUNT_UNIQUE_EMAIL = True
ACCOUNT_PREVENT_ENUMERATION = True
# Unverified users may sign in and browse; uploading and sharing check verification later.
ACCOUNT_EMAIL_VERIFICATION = "optional"
# Changing the password keeps this session; the new hash still signs out all others.
ACCOUNT_LOGOUT_ON_PASSWORD_CHANGE = False
# Adds the Turnstile token to both the email signup and the OAuth "complete signup" forms.
ACCOUNT_SIGNUP_FORM_CLASS = "apps.accounts.forms.TurnstileSignupForm"
ACCOUNT_EMAIL_SUBJECT_PREFIX = ""
# Merged over allauth's defaults. Login: 10 attempts/min per IP, 5 failures/min per email.
ACCOUNT_RATE_LIMITS: dict[str, str] | bool = {
    "login": "10/m/ip",
    "login_failed": "10/m/ip,5/m/key",
    "signup": "10/m/ip",
    "reset_password": "10/m/ip,5/m/key",
    "reset_password_from_key": "10/m/ip",
}
# Header carrying the real client IP, set by a proxy we control (empty: use REMOTE_ADDR).
ALLAUTH_TRUSTED_CLIENT_IP_HEADER = env("TRUSTED_CLIENT_IP_HEADER", default="") or None
HEADLESS_ONLY = True
HEADLESS_CLIENTS = ("browser",)
HEADLESS_SERVE_SPECIFICATION = True
HEADLESS_FRONTEND_URLS = {
    "account_confirm_email": f"{APP_BASE_URL}/verify-email/{{key}}",
    "account_reset_password": f"{APP_BASE_URL}/password/reset",
    "account_reset_password_from_key": f"{APP_BASE_URL}/password/reset/{{key}}",
    "account_signup": f"{APP_BASE_URL}/signup",
    # allauth appends ?error=... when the provider handshake fails.
    "socialaccount_login_error": f"{APP_BASE_URL}/login",
}

# --- OAuth (Google, GitHub) ---
# Credentials come from .env; a provider without a client id is left out entirely,
# so /api/auth/browser/v1/config only lists providers that can actually be used.
SOCIALACCOUNT_ADAPTER = "apps.accounts.adapter.SocialAccountAdapter"
# Both providers verify email ownership, so a verified provider email signs into the
# local account with that email and links the provider to it.
SOCIALACCOUNT_EMAIL_AUTHENTICATION = True
SOCIALACCOUNT_EMAIL_AUTHENTICATION_AUTO_CONNECT = True
_OAUTH_PROVIDERS: dict[str, tuple[str, dict[str, object]]] = {
    "google": (
        "GOOGLE",
        {
            "SCOPE": ["openid", "profile", "email"],
            "AUTH_PARAMS": {"access_type": "online"},
            "OAUTH_PKCE_ENABLED": True,
        },
    ),
    "github": ("GITHUB", {"SCOPE": ["read:user", "user:email"]}),
}
SOCIALACCOUNT_PROVIDERS = {
    name: {
        "APPS": [
            {
                "client_id": env(f"{prefix}_CLIENT_ID"),
                "secret": env(f"{prefix}_CLIENT_SECRET", default=""),
            }
        ],
        **options,
    }
    for name, (prefix, options) in _OAUTH_PROVIDERS.items()
    if env(f"{prefix}_CLIENT_ID", default="")
}

# --- Object storage (S3-compatible: AWS S3, Cloudflare R2; LocalStack in dev/CI) ---
# Only apps.storage reads these. Empty endpoint means AWS S3.
S3_ENDPOINT_URL = env("S3_ENDPOINT_URL", default="") or None
S3_REGION = env("S3_REGION", default="us-east-1")
S3_BUCKET = env("S3_BUCKET")
S3_ACCESS_KEY_ID = env("S3_ACCESS_KEY_ID")
S3_SECRET_ACCESS_KEY = env("S3_SECRET_ACCESS_KEY")
S3_ADDRESSING_STYLE = env("S3_ADDRESSING_STYLE", default="virtual")
# Presigned URL lifetimes (architecture.md): parts are re-requested when they expire.
S3_UPLOAD_PART_URL_SECONDS = 60 * 60
S3_DOWNLOAD_URL_SECONDS = 5 * 60

# --- Background thumbnails (M3-01) ---
THUMBNAIL_MAX_SOURCE_BYTES = env.int("THUMBNAIL_MAX_SOURCE_BYTES", default=100 * 1024 * 1024)
THUMBNAIL_MAX_PIXELS = env.int("THUMBNAIL_MAX_PIXELS", default=40_000_000)
THUMBNAIL_SOFT_TIME_LIMIT = env.int("THUMBNAIL_SOFT_TIME_LIMIT", default=60)
THUMBNAIL_TIME_LIMIT = env.int("THUMBNAIL_TIME_LIMIT", default=90)

# --- Cloudflare Turnstile (empty secret disables the check; prod requires it) ---
# The SPA reads the site key from GET /api/v1/config, so both keys live here.
TURNSTILE_SITE_KEY = env("TURNSTILE_SITE_KEY", default="")
TURNSTILE_SECRET_KEY = env("TURNSTILE_SECRET_KEY", default="")

# --- i18n ---
LANGUAGE_CODE = "vi"
LANGUAGES = [("vi", "Tiếng Việt"), ("en", "English")]
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# --- Static ---
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# --- Email (Django 6.1 MAILERS; the old EMAIL_* settings are deprecated) ---
MAILERS = {
    "default": {
        "BACKEND": "django.core.mail.backends.smtp.EmailBackend",
        "OPTIONS": {
            "host": env("EMAIL_HOST", default="localhost"),
            "port": env.int("EMAIL_PORT", default=1025),
            "username": env("EMAIL_HOST_USER", default=""),
            "password": env("EMAIL_HOST_PASSWORD", default=""),
            "use_tls": env.bool("EMAIL_USE_TLS", default=False),
            "timeout": 10,
        },
    }
}
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="Qloud <no-reply@localhost>")

# --- Celery ---
CELERY_BROKER_URL = env("CELERY_BROKER_URL")
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_TIME_LIMIT = 15 * 60
CELERY_TIMEZONE = TIME_ZONE
# `celery -A config beat`: one beat process per deployment (architecture.md).
CELERY_BEAT_SCHEDULE = {
    "expire-uploads": {"task": "apps.uploads.tasks.expire_uploads", "schedule": 60 * 60},
}

# --- DRF / OpenAPI ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.DefaultCursorPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.core.errors.exception_handler",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Qloud API",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SERVE_PERMISSIONS": ["rest_framework.permissions.AllowAny"],
    # Several components use the same field names with different choices.
    "ENUM_NAME_OVERRIDES": {
        "KindEnum": "apps.drive.models.Node.Kind",
        "PreviewKindEnum": ["image", "pdf", "video", "audio", "text", "unsupported"],
        "UploadStatusEnum": "apps.uploads.models.UploadSession.Status",
        "FolderConflictEnum": ["fail", "rename", "reuse"],
        "OnConflictEnum": "apps.uploads.models.UploadSession.OnConflict",
    },
}

# --- Logging ---
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "default"},
    },
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", default="INFO")},
}
