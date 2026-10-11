#!/usr/bin/env python3
"""Build the pinned, LGPL-only worker tools on macOS/Linux (C compiler and make)."""

# Only fixed build/tool commands and a trusted local installation prefix are executed.
# ruff: noqa: S603, S607
import argparse
import hashlib
import os
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
from pathlib import Path

VERSION = "9.0.2"
SHA256 = "8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e"
URL = f"https://ffmpeg.org/releases/ffmpeg-{VERSION}.tar.xz"
FLAGS = [
    "--disable-autodetect",
    "--disable-everything",
    "--disable-network",
    "--disable-gpl",
    "--disable-nonfree",
    "--disable-version3",
    "--disable-doc",
    "--disable-x86asm",
    "--disable-static",
    "--enable-shared",
    "--enable-rpath",
    "--enable-ffmpeg",
    "--enable-ffprobe",
    "--disable-ffplay",
    "--enable-avcodec",
    "--enable-avformat",
    "--enable-avfilter",
    "--enable-swscale",
    "--enable-decoder=h264,hevc,mpeg4",
    "--enable-parser=h264,hevc,mpeg4video",
    "--enable-demuxer=mov",
    "--enable-protocol=file,pipe",
    "--enable-encoder=png",
    "--enable-zlib",
    "--enable-muxer=image2",
    "--enable-filter=scale,format,transpose,hflip,vflip,trim",
]


def validate(prefix: Path) -> None:
    for name in ("ffmpeg", "ffprobe"):
        binary = str(prefix / "bin" / name)
        result = subprocess.run([binary, "-version"], check=True, capture_output=True, text=True)
        configuration = result.stdout + result.stderr
        if f"version {VERSION} " not in configuration or any(
            flag in configuration
            for flag in ("--enable-gpl", "--enable-nonfree", "--enable-version3")
        ):
            raise RuntimeError("unexpected FFmpeg version or prohibited build flags")
        license_text = subprocess.run(
            [binary, "-L"], check=True, capture_output=True, text=True
        ).stdout
        license_text = " ".join(license_text.split())
        if (
            "GNU Lesser General Public License" not in license_text
            or "version 2.1" not in license_text
        ):
            raise RuntimeError("worker tools must be LGPL-2.1-or-later")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--prefix", type=Path, default=Path(__file__).resolve().parent.parent / ".tools/ffmpeg"
    )
    parser.add_argument(
        "--archive", type=Path, help="Use a previously downloaded, checksum-verified source"
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    prefix = args.prefix.resolve()
    if args.check:
        validate(prefix)
        return
    with tempfile.TemporaryDirectory(prefix="qloud-ffmpeg-build-") as directory:
        work = Path(directory)
        archive = work / f"ffmpeg-{VERSION}.tar.xz"
        if args.archive:
            shutil.copyfile(args.archive, archive)
        else:
            with urllib.request.urlopen(URL, timeout=60) as response, archive.open("wb") as target:
                shutil.copyfileobj(response, target)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
            raise RuntimeError("FFmpeg source checksum mismatch")
        with tarfile.open(archive) as source:
            source.extractall(work, filter="data")
        source_dir = work / f"ffmpeg-{VERSION}"
        subprocess.run(
            [str(source_dir / "configure"), f"--prefix={prefix}", *FLAGS],
            cwd=source_dir,
            check=True,
        )
        subprocess.run(["make", f"-j{min(os.cpu_count() or 2, 8)}"], cwd=source_dir, check=True)
        subprocess.run(["make", "install"], cwd=source_dir, check=True)
        notices = prefix / "share/qloud-ffmpeg"
        notices.mkdir(parents=True, exist_ok=True)
        # Ship corresponding source, exact configuration and copyright/license notices.
        shutil.copyfile(archive, notices / archive.name)
        for name in ("COPYING.LGPLv2.1", "LICENSE.md", "Changelog"):
            shutil.copyfile(source_dir / name, notices / name)
        (notices / "BUILD.txt").write_text(
            f"{URL}\nSHA256 {SHA256}\n" + "\n".join([f"--prefix={prefix}", *FLAGS]) + "\n"
        )
    validate(prefix)
    print(f"FFmpeg {VERSION}, LGPL-2.1-or-later: {prefix}")


if __name__ == "__main__":
    main()
