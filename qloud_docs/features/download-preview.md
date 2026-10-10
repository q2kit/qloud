# Download và xem trước (F-VIEW)

**Trạng thái:** Đang làm · Download M2 đã hoàn thành; phần xem trước M3 và kế hoạch M3-01 được duyệt tại [#27](https://github.com/q2kit/qloud/issues/27#issuecomment-6101912543) · **Milestone:** M2 (download), M3 (xem trước) · **Màn hình:** S-10

## User stories
- Tôi muốn tải một file về máy.
- Tôi muốn xem nhanh ảnh, PDF hoặc video ngay trong trình duyệt, và chuyển sang file trước hoặc sau.
- Tôi muốn thấy thumbnail của ảnh và PDF ở chế độ lưới.

## Quy tắc
- Download: BE trả presigned GET URL có hạn 5 phút, với `Content-Disposition: attachment; filename*=UTF-8''...` để giữ đúng tên tiếng Việt.
  M2-05 (`GET /nodes/{id}/download` → `{url, expires_at}`, `drive.downloads`):
  - cần quyền xem; file trong thùng rác hoặc không có quyền thì 404; folder thì 400 `not_a_file`;
  - tên file là tên **hiện tại** của node, nội dung là phiên bản hiện tại (phiên bản cũ: M7-02);
  - tải về cũng ép `application/octet-stream` cho loại chạy được script (HTML, SVG, XML, `*+xml`, JavaScript).
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

## Ghi chú cho M3
### M3-01 — thumbnail ảnh/PDF
- Task `drive.tasks.generate_thumbnail` được enqueue qua `transaction.on_commit` sau upload của loại được hỗ trợ; nguồn chỉ được đọc bởi worker Celery, upload/download của người dùng vẫn đi thẳng tới S3.
- Pillow xử lý JPEG, PNG, GIF, WebP, AVIF; chỉ frame đầu ảnh động, sửa hướng EXIF, giữ tỷ lệ và không phóng to ảnh nhỏ. pypdfium2 render trang đầu PDF trực tiếp ở độ phân giải cạnh dài 1024px.
- Hai WebP được ghi vào `thumbs/{version_id}/1024.webp` và `thumbs/{version_id}/256.webp`. Chỉ sau khi ghi đủ cả hai, cập nhật `Node.thumbnail_key` thành key 256px nếu version vẫn hiện hành và node chưa vào thùng rác. Không đổi quota hoặc `updated_at` của file (không làm xáo trộn Gần đây).
- Gọi lại an toàn: key cố định theo version, task bỏ qua version đã có thumbnail, đã mất, đã thay thế hoặc trong thùng rác. Lỗi S3 tạm thời retry tối đa 3 lần với backoff, tối đa 60 giây; lỗi giải mã, file không hỗ trợ/PDF mã hóa dùng icon dự phòng. Ghi S3 dở dang không được công bố, có thể được ghi lại khi retry.
- Giới hạn được owner duyệt: `THUMBNAIL_MAX_SOURCE_BYTES=104857600` (100 MiB), `THUMBNAIL_MAX_PIXELS=40000000`, `THUMBNAIL_SOFT_TIME_LIMIT=60`, `THUMBNAIL_TIME_LIMIT=90` (giây). Nguồn quá giới hạn thì bỏ thumbnail; S3 read kiểm tra cả Content-Length và số byte thực đọc. PDF chỉ render trang đầu theo kích thước đầu ra. Celery prefork thực thi timeout; eager test không mô phỏng hard timeout.
- Broker không nhận task thì ghi log và giữ upload thành công, dùng icon dự phòng; không hứa tự tạo lại thumbnail cho trường hợp chưa enqueue được. Task có thể được enqueue lại theo version id khi vận hành.
- M3-02 cấp URL preview/thumbnail; M3-03 hiển thị thumbnail và trình xem. M3-01 chưa đổi API hoặc UI.

### M3-02 — API preview
- Hợp đồng API được duyệt tại [#28](https://github.com/q2kit/qloud/issues/28#issuecomment-6102279503).
- `GET /nodes/{id}/preview` trả `{kind, url, expires_at, thumbnail}`; cần quyền xem, chỉ file còn sống và phiên bản hiện hành. Không thấy/không có quyền/đã vào thùng rác trả 404; folder trả 400 `not_a_file`.
- `kind`: `image`, `pdf`, `video`, `audio`, `text`, `unsupported`. Loại không hỗ trợ trả 200 với `url`, `expires_at`, `thumbnail` bằng null; tải qua endpoint download hiện có.
- Ảnh JPEG/PNG/GIF/WebP/AVIF, PDF, video MP4/WebM, audio MPEG (MP3)/WAV/OGG được cấp presigned URL inline 5 phút. MIME chuẩn hóa từ current version, không đoán từ tên file; Content-Disposition giữ tên node hiện tại.
- Text nhỏ hơn **1.000.000 byte**, MIME trong allowlist, được ép `text/plain` để FE hiển thị text an toàn: `text/plain`, `text/markdown`, `text/x-markdown`, `text/csv`, `application/json`, `text/x-python`, `text/x-c`, `text/x-c++`, `text/x-java-source`, `text/x-go`, `text/x-rust`, `text/x-shellscript`, `application/x-sh`, `application/x-python-code`, `text/css`, `text/x-typescript`, `application/typescript`. Không cấp URL preview cho HTML/SVG/XML/JavaScript, mọi MIME `*+xml` hoặc chứa `javascript`, và các MIME ngoài allowlist.
- `thumbnail` là null nếu chưa có cặp ảnh của current version; khi có là `{url, large_url, expires_at}` cho WebP 256/1024px inline 5 phút. Không gọi worker hoặc đọc nguồn trong request; không cấp URL từ key cũ của version khác. FE có thể dùng icon và gọi lại sau khi worker hoàn thành.
- Video đi trực tiếp S3 và giữ Range (206) để tua; integration test xác minh byte range, chưa kiểm thử UI tua video 2 GB (thuộc M3-03). API không làm thumbnail hiển thị trên web; chưa có thay đổi UI ở M3-02.

### M3-03 — trình xem và thumbnail
- Kế hoạch được duyệt tại [#29](https://github.com/q2kit/qloud/issues/29#issuecomment-6102467202), gồm bổ sung thumbnail ở **cả grid và list children**, áp dụng cho Drive/Gần đây.
- Double click trên desktop, Enter hoặc nút Xem trước mở overlay toàn màn hình qua `?preview=:id`; nút Tải xuống tách riêng. ←/→ và nút trước/sau đi theo thứ tự danh sách, bỏ folder, tải tiếp cursor khi cần. Phím điều khiển media/PDF/input được giữ cho control đó. Esc/nút đóng, Back/Forward và khôi phục focus được hỗ trợ.
- Thumbnail chỉ fetch cho ảnh/PDF trong viewport, lazy image; dùng icon nếu chưa có/lỗi. Query chung theo id/updated_at, polling mỗi 5 giây tối đa 6 lần thêm khi chưa có thumbnail; dừng khi rời viewport hoặc hết lượt. URL có thumbnail được refresh trước hạn 30 giây, query stale sau 210 giây.
- Viewer refresh URL nguồn trước hạn 30 giây; loading/lỗi/thử lại và trạng thái không hỗ trợ có bản dịch vi/en. Ảnh dùng img; video/audio native controls và preload metadata; text đọc trực tiếp S3 và chèn text vào pre, không HTML/Markdown render. Khi đóng/đổi file, source fetch/PDF task/media được hủy hoặc dừng.
- Lifecycle video/audio gán nguồn trong setup và giải phóng trong cleanup, bao gồm vòng setup/cleanup/setup của React StrictMode ở dev. Test Chromium gồm cả production build và Vite dev (`PREVIEW_DEV=1`), xác minh src, metadata, phát audio/video và tua Range; CI chạy thêm hai luồng media trên Vite dev ở desktop/360px.
- PDF dùng pdf.js 6.4, canvas từng trang, chọn trang/zoom/fit chiều rộng; không dựng mọi trang cùng lúc. Worker, CMap/font/WASM được build/host trong app, không dùng CDN. Không có annotation/action/scripting layer thực thi script hay liên kết trong PDF.
- Link `/drive/files/:id` (UUID compact) resolve node và folder hiện tại, rồi mở overlay ở folder đó, nên vẫn đúng sau khi file di chuyển. Copy link/tab mới/middle click/Ctrl hoặc ⌘+Enter dùng route này cho file. Gần đây dùng cùng viewer và link.

### Link riêng cho file
- **Link riêng cho file**, giống folder (M2-07b):
  - lưu lại hoặc mở ở tab khác thì ra đúng file đó trong trình xem;
  - middle click, Ctrl/⌘+Enter và mục "Mở trong thẻ mới"/"Sao chép liên kết" trong menu cũng áp dụng cho file;
  - link nên theo id của file, không theo folder chứa nó, để vẫn đúng sau khi file bị di chuyển.

## Tiêu chí chấp nhận
- [x] Tải file có tên tiếng Việt có dấu thì giữ đúng tên.
- [x] Mở trình xem: dùng được phím ←/→ để chuyển file, Esc để đóng, nút Tải xuống.
- [x] Video 2 GB tua được ngay, không phải chờ tải hết.
- [x] File HTML hoặc SVG không bị render inline.
- [x] URL hết hạn sau 5 phút.
