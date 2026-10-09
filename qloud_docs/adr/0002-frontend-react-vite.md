# 0002. Frontend là SPA dùng React + Vite + shadcn/ui

- Trạng thái: Chấp nhận · 2026-10-09

## Quyết định
SPA: Vite, React, TypeScript, React Router, TanStack Query, Zustand, Tailwind CSS + shadcn/ui (Radix), i18next.

## Lý do
- Ứng dụng nằm gần như hoàn toàn sau đăng nhập, rất tương tác, không cần SSR hay SEO. SPA build ra file tĩnh, nginx phục vụ, không cần server Node.
- shadcn/ui để code component trong repo, tùy biến hoàn toàn; Radix lo trợ năng; Tailwind + CSS variable cho dark mode.
  Ant Design/MUI mang đậm phong cách của thư viện, khó làm giao diện riêng.

## Hệ quả
- Tự xây design token và các component phức tạp (lưới file có virtualization, khay upload).
- API client sinh từ OpenAPI, nên BE phải giữ schema chính xác.
