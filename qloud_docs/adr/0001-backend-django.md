# 0001. Backend dùng Django + DRF

- Trạng thái: Chấp nhận · 2026-10-09

## Quyết định
Django + Django REST Framework, drf-spectacular cho OpenAPI, django-allauth (headless) cho auth, Celery + Redis cho tác vụ nền.

## Lý do
- ORM, migration, Django admin (quản trị user, plan, kiểm duyệt) và allauth (Google/GitHub) có sẵn. FastAPI, NestJS hay Go đều phải tự ghép những phần này.
- Điểm yếu về hiệu năng của Django không ảnh hưởng: byte file không đi qua server (ADR-0003), server chỉ xử lý request metadata ngắn và mở rộng ngang được.
- Quy ước rõ ràng, tài liệu dồi dào: hợp với việc code do AI agent viết.

## Hệ quả
- Tách lớp `services`/`selectors`, view chỉ làm phần mỏng.
- Việc nặng luôn đưa vào Celery, không xử lý trong request.
- Cần realtime (thông báo, cộng tác) thì thêm Django Channels hoặc service riêng.
