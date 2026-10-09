# 0002. Frontend dùng React + Vite + shadcn/ui

- Trạng thái: Chấp nhận
- Ngày: 2026-10-09

## Bối cảnh
Chủ dự án chọn React. Ứng dụng nằm hoàn toàn sau màn hình đăng nhập, rất tương tác (kéo thả, chọn nhiều, upload nền), và không cần SEO.
Cần i18n và dark mode. Giao diện phải mang bản sắc riêng.

## Quyết định
SPA dùng Vite + React + TypeScript; React Router; TanStack Query; Zustand; Tailwind CSS + shadcn/ui (Radix); i18next.

## Lý do và các phương án đã cân nhắc
- **SPA thay vì Next.js:** không cần SSR hay SEO (chỉ có trang link công khai, và trang này cũng không cần SEO).
  SPA build ra file tĩnh, host được ở bất kỳ đâu (hiện tại do nginx trên VPS phục vụ), không cần chạy server Node.
- **shadcn/ui:** code của component nằm ngay trong repo nên tùy biến hoàn toàn được, tránh bị "trông giống mọi app MUI/Ant khác".
  Radix lo phần trợ năng (a11y). Tailwind kết hợp CSS variable giúp làm dark mode dễ.
- **Ant Design / MUI:** nhanh nhưng mang đậm phong cách riêng của thư viện, khó làm ra giao diện mang bản sắc của Qloud.

## Hệ quả
- Phải tự xây design tokens và một số component phức tạp (lưới file có virtualization, khay upload).
- API client được sinh từ OpenAPI, nên BE phải giữ schema chính xác.
