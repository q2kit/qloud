#!/usr/bin/env python3
"""pre-push hook: block pushes to master and enforce branch names.

Reads `<local ref> <local sha> <remote ref> <remote sha>` lines from stdin.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from conventions import branch_problems  # noqa: E402

PROTECTED = {"refs/heads/master"}


def main() -> int:
    problems: list[str] = []
    for line in sys.stdin:
        parts = line.split()
        if len(parts) != 4:
            continue
        local_ref, _, remote_ref, _ = parts
        if remote_ref in PROTECTED:
            problems.append("pushing to `master` is not allowed; open a pull request instead")
        if local_ref.startswith("refs/heads/"):
            problems += branch_problems(local_ref.removeprefix("refs/heads/"))

    for problem in problems:
        print(f"✗ {problem}", file=sys.stderr)
    if problems:
        print("  See qloud_docs/conventions.md › Branch", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
