# Media tổng hợp cho test preview

Các fixture này không chứa media của bên thứ ba. `preview.mp4` là clip H.264 màu
xanh, dài 20 giây, 160×90px. M3-04 bổ sung:

- `preview-short.mp4`: 0,2 giây đầu để kiểm tra lấy frame đầu của clip ngắn.
- `preview-wide.mp4`: clip H.264 màu đỏ, dài 1,5 giây, 1920×1080px để kiểm tra scale.
- `preview-rotated.mp4`: clip xanh có display matrix xoay 90°.

Tạo lại từ gốc repo bằng FFmpeg có encoder, chỉ dùng để tạo dữ liệu test
(bản LGPL trên worker production chủ ý không có encoder H.264):

```bash
cd "$(git rev-parse --show-toplevel)" &&
  ffmpeg -nostdin -v error -y -i qloud_frontend/e2e/fixtures/preview.mp4 -t 0.2 -c copy qloud_frontend/e2e/fixtures/preview-short.mp4 &&
  ffmpeg -nostdin -v error -y -f lavfi -i color=c=red:s=1920x1080:r=10:d=1.5 -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart qloud_frontend/e2e/fixtures/preview-wide.mp4 &&
  ffmpeg -nostdin -v error -y -display_rotation 90 -i qloud_frontend/e2e/fixtures/preview.mp4 -c copy qloud_frontend/e2e/fixtures/preview-rotated.mp4
```
