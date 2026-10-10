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
4. **Resume:** fingerprint lưu trên session ở server; không dùng IndexedDB (quyết định M2-08b, [ADR-0008](../adr/0008-server-upload-fingerprints.md), [kế hoạch #24](https://github.com/q2kit/qloud/issues/24#issuecomment-6098540092)).
   Fingerprint là SHA-256 của JSON `[tên, kích thước, lastModified, SHA-256 của 1 MiB đầu]`, dạng hex 64 ký tự để tên dài vẫn vừa giới hạn API.
   Khi mở lại Drive, FE gọi `GET /uploads?status=active` (cursor pagination) và yêu cầu người dùng **chọn lại file** cho từng session.
   Nếu fingerprint khớp thì `GET /uploads/{id}` lấy part đã có (S3 `ListParts`), chỉ upload phần còn thiếu; không tạo session hay giữ chỗ quota lần nữa.
   Tệp khác hoặc thời gian chỉnh sửa khác thì báo lỗi, giữ session để chọn lại hoặc hủy. Session cũ từ M2-08a chỉ có fingerprint nhanh, không khớp định dạng mới: cần hủy và upload lại.
5. **Hoàn tất:** `POST /uploads/{id}/complete`. BE gọi `ListParts` rồi `CompleteMultipartUpload`, kiểm tra tổng kích thước, sau đó trong một transaction:
   tạo Blob, Node (hoặc version mới), `reserved -= size`, `used += size`. M3-01: enqueue task thumbnail ảnh/PDF qua `transaction.on_commit` sau khi transaction hoàn tất; thumbnail không tính quota. Lỗi enqueue được ghi log, không đổi kết quả upload thành công.
6. **Hủy / hết hạn:** `AbortMultipartUpload` và trả lại phần quota đã giữ chỗ. Celery beat quét mỗi giờ để dọn các session quá `expires_at` (7 ngày).
   Bucket có thêm lifecycle rule `AbortIncompleteMultipartUpload` sau 8 ngày để dự phòng.
   M2-06: task `uploads.tasks.expire_uploads` (`CELERY_BEAT_SCHEDULE`, mỗi giờ). Mỗi session một transaction, khóa theo cùng thứ tự với `complete`/`abort` (owner rồi session),
   nên upload đang hoàn tất thì xong trước hoặc không bị đụng tới. Quota được trả lại kể cả khi S3 lỗi lúc dọn; phần còn sót do lifecycle rule xử lý. Chạy lại không làm gì thêm.

**Yêu cầu về CORS của bucket:** cho phép `PUT` và `GET` từ origin của FE, và `ExposeHeaders: ETag`.

## Quyết định của M2-04 ([#20](https://github.com/q2kit/qloud/issues/20))
- **Điều kiện tạo session:** quyền `editor` trên folder đích và **email đã xác thực** (403 `email_not_verified`; FE hiện thông báo kèm nút gửi lại email).
  Giới hạn kích thước file và quota là của **owner folder đích**. Session chỉ người tạo thấy; người khác nhận 404.
- **Trùng tên:**
  - Lúc tạo session, `on_conflict=fail` (mặc định) trả 409 `name_conflict` để FE hỏi người dùng; `rename` là "Giữ cả hai".
  - Tên bị trùng **trong lúc** upload thì khi hoàn tất luôn thêm hậu tố ` (n)`, không bỏ dữ liệu đã upload.
  - "Thay thế" (phiên bản mới) thuộc M7-01.
- **Folder đích bị xóa hoặc vào thùng rác trong lúc upload:**
  - Khi hoàn tất, tạo lại các folder bị mất theo đường dẫn đã lưu lúc tạo session, bắt đầu từ folder sâu nhất còn tồn tại; folder gốc luôn còn.
  - Folder cùng tên còn sống ở đó thì dùng lại, nên các file của một lần upload folder vẫn nằm chung một chỗ.
  - Folder trong thùng rác giữ nguyên: folder tạo lại chỉ chứa file mới.
  - Chỉ khi không còn folder nào trên đường dẫn mà người upload sửa được (M5) thì hủy upload, trả 409 `target_unavailable`.
- **Gọi lại an toàn:** `complete` gọi lại trả về đúng node. Nếu S3 đã ghép xong mà bước ghi DB lỗi, lần gọi sau nhận ra object đã có và làm tiếp. `DELETE` gọi lại vẫn trả 204.
- **Không giữ khóa DB khi gọi S3:** giữ chỗ quota, rồi `CreateMultipartUpload`; `ListParts`/`CompleteMultipartUpload`/`HeadObject`, rồi một transaction ghi Blob, Node, version và chuyển `reserved` → `used`.
  Mọi thay đổi quota của một owner chạy lần lượt nhờ khóa dòng User của owner.
- **Mã lỗi:**
  - 403 `email_not_verified`;
  - 413 `file_too_large`, `quota_exceeded`;
  - 409 `name_conflict`, `upload_closed` (đã xong hoặc đã hủy), `target_unavailable`;
  - 410 `upload_expired`;
  - 400 `upload_incomplete` (thiếu part hoặc sai kích thước; session vẫn còn), `invalid_part`;
  - 503 `storage_unavailable`.

## Đã làm ở M2-08a ([#105](https://github.com/q2kit/qloud/issues/105))
- **Lối vào:**
  - menu "Tạo mới › Tải tệp lên", hoặc nút "Tải tệp lên" ở trạng thái rỗng;
  - kéo file từ máy vào trang Drive (upload vào folder đang mở; trang hiện vùng thả "Thả để tải lên vào …") hoặc thả lên một folder trong danh sách (upload vào folder đó);
  - kéo cả folder được bổ sung ở M2-08b (xem bên dưới).
- **Engine** (`qloud_frontend/src/features/upload/engine.ts`, ngoài React; store `zustand` cho khay):
  - **song song:** tối đa **4 part đang chạy trên toàn hàng đợi**, file lấy part theo thứ tự; tạo trước tối đa 2 session để file kế tiếp sẵn sàng;
  - **URL part:** xin theo lô 20; các part bắt đầu cùng lúc dùng chung một request; URL được coi là hết hạn sau 55 phút;
  - **tiến độ:** PUT bằng `XMLHttpRequest` để có tiến độ; tốc độ tính trên 5 giây gần nhất;
  - **lỗi part:** thử lại sau 1, 2, 4, 8, 16 giây (5 lần), rồi file chuyển sang lỗi; storage trả 403 (URL hết hạn) thì xin URL mới và gửi lại ngay;
  - **chưa hoàn tất khi còn part chưa xong:** part đang chờ thử lại vẫn tính là chưa xong, nên file chỉ hoàn tất khi đủ part;
  - **mất mạng:** cả hàng đợi tạm dừng, có mạng lại (`online`) thì tự tiếp tục;
  - **tạm dừng / tiếp tục / hủy:** tạm dừng hủy các request đang chạy và giữ session; tiếp tục đọc part đã có từ server (`GET /uploads/{id}`) và chỉ gửi phần thiếu; hủy gọi `DELETE /uploads/{id}`;
  - **file 0 byte** hoàn tất ngay, không có part.
- **Trùng tên:** hộp thoại "Tên đã được dùng" với "Giữ cả hai" (`on_conflict=rename`) hoặc "Bỏ qua"; ô "Áp dụng cho N tệp còn lại" trả lời luôn các file sau trong hàng đợi; Esc nghĩa là "Bỏ qua".
- **Lỗi cần người dùng xử lý** (`quota_exceeded`, `file_too_large`, `email_not_verified`…) không tự thử lại, nhưng vẫn bấm "Thử lại" được (ví dụ sau khi đã giải phóng dung lượng). `email_not_verified` có nút "Gửi lại email xác thực" (allauth `PUT /account/email`).
- **Khay upload:**
  - tiêu đề "Đang tải lên 2/5" kèm tốc độ và thời gian còn lại; mất mạng thì báo;
  - từng file có thanh tiến độ, trạng thái và nút (tạm dừng, tiếp tục, thử lại, hủy);
  - hành động chung: tạm dừng/tiếp tục tất cả, thử lại các file lỗi, thu gọn, đóng khi đã xong hết;
  - có `aria-live`.
- **Rời trang** khi còn upload thì trình duyệt hỏi lại (`beforeunload`). Upload xong thì danh sách folder đích tự làm mới.
- **E2E:** bucket `qloud-e2e` (CORS cho `http://localhost:4173`) do `infra/localstack/init-s3.sh` tạo; healthcheck của LocalStack chờ CORS của bucket này.

## Upload cả folder
M2-08b ([#106](https://github.com/q2kit/qloud/issues/106)):
- Menu "Tạo mới › Tải thư mục lên" dùng `webkitdirectory`; kéo thả folder dùng `webkitGetAsEntry`. Các entry được lấy ngay trong sự kiện drop, trước khi trình duyệt đóng quyền đọc drag data.
- Đọc hết các lô của `readEntries` và duyệt cả cây. Folder rỗng được giữ khi kéo thả; picker `webkitdirectory` chỉ trả file nên không biểu diễn folder hoàn toàn rỗng.
- Tạo folder từ trên xuống bằng `POST /folders`; ánh xạ đường dẫn gốc sang ID trả về, kể cả khi server đổi tên. File lẻ và các file trong cây được đưa vào hàng đợi upload hiện có, đúng folder đích.
- Folder trùng tên: hỏi "Gộp" (`reuse`), "Giữ cả hai" (`rename`) hoặc "Bỏ qua" (bỏ cả cây con). Gộp chỉ dùng folder đang sống, không dùng file hay folder trong thùng rác. File trùng tên trong folder gộp vẫn dùng hộp thoại của engine.
- Báo trạng thái chuẩn bị folder và lỗi đọc/tạo folder; không upload file vào folder sai khi tạo cây thất bại. Các lần chọn/kéo folder được xử lý lần lượt; cảnh báo rời trang trong lúc chuẩn bị cây.
- Trên Drive có vùng "Tệp tải lên dở dang", lấy từ server qua TanStack Query, có nút xem thêm, chọn lại tệp gốc và hủy (trả quota). Session đã gắn vào khay không hiện lần nữa trong vùng này.
- E2E dùng stack thật: chọn folder lồng nhau, Gộp/Giữ cả hai; seed session và part qua API/S3, reload, từ chối file không khớp, tiếp tục chỉ part thiếu, tải về so nội dung.

## UI — khay upload
- Hiển thị: tổng tiến độ, tốc độ, thời gian còn lại; từng file có trạng thái (đang chờ, đang upload, tạm dừng, lỗi, xong).
- Hành động: tạm dừng/tiếp tục tất cả, hủy, thử lại các file lỗi. Khi có upload đang chạy mà người dùng định rời trang thì hiện cảnh báo.
- Khi xong: file hiện ngay trong folder (invalidate query).

## M2-10 — bổ sung hoàn thiện M2 ([#26](https://github.com/q2kit/qloud/issues/26))
- Giữ các E2E tạo folder, upload/download và resume từ session seed của M2-07/M2-08; không viết lại các ca đã có.
- `e2e/upload-interruption.spec.ts` bổ sung hai ca file **100 MiB**, bắt đầu hoàn toàn qua UI trong folder vừa tạo: mất mạng rồi tự tiếp tục và reload rồi chọn lại tệp gốc.
- Test đợi part đầu tiên thực sự lưu trên S3, giữ các PUT còn lại để ngắt tại thời điểm xác định; chuyển browser context sang offline. API Django và phản hồi S3 đều dùng stack thật.
- Kiểm tra cùng session và folder đích, không gửi lại part đầu, không hoàn tất khi thiếu part; khi xong chỉ có một file, download khớp toàn bộ byte và file không xuất hiện nhầm ở folder gốc. Chạy trên Chromium desktop và 360px.
- Ca 100 MiB không thay thế kiểm chứng file 5 GB trong tiêu chí chấp nhận bên dưới. Bug E2E drag/move không ổn định vẫn theo dõi riêng ở [#115](https://github.com/q2kit/qloud/issues/115).

## Tiêu chí chấp nhận
- [ ] Upload file 0 byte, 1 KB, 100 MB và 5 GB đều thành công; checksum khớp khi tải về.
- [ ] Ngắt mạng ở giữa chừng rồi bật lại: upload tự tiếp tục, không phải tải lại các part đã xong.
- [ ] Reload trang, chọn lại đúng file: tiếp tục từ chỗ dừng.
- [ ] Hai upload đồng thời không thể làm vượt quota (có test tranh chấp đồng thời).
- [ ] Hủy upload thì quota giữ chỗ được trả lại và trên S3 không còn part nào.
- [ ] Không có byte file nào đi qua server Django.

## Ghi chú
- File 0 byte: S3 không nhận multipart upload có 0 part, nên BE dùng `PutObject` rỗng thay thế.
