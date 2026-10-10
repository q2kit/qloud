# Upload (F-UPLOAD)

**Trạng thái:** Đã duyệt · **Milestone:** M2 · Xem thêm [ADR-0003](../adr/0003-direct-to-s3-multipart-upload.md)

Duyệt ở [#17](https://github.com/q2kit/qloud/issues/17). Model `Blob`/`FileVersion` có từ M2-01.

## User stories
- Tôi muốn kéo thả nhiều file hoặc cả một folder vào trình duyệt để upload.
- Tôi muốn upload file rất lớn (hàng chục GB) mà không sợ mất tiến độ khi mạng chập chờn.
- Tôi muốn tạm dừng, tiếp tục hoặc hủy từng file; và khi reload trang thì upload dở dang vẫn tiếp tục được.

## Luồng kỹ thuật
1. **Tạo session:** `POST /uploads`. BE kiểm tra:
   - quyền `editor` trên folder đích;
   - `size <= max_file_size` theo plan của owner folder đích;
   - quota: `used + reserved + size <= quota` của owner folder đích, rồi **giữ chỗ** (`reserved += size`) trong transaction.

   Sau đó BE gọi `CreateMultipartUpload` với key `blobs/{uuid}` và trả về `{id, part_size, part_count}`.
2. **Chọn `part_size`:** tối thiểu 8 MiB, tăng theo bội số MiB sao cho `part_count <= 10.000` (giới hạn của S3); `storage.s3.part_size_for()`.
   Ví dụ file 50 GiB thì part 8 MiB × 6.400 part; 80 GiB thì 9 MiB; 5 TiB thì 525 MiB.
3. **Upload part:** FE xin presigned URL theo lô 20 part, rồi `PUT` song song tối đa 4 part.
   Part lỗi được thử lại với backoff lũy thừa (tối đa 5 lần). URL hết hạn thì xin URL mới.
4. **Resume:** FE lưu `{fingerprint → session_id}` vào IndexedDB, với fingerprint = tên + kích thước + lastModified + hash của 1 MB đầu.
   Khi mở lại trang, FE gọi `GET /uploads?status=active`, rồi yêu cầu người dùng **chọn lại file** (trình duyệt không cho tự đọc lại file).
   Nếu fingerprint khớp thì `GET /uploads/{id}` để lấy danh sách part đã có (BE đọc từ S3 `ListParts`) và chỉ upload phần còn thiếu.
5. **Hoàn tất:** `POST /uploads/{id}/complete`. BE gọi `ListParts` rồi `CompleteMultipartUpload`, kiểm tra tổng kích thước, sau đó trong một transaction:
   tạo Blob, Node (hoặc version mới), `reserved -= size`, `used += size`. Cuối cùng đẩy task thumbnail.
6. **Hủy / hết hạn:** `AbortMultipartUpload` và trả lại phần quota đã giữ chỗ. Celery beat quét mỗi giờ để dọn các session quá `expires_at` (7 ngày).
   Bucket có thêm lifecycle rule `AbortIncompleteMultipartUpload` sau 8 ngày để dự phòng.

**Yêu cầu về CORS của bucket:** cho phép `PUT` và `GET` từ origin của FE, và `ExposeHeaders: ETag`.

## Upload cả folder
FE đọc cấu trúc thư mục (qua `webkitdirectory` hoặc DataTransfer items), gọi API để tạo các folder theo thứ tự từ trên xuống, rồi upload file vào đúng folder.

## UI — khay upload
- Hiển thị: tổng tiến độ, tốc độ, thời gian còn lại; từng file có trạng thái (đang chờ, đang upload, tạm dừng, lỗi, xong).
- Hành động: tạm dừng/tiếp tục tất cả, hủy, thử lại các file lỗi. Khi có upload đang chạy mà người dùng định rời trang thì hiện cảnh báo.
- Khi xong: file hiện ngay trong folder (invalidate query).

## Tiêu chí chấp nhận
- [ ] Upload file 0 byte, 1 KB, 100 MB và 5 GB đều thành công; checksum khớp khi tải về.
- [ ] Ngắt mạng ở giữa chừng rồi bật lại: upload tự tiếp tục, không phải tải lại các part đã xong.
- [ ] Reload trang, chọn lại đúng file: tiếp tục từ chỗ dừng.
- [ ] Hai upload đồng thời không thể làm vượt quota (có test tranh chấp đồng thời).
- [ ] Hủy upload thì quota giữ chỗ được trả lại và trên S3 không còn part nào.
- [ ] Không có byte file nào đi qua server Django.

## Ghi chú
- File 0 byte: S3 không nhận multipart upload có 0 part, nên BE dùng `PutObject` rỗng thay thế.
