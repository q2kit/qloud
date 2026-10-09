# Tổng quan

## Qloud là gì

Qloud là ứng dụng web để **lưu trữ, sắp xếp, xem và chia sẻ file**.
Về chức năng thì cùng loại với Google Drive, nhưng giao diện và trải nghiệm được thiết kế riêng, không sao chép.

## Mục tiêu

- **Giai đoạn 1 (hiện tại):** dùng miễn phí cho một nhóm nhỏ bạn bè. Cần ổn định, an toàn và dễ dùng.
- **Giai đoạn sau:** thương mại hóa (gói trả phí theo dung lượng) và mở rộng lên số lượng người dùng lớn.

Vì vậy, hệ thống được **thiết kế từ đầu để mở rộng được**: storage tách riêng, server stateless, phân quyền tập trung.
Nhưng **chưa tối ưu sớm**: không làm microservice, sharding hay đa vùng khi chưa có nhu cầu thật.

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
