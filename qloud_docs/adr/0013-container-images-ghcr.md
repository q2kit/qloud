# 0013. Image production build trên GitHub Actions, lưu ở GHCR

- Trạng thái: Chấp nhận · 2026-11-05

## Quyết định
- Một Dockerfile nhiều stage (`infra/docker/Dockerfile`) cho hai image:
  - `qloud-backend`: Django, gunicorn, Celery và FFmpeg LGPL. Dùng cho các service `api`, `worker`, `beat` và `migrate`.
  - `qloud-web`: nginx, chứa bản build FE và `/static/` của Django.
- Workflow `images.yml` build cả hai image. PR có sửa phần liên quan tới build thì chỉ build để kiểm tra. Push lên `master` thì build và push lên `ghcr.io/<owner>/qloud-{backend,web}` với tag `sha-<commit>` và `master`.
- VPS không build: `docker compose pull && docker compose up -d` (`infra/production/compose.yml`). Compose vẫn giữ phần `build:` để build tại chỗ khi cần, chẳng hạn khi kiểm tra trên máy.

## Lý do
- Build FFmpeg và FE tốn CPU/RAM vài phút. Build trên VPS làm chậm và có thể ảnh hưởng tới bản đang chạy.
- GHCR đi cùng repo GitHub: không cần tài khoản registry riêng, CI đăng nhập bằng `GITHUB_TOKEN`.
- Tag theo commit thì deploy lại hay quay về bản cũ đều chỉ là đổi `QLOUD_TAG`.

## Hệ quả
- Repo private nên package trên GHCR cũng private. VPS phải `docker login ghcr.io` bằng token chỉ có quyền `read:packages` (xem `deploy.md`).
- Đổi Dockerfile, cấu hình nginx, lockfile hay `scripts/build_ffmpeg.py` thì PR phải build được (`images.yml`).
- Image không chứa secret: tất cả nằm trong `infra/production/.env` trên server. TLS do nginx của host đảm nhiệm ([ADR-0014](0014-host-nginx-tls.md)).
- Deploy tự động (pull rồi khởi động lại trên VPS sau khi push image) thuộc M8-04.
