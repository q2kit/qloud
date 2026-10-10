# UI / UX

> Trạng thái: **Đã duyệt**. Đổi hướng thiết kế (design system, màu, bố cục tổng thể) phải hỏi trước (AGENTS.md mục 4).

## Hướng thiết kế

Mục tiêu: **gọn, yên tĩnh, thao tác nhanh**.

- **Tính cách:** tối giản, nhiều khoảng trắng, chữ là trọng tâm, góc bo vừa phải (8px), bóng đổ rất nhẹ.
- **Màu:** nền trung tính hơi ấm (thang stone). Chỉ có **một màu nhấn: teal** (light `#0f766e`, dark `#2dd4bf`), dùng cho hành động chính và trạng thái được chọn.
  Ngoài ra có các màu trạng thái: thành công, cảnh báo, lỗi. Mọi màu định nghĩa bằng CSS variable (design token) để làm dark mode.
- **Font:** "Be Vietnam Pro" (giấy phép OFL, hiển thị dấu tiếng Việt đẹp), tự host và chỉ lấy các weight 400, 500, 600. Ở các cột số dùng chữ số có độ rộng đều (tabular figures).
- **Điểm nhấn trong trải nghiệm:**
  - **Command palette (⌘K / Ctrl+K)** thay cho ô tìm kiếm cố định: dùng để tìm file, nhảy tới folder và chạy lệnh (tạo folder, upload…).
  - **Breadcrumb là tiêu đề trang**: kéo thả file vào một mục của breadcrumb là di chuyển file tới đó.
  - **Panel chi tiết bên phải** (bật/tắt bằng phím `i`): thông tin, phiên bản, chia sẻ, hoạt động, tất cả trong một chỗ.
  - **Khay upload** nổi ở góc dưới: hiện tiến độ, tạm dừng/tiếp tục, thử lại.
  - **Phím tắt** cho mọi thao tác chính. Bấm `?` để xem danh sách phím tắt.
- **Biểu tượng:** chữ Q trắng trên ô teal bo góc (`qloud_frontend/public/`: `favicon.svg`, `favicon.ico` 16+32px cho trình duyệt cũ, `apple-touch-icon.png` 180px không bo góc vì iOS tự bo).
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
- Header luôn nằm trên cùng, gồm tiêu đề, tìm kiếm hoặc command palette, menu "Tạo mới" (Thư mục mới, Tải tệp lên), nút bật panel chi tiết và menu tài khoản (đăng xuất).
  Tiêu đề header lấy theo route đang mở (`handle.titleKey` của route, ví dụ Drive, Gần đây, Thùng rác, 404).
- Trang Drive (S-05): breadcrumb nằm đầu nội dung trang và là tiêu đề trang, mục cuối (folder hiện tại) là `<h1>`. Trên màn hình hẹp, các folder ở giữa thu thành "…".
  Vùng nội dung folder giãn hết chiều cao còn lại dưới header (trừ padding trang); vùng trống tới đáy nhận drop upload và kéo chọn. Double click chỉ bật trên desktop có chuột/hover (`(hover: hover) and (pointer: fine)`): vùng trống bên dưới thanh công cụ mở modal tạo thư mục con trong folder đang xem, item thì mở item. Trên thiết bị cảm ứng, chọn item rồi dùng nút/menu Mở/Tải xuống; tạo folder bằng menu/nút hiện có. Bàn phím giữ Enter và các thao tác hiện có.
  Nội dung các trang trong app shell giãn theo chiều rộng khả dụng, giữ giới hạn chiều rộng riêng của từng trang; trang Cài đặt không tràn ngang ở 360px khi main dùng flex để giãn chiều cao Drive.
  `/` chuyển sang `/drive`. Id trong URL là UUID bỏ dấu gạch (`/drive/folders/01a1261573fd7134b1948c39b526fe9e`).
- Panel chi tiết rộng 320px ở desktop lớn (`xl`); trên màn hình nhỏ hơn hiển thị dạng bottom sheet.
- Phím `i` bật/tắt panel chi tiết. Phím bị bỏ qua khi focus nằm trong ô nhập liệu, trong menu hoặc listbox (dùng chữ cái để nhảy tới mục), trong một hộp thoại khác (ví dụ drawer điều hướng), khi giữ phím (auto-repeat) hoặc khi sự kiện đã được xử lý. Trong bottom sheet chi tiết, `i` đóng sheet.
- Màn hình đăng nhập và các trang công khai dùng layout riêng, không hiển thị application shell. Các màn hình auth (S-01 đến S-04) là một card ở giữa, rộng tối đa 384px.
- Lỗi khi hiển thị bất kỳ route nào: trang lỗi đã dịch (`routeError.*`), có nút tải lại trang và nút về Drive, thay cho màn hình lỗi tiếng Anh mặc định của React Router.

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
- `<meta name="theme-color">` (màu thanh trình duyệt trên mobile) theo theme đã phân giải, đặt ngay từ script chạy trước khi vẽ trang. Đây là chỗ duy nhất phải lặp mã màu (`--background`), vì thẻ meta không đọc được CSS variable.
- Đổi theme ở một tab thì các tab khác đang mở cũng đổi theo (sự kiện `storage`).

### S-06 — Gần đây (M2-09)
- Dùng chung `FileBrowser`/`NodeCollection` với S-05; Được chia sẻ và Thùng rác sẽ dùng cùng core khi triển khai. Trang cấp dữ liệu và action theo ngữ cảnh.
- File của mình cập nhật gần nhất từ mọi folder, tối đa 100, thứ tự mới nhất cố định. Lưới/danh sách nhớ chung với Drive; chọn và bàn phím như Drive, double click chỉ desktop có chuột/hover.
- Một file: Tải xuống, Mở thư mục chứa tệp, Thông tin. Loading/rỗng/lỗi và Thử lại dùng chung core. Không tạo folder bằng double click vùng trống, không kéo item để di chuyển/nhận drop upload tại nội dung Gần đây. Header Tạo mới vẫn trỏ Drive gốc.
- Mở thư mục chứa tệp từ menu file (Drive/Gần đây) dùng link folder cha với `?select=<UUID-file-không-dấu-gạch>`. Drive kiểm tra file còn ở đúng folder và có quyền, tải tiếp trang cursor tới file, chọn/highlight, cuộn tới và focus item cả khi virtualize. Reload link vẫn chọn file; Esc/click vùng trống bỏ chọn bình thường. Link tới file đã chuyển/xóa/không có quyền báo không tìm thấy, không tự chuyển sang folder khác.
