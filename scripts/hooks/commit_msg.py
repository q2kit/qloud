#!/usr/bin/env python3
"""commit-msg hook: enforce Conventional Commits (qloud_docs/conventions.md › Commit message)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from conventions import HEADER, HEADER_MAX, SCOPES, TYPES, subject_problems  # noqa: E402

# Messages git or tooling generates on its own.
SKIP_PREFIXES = ("Merge ", "Revert ", "fixup! ", "squash! ", "amend! ")


def main() -> int:
    raw = Path(sys.argv[1]).read_text(encoding="utf-8")
    lines = [line for line in raw.splitlines() if not line.startswith("#")]
    while lines and not lines[0].strip():
        lines.pop(0)
    if not lines:
        return 0  # empty message: git aborts the commit itself
    header = lines[0]
    if header.startswith(SKIP_PREFIXES):
        return 0

    problems: list[str] = []
    match = HEADER.match(header)
    if not match:
        problems.append(
            "header must be `<type>(<scope>): <subject>` "
            f"(type: {', '.join(TYPES)}; scope: {', '.join(SCOPES)}, fe or fe-<feature>)"
        )
    else:
        problems += subject_problems(match.group("subject"))
    if len(header) > HEADER_MAX:
        problems.append(f"header is {len(header)} characters; max {HEADER_MAX}")
    if len(lines) > 1 and lines[1].strip():
        problems.append("leave a blank line between the header and the body")

    if problems:
        print(f"✗ commit message: {header!r}", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        print("  See qloud_docs/conventions.md › Commit message", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
