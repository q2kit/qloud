# Tổng quan

## Qloud là gì

Qloud là ứng dụng web mã nguồn mở để **lưu trữ, sắp xếp, xem trước và chia sẻ file**.
Mỗi người dùng có không gian lưu trữ riêng, giới hạn theo gói dung lượng. File và thư mục có thể chia sẻ cho người dùng khác
(quyền xem hoặc sửa) hoặc qua link công khai. Upload chia nhỏ và tự tiếp tục khi gián đoạn, nên dùng được với file rất lớn.

## Nguyên tắc thiết kế

- **Mở rộng được mà không phải viết lại:** byte của file đi thẳng giữa trình duyệt và object storage, server ứng dụng stateless,
  phân quyền tập trung ở một lớp duy nhất. Tăng tải bằng cách thêm instance.
- **Không tối ưu sớm:** không làm microservice, sharding hay đa vùng khi chưa có nhu cầu thật.
- **An toàn mặc định:** kiểm tra quyền phía server cho mọi request, không để lộ node mình không có quyền.

## Nền tảng

- Chỉ có web (desktop và mobile browser). Chưa làm app native hay desktop sync client.

## Phạm vi MVP

1. Đăng ký và đăng nhập (email/mật khẩu, Google, GitHub)
2. Upload (chia chunk, tự tiếp tục khi lỗi) và download
3. Thư mục lồng nhau; đổi tên, di chuyển
4. Xem trước ảnh, PDF, video
5. Chia sẻ qua link công khai
6. Chia sẻ cho người dùng khác với quyền xem hoặc sửa
7. Thùng rác và khôi phục
8. Tìm kiếm
9. Quota dung lượng cho mỗi người
10. Lưu nhiều phiên bản của một file

**Chưa nằm trong MVP:** sửa tài liệu trực tuyến, nhiều người cùng sửa, app mobile, desktop sync, thanh toán, mã hóa đầu cuối, quét virus.

## Thuật ngữ

| Thuật ngữ | Nghĩa |
|---|---|
| **Node** | Một mục trong cây thư mục: là *folder* hoặc *file* |
| **Folder** | Node chứa các node khác |
| **File** | Node trỏ tới một hoặc nhiều *version* |
| **Version** | Một lần upload nội dung cho một file. File luôn có đúng một *current version* |
| **Blob** | Object thật nằm trên S3 (key, size, checksum) |
| **Upload session** | Một phiên upload chia chunk (S3 multipart upload), có thể tiếp tục khi bị gián đoạn |
| **Owner** | Người sở hữu node. Dung lượng của node được tính vào quota của owner |
| **Share** | Quyền truy cập trên một node được cấp cho một người dùng khác |
| **Share link** | Link công khai, ai có link cũng truy cập được node |
| **Role** | Mức quyền: `viewer` (xem, tải) hoặc `editor` (thêm, sửa, xóa). Owner có toàn quyền |
| **Trash** | Thùng rác: node bị xóa mềm, có thể khôi phục trong thời hạn quy định |
| **Quota** | Dung lượng tối đa của một người dùng |
