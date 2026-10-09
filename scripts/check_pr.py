#!/usr/bin/env python3
"""Check a pull request against qloud_docs/conventions.md › Pull Request.

Reads PR_TITLE, PR_BODY and PR_HEAD_REF from the environment (never interpolate
them into shell code) and the list of changed files from stdin, one path per line.
"""

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conventions import (  # noqa: E402
    BOT_BRANCH_PREFIX,
    PR_TITLE,
    PR_TITLE_MAX,
    SCOPES,
    STRAY_TASK,
    TYPES,
    branch_problems,
    subject_problems,
)

CODE_PREFIXES = ("qloud_backend/", "qloud_frontend/", "infra/", "docker-compose.yml")


def title_problems(title: str, body: str, *, bot: bool = False) -> list[str]:
    match = PR_TITLE.match(title)
    if not match:
        return [
            "PR title must be `<type>(<scope>): <subject> [<task-id>]` "
            f"(type: {', '.join(TYPES)}; scope: {', '.join(SCOPES)}, fe or fe-<feature>); "
            f"got: {title!r}"
        ]
    errors = subject_problems(match.group("subject"))
    if STRAY_TASK.search(match.group("subject")):
        errors.append("task ID must be written exactly ` [M<n>-<nn>]` at the end, e.g. ` [M2-04]`")
    if len(title) > PR_TITLE_MAX and not bot:
        errors.append(
            f"PR title is {len(title)} characters; keep it within {PR_TITLE_MAX} so the "
            "squash commit header (with ` (#123)`) stays within 72"
        )
    if match.group("task") and not re.search(r"\bCloses #\d+", body):
        errors.append("PR has a task ID in its title, so its body must contain `Closes #<issue>`")
    return errors


def main() -> int:
    title = os.environ.get("PR_TITLE", "")
    body = os.environ.get("PR_BODY", "")
    head_ref = os.environ.get("PR_HEAD_REF", "")
    changed = [line.strip() for line in sys.stdin if line.strip()]

    bot = head_ref.startswith(BOT_BRANCH_PREFIX)
    errors = title_problems(title, body, bot=bot)
    if head_ref and not bot:
        errors += branch_problems(head_ref)

    touches_code = any(path.startswith(CODE_PREFIXES) for path in changed)
    if touches_code and "qloud_docs/ROADMAP.md" not in changed:
        print("::warning::PR changes code but not qloud_docs/ROADMAP.md (status + Nhật ký).")

    for message in errors:
        print(f"::error::{message}")
    print(f"PR check: {len(errors)} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
