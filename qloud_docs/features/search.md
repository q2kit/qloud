# Tìm kiếm (F-SEARCH)

**Trạng thái:** Nháp · **Milestone:** M6 · **Màn hình:** S-09 và command palette

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
- [ ] "bao cao" tìm được "Báo cáo Q3.pdf".
- [ ] Không bao giờ trả về node mà mình không có quyền (có test riêng cho điều này).
- [ ] Đạt p95 dưới 300ms khi có 100.000 node.
