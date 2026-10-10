#!/usr/bin/env python3
"""Task workflow commands (AGENTS.md mục 3), for agents and people alike.

    python3 scripts/workflow.py task-start <issue> --slug <slug> [--type <type>]
    python3 scripts/workflow.py pr-open --title <title> --body-file <file> [...]
    python3 scripts/workflow.py roadmap-sync [--pr <n>] [--check] [--github]

The ROADMAP parsing and editing below is pure (tested in scripts/tests);
everything that talks to git or GitHub goes through `run` / `gh_json`.
"""

# Runs fixed git/gh/check commands defined in this file, never commands built from input.
# ruff: noqa: S602, S603, S607

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_pr import title_problems
from conventions import PR_TITLE, TASK_ID, TYPES, branch_problems

BASE = "master"
ROADMAP = Path("qloud_docs/ROADMAP.md")
DONE, REVIEW, TODO = "✅", "🟦", "⬜"
# Issue labels → branch/commit type; `--type` overrides.
LABEL_TYPES = {"type:feature": "feat", "type:chore": "chore", "type:test": "test", "bug": "fix"}

TASK_ROW = re.compile(
    rf"^\| (?P<task>{TASK_ID}) \| (?P<desc>.*) "
    r"\| \[#(?P<issue>\d+)\]\([^)]*\) \| (?P<status>.*) \|$"
)
OVERVIEW_ROW = re.compile(r"^\| (?P<milestone>M\d+) \| (?P<goal>.*) \| (?P<status>\S+) \|$")
SECTION = re.compile(r"^## (?P<milestone>M\d+) — ")
FEATURE_LINK = re.compile(r"\((features/[^)]+\.md)\)")
BRANCH_TASK = re.compile(rf"^[a-z]+/(?P<task>{TASK_ID})-")
ISSUE_TASK = re.compile(rf"^\[(?P<task>{TASK_ID})\]")


class WorkflowError(Exception):
    """A problem the user has to fix; printed without a traceback."""


# --- ROADMAP (pure) ---------------------------------------------------------


@dataclass(frozen=True)
class Task:
    id: str
    milestone: str
    issue: int
    status: str

    @property
    def done(self) -> bool:
        return self.status.startswith(DONE)


def parse_tasks(text: str) -> dict[str, Task]:
    tasks = {}
    for line in text.splitlines():
        if match := TASK_ROW.match(line):
            task_id = match["task"]
            tasks[task_id] = Task(
                task_id, task_id.split("-")[0], int(match["issue"]), match["status"]
            )
    return tasks


def _map_lines(text: str, replace: Callable[[str], str]) -> str:
    return "".join(
        replace(line.rstrip("\n")) + ("\n" if line.endswith("\n") else "")
        for line in text.splitlines(keepends=True)
    )


def set_task_status(text: str, task_id: str, status: str) -> str:
    if task_id not in parse_tasks(text):
        raise WorkflowError(f"{task_id} is not in {ROADMAP}")

    def replace(line: str) -> str:
        match = TASK_ROW.match(line)
        if not match or match["task"] != task_id:
            return line
        return line[: match.start("status")] + status + line[match.end("status") :]

    return _map_lines(text, replace)


def done_status(pr_number: int, pr_url: str) -> str:
    return f"{DONE} [PR #{pr_number}]({pr_url})"


def sync_overview(text: str) -> str:
    """Mark a milestone ✅ in the overview once every one of its tasks is ✅."""
    by_milestone: dict[str, list[Task]] = {}
    for task in parse_tasks(text).values():
        by_milestone.setdefault(task.milestone, []).append(task)
    finished = {m for m, tasks in by_milestone.items() if all(t.done for t in tasks)}

    def replace(line: str) -> str:
        match = OVERVIEW_ROW.match(line)
        if not match or match["milestone"] not in finished or match["status"] == DONE:
            return line
        return line[: match.start("status")] + DONE + line[match.end("status") :]

    return _map_lines(text, replace)


def feature_docs(text: str, milestone: str) -> list[str]:
    """Feature files linked from a milestone's section heading."""
    for line in text.splitlines():
        if (match := SECTION.match(line)) and match["milestone"] == milestone:
            return FEATURE_LINK.findall(line)
    return []


def task_from_branch(branch: str) -> str | None:
    match = BRANCH_TASK.match(branch)
    return match["task"] if match else None


def task_from_pr_title(title: str) -> str | None:
    match = PR_TITLE.match(title)
    return match["task"] if match else None


def checks_for(changed: list[str], *, e2e: bool = True) -> list[tuple[str, str, str]]:
    """(name, directory, command) for the parts a branch touched; mirrors AGENTS.md mục 8."""
    shared = any(
        path.startswith((".github/workflows/", "docker-compose.yml", "infra/")) for path in changed
    )
    backend = shared or any(path.startswith("qloud_backend/") for path in changed)
    frontend = shared or any(path.startswith("qloud_frontend/") for path in changed)
    checks = []
    if backend:
        checks += [
            ("backend: ruff format", "qloud_backend", "uv run ruff format --check ."),
            ("backend: ruff", "qloud_backend", "uv run ruff check ."),
            ("backend: mypy", "qloud_backend", "uv run mypy ."),
            (
                "backend: migrations",
                "qloud_backend",
                "DJANGO_SETTINGS_MODULE=config.settings.test "
                "uv run python manage.py makemigrations --check --dry-run",
            ),
            ("backend: pytest", "qloud_backend", "uv run pytest --cov -q"),
        ]
    if frontend:
        checks += [
            ("frontend: lint", "qloud_frontend", "pnpm lint"),
            ("frontend: format", "qloud_frontend", "pnpm format:check"),
            ("frontend: typecheck", "qloud_frontend", "pnpm typecheck"),
            ("frontend: test", "qloud_frontend", "pnpm test:coverage"),
            ("frontend: build", "qloud_frontend", "pnpm build"),
        ]
    if e2e and (backend or frontend):
        checks.append(("e2e", "qloud_frontend", "pnpm test:e2e"))
    if any(path.startswith("scripts/") for path in changed):
        checks.append(("scripts: unittest", ".", "python3 -m unittest discover -s scripts/tests"))
    return checks


# --- git and GitHub ----------------------------------------------------------


def run(*cmd: str, cwd: Path | None = None, check: bool = True) -> str:
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if check and result.returncode != 0:
        output = result.stderr.strip() or result.stdout.strip()
        raise WorkflowError(f"`{' '.join(cmd)}` failed:\n{output}")
    return result.stdout.strip()


def gh_json(*args: str) -> Any:
    return json.loads(run("gh", *args) or "null")


def repo_root() -> Path:
    return Path(run("git", "rev-parse", "--show-toplevel"))


def step(message: str) -> None:
    print(f"→ {message}", flush=True)


def warn(message: str) -> None:
    print(f"⚠ {message}", flush=True)


def require_clean_tree() -> None:
    if run("git", "status", "--porcelain", "--untracked-files=no"):
        raise WorkflowError("uncommitted changes: commit or stash them first")


def rebase_if_behind() -> bool:
    """Rebase on origin/master only when it has new commits. True when it rebased."""
    run("git", "fetch", "origin")
    ancestor = subprocess.run(["git", "merge-base", "--is-ancestor", f"origin/{BASE}", "HEAD"])
    if ancestor.returncode == 0:
        return False
    step(f"origin/{BASE} has new commits: rebasing")
    rebase = subprocess.run(["git", "rebase", f"origin/{BASE}"], capture_output=True, text=True)
    if rebase.returncode != 0:
        raise WorkflowError(
            "rebase stopped on conflicts: resolve them, `git rebase --continue`, then run again\n"
            + rebase.stdout.strip()
        )
    return True


def read_roadmap(root: Path) -> str:
    return (root / ROADMAP).read_text(encoding="utf-8")


def write_roadmap(root: Path, text: str) -> None:
    (root / ROADMAP).write_text(text, encoding="utf-8")


def doc_status(root: Path, feature: str) -> str:
    path = root / "qloud_docs" / feature
    marker = "**Trạng thái:**"
    lines = path.read_text(encoding="utf-8").splitlines()
    first = next((line for line in lines if marker in line), "")
    return first.split(marker, 1)[-1].split("·")[0].strip()


# --- commands ----------------------------------------------------------------


def task_start(args: argparse.Namespace) -> None:
    root = repo_root()
    issue = gh_json(
        "issue", "view", str(args.issue), "--json", "number,title,labels,state,blockedBy"
    )
    match = ISSUE_TASK.match(issue["title"])
    if not match:
        raise WorkflowError(f"issue #{args.issue} has no `[M<n>-<nn>]` task ID in its title")
    task_id = match["task"]
    labels = {label["name"] for label in issue["labels"]}
    type_ = args.type or next((t for label, t in LABEL_TYPES.items() if label in labels), None)
    if type_ is None:
        raise WorkflowError(
            f"cannot tell the type from the labels; pass --type ({', '.join(TYPES)})"
        )
    branch = f"{type_}/{task_id}-{args.slug}"
    if problems := branch_problems(branch):
        raise WorkflowError("; ".join(problems))

    if issue["state"] != "OPEN":
        warn(f"issue #{args.issue} is {issue['state'].lower()}")
    for blocker in (issue.get("blockedBy") or {}).get("nodes", []):
        if blocker.get("state") == "OPEN":
            warn(f"blocked by open issue #{blocker.get('number')}: {blocker.get('title')}")
    roadmap = read_roadmap(root)
    task = parse_tasks(roadmap).get(task_id)
    if task is None:
        warn(f"{task_id} is not in {ROADMAP}")
    else:
        if task.done:
            warn(f"{task_id} is already ✅ in {ROADMAP}")
        for feature in feature_docs(roadmap, task.milestone):
            if (status := doc_status(root, feature)).startswith("Nháp"):
                warn(f"{feature} is `{status}`: get it approved first (qloud_docs/README.md)")

    require_clean_tree()
    run("git", "fetch", "origin")
    if run("git", "branch", "--list", branch) or run(
        "git", "branch", "--remotes", "--list", f"origin/{branch}"
    ):
        step(f"continuing {branch}")
        run("git", "switch", branch)
        rebase_if_behind()
    else:
        step(f"creating {branch} from the latest {BASE}")
        run("git", "switch", BASE)
        run("git", "pull", "--ff-only")
        run("git", "switch", "-c", branch)

    step(f"assigning #{args.issue} and adding status:in-progress")
    run(
        "gh", "issue", "edit", str(args.issue),
        "--add-assignee", "@me", "--add-label", "status:in-progress",
    )  # fmt: skip
    print(f"✔ on {branch}. Next: read the issue and the docs it links (AGENTS.md mục 3, bước 3).")


def pr_open(args: argparse.Namespace) -> None:
    root = repo_root()
    branch = run("git", "branch", "--show-current")
    if branch == BASE:
        raise WorkflowError(f"on {BASE}: start a task branch first (task-start)")
    body = Path(args.body_file).read_text(encoding="utf-8")
    problems = title_problems(args.title, body) + branch_problems(branch)
    task_id = task_from_branch(branch)
    roadmap = read_roadmap(root)
    task = parse_tasks(roadmap).get(task_id) if task_id else None
    if task_id and task_from_pr_title(args.title) != task_id:
        problems.append(f"the title must end with ` [{task_id}]` (from the branch name)")
    if task and not re.search(rf"\bCloses #{task.issue}\b", body):
        problems.append(f"the body must contain `Closes #{task.issue}` ({task_id} in {ROADMAP})")
    if problems:
        raise WorkflowError("\n".join(problems))

    require_clean_tree()
    rebased = rebase_if_behind()

    # Read again: the rebase may have brought a newer ROADMAP.
    roadmap = read_roadmap(root)
    task = parse_tasks(roadmap).get(task.id) if task else None
    if task and not task.status.startswith((REVIEW, DONE)):
        step(f"marking {task.id} {REVIEW} in {ROADMAP}")
        write_roadmap(root, set_task_status(roadmap, task.id, REVIEW))
        message = f"docs(roadmap): mark {task.id} for review"
        if args.co_author:
            message += f"\n\nCo-Authored-By: {args.co_author}"
        run("git", "add", str(ROADMAP), cwd=root)
        run("git", "commit", "-m", message, cwd=root)

    changed = run("git", "diff", "--name-only", f"origin/{BASE}...HEAD").splitlines()
    for name, directory, command in checks_for(changed, e2e=not args.skip_e2e):
        step(name)
        if subprocess.run(command, shell=True, cwd=root / directory).returncode != 0:
            raise WorkflowError(f"{name} failed: fix it, commit, and run pr-open again")
    if args.skip_e2e:
        warn("E2E skipped (--skip-e2e): say so in the PR body")

    pushed = run("git", "ls-remote", "--heads", "origin", branch) != ""
    step("pushing")
    if pushed and rebased:
        run("git", "push", "--force-with-lease", "-u", "origin", "HEAD")
    else:
        run("git", "push", "-u", "origin", "HEAD")

    existing = gh_json("pr", "list", "--head", branch, "--state", "open", "--json", "url")
    if existing:
        url = existing[0]["url"]
        print(f"✔ updated {url} (title and body left as they are)")
    else:
        url = run(
            "gh", "pr", "create", "--base", BASE,
            "--title", args.title, "--body-file", args.body_file,
        )  # fmt: skip
        print(f"✔ opened {url}")
    if args.watch:
        subprocess.run(["gh", "pr", "checks", url, "--watch"])


def roadmap_sync(args: argparse.Namespace) -> None:
    root = repo_root()
    original = read_roadmap(root)
    text = original
    tasks = parse_tasks(text)

    if args.pr:
        pr = gh_json("pr", "view", str(args.pr), "--json", "number,title,url")
        prs = [pr]
    else:
        prs = gh_json(
            "pr", "list", "--state", "merged", "--limit", "200", "--json", "number,title,url"
        )
    for pr in prs:
        task_id = task_from_pr_title(pr["title"])
        if task_id is None:
            if args.pr:
                raise WorkflowError(f"PR #{args.pr} has no task ID in its title")
            continue
        task = tasks.get(task_id)
        if task is None:
            # Finished milestones may be folded into a one-line summary (M0).
            if any(t.milestone == task_id.split("-")[0] for t in tasks.values()):
                warn(f"PR #{pr['number']} is for {task_id}, which is not in {ROADMAP}")
        elif not task.done:
            print(f"  {task_id}: {task.status} → {DONE} (PR #{pr['number']})")
            text = set_task_status(text, task_id, done_status(pr["number"], pr["url"]))
    text = sync_overview(text)

    if text == original:
        print(f"✔ {ROADMAP} matches GitHub")
    elif args.check:
        raise WorkflowError(f"{ROADMAP} is out of date: run roadmap-sync")
    else:
        write_roadmap(root, text)
        print(f"✔ updated {ROADMAP}; commit it in the next PR (AGENTS.md mục 3, bước 9)")

    if args.github:
        sync_github()


def sync_github() -> None:
    stale = gh_json(
        "issue", "list", "--state", "closed", "--label", "status:in-progress", "--json", "number"
    )
    for issue in stale:
        step(f"removing status:in-progress from closed #{issue['number']}")
        run("gh", "issue", "edit", str(issue["number"]), "--remove-label", "status:in-progress")
    milestones = gh_json("api", "repos/{owner}/{repo}/milestones?state=open&per_page=100")
    for milestone in milestones:
        # Only once nothing at all is open in it, bugs included.
        if milestone["open_issues"] == 0 and milestone["closed_issues"] > 0:
            step(f"closing milestone {milestone['title']}")
            run(
                "gh", "api", "-X", "PATCH",
                f"repos/{{owner}}/{{repo}}/milestones/{milestone['number']}", "-f", "state=closed",
            )  # fmt: skip


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    commands = parser.add_subparsers(dest="command", required=True)

    start = commands.add_parser("task-start", help="create or resume the branch, claim the issue")
    start.add_argument("issue", type=int)
    start.add_argument("--slug", required=True, help="English kebab-case, e.g. upload-session")
    start.add_argument("--type", choices=TYPES, help="default: from the issue's type label")
    start.set_defaults(handler=task_start)

    open_ = commands.add_parser("pr-open", help="check, push and open (or update) the PR")
    open_.add_argument("--title", required=True)
    open_.add_argument("--body-file", required=True)
    open_.add_argument("--skip-e2e", action="store_true", help="say so in the PR body")
    open_.add_argument("--watch", action="store_true", help="then wait for CI")
    open_.add_argument("--co-author", help="Co-Authored-By trailer for the ROADMAP commit")
    open_.set_defaults(handler=pr_open)

    sync = commands.add_parser("roadmap-sync", help="mark merged tasks ✅ in the ROADMAP")
    sync.add_argument("--pr", type=int, help="mark this open PR's task done, before merging it")
    sync.add_argument("--check", action="store_true", help="only report; exit 1 when out of date")
    sync.add_argument(
        "--github", action="store_true", help="also tidy labels, close finished milestones"
    )
    sync.set_defaults(handler=roadmap_sync)

    args = parser.parse_args(argv)
    try:
        args.handler(args)
    except WorkflowError as error:
        print(f"✗ {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
