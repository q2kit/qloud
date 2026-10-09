# UI / UX

> Trạng thái: **Đã duyệt hướng tổng thể** (giao cho agent quyết, 2026-10-09). Chi tiết vẫn có thể điều chỉnh khi làm M0-07.

## Hướng thiết kế (đề xuất)

Mục tiêu: **gọn, yên tĩnh, thao tác nhanh**. Không sao chép bố cục của Google Drive.

- **Tính cách:** tối giản, nhiều khoảng trắng, chữ là trọng tâm, góc bo vừa phải (8px), bóng đổ rất nhẹ.
- **Màu:** nền trung tính hơi ấm (thang stone). Chỉ có **một màu nhấn: teal** (light `#0f766e`, dark `#2dd4bf`), dùng cho hành động chính và trạng thái được chọn.
  Chọn teal để tách khỏi màu xanh dương quen thuộc của Google Drive.
  Ngoài ra có các màu trạng thái: thành công, cảnh báo, lỗi. Mọi màu định nghĩa bằng CSS variable (design token) để làm dark mode.
- **Font:** "Be Vietnam Pro" (giấy phép OFL, hiển thị dấu tiếng Việt đẹp), tự host và chỉ lấy các weight 400, 500, 600. Ở các cột số dùng chữ số có độ rộng đều (tabular figures).
- **Điểm khác biệt so với Drive:**
  - **Command palette (⌘K / Ctrl+K)** thay cho ô tìm kiếm cố định: dùng để tìm file, nhảy tới folder và chạy lệnh (tạo folder, upload…).
  - **Breadcrumb là tiêu đề trang**: kéo thả file vào một mục của breadcrumb là di chuyển file tới đó.
  - **Panel chi tiết bên phải** (bật/tắt bằng phím `i`): thông tin, phiên bản, chia sẻ, hoạt động, tất cả trong một chỗ.
  - **Khay upload** nổi ở góc dưới: hiện tiến độ, tạm dừng/tiếp tục, thử lại.
  - **Phím tắt** cho mọi thao tác chính. Bấm `?` để xem danh sách phím tắt.
- **Component:** shadcn/ui trên nền Radix, được tùy biến theo token của Qloud.
- **Responsive:** trên mobile, sidebar thu thành drawer, panel chi tiết thành bottom sheet, hành động chính là nút nổi "+".

## Bố cục chính (desktop)

```

┌────────────┬──────────────────────────────────────────────┬──────────────┐
│ Qloud      │  Drive của tôi › Dự án › Thiết kế    [⌘K] [+]│              │
│            │──────────────────────────────────────────────│  Chi tiết    │
│ ▸ Drive    │  [Lưới|Danh sách]   Sắp xếp: Tên ▾           │  (bật/tắt)   │
│ ▸ Gần đây  │                                              │              │
│ ▸ Được chia│   📁 Folder A     📁 Folder B                │  Thông tin   │
│   sẻ       │   🖼 photo.jpg    📄 report.pdf               │  Phiên bản   │
│ ▸ Thùng rác│                                              │  Chia sẻ     │
│            │                                              │              │
│ ▓▓▓░ 4/15GB│                                ┌───────────┐ │              │
│ ⚙ Cài đặt  │                                │ Upload 2/5│ │              │
└────────────┴────────────────────────────────┴───────────┴─┴──────────────┘
```

### Hành vi responsive của application shell

- Từ breakpoint `lg`, sidebar rộng 256px cố định bên trái; trên màn hình nhỏ hơn, sidebar mở thành drawer có lớp nền che.
- Header luôn nằm trên cùng, gồm tiêu đề/breadcrumb, tìm kiếm hoặc command palette, hành động tạo mới và nút bật panel chi tiết.
- Panel chi tiết rộng 320px ở desktop lớn (`xl`); trên màn hình nhỏ hơn hiển thị dạng bottom sheet.
- Phím `i` bật/tắt panel chi tiết khi focus không nằm trong ô nhập liệu.
- Màn hình đăng nhập và các trang công khai dùng layout riêng, không hiển thị application shell.

## Danh sách màn hình

| ID | Màn hình | Route | Feature |
|---|---|---|---|
| S-01 | Đăng nhập | `/login` | auth |
| S-02 | Đăng ký | `/signup` | auth |
| S-03 | Xác thực email | `/verify-email/:key` | auth |
| S-04 | Quên / đặt lại mật khẩu | `/password/reset`, `/password/reset/:key` | auth |
| S-05 | Drive của tôi (nội dung một folder) | `/drive`, `/drive/folders/:id` | files-folders |
| S-06 | Gần đây | `/recent` | files-folders |
| S-07 | Được chia sẻ với tôi | `/shared` | sharing |
| S-08 | Thùng rác | `/trash` | trash |
| S-09 | Kết quả tìm kiếm | `/search?q=` | search |
| S-10 | Trình xem file (overlay toàn màn hình) | `?preview=:id` trên route hiện tại | download-preview |
| S-11 | Hộp thoại chia sẻ | modal | sharing |
| S-12 | Trang link công khai (có nút Báo cáo vi phạm) | `/s/:token` | sharing |
| S-13 | Cài đặt: hồ sơ, ngôn ngữ, giao diện, tài khoản liên kết | `/settings` | auth |
| S-14 | Dung lượng | `/settings/storage` | quota |
| S-15 | Trang 404 / không có quyền | `*` | — |

Mỗi màn hình được mô tả chi tiết (trạng thái rỗng, đang tải, lỗi, hành động) trong file feature tương ứng.

## Trạng thái bắt buộc cho mọi màn hình danh sách
- **Đang tải:** khung xương (skeleton), không dùng spinner toàn trang.
- **Rỗng:** có minh họa, lời nhắn và hành động gợi ý (ví dụ "Kéo file vào đây để upload").
- **Lỗi:** thông báo dễ hiểu và nút "Thử lại".
- **Lạc quan (optimistic):** đổi tên, di chuyển, xóa thì cập nhật UI ngay, rồi hoàn tác nếu API báo lỗi.

## i18n
- Ngôn ngữ: `vi` (mặc định) và `en`. Thứ tự ưu tiên khi chọn ngôn ngữ: cài đặt của user, rồi `navigator.language`, rồi `vi`.
- Key đặt theo namespace của feature, ví dụ `drive.actions.rename`, `errors.quota_exceeded`.
- Định dạng ngày, số và dung lượng (KB/MB/GB) theo `Intl` và locale hiện tại.
- Email do BE gửi cũng phải theo ngôn ngữ của user.

## Dark mode
- Có 3 lựa chọn: `system` (mặc định), `light`, `dark`. Lưu vào profile, và cache ở localStorage để tránh trang bị nháy màu khi tải.
- Dùng class `dark` của Tailwind kết hợp CSS variable. Mọi màu phải đi qua token, không viết mã màu trực tiếp.
