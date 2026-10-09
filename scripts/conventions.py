"""Single source for commit, PR and branch naming rules (qloud_docs/conventions.md).

Used by the git hooks (scripts/hooks/) and by CI (scripts/check_pr.py).
"""

import re

TYPES = ("feat", "fix", "docs", "test", "refactor", "perf", "chore", "ci", "build")
SCOPES = (
    # Backend Django apps
    "accounts", "drive", "uploads", "sharing", "trash", "search", "storage", "core",
    # Other areas
    "api", "dev", "env", "ci", "deploy", "deps", "repo", "docs", "roadmap", "adr",
)  # fmt: skip
# Frontend: `fe` or `fe-<feature>`.
SCOPE = rf"(?:{'|'.join(SCOPES)}|fe(?:-[a-z0-9]+)*)"
TASK_ID = r"M\d+-\d{2}[a-z]?"

# `<type>(<scope>)!: <subject>` — subject starts lowercase, no trailing period.
HEADER = re.compile(rf"^(?P<type>{'|'.join(TYPES)})\((?P<scope>{SCOPE})\)!?: (?P<subject>\S.*)$")
PR_TITLE = re.compile(
    rf"^(?P<type>{'|'.join(TYPES)})\((?P<scope>{SCOPE})\)!?: (?P<subject>\S.*?)"
    rf"(?: \[(?P<task>{TASK_ID})\])?$"
)
BRANCH = re.compile(rf"^(?:{'|'.join(TYPES)})/(?:{TASK_ID}-)?(?P<slug>[a-z0-9]+(?:-[a-z0-9]+)*)$")

HEADER_MAX = 72
# GitHub appends ` (#123)` to the squash commit, which must still fit HEADER_MAX.
PR_TITLE_MAX = HEADER_MAX - len(" (#123)")
SLUG_MAX = 40
# A trailing `[...]` that PR_TITLE did not take as the task ID, e.g. `[M2-4]`.
STRAY_TASK = re.compile(r"\[[^\]]*\]\s*$")
# Dependabot names its own branches and its titles can run long.
BOT_BRANCH_PREFIX = "dependabot/"


def subject_problems(subject: str) -> list[str]:
    problems = []
    if subject[:1].isupper():
        problems.append("subject must start with a lowercase letter (imperative: `add`, not `Add`)")
    if subject.endswith("."):
        problems.append("subject must not end with a period")
    return problems


def branch_problems(name: str) -> list[str]:
    match = BRANCH.match(name)
    if not match:
        return [
            f"branch `{name}` must be `<type>/<task-id>-<slug>` or `<type>/<slug>` "
            f"(type: {', '.join(TYPES)}; slug: lowercase a-z, 0-9, `-`)"
        ]
    if len(match.group("slug")) > SLUG_MAX:
        return [f"branch slug is longer than {SLUG_MAX} characters"]
    return []
