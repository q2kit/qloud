# Tài liệu Qloud

Tài liệu này viết cho **cả người lẫn AI agent**. Đây là nguồn sự thật về sản phẩm, kiến trúc và tiến độ.
Nếu code và docs mâu thuẫn nhau thì đó là bug: phải sửa một trong hai.

## Đọc gì, khi nào

| File | Nội dung | Đọc khi |
|---|---|---|
| [overview.md](overview.md) | Tầm nhìn, phạm vi, thuật ngữ | Lần đầu tiếp cận dự án |
| [ROADMAP.md](ROADMAP.md) | Milestone, task, trạng thái, nhật ký | **Mỗi phiên làm việc** — để biết tiến độ |
| [requirements.md](requirements.md) | Yêu cầu chức năng và phi chức năng | Khi cần biết phạm vi |
| [features/](features/) | Đặc tả từng tính năng: user story, quy tắc, tiêu chí chấp nhận | Trước khi làm một tính năng |
| [architecture.md](architecture.md) | Kiến trúc, công nghệ, luồng chính | Khi thiết kế hoặc code |
| [data-model.md](data-model.md) | Bảng, quan hệ, ràng buộc | Khi động vào database |
| [api.md](api.md) | Quy ước API, danh sách endpoint | Khi làm API hoặc gọi API |
| [ui-ux.md](ui-ux.md) | Hướng thiết kế, danh sách màn hình, i18n, dark mode | Khi làm frontend |
| [conventions.md](conventions.md) | Quy ước code, test, git, CI | Luôn tuân theo |
| [adr/](adr/) | Các quyết định kiến trúc và lý do | Khi thắc mắc "tại sao lại làm thế này" |

## Trạng thái tài liệu

Đầu mỗi file feature có dòng **Trạng thái**, nhận một trong các giá trị:
`Nháp` → `Đã duyệt` → `Đang làm` → `Hoàn thành`.
Chỉ bắt đầu code một feature khi trạng thái của nó là `Đã duyệt`.

**Duyệt theo milestone:** trước task đầu tiên của một milestone, agent nhờ duyệt các file feature mà milestone đó dùng
(comment trên issue của task đầu, label `needs:owner-decision`). Khi được duyệt thì đổi `Nháp` → `Đã duyệt` trong một PR.
Khi bắt đầu code feature thì đổi sang `Đang làm`, khi milestone xong thì `Hoàn thành`.
