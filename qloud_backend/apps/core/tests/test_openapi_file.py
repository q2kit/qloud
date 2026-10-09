from io import StringIO
from pathlib import Path

from django.conf import settings
from django.core.management import call_command

SCHEMA_FILE = Path(settings.BASE_DIR) / "openapi.yaml"
REGENERATE = (
    "uv run python manage.py spectacular --file openapi.yaml --validate --fail-on-warn "
    "(then `pnpm api:generate` in qloud_frontend)"
)


def test_committed_openapi_schema_is_up_to_date():
    generated = StringIO()
    call_command("spectacular", "--validate", "--fail-on-warn", stdout=generated)

    assert SCHEMA_FILE.read_text() == generated.getvalue(), (
        f"qloud_backend/openapi.yaml is stale. Regenerate it: {REGENERATE}"
    )
