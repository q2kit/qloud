"""Tests for the convention scripts. Run: python3 -m unittest discover -s scripts/tests"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from check_licenses import is_allowed, problems  # noqa: E402
from check_pr import title_problems  # noqa: E402
from conventions import branch_problems  # noqa: E402
from workflow import (  # noqa: E402
    WorkflowError,
    checks_for,
    done_status,
    feature_docs,
    parse_tasks,
    set_task_status,
    sync_overview,
    task_from_branch,
    task_from_pr_title,
)

ROADMAP = """\
| Milestone | Mục tiêu | Trạng thái |
|---|---|---|
| M1 | Xác thực | ⬜ |
| M2 | Folder, file | ⬜ |

## M1 — Xác thực ([auth.md](features/auth.md))
| ID | Task | Issue | Trạng thái |
|---|---|---|---|
| M1-01 | Model `User` \\| Plan | [#10](https://x/i/10) | ✅ [PR #82](https://x/p/82) |
| M1-02 | allauth | [#11](https://x/i/11) | 🟦 |

## M2 — Folder ([files-folders.md](features/files-folders.md), [upload.md](features/upload.md))
| ID | Task | Issue | Trạng thái |
|---|---|---|---|
| M2-04a | Upload session | [#20](https://x/i/20) | ⬜ |
"""


class LicenseTests(unittest.TestCase):
    def test_permissive_licenses_and_pypi_classifiers_pass(self):
        for license_ in [
            "MIT",
            "MIT License",
            "BSD License",
            "Apache Software License; BSD License",
            "Apache-2.0 OR BSD-2-Clause",
            "(MIT OR CC0-1.0)",
            "Mozilla Public License 2.0 (MPL 2.0)",
        ]:
            with self.subTest(license_):
                self.assertTrue(is_allowed(license_))

    def test_unknown_copyleft_and_source_available_licenses_fail(self):
        for license_ in [
            "",
            "UNKNOWN",
            "GPL-3.0-or-later",
            "AGPL-3.0",
            "SSPL-1.0",
            "BUSL-1.1",
            "MIT AND GPL-2.0",
        ]:
            with self.subTest(license_):
                self.assertFalse(is_allowed(license_))

    def test_exceptions_only_cover_their_package_and_exact_license(self):
        self.assertEqual(problems([("psycopg", "LGPL-3.0-only")]), [])
        self.assertEqual(len(problems([("other", "LGPL-3.0-only")])), 1)
        self.assertEqual(len(problems([("psycopg", "GPL-3.0-only")])), 1)


class PrTitleTests(unittest.TestCase):
    def test_valid_titles(self):
        self.assertEqual(title_problems("fix(core): handle 404 [M0-13]", "Closes #70"), [])
        self.assertEqual(title_problems("docs(roadmap): mark M0-11 done", ""), [])

    def test_task_id_requires_closes(self):
        self.assertEqual(len(title_problems("fix(core): handle 404 [M0-13]", "")), 1)

    def test_malformed_task_id_is_rejected(self):
        for title in [
            "fix(core): handle 404 [M0-4]",
            "fix(core): handle 404[M0-13]",
            "fix(core): handle 404 [M0-13] ",
        ]:
            with self.subTest(title):
                self.assertTrue(title_problems(title, "Closes #70"))

    def test_dependabot_titles_skip_subject_case_and_length(self):
        title = "chore(deps): Bump the frontend-minor-patch group in /qloud_frontend with 2 updates"
        self.assertTrue(title_problems(title, ""))
        self.assertEqual(title_problems(title, "", bot=True), [])

    def test_title_must_leave_room_for_the_pr_number(self):
        title = "fix(core): " + "a" * 60
        self.assertTrue(title_problems(title, ""))
        self.assertEqual(title_problems(title, "", bot=True), [])


class BranchTests(unittest.TestCase):
    def test_branch_names(self):
        self.assertEqual(branch_problems("fix/M0-13-be-review-fixes"), [])
        self.assertEqual(branch_problems("docs/roadmap-m0-done"), [])
        self.assertTrue(branch_problems("Bad_Name"))
        self.assertTrue(branch_problems("feature/M0-13-x"))


class RoadmapTests(unittest.TestCase):
    def test_parse_tasks(self):
        tasks = parse_tasks(ROADMAP)
        self.assertEqual(list(tasks), ["M1-01", "M1-02", "M2-04a"])
        self.assertTrue(tasks["M1-01"].done)
        self.assertEqual((tasks["M1-02"].issue, tasks["M1-02"].status), (11, "🟦"))
        self.assertEqual(tasks["M2-04a"].milestone, "M2")

    def test_set_task_status_changes_only_that_row(self):
        text = set_task_status(ROADMAP, "M2-04a", "🟦")
        self.assertEqual(parse_tasks(text)["M2-04a"].status, "🟦")
        self.assertEqual(
            [line for line in text.splitlines() if "M2-04a" not in line],
            [line for line in ROADMAP.splitlines() if "M2-04a" not in line],
        )
        self.assertTrue(text.endswith("\n"))

    def test_unknown_task_is_an_error(self):
        with self.assertRaises(WorkflowError):
            set_task_status(ROADMAP, "M9-01", "🟦")

    def test_overview_follows_tasks(self):
        self.assertEqual(sync_overview(ROADMAP), ROADMAP)
        text = set_task_status(ROADMAP, "M1-02", done_status(84, "https://x/84"))
        text = sync_overview(text)
        self.assertIn("| M1 | Xác thực | ✅ |", text)
        self.assertIn("| M2 | Folder, file | ⬜ |", text)
        self.assertIn(
            "| M1-02 | allauth | [#11](https://x/i/11) | ✅ [PR #84](https://x/84) |",
            text,
        )

    def test_feature_docs_of_a_milestone(self):
        self.assertEqual(
            feature_docs(ROADMAP, "M2"), ["features/files-folders.md", "features/upload.md"]
        )
        self.assertEqual(feature_docs(ROADMAP, "M7"), [])

    def test_task_ids_from_branch_and_title(self):
        self.assertEqual(task_from_branch("feat/M2-04a-upload-session"), "M2-04a")
        self.assertIsNone(task_from_branch("docs/roadmap-m0-done"))
        self.assertEqual(task_from_pr_title("feat(uploads): add session API [M2-04]"), "M2-04")
        self.assertIsNone(task_from_pr_title("docs(roadmap): mark M0-11 done"))


class ChecksForTests(unittest.TestCase):
    def names(self, changed, **kwargs):
        return [name for name, _, _ in checks_for(changed, **kwargs)]

    def test_docs_only_runs_nothing(self):
        self.assertEqual(self.names(["qloud_docs/ROADMAP.md", "AGENTS.md"]), [])

    def test_each_side_runs_its_checks_and_e2e(self):
        backend = self.names(["qloud_backend/apps/core/views.py"])
        self.assertIn("backend: pytest", backend)
        self.assertNotIn("frontend: lint", backend)
        self.assertEqual(backend[-1], "e2e")
        frontend = self.names(["qloud_frontend/src/main.tsx"], e2e=False)
        self.assertIn("frontend: build", frontend)
        self.assertNotIn("e2e", frontend)

    def test_shared_files_run_both_sides(self):
        names = self.names(["docker-compose.yml"])
        self.assertIn("backend: mypy", names)
        self.assertIn("frontend: typecheck", names)

    def test_scripts_run_their_own_tests(self):
        self.assertEqual(self.names(["scripts/workflow.py"]), ["scripts: unittest"])


if __name__ == "__main__":
    unittest.main()
