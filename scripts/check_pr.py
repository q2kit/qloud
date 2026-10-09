#!/usr/bin/env python3
"""Check a pull request against qloud_docs/conventions.md › Pull Request.

Reads PR_TITLE and PR_BODY from the environment (never interpolate them into
shell code) and the list of changed files from stdin, one path per line.
"""

import os
import re
import sys

TYPES = "feat|fix|docs|test|refactor|perf|chore|ci|build"
TITLE = re.compile(rf"^(?:{TYPES})\([a-z0-9-]+\)!?: \S.*?(?: \[(?P<task>M\d+-\d{{2}}[a-z]?)\])?$")
CODE_PREFIXES = ("qloud_backend/", "qloud_frontend/", "infra/", "docker-compose.yml")


def main() -> int:
    title = os.environ.get("PR_TITLE", "")
    body = os.environ.get("PR_BODY", "")
    changed = [line.strip() for line in sys.stdin if line.strip()]
    errors: list[str] = []

    match = TITLE.match(title)
    if not match:
        errors.append(
            "PR title must be `<type>(<scope>): <subject> [<task-id>]` "
            f"(type: {TYPES.replace('|', ', ')}); got: {title!r}"
        )
    elif len(title) > 100:
        errors.append(f"PR title is {len(title)} characters; keep it under 100")

    if match and match.group("task") and not re.search(r"\bCloses #\d+", body):
        errors.append("PR has a task ID in its title, so its body must contain `Closes #<issue>`")

    touches_code = any(path.startswith(CODE_PREFIXES) for path in changed)
    if touches_code and "qloud_docs/ROADMAP.md" not in changed:
        print("::warning::PR changes code but not qloud_docs/ROADMAP.md (status + Nhật ký).")

    for message in errors:
        print(f"::error::{message}")
    print(f"PR check: {len(errors)} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
