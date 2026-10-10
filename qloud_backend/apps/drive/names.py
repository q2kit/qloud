"""Node name rules (qloud_docs/features/files-folders.md, "Quy tắc nghiệp vụ").

The `node_name` check constraint enforces the same rules on raw writes.
"""

import re

from django.core.exceptions import ValidationError

MAX_LENGTH = 255
_FORBIDDEN = re.compile(r"[\x00-\x1f\x7f/]")


def validate_name(name: str) -> None:
    """Reject a name that is not already normalized (see `normalize_name`)."""
    if name != name.strip() or not name or name in {".", ".."}:
        raise ValidationError("Invalid name.", code="invalid_name")
    if len(name) > MAX_LENGTH:
        raise ValidationError("Name is too long.", code="name_too_long")
    if _FORBIDDEN.search(name):
        raise ValidationError(
            "Name must not contain `/` or control characters.", code="invalid_name"
        )


def normalize_name(raw: str) -> str:
    """Trim surrounding whitespace, then validate. Use for every name from a client."""
    name = raw.strip()
    validate_name(name)
    return name
