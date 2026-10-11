import importlib.util
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "build_ffmpeg", Path(__file__).parents[1] / "build_ffmpeg.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FFmpegBuildTests(unittest.TestCase):
    def test_rejects_wrong_version_and_gpl_nonfree_builds(self):
        for config in [
            "version 8.1.3 ",
            "version 9.0.2 --enable-gpl",
            "version 9.0.2 --enable-nonfree",
            "version 9.0.2 --enable-version3",
        ]:
            with (
                self.subTest(config=config),
                patch.object(
                    module.subprocess, "run", return_value=SimpleNamespace(stdout=config, stderr="")
                ),
                self.assertRaises(RuntimeError),
            ):
                module.validate(Path("/decoder"))

    def test_rejects_license_upgrade(self):
        for license_text in [
            "GNU General Public License version 3",
            "GNU Lesser General Public License version 3",
        ]:
            with (
                self.subTest(license=license_text),
                patch.object(
                    module.subprocess,
                    "run",
                    side_effect=[
                        SimpleNamespace(stdout="version 9.0.2 ", stderr=""),
                        SimpleNamespace(stdout=license_text),
                    ],
                ),
                self.assertRaises(RuntimeError),
            ):
                module.validate(Path("/decoder"))

    def test_accepts_exact_lgpl_build_for_both_tools(self):
        with patch.object(
            module.subprocess,
            "run",
            side_effect=[
                SimpleNamespace(stdout="version 9.0.2 ", stderr=""),
                SimpleNamespace(stdout="GNU Lesser General Public\nLicense version 2.1"),
            ]
            * 2,
        ) as run:
            module.validate(Path("/decoder"))
        self.assertEqual(run.call_count, 4)

    def test_source_checksum_mismatch_prevents_build(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "bad.tar.xz"
            archive.write_bytes(b"not trusted source")
            with (
                patch("sys.argv", ["build_ffmpeg.py", "--archive", str(archive)]),
                patch.object(module.subprocess, "run") as run,
                self.assertRaisesRegex(RuntimeError, "checksum"),
            ):
                module.main()
            run.assert_not_called()
