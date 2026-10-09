# 0001. Backend dùng Django + DRF

- Trạng thái: Chấp nhận
- Ngày: 2026-10-09

## Bối cảnh
Cần một backend dùng được cho sản phẩm thật: có auth (email + OAuth), phân quyền phức tạp, nhiều bảng quan hệ, tác vụ nền.
Code do AI agent viết, nên framework càng có quy ước rõ ràng và tài liệu dồi dào càng tốt.

## Quyết định
Dùng Django (bản ổn định mới nhất, hiện là 6.1) + Django REST Framework, drf-spectacular cho OpenAPI, django-allauth (headless) cho auth, Celery + Redis cho tác vụ nền.

## Lý do và các phương án đã cân nhắc
- **Ưu điểm của Django:** ORM và migration trưởng thành; Django admin dùng ngay được để quản trị (quota, user); allauth hỗ trợ sẵn Google/GitHub; hệ sinh thái lớn.
  AI agent viết Django rất tốt nhờ quy ước rõ ràng và tài liệu dồi dào.
- **Về hiệu năng:** điểm yếu của Django (đồng bộ, chậm hơn Go/Node khi phục vụ nhiều kết nối) **gần như không ảnh hưởng** ở đây,
  vì byte của file không đi qua server (ADR-0003). Server chỉ xử lý request metadata ngắn, và mở rộng ngang bằng cách thêm instance.
- **FastAPI:** nhanh, async, nhưng phải tự ghép ORM, migration, admin và auth. Nhiều việc hơn mà không được lợi gì rõ rệt.
- **NestJS hoặc Go:** cũng là lựa chọn tốt, nhưng phải tự ghép admin và auth như FastAPI, trong khi Django không có điểm yếu nào mang tính chặn đường cho bài toán này.

## Hệ quả
- Phải giữ kỷ luật tách lớp (services/selectors) để code không dồn hết vào view.
- Phải dùng Celery cho mọi việc nặng; không xử lý nặng ngay trong request.
- Nếu sau này cần realtime (thông báo, cộng tác) thì thêm Django Channels hoặc một service riêng.
