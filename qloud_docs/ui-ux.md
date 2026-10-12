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
  Vùng nội dung folder giãn hết chiều cao còn lại dưới header (trừ padding trang); vùng trống tới đáy nhận drop upload và kéo chọn. Double click chỉ bật trên desktop có chuột/hover (`(hover: hover) and (pointer: fine)`): vùng trống bên dưới thanh công cụ mở modal tạo thư mục con trong folder đang xem, item thì mở item. Trên thiết bị cảm ứng, dùng Mở/Tải xuống trong menu “⋯” của item; tạo folder bằng menu/nút hiện có. Bàn phím giữ Enter và các thao tác hiện có.
  Thao tác với mục (Mở, Tải xuống, Đổi tên, Di chuyển, Chia sẻ, Chuyển vào thùng rác, Khôi phục, Xóa vĩnh viễn…) chỉ nằm trong menu của item: chuột phải, nút “⋯”, Shift+F10, cùng phím tắt và panel chi tiết. Thanh công cụ phía trên danh sách chỉ có sắp xếp và chế độ xem; không hiện nút thao tác hay số mục đã chọn, số mục đã chọn chỉ được đọc cho trình đọc màn hình (`aria-live`). Hàng tiêu đề Drive chỉ có breadcrumb.
  Nội dung các trang trong app shell giãn theo chiều rộng khả dụng, giữ giới hạn chiều rộng riêng của từng trang; trang Cài đặt không tràn ngang ở 360px khi main dùng flex để giãn chiều cao Drive.
  `/` chuyển sang `/drive`. Id trong URL là UUID bỏ dấu gạch (`/drive/folders/01a1261573fd7134b1948c39b526fe9e`).
- Panel chi tiết rộng 320px ở desktop lớn (`xl`); trên màn hình nhỏ hơn hiển thị dạng bottom sheet.
- Phím `i` bật/tắt panel chi tiết. Phím bị bỏ qua khi focus nằm trong ô nhập liệu, trong menu hoặc listbox (dùng chữ cái để nhảy tới mục), trong một hộp thoại khác (ví dụ drawer điều hướng), khi giữ phím (auto-repeat) hoặc khi sự kiện đã được xử lý. Trong bottom sheet chi tiết, `i` đóng sheet.
- Màn hình đăng nhập và các trang công khai dùng layout riêng, không hiển thị application shell. Các màn hình auth (S-01 đến S-04) là một card ở giữa, rộng tối đa 384px.
- Lỗi khi hiển thị bất kỳ route nào: trang lỗi đã dịch (`routeError.*`), có nút tải lại trang và nút về Drive, thay cho màn hình lỗi tiếng Anh mặc định của React Router.

### Tab Phiên bản (M7-03)

Trong panel chi tiết, Thông tin/Phiên bản có thể đổi bằng click hoặc mũi tên/Home/End; đổi lựa chọn luôn về Thông tin. Chỉ một file còn sống mới bật Phiên bản. Danh sách card nhỏ cuộn trong panel/bottom sheet, có số version, nhãn Hiện tại/Giữ mãi, thời gian/dung lượng, tên gốc/MIME và uploader. Tải thêm theo cursor; skeleton/rỗng/lỗi có Thử lại. Hành động tải cho viewer, restore cho editor/owner, delete cho owner; current không có restore/delete. Restore/delete có hộp xác nhận và focus quay lại hành động hoặc danh sách khi phiên bản đã xóa. Nội dung/thao tác co ở 360px, chuỗi vi/en và màu token. Chi tiết: [versioning.md](features/versioning.md#m7-03--tab-phiên-bản).

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
| S-10 | Trình xem file (overlay toàn màn hình) | `?preview=:id` trên Drive/Gần đây; link riêng `/drive/files/:id` resolve folder hiện tại; nếu không có quyền folder cha thì mở viewer độc lập | download-preview |
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
- Dùng chung `FileBrowser`/`NodeCollection` với S-05; Được chia sẻ và Thùng rác dùng cùng core. Trang cấp dữ liệu và action theo ngữ cảnh.
- File của mình cập nhật gần nhất từ mọi folder, tối đa 100, thứ tự mới nhất cố định. Lưới/danh sách nhớ chung với Drive; chọn và bàn phím như Drive, double click chỉ desktop có chuột/hover.
- Một file: Tải xuống, Mở thư mục chứa tệp, Thông tin. Loading/rỗng/lỗi và Thử lại dùng chung core. Không tạo folder bằng double click vùng trống, không kéo item để di chuyển/nhận drop upload tại nội dung Gần đây. Header Tạo mới vẫn trỏ Drive gốc.
- Mở thư mục chứa tệp chỉ có ở Gần đây, dùng link folder cha với `?select=<UUID-file-không-dấu-gạch>`. Drive kiểm tra file còn ở đúng folder và có quyền, tải tiếp trang cursor tới file, chọn/highlight, cuộn tới và focus item cả khi virtualize. Reload link vẫn chọn file; Esc/click vùng trống bỏ chọn bình thường. Link tới file đã chuyển/xóa/không có quyền báo không tìm thấy, không tự chuyển sang folder khác.
- Menu “⋯” chọn item và mở sau khi click hoàn tất (đã thả con trỏ), tránh mouseup kích hoạt nhầm action khi toolbar đổi chiều cao giữa các vùng chọn. Chuột phải và mở menu bằng bàn phím giữ hành vi hiện có.

### S-08 — Thùng rác (M4-03)

Trang `/trash` dùng chung FileBrowser/NodeCollection với Drive: lưới/danh sách, sắp xếp,
phân trang cursor, chọn nhiều, menu chuột phải/nút ⋯. Các action là Khôi phục và Xóa vĩnh viễn;
header có Dọn sạch thùng rác. Xóa vĩnh viễn/dọn sạch mở hộp thoại xác nhận, focus ở Hủy;
lỗi API giữ hộp thoại và dữ liệu để thử lại. File có thumbnail ảnh/PDF/MP4 trong grid/list; thiếu/lỗi dùng icon. Không mở preview nội dung/download trong Trash.

Drive có action Chuyển vào thùng rác cho một/nhiều mục trong menu của item. Mục rời danh sách
ngay khi gửi request; thất bại thì rollback cache và giữ lại selection. Toast ở layout chung
hiển thị Đã chuyển vào thùng rác + Hoàn tác trong khoảng 8 giây, tồn tại qua chuyển trang.
Hoàn tác dùng root nhóm server trả về; lỗi hiển thị thông báo cho phép thử lại/khôi phục từ trang trash.
Mỗi request chọn tối đa 1.000 mục, theo giới hạn API. Đủ i18n vi/en, light/dark, responsive 360px.

### S-07, S-11, S-12 — Chia sẻ (M5-05)

- Được chia sẻ dùng lưới/danh sách và cursor chung Drive, thêm tên owner và quyền thực tế. Mở file qua route riêng, folder qua Drive; không nhận drop upload ở danh sách này.
- Hộp thoại Chia sẻ mở từ menu của một mục có quyền hoặc từ panel chi tiết. Hai phần Người có quyền truy cập và Link công khai; email/role, danh sách grant, hạn dùng tùy chọn, copy và thu hồi. Hộp thoại cuộn trong 90dvh, co tới 360px; Esc/Đóng trả focus về nơi mở.
- Trang public dùng PublicLayout với ngôn ngữ/theme, chỉ xem/download. Link file và link folder dùng cùng bố cục: tên (`<h1>`), nút Báo cáo vi phạm, thanh chọn dạng lưới/danh sách và FileBrowser (thumbnail). Link file chỉ có một card là file đó và không có sắp xếp; mở link thì viewer toàn màn hình tự mở, đóng về trang này. Folder có thêm sắp xếp và breadcrumb giới hạn trong cây. Không có dòng mô tả phạm vi link. Menu thao tác hoạt động ngay cả khi chưa chọn mục. Link không còn hợp lệ hiện “Nội dung không còn khả dụng”. Báo cáo vi phạm triển khai cùng M5-07.


### Báo cáo và kiểm duyệt — M5-07
S-12 thêm nút “Báo cáo vi phạm” cho folder hiện tại hoặc file của link file; viewer file có nút cờ báo cáo đúng file đang xem. Modal dùng select lý do, textarea mô tả, email liên hệ và Turnstile; đang gửi khóa thao tác, thành công có xác nhận, lỗi quota/404/captcha có thông báo dịch. Dùng cùng dialog, button, màu và layout responsive hiện có.

Route `/moderation` trong app shell chỉ cho superuser (flag `/me.is_superuser`), navigation kiểm duyệt chỉ hiện khi có quyền. User thường truy cập URL trực tiếp thấy trang 404 (S-15) và không gọi API báo cáo. Desktop dùng hai cột danh sách–chi tiết; hàng được chọn có viền rõ, badge trạng thái và số report cùng node. Mobile 360px chuyển danh sách → chi tiết với nút quay lại. Danh sách lọc trạng thái/node và tải thêm theo cursor. Chi tiết gồm nội dung, thời gian/mã report, liên hệ, node bị báo cáo, node gốc link, loại/kích thước/MIME, owner tên/email/trạng thái và trạng thái link hiện tại. Đích đã xóa hiện rõ, UUID/tên snapshot vẫn giữ. Mục report cùng node hiện tổng/đang mở và nút xem tất cả (bỏ filter status, giữ phân trang); giải thích mỗi report được xử lý riêng. Audit hiện người/thời gian/ghi chú và kết quả thực tế (link mới bị gỡ, owner mới bị khóa hoặc không có thay đổi mới). Report open có chọn action, giải thích phạm vi, ghi chú bắt buộc và bước xác nhận. Xử lý xong hiện audit, không còn form. Hỗ trợ light/dark, vi/en và 360px; `/admin/` của Django giữ chức năng đọc audit.

### Tìm kiếm và command palette (M6)
- Header mở bảng lệnh bằng nút tìm kiếm hoặc Ctrl+K/⌘K. Từ khóa trống hiện điều hướng nhanh và hành động tạo/upload theo quyền của folder hiện tại. Khi một dialog khác đang mở, shortcut không mở thêm bảng lệnh.
- Nhập từ khóa: debounce 150ms, tối đa 8 gợi ý và mục “Xem tất cả kết quả”; dùng ↑/↓ để chọn, Enter để mở, Esc để đóng và trả focus về điểm mở. Dialog có loading, lỗi/thử lại và trạng thái rỗng.
- S-09 giữ từ khóa, loại, người sở hữu và ngày sửa trong URL; dùng lưới/danh sách chung. API xếp theo độ liên quan, UI giữ nguyên thứ tự đó. File mở viewer, folder mở Drive; mục được chia sẻ hiện owner/quyền, dữ liệu được tải thêm bằng cursor.

M7-04: tab Phiên bản thêm nút Giữ mãi/Bỏ giữ mãi cho owner, cả current và bản cũ; nút có `aria-pressed`, khóa trong lúc gửi và chỉ cập nhật sau thành công. Viewer/editor chỉ thấy nhãn Giữ mãi. Hướng thiết kế và vị trí panel giữ nguyên.
