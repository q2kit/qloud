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
    BE trả 409 `name_conflict` khi tạo session; *Giữ cả hai* là gửi lại với `on_conflict=rename` (xem [upload.md](upload.md)).
  - **Di chuyển** bị trùng tên: tự thêm hậu tố ` (n)` **trước phần mở rộng** của file, n nhỏ nhất chưa trùng:
    `report.pdf` → `report (1).pdf`; folder và file không có phần mở rộng (`Docs`, `.env`) thì thêm vào cuối. Tên dài thì cắt bớt để không quá 255 ký tự.
  - Folder gốc không đổi tên, không di chuyển được (400 `root_folder`).
- Di chuyển: không được chuyển một folder vào chính nó hoặc vào cây con của nó (lỗi 400 `invalid_move`). Cần quyền `editor` trên cả nguồn lẫn đích.
  Di chuyển giữa hai cây của hai owner khác nhau thì **không đổi owner** của node (MVP chỉ cho phép trong cùng owner — cần xác nhận khi làm phần sharing).
- Mặc định folder xếp trước file, sau đó theo tên (natural sort: "file2" đứng trước "file10").
  Sắp xếp bằng collation ICU `natural` của PostgreSQL (`und-u-kn-true`): số theo giá trị, không phân biệt hoa thường và dấu ở mức đầu (`a, anh, Ảnh, B, File1, file2, file10`).
- Di chuyển nhiều node chạy trong một transaction và khóa theo owner, nên hai lệnh di chuyển chéo nhau chạy cùng lúc không tạo được vòng.
- Gần đây (M2-09): chỉ file do mình sở hữu, còn sống, sắp theo `updated_at` giảm dần (UUID giảm dần khi cùng timestamp), tối đa 100 file qua toàn bộ các trang cursor. Không ghi nhận lần mở/download. File mới được chia sẻ và có thể cả file mới mở sẽ được bổ sung sau, theo quyết định của owner ở [#25](https://github.com/q2kit/qloud/issues/25#issuecomment-6100858060).

## Tương tác UI
- Chọn: click; Ctrl/⌘+click để chọn thêm; Shift+click để chọn một dải; Ctrl/⌘+A để chọn tất cả.
- Menu chuột phải và menu "⋯": Mở, Xem trước, Tải xuống, Chia sẻ, Đổi tên (F2), Di chuyển, Thông tin (i), Xóa (Delete).
- Kéo thả node vào một folder hoặc một mục trong breadcrumb để di chuyển.
- Danh sách cuộn vô hạn (dùng cursor) và dùng virtualization khi có trên 200 mục.

## Đã làm ở M2-07a ([#100](https://github.com/q2kit/qloud/issues/100))
- **Route và breadcrumb:** `/drive` (folder gốc) và `/drive/folders/:id`; breadcrumb là tiêu đề trang, đường dẫn lấy từ server nên reload vẫn đúng.
- **Hiển thị:**
  - lưới hoặc danh sách, sắp xếp theo 6 kiểu của API; cả hai lựa chọn nhớ trong trình duyệt (`qloud.drive.view`, `qloud.drive.ordering`);
  - cuộn vô hạn theo cursor (trang 100 mục, kèm nút "Tải thêm" dự phòng cho bàn phím);
  - quá 200 mục thì virtualization theo cuộn của cửa sổ.
- **Chọn và bàn phím:**
  - click để chọn một mục (chọn nhiều ở M2-07b); phím mũi tên để di chuyển, Enter để mở, F2 để đổi tên;
  - mục đang chọn hiện trong panel chi tiết (loại, kích thước, ngày sửa, ngày tạo) và có nút Đổi tên/Tải xuống trên thanh công cụ.
- **Mở:** bấm đúp trên desktop có chuột/hover, hoặc Enter/nút Mở/menu trên mọi thiết bị; folder thì vào trong, file thì tải về cho tới khi M3 có trình xem.
- **Tạo folder:** menu "Tạo mới" ở header hoặc nút ở trạng thái rỗng; tên trùng thì báo ngay trong hộp thoại.
- **Đổi tên:**
  - lạc quan (tên mới hiện ngay);
  - API từ chối thì trả lại tên cũ và mở lại hộp thoại với tên vừa nhập kèm thông báo lỗi;
  - với file, phần mở rộng không được chọn sẵn.
- **Trạng thái:** đang tải (skeleton), rỗng, lỗi kèm "Thử lại", và folder không tồn tại hoặc không có quyền.

## Đã làm ở M2-07b ([#101](https://github.com/q2kit/qloud/issues/101))
- **Chọn:**
  - click (một mục), Ctrl/⌘+click (thêm/bớt), Shift+click hoặc Shift+mũi tên (cả dải từ mục làm mốc);
  - Ctrl/⌘+A (tất cả mục đã tải) và Esc (bỏ chọn) dùng được ở mọi chỗ trên trang Drive, trừ khi đang gõ hoặc đang mở hộp thoại/menu;
  - thanh công cụ ghi số mục đã chọn; panel chi tiết tóm tắt số folder, số file và tổng dung lượng;
  - **vùng chọn** như trình quản lý file trên desktop:
    - nhấn chuột trên chỗ trống rồi kéo thì hiện khung, mục nào chạm khung thì được chọn;
    - giữ Ctrl/⌘ thì cộng thêm vào vùng chọn sẵn có; kéo gần mép trên/dưới cửa sổ thì trang tự cuộn;
    - nhấn trên chỗ trống mà không kéo thì bỏ chọn;
    - chỉ cho chuột (trên cảm ứng, kéo là cuộn); nhấn trên một mục vẫn là chọn hoặc kéo để di chuyển.
- **Backspace** về folder cha, trừ khi đang gõ hoặc đang mở hộp thoại/menu; ở folder gốc thì không làm gì.
- **Menu của mục:**
  - chuột phải, nút "⋯" trên từng mục (luôn hiện trên màn hình cảm ứng), hoặc Shift+F10 từ bàn phím;
  - một mục: Mở/Tải xuống, Đổi tên, Di chuyển, Thông tin; nhiều mục: Di chuyển;
  - mở menu trên một mục chưa chọn thì chọn mục đó trước;
  - khi menu đang mở, phím và click trong menu chỉ tác động lên menu, không đổi mục đang chọn phía sau (menu nằm trong portal nhưng sự kiện React vẫn nổi bọt về mục, nên mục bỏ qua sự kiện không xảy ra bên trong nó).
- **Di chuyển:**
  - hộp thoại duyệt folder; không vào được folder đang di chuyển; "Di chuyển tới đây" tắt khi đích là chỗ hiện tại;
  - kéo thả (HTML5) vào một folder hoặc một mục của breadcrumb, đích sáng lên khi kéo qua; màn hình cảm ứng dùng hộp thoại;
  - mọi cách đều gửi **một** request cho cả vùng chọn;
  - lạc quan: mục rời folder ngay, API từ chối (ví dụ `invalid_move`) thì quay lại kèm thông báo;
  - kết quả được đọc cho trình đọc màn hình ("Đã di chuyển 2 mục tới …").
- **Link riêng của folder:**
  - mỗi folder có URL `/drive/folders/:id` (folder gốc là `/drive`); lưu lại hoặc mở ở tab khác vẫn ra đúng folder, vì folder và breadcrumb được tải theo id từ server;
  - id trên URL là UUID **bỏ dấu gạch** (32 ký tự hex); FE thêm lại dấu gạch trước khi gọi API. Link có dấu gạch (hoặc chữ hoa) vẫn mở được và được thay bằng dạng gọn;
  - id là UUID nên không đoán được, và người không có quyền nhận 404;
  - mở trong thẻ mới bằng **middle click**, **Ctrl/⌘+Enter**, hoặc mục "Mở trong thẻ mới" trong menu; menu có thêm "Sao chép liên kết";
  - **Ctrl/⌘+click vẫn là chọn thêm**, không mở thẻ mới;
  - file chưa có link riêng: làm ở M3 cùng trình xem (xem [download-preview.md](download-preview.md)).

## M2-09 — Gần đây ([#25](https://github.com/q2kit/qloud/issues/25))
- `/recent` lấy file từ tất cả thư mục của mình qua `GET /recent`; thứ tự mới nhất cố định, không thay đổi lựa chọn sắp xếp của Drive.
- Drive và Gần đây dùng chung core `FileBrowser` (toolbar, loading/rỗng/lỗi, kéo vùng chọn, bàn phím) và `NodeCollection` (lưới/danh sách, item/menu, phân trang/virtualization). Được chia sẻ và Thùng rác sẽ dùng cùng core khi triển khai M5/M4; mỗi trang truyền dữ liệu và các action phù hợp, không sao chép giao diện file.
- Gần đây dùng chung lựa chọn lưới/danh sách, chọn một/nhiều, Shift/Ctrl/⌘ và Ctrl/⌘+A/Esc. Một file có action Tải xuống, Mở thư mục chứa tệp, Thông tin. Enter và double click desktop tải file cho tới M3; thiết bị cảm ứng dùng nút/menu. Không đổi tên/di chuyển trực tiếp ở Gần đây; mở thư mục chứa file để dùng các thao tác Drive.
- Double click vùng trống không tạo folder; item không kéo để di chuyển và nội dung trang không nhận upload. Menu Tạo mới toàn cục vẫn tạo/upload vào Drive gốc như các route ngoài Drive trước đây.
- Có skeleton, trạng thái rỗng, lỗi kèm Thử lại; hỗ trợ vi/en, light/dark và 360px. Chuyển vào/ra Gần đây xóa vùng chọn cũ.
- Upload hoàn tất, đổi tên và di chuyển làm mới cache Gần đây. Danh sách không ghi lịch sử truy cập; mở/download không thay đổi `updated_at`.
- Mở thư mục chứa tệp chỉ có ở Gần đây, dùng link folder cha với `?select=<UUID-file-không-dấu-gạch>`. Drive kiểm tra file còn ở đúng folder và có quyền, tải tiếp trang cursor tới file, chọn/highlight, cuộn tới và focus item cả khi virtualize. Reload link vẫn chọn file; Esc/click vùng trống bỏ chọn bình thường. Link tới file đã chuyển/xóa/không có quyền báo không tìm thấy, không tự chuyển sang folder khác.
- Menu “⋯” chọn item và mở sau khi click hoàn tất (đã thả con trỏ), tránh mouseup kích hoạt nhầm action khi toolbar đổi chiều cao giữa các vùng chọn. Chuột phải và mở menu bằng bàn phím giữ hành vi hiện có.

## Tiêu chí chấp nhận
### M2-11, M2-12 và M2-13 — vùng trống và double click của Drive ([#109](https://github.com/q2kit/qloud/issues/109), [#111](https://github.com/q2kit/qloud/issues/111), [#112](https://github.com/q2kit/qloud/issues/112))
- Double click **chỉ trên desktop**: thiết bị có con trỏ chính chính xác và hỗ trợ hover (`(hover: hover) and (pointer: fine)`), không dựa vào chiều rộng viewport. Theo quyết định của owner ở #112, thiết bị cảm ứng không dùng double click để mở item hay tạo folder; chọn item rồi dùng nút/menu Mở/Tải xuống, tạo folder qua menu/nút hiện có. Bàn phím giữ Enter và các thao tác hiện có.
- Trên desktop, double click vào vùng trống của folder đang mở sẽ mở modal tạo thư mục con hiện có, với parent là folder đang xem; áp dụng cho folder gốc và folder lồng nhau, dạng lưới/danh sách, rỗng/có nội dung.
- Trên desktop, double click lên item vẫn mở folder/file; click đơn trên vùng trống vẫn bỏ chọn. Kéo vùng chọn, kéo thả di chuyển/upload và các cách tạo folder hiện có vẫn hoạt động.
- Không kích hoạt từ breadcrumb, toolbar, nút, menu hoặc modal; không mở khi đang có menu/modal hoặc folder đang tải, lỗi, không tồn tại hay không có quyền.
- Dùng lại focus, validation và xử lý lỗi của modal tạo folder; không đổi API/schema. Kết thúc thao tác kéo vùng chọn không mở modal.
- Section của Drive và vùng nội dung bên dưới thanh công cụ giãn hết chiều cao còn lại dưới header (trừ padding của trang). Upload qua drag/drop, kéo vùng chọn và double click hoạt động tới đáy vùng nội dung, kể cả khi ít mục hoặc folder rỗng; không giới hạn ở 50vh.
- Nội dung dài vẫn cuộn theo cửa sổ, giữ phân trang/virtualization. Drop lên folder con vẫn upload vào folder con; sidebar và header không phải vùng nhận drop.

### Tiêu chí chung
- [x] Tạo folder lồng nhau 3 cấp; breadcrumb hiển thị đúng; reload trang vẫn đúng.
- [x] Đổi tên trùng thì báo lỗi; di chuyển vào cây con thì bị chặn.
- [x] Di chuyển 50 mục cùng lúc chỉ tốn một request, và UI cập nhật kiểu lạc quan.
- [ ] Folder 10.000 mục vẫn cuộn mượt; API đạt NF-01.
- [ ] Người không có quyền nhận 404 với mọi endpoint của node.

### M4-06 — kéo card có thumbnail
- Ảnh thumbnail không kéo riêng; kéo từ ảnh vẫn dùng ID node và toàn bộ card làm drag image (kèm tên/metadata), như kéo từ phần tên.
- Nếu DataTransfer có cả payload node và Files thì ưu tiên di chuyển node, không hiện dropzone hay khởi tạo upload. File ngoài máy vẫn upload vào folder hoặc Drive như trước.
