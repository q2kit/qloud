# Download và xem trước (F-VIEW)

**Trạng thái:** Nháp · **Milestone:** M2 (download), M3 (xem trước) · **Màn hình:** S-10

## User stories
- Tôi muốn tải một file về máy.
- Tôi muốn xem nhanh ảnh, PDF hoặc video ngay trong trình duyệt, và chuyển sang file trước hoặc sau.
- Tôi muốn thấy thumbnail của ảnh và PDF ở chế độ lưới.

## Quy tắc
- Download: BE trả presigned GET URL có hạn 5 phút, với `Content-Disposition: attachment; filename*=UTF-8''...` để giữ đúng tên tiếng Việt.
- Xem trước: presigned URL với `inline`. **Không bao giờ để trình duyệt render inline các loại có thể chạy script** (HTML, SVG, XML).
  Với những loại này, BE ép `Content-Type: application/octet-stream` và chỉ cho phép tải về.
- Các loại hỗ trợ xem trước:
  - Ảnh: jpg, png, gif, webp, avif (riêng heic có thể chưa hỗ trợ)
  - PDF: dùng pdf.js
  - Video: mp4/webm, phát bằng thẻ `<video>` gốc của trình duyệt, tua được nhờ S3 hỗ trợ Range. Không transcode.
  - Âm thanh: mp3, wav, ogg
  - Văn bản thuần, nhỏ hơn 1 MB: txt, md, json, csv, code — hiển thị dạng text an toàn, không render
- Thumbnail: Celery tạo ảnh webp, cạnh dài 256px và 1024px, cho ảnh và trang đầu của PDF; lưu tại `thumbs/{version_id}/{size}.webp`.
  Thumbnail **không tính vào quota**. Nếu tạo lỗi thì hiện icon theo loại file.
- Tải nhiều file hoặc tải cả folder dạng zip: **chưa có trong MVP** (cần worker riêng để nén). Ghi chú để làm sau.

## Tiêu chí chấp nhận
- [ ] Tải file có tên tiếng Việt có dấu thì giữ đúng tên.
- [ ] Mở trình xem: dùng được phím ←/→ để chuyển file, Esc để đóng, nút Tải xuống.
- [ ] Video 2 GB tua được ngay, không phải chờ tải hết.
- [ ] File HTML hoặc SVG không bị render inline.
- [ ] URL hết hạn sau 5 phút.
