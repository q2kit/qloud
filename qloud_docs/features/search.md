# Tìm kiếm (F-SEARCH)

**Trạng thái:** Đang làm · **Milestone:** M6 · **Màn hình:** S-09 và command palette

## User stories
- Tôi muốn gõ một phần tên để tìm nhanh file hoặc folder, kể cả khi gõ không dấu.
- Tôi muốn lọc theo loại file, ngày sửa và người sở hữu.

## Quy tắc
- Phạm vi: các node mình sở hữu, cộng với các node được chia sẻ cho mình (gồm cả cây con), không tính node trong thùng rác.
- Khớp theo tên: không phân biệt hoa thường, **không phân biệt dấu** (dùng extension `unaccent` kết hợp `pg_trgm`). Ví dụ gõ "bao cao" vẫn tìm thấy "Báo cáo".
- Xếp hạng: khớp chính xác trước, rồi khớp ở đầu tên, rồi theo độ tương đồng trigram, cuối cùng theo `updated_at`.
- Bộ lọc `type`: folder, document (pdf, doc, txt…), image, video, audio, archive, other.
- Command palette: debounce 150ms, hiện tối đa 8 kết quả kèm các lệnh nhanh.
- Chưa tìm theo nội dung file trong MVP.

## Tiêu chí chấp nhận
- [x] "bao cao" tìm được "Báo cáo Q3.pdf".
- [x] Không bao giờ trả về node mà mình không có quyền (có test riêng cho điều này).
- [x] Đạt p95 dưới 300ms khi có 100.000 node trong benchmark local bên dưới.

## Phạm vi triển khai M6 — đã duyệt

Owner đã duyệt đặc tả và kế hoạch cho cả M6 trên [#40](https://github.com/q2kit/qloud/issues/40#issuecomment-6111662546). M6-01 và M6-02 đã triển khai, đang chờ review ở hai PR riêng.

### M6-01 — API và chỉ mục
- `GET /api/v1/search` yêu cầu đăng nhập, giữ tham số đã mô tả trong `api.md`: `q`, `type`, `modified_after`, `owner`; bổ sung `cursor`, `page_size` theo quy ước danh sách.
- `q` bắt buộc, bỏ khoảng trắng đầu/cuối, dài 1–255 ký tự. Chuỗi rỗng hoặc tham số lọc không hợp lệ trả 400. `%` và `_` trong tên/từ khóa là ký tự thường, không được coi là wildcard do người dùng cung cấp.
- Phạm vi lấy từ `sharing.permissions.nodes_for(user)`, loại folder gốc và node trong thùng rác. Chia sẻ qua link public không đưa node vào kết quả tìm kiếm của tài khoản.
- Chuẩn hóa tên/từ khóa bằng `lower(unaccent(...))`; hỗ trợ chữ `đ`, chữ hoa và Unicode tiếng Việt. Tìm một phần tên; với từ khóa từ 3 ký tự trở lên bổ sung kết quả gần đúng theo trigram (ngưỡng 0,3). Từ khóa 1–2 ký tự chỉ khớp chuỗi con.
- Thứ tự: tên chuẩn hóa khớp hoàn toàn, khớp đầu tên, độ tương đồng giảm dần, `updated_at` giảm dần, UUID giảm dần để phá hòa. Cursor theo các khóa này, gắn với từ khóa/bộ lọc để không dùng nhầm cursor của tìm kiếm khác.
- `type` nhận một trong `folder`, `document`, `image`, `video`, `audio`, `archive`, `other`; không truyền nghĩa là tất cả. Phân nhóm file theo MIME (document gồm PDF, văn bản, Office/OpenDocument; archive gồm ZIP/RAR/7z/tar/gzip); loại chưa biết thuộc other. File không bị phân loại thành folder chỉ do tên hoặc phần mở rộng.
- `owner=me` chỉ node mình sở hữu, `owner=others` chỉ node của người khác được chia sẻ; không truyền nghĩa là cả hai. `modified_after` nhận datetime ISO 8601 có timezone, lọc `updated_at >=` thời điểm đó.
- Response cursor `{next, previous, results}`; mỗi kết quả có metadata node, owner và quyền hiệu lực cần cho UI, không tải byte hay tiết lộ đường dẫn cha không được chia sẻ. Mặc định 50 mục, tối đa 200; palette dùng `page_size=8`.
- Bật extension `unaccent`, `pg_trgm`; thêm cột tên chuẩn hóa có collation xác định và chỉ mục GIN trigram trên cột này. Trigger DB cập nhật khi tạo/đổi tên (kể cả bulk update), backfill node cũ. Migration đảo ngược được; không đổi tên hiển thị hay quy tắc trùng tên của Drive.
- Test API: chưa đăng nhập/khóa tài khoản, node riêng của người khác, share trực tiếp/thừa kế/thu hồi, thùng rác, Unicode/không dấu, xếp hạng, bộ lọc, cursor nhiều mục đồng hạng, số query không tăng theo số kết quả. Kiểm tra migration trên DB trống và dữ liệu cũ.
- Benchmark trên PostgreSQL thật với 100.000 node, gồm dữ liệu sở hữu và được chia sẻ; ghi môi trường, dữ liệu, các truy vấn đại diện và p95. Mục tiêu dưới 300ms; nếu chưa đạt thì tối ưu và ghi rõ kết quả, không thay bằng một test có mock.

### M6-02 — command palette và trang S-09
- Bật trigger tìm kiếm sẵn có trong header và phím `Ctrl+K`/`⌘K`; dùng dialog, màu và bố cục theo design system hiện tại. Không thêm dependency chính mới.
- Debounce 150ms, tối đa 8 node gợi ý; hủy request từ khóa cũ để response cũ không thay kết quả mới. Có loading, lỗi/thử lại và trạng thái không có kết quả.
- Phím mũi tên chọn gợi ý, Enter mở, Esc đóng, giữ focus đúng và dùng được với trình đọc màn hình. Folder mở link Drive, file mở route viewer hiện có; quyền kiểm tra lại qua API hiện có.
- Lệnh nhanh dùng lại hành động hiện có: tới Drive/Gần đây/Được chia sẻ/Thùng rác/Cài đặt; tạo folder, upload file hoặc folder theo folder hiện tại và khả năng chỉnh sửa. Từ khóa rỗng chỉ hiện lệnh nhanh, không gọi search.
- Enter để xem tất cả kết quả hoặc nút tương ứng mở `/search?q=...`. Trang S-09 lưu từ khóa/bộ lọc trong URL, hỗ trợ reload/back/forward, các bộ lọc loại/ngày sửa/owner và cursor để tải thêm.
- Dùng chung lưới/danh sách và viewer; hiển thị owner/quyền cho mục được chia sẻ, không tạo bản sao dữ liệu server trong Zustand. Giữ i18n vi/en, light/dark và 360px.
- Unit test debounce, hủy response cũ, bàn phím, URL/bộ lọc và phân trang. E2E stack thật tìm không dấu, mở file/folder riêng/được chia sẻ và xác nhận mục không có quyền không xuất hiện; chụp 4 ảnh light/dark, desktop/360px.

### Giao PR
- M6-01 ở một PR riêng, có OpenAPI và type FE được sinh lại, docs/schema/benchmark tương ứng.
- M6-02 ở PR riêng sau API; nếu API chưa merge thì dùng stacked branch theo conventions và ghi rõ dependency.
- Nếu một task vượt mức hợp lý cho một PR, tách task con và issue theo AGENTS.md trước khi mở PR.
- Agent không tự merge; người duyệt từng PR.

## Kiểm chứng M6-01
- 27 test API: Unicode NFC/NFD, đ, ligature dài, wildcard literal, ranking/fuzzy, filter MIME/owner/date, query lỗi, cursor tiến/lùi và đổi scope; share trực tiếp/thừa kế, thu hồi, trash và suspended. Metadata không N+1: tối đa 4 SQL gồm savepoint, chuẩn hóa/threshold, query trang, release.
- Migration 0007 chạy với dữ liệu trống và dữ liệu cũ, backfill, bulk rename và đảo ngược được; test dùng model theo state migration để không phụ thuộc schema mới nhất.
- Lệnh `cd "$(git rev-parse --show-toplevel)/qloud_backend" && uv run python manage.py benchmark_search --samples 30`: PostgreSQL 18.6 aarch64 trong Docker Compose local; 100.000 node tạo cho benchmark (49.999 file sở hữu, 50.000 file thừa kế editor qua một folder shared, cộng folder đó). Corpus luôn rollback. Đo API view và serialization, không gồm mạng HTTP hoặc session lookup; bỏ một lần warmup cho mỗi query, 30 mẫu lấy p95. Đây là kết quả local, không thay đo production.

| Truy vấn | p95 (ms) |
|---|---:|
| bao cao | 226,56 |
| record (khớp rộng) | 244,31 |
| r (một ký tự) | 253,74 |
| missingXYZ | 11,07 |
| bao cao + owner=others + type=document | 176,73 |

## Kiểm chứng M6-02
- Command palette ở header, Ctrl+K/⌘K, focus và bàn phím; tối đa 8 gợi ý sau 150ms. Request cũ được hủy bằng AbortSignal. Từ khóa trống dùng các hành động hiện có và không gọi search.
- Trang `/search` giữ từ khóa, loại, owner và mốc ngày sửa trong URL; mốc ngày lấy 00:00 theo timezone trình duyệt và gửi ISO datetime có timezone. Kết quả giữ thứ tự độ liên quan của API, tải thêm bằng cursor, dùng lưới/danh sách và viewer hiện có. Chỉ mục được chia sẻ hiển thị owner/quyền.
- Unit test kiểm tra debounce/hủy, focus/phím mũi tên/Enter/Esc, lệnh nhanh/modal, URL/back và lỗi/thử lại/phân trang. Chromium stack thật kiểm tra tìm không dấu, mở file/folder sở hữu và share thừa kế, không lộ mục riêng tư, thu hồi quyền, reload/back và bộ lọc.
- Live test headless với dữ liệu tạo qua API, light/dark ở desktop và 360px; ảnh palette và trang kết quả lưu trong `qloud_docs/assets/m6-02-*.png`.
