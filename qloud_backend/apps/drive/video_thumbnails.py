"""Extract one MP4 frame in the worker, using an explicitly configured LGPL build."""

import json
import math
import subprocess
import tempfile
import time
from pathlib import Path

from django.conf import settings
from PIL import Image


def _run(argv: list[str], deadline: float) -> bytes:
    # Executables and argv are controlled by the worker, never by a file name or URL.
    with subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as process:  # noqa: S603
        try:
            output, _ = process.communicate(timeout=max(0.01, deadline - time.monotonic()))
            if process.returncode:
                raise ValueError("MP4 decoder failed")
            return output
        except subprocess.TimeoutExpired as error:
            raise ValueError("MP4 decoder timed out") from error
        finally:
            # Also reap on Celery's SoftTimeLimitExceeded, not only subprocess timeout.
            if process.poll() is None:
                process.kill()
            process.wait()


def frame(source: bytes) -> Image.Image:
    deadline = time.monotonic() + 35
    ffmpeg, ffprobe = settings.THUMBNAIL_FFMPEG, settings.THUMBNAIL_FFPROBE
    for executable in (ffmpeg, ffprobe):
        license_text = " ".join(
            _run([executable, "-L"], deadline).decode("utf-8", errors="replace").split()
        )
        if (
            "GNU Lesser General Public License" not in license_text
            or "version 2.1" not in license_text
            or any(
                flag in license_text
                for flag in ("--enable-gpl", "--enable-nonfree", "--enable-version3")
            )
        ):
            raise ValueError("thumbnail decoder must be an LGPL-only build")
    with tempfile.TemporaryDirectory(prefix="qloud-thumbnail-") as directory:
        path = Path(directory) / "source.mp4"
        path.write_bytes(source)
        input_options = [
            "-protocol_whitelist",
            "file,pipe",
            "-format_whitelist",
            "mov",
            "-enable_drefs",
            "0",
            "-use_absolute_path",
            "0",
            "-threads",
            "1",
            "-max_pixels",
            str(settings.THUMBNAIL_MAX_PIXELS),
        ]
        metadata = json.loads(
            _run(
                [
                    ffprobe,
                    "-v",
                    "error",
                    *input_options,
                    "-select_streams",
                    "V:0",
                    "-show_entries",
                    "stream=codec_name,width,height:format=duration",
                    "-of",
                    "json",
                    str(path),
                ],
                deadline,
            )
        )
        streams = metadata.get("streams", [])
        if not streams:
            raise ValueError("MP4 has no video stream")
        stream = streams[0]
        width, height = int(stream.get("width", 0)), int(stream.get("height", 0))
        if width <= 0 or height <= 0 or width * height > settings.THUMBNAIL_MAX_PIXELS:
            raise ValueError("MP4 exceeds thumbnail pixel limit")
        if stream.get("codec_name") not in {"h264", "hevc", "mpeg4"}:
            raise ValueError("unsupported MP4 codec")
        duration = float(metadata.get("format", {}).get("duration", 0))
        if not math.isfinite(duration) or duration < 0:
            raise ValueError("invalid MP4 duration")
        output = Path(directory) / "frame.png"
        for seek in [1, 0] if duration > 1 else [0]:
            _run(
                [
                    ffmpeg,
                    "-nostdin",
                    "-v",
                    "error",
                    "-y",
                    "-ss",
                    str(seek),
                    *input_options,
                    "-i",
                    str(path),
                    "-map",
                    "0:V:0",
                    "-frames:v",
                    "1",
                    "-an",
                    "-sn",
                    "-dn",
                    "-vf",
                    "scale=w='min(1024,iw)':h='min(1024,ih)':force_original_aspect_ratio=decrease:reset_sar=1",
                    "-c:v",
                    "png",
                    "-threads",
                    "1",
                    "-f",
                    "image2",
                    str(output),
                ],
                deadline,
            )
            if output.exists() and output.stat().st_size:
                break
        if not output.exists() or not 0 < output.stat().st_size <= 5 * 1024 * 1024:
            raise ValueError("MP4 has no bounded thumbnail frame")
        with Image.open(output, formats=["PNG"]) as image:
            if max(image.size) > 1024:
                raise ValueError("MP4 thumbnail exceeds output dimensions")
            return image.convert("RGBA")
