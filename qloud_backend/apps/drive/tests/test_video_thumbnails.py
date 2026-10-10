import json
import subprocess
from pathlib import Path
from typing import cast
from unittest.mock import Mock

import pytest
from billiard.exceptions import SoftTimeLimitExceeded
from PIL import Image

from apps.drive import video_thumbnails as video

FIXTURE = Path(__file__).resolve().parents[4] / "qloud_frontend/e2e/fixtures/preview.mp4"


@pytest.mark.parametrize("name", ["preview.mp4", "preview-short.mp4"])
def test_real_mp4_frame_is_blue_and_not_upscaled(name):
    with video.frame(FIXTURE.with_name(name).read_bytes()) as image:
        assert image.size == (160, 90)
        red, green, blue, _ = cast(tuple[int, int, int, int], image.getpixel((80, 45)))
        assert blue > 240
        assert red < 10
        assert green < 10


@pytest.mark.parametrize("duration", ["0.2", "20"])
def test_seek_short_clip_cleanup_and_boundaries(monkeypatch, tmp_path, duration):
    paths = []
    seeks = []

    def run(argv, deadline):
        if "-L" in argv:
            return b"GNU Lesser General Public License version 2.1"
        if "-show_entries" in argv:
            paths.append(Path(argv[-1]))
            return json.dumps(
                {
                    "streams": [{"codec_name": "h264", "width": 160, "height": 90}],
                    "format": {"duration": duration},
                }
            ).encode()
        seeks.append(argv[argv.index("-ss") + 1])
        assert "-protocol_whitelist" in argv
        assert "file,pipe" in argv
        assert argv[argv.index("-enable_drefs") + 1] == "0"
        assert argv[argv.index("-use_absolute_path") + 1] == "0"
        with Image.new("RGB", (160, 90), "blue") as image:
            image.save(argv[-1], format="PNG")
        return b""

    monkeypatch.setattr(video, "_run", run)
    with video.frame(b"source") as image:
        assert image.size == (160, 90)
    assert seeks == (["0"] if duration == "0.2" else ["1"])
    assert paths
    assert not paths[0].parent.exists()


@pytest.mark.parametrize(
    "stream",
    [
        {"codec_name": "h264", "width": 100000, "height": 100000},
        {"codec_name": "h264", "width": 0, "height": 90},
        {"codec_name": "av1", "width": 160, "height": 90},
    ],
)
def test_reject_before_decode_and_cleanup(monkeypatch, stream):
    paths = []

    def run(argv, deadline):
        if "-L" in argv:
            return b"GNU Lesser General Public License version 2.1"
        assert "-show_entries" in argv, "must not invoke decoder"
        paths.append(Path(argv[-1]))
        return json.dumps({"streams": [stream]}).encode()

    monkeypatch.setattr(video, "_run", run)
    with pytest.raises(ValueError, match="MP4"):
        video.frame(b"source")
    assert not paths[0].parent.exists()


@pytest.mark.parametrize(
    "license_text",
    [
        b"GNU General Public License version 3",
        b"GNU Lesser General Public License version 3",
        b"GNU Lesser General Public License version 2.1 --enable-nonfree",
    ],
)
def test_reject_unapproved_build(monkeypatch, license_text):
    monkeypatch.setattr(video, "_run", lambda *args: license_text)
    with pytest.raises(ValueError, match="LGPL-only"):
        video.frame(b"source")


@pytest.mark.parametrize(
    "error", [subprocess.TimeoutExpired("decoder", 1), SoftTimeLimitExceeded()]
)
def test_timeout_kills_and_reaps_process(monkeypatch, error):
    process = Mock()
    process.__enter__ = Mock(return_value=process)
    process.__exit__ = Mock(return_value=False)
    process.communicate.side_effect = error
    process.poll.return_value = None
    monkeypatch.setattr(subprocess, "Popen", Mock(return_value=process))
    expected = ValueError if isinstance(error, subprocess.TimeoutExpired) else SoftTimeLimitExceeded
    with pytest.raises(expected):
        video._run(["decoder"], 1)
    process.kill.assert_called_once()
    process.wait.assert_called_once()


@pytest.mark.parametrize(
    ("name", "size"), [("preview-wide.mp4", (1024, 576)), ("preview-rotated.mp4", (90, 160))]
)
def test_real_frame_scales_and_applies_display_rotation(name, size):
    with video.frame(FIXTURE.with_name(name).read_bytes()) as image:
        assert image.size == size
