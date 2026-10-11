# 0009. Thumbnail MP4 bằng FFmpeg trên Celery worker

- Trạng thái: Chấp nhận · 2026-10-11 · [Owner duyệt #121](https://github.com/q2kit/qloud/issues/121#issuecomment-6103108839)

## Quyết định

FFmpeg/ffprobe 9.0.2 là dependency native trên **host/container Celery worker**, gọi qua subprocess để lấy một frame MP4. Build shared LGPL-2.1-or-later bằng `scripts/build_ffmpeg.py`; không GPL/nonfree/version3, không network, không dùng binary Homebrew mặc định. Cho phép ngoại lệ giấy phép riêng cho FFmpeg/ffprobe trong conventions.md.

## Lý do

Pillow không giải mã video. FFmpeg hỗ trợ decoder native H.264/HEVC/MPEG-4, chạy độc lập với Django/Python và có thể giới hạn container/protocol/threads/thời gian. Binary wrapper Python không bảo đảm giấy phép của native bundle; build tối thiểu kiểm soát cấu hình thực tế.

## Hệ quả

Dev cài binary trên máy chạy worker; deploy cài vào worker image/host, Django API không cần binary. Giữ toàn bộ prefix shared library và source/license/configuration trong `share/qloud-ffmpeg` khi phân phối. CI build từ source đã ghim SHA256 và xác minh phiên bản/cấu hình/license. Đường dẫn lấy từ THUMBNAIL_FFMPEG/THUMBNAIL_FFPROBE, mặc định `.tools/ffmpeg/bin` ở gốc repo.

Worker chỉ đọc S3 ≤100 MiB, probe giới hạn 40 triệu pixel, lấy frame ~1 giây (video ngắn dùng frame đầu), scale ≤1024px rồi Pillow xuất WebP. Không transcode, không tính quota, không backfill tự động. Process và thư mục tạm có cleanup; lỗi/giới hạn dùng icon. Celery prefork giữ timeout 60/90 giây, subprocess chung budget 35 giây.

Build dùng zlib của hệ thống (giấy phép Zlib, cần header khi compile) và RPATH tới `<prefix>/lib`. Khi build image nhiều stage, dùng `--prefix` đúng đường dẫn cuối trong worker và copy prefix sang cùng đường dẫn; không di chuyển binary/shared libraries sang prefix khác. Ví dụ build `python3 scripts/build_ffmpeg.py --prefix /opt/qloud-ffmpeg`, rồi cấu hình `THUMBNAIL_FFMPEG=/opt/qloud-ffmpeg/bin/ffmpeg` và `THUMBNAIL_FFPROBE=/opt/qloud-ffmpeg/bin/ffprobe`.
