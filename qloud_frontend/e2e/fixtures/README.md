# Preview test media

These synthetic fixtures contain no third-party media. `preview.mp4` is a 20-second
160×90 blue H.264 clip. M3-04 adds:

- `preview-short.mp4`: first 0.2 seconds, for first-frame fallback.
- `preview-wide.mp4`: 1.5-second 1920×1080 red H.264 clip, for bounded scaling.
- `preview-rotated.mp4`: blue clip with a 90-degree display matrix.

Regenerate from the repository root with an encoder-capable FFmpeg used only to
create test data (the production LGPL worker build intentionally has no H.264 encoder):

```bash
ffmpeg -nostdin -v error -y -i qloud_frontend/e2e/fixtures/preview.mp4 -t 0.2 -c copy qloud_frontend/e2e/fixtures/preview-short.mp4
ffmpeg -nostdin -v error -y -f lavfi -i color=c=red:s=1920x1080:r=10:d=1.5 -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart qloud_frontend/e2e/fixtures/preview-wide.mp4
ffmpeg -nostdin -v error -y -display_rotation 90 -i qloud_frontend/e2e/fixtures/preview.mp4 -c copy qloud_frontend/e2e/fixtures/preview-rotated.mp4
```
