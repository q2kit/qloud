"""Tests for the convention scripts. Run: python3 -m unittest discover -s scripts/tests"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from check_licenses import is_allowed, problems  # noqa: E402
from check_pr import title_problems  # noqa: E402
from conventions import branch_problems  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
