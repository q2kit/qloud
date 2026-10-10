# Folder và file (F-NODE)

**Trạng thái:** Đang làm · **Milestone:** M2 · **Màn hình:** S-05, S-06

Duyệt ở [#17](https://github.com/q2kit/qloud/issues/17). M2-02: API folder/node (xem [api.md › Node](../api.md#node)). M2-01: model `Node` đầy đủ, `drive.names.normalize_name()` cho quy tắc tên, và tầng phân quyền `sharing.permissions` (xem [architecture.md › Phân quyền](../architecture.md#phân-quyền)).

## User stories
- Tôi muốn tạo folder lồng nhau để sắp xếp file.
- Tôi muốn xem nội dung folder ở dạng lưới hoặc danh sách, và sắp xếp theo tên, ngày sửa hoặc kích thước.
- Tôi muốn đổi tên và di chuyển file hoặc folder, kể cả nhiều mục cùng lúc.
- Tôi muốn thấy breadcrumb và nhảy nhanh tới folder cha.
- Tôi muốn xem danh sách file gần đây.

## Quy tắc nghiệp vụ
- Tên: 1–255 ký tự, không chứa `/` hay ký tự điều khiển; bỏ khoảng trắng ở đầu và cuối. Tên không được là `.` hoặc `..`.
- Trong một folder, tên là duy nhất (không phân biệt hoa thường, không tính các node trong thùng rác).
  - **Tạo folder hoặc đổi tên** bị trùng thì trả lỗi 409 `name_conflict`.
  - **Upload** bị trùng tên: hỏi người dùng *Thay thế* (tạo phiên bản mới, xem versioning), *Giữ cả hai* (tự thêm hậu tố ` (1)`) hoặc *Bỏ qua*.
  - **Di chuyển** bị trùng tên: tự thêm hậu tố ` (n)` **trước phần mở rộng** của file, n nhỏ nhất chưa trùng:
    `report.pdf` → `report (1).pdf`; folder và file không có phần mở rộng (`Docs`, `.env`) thì thêm vào cuối. Tên dài thì cắt bớt để không quá 255 ký tự.
  - Folder gốc không đổi tên, không di chuyển được (400 `root_folder`).
- Di chuyển: không được chuyển một folder vào chính nó hoặc vào cây con của nó (lỗi 400 `invalid_move`). Cần quyền `editor` trên cả nguồn lẫn đích.
  Di chuyển giữa hai cây của hai owner khác nhau thì **không đổi owner** của node (MVP chỉ cho phép trong cùng owner — cần xác nhận khi làm phần sharing).
- Mặc định folder xếp trước file, sau đó theo tên (natural sort: "file2" đứng trước "file10").
  Sắp xếp bằng collation ICU `natural` của PostgreSQL (`und-u-kn-true`): số theo giá trị, không phân biệt hoa thường và dấu ở mức đầu (`a, anh, Ảnh, B, File1, file2, file10`).
- Di chuyển nhiều node chạy trong một transaction và khóa theo owner, nên hai lệnh di chuyển chéo nhau chạy cùng lúc không tạo được vòng.
- Gần đây: các file do mình sở hữu hoặc được chia sẻ, sắp theo thời điểm sửa hoặc upload gần nhất của mình, tối đa 100 mục.

## Tương tác UI
- Chọn: click; Ctrl/⌘+click để chọn thêm; Shift+click để chọn một dải; Ctrl/⌘+A để chọn tất cả.
- Menu chuột phải và menu "⋯": Mở, Xem trước, Tải xuống, Chia sẻ, Đổi tên (F2), Di chuyển, Thông tin (i), Xóa (Delete).
- Kéo thả node vào một folder hoặc một mục trong breadcrumb để di chuyển.
- Danh sách cuộn vô hạn (dùng cursor) và dùng virtualization khi có trên 200 mục.

## Tiêu chí chấp nhận
- [ ] Tạo folder lồng nhau 3 cấp; breadcrumb hiển thị đúng; reload trang vẫn đúng.
- [ ] Đổi tên trùng thì báo lỗi; di chuyển vào cây con thì bị chặn.
- [ ] Di chuyển 50 mục cùng lúc chỉ tốn một request, và UI cập nhật kiểu lạc quan.
- [ ] Folder 10.000 mục vẫn cuộn mượt; API đạt NF-01.
- [ ] Người không có quyền nhận 404 với mọi endpoint của node.
