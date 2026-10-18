# Roadmap & tiến độ

> Mỗi task có một GitHub Issue; PR đóng issue bằng `Closes #n`. Quy trình: AGENTS.md mục 3.
>
> Trạng thái: ⬜ Chưa làm · 🟨 Đang làm · 🟦 Chờ duyệt · ✅ Xong · ⛔ Bị chặn (ghi lý do)

## Tổng quan milestone

| Milestone | Mục tiêu | Trạng thái |
|---|---|---|
| M0 | Nền tảng: docs, khung BE/FE, Docker, CI | ✅ |
| M1 | Xác thực và tài khoản | ✅ |
| M2 | Folder, file, upload chia chunk, download | ✅ |
| M3 | Xem trước và thumbnail | ✅ |
| M4 | Thùng rác | ✅ |
| M5 | Chia sẻ (cho người dùng và qua link) | ✅ |
| M6 | Tìm kiếm | ✅ |
| M7 | Phiên bản file | 🟨 |
| M8 | Quota UI, hoàn thiện, deploy production | 🟨 |

## M0 — Nền tảng
Xong (15 task: docs, khung BE/FE, Docker, CI, E2E, git hooks). Chi tiết: milestone [M0](https://github.com/q2kit/qloud/milestone/1?closed=1) trên GitHub.

## M1 — Xác thực ([auth.md](features/auth.md))
| ID | Task | Issue | Trạng thái |
|---|---|---|---|
| M1-01 | Model User và Plan (seed `free-2026`, `plus-2026`), khóa user, `get_limits()`, tạo folder gốc và gán plan khi đăng ký, Django admin cho plan/user | [#10](https://github.com/q2kit/qloud/issues/10) | ✅ [PR #82](https://github.com/q2kit/qloud/pull/82) |
| M1-02 | allauth headless: đăng ký, đăng nhập, đăng xuất, xác thực email, quên mật khẩu | [#11](https://github.com/q2kit/qloud/issues/11) | ✅ [PR #84](https://github.com/q2kit/qloud/pull/84) |
| M1-03 | OAuth Google và GitHub, liên kết tài khoản theo email đã xác thực | [#12](https://github.com/q2kit/qloud/issues/12) | ✅ [PR #85](https://github.com/q2kit/qloud/pull/85) |
| M1-04 | Rate limit và Cloudflare Turnstile cho auth; gửi email qua SMTP bằng Celery, template email `vi`/`en` | [#13](https://github.com/q2kit/qloud/issues/13) | ✅ [PR #87](https://github.com/q2kit/qloud/pull/87) |
| M1-05 | FE: màn hình S-01 đến S-04, bảo vệ route | [#14](https://github.com/q2kit/qloud/issues/14) | ✅ [PR #88](https://github.com/q2kit/qloud/pull/88) |
| M1-06 | FE: cài đặt hồ sơ, ngôn ngữ, giao diện (S-13) | [#15](https://github.com/q2kit/qloud/issues/15) | ✅ [PR #89](https://github.com/q2kit/qloud/pull/89) |
| M1-07 | E2E cho luồng auth | [#16](https://github.com/q2kit/qloud/issues/16) | ✅ [PR #90](https://github.com/q2kit/qloud/pull/90) |

## M2 — Folder, file, upload, download ([files-folders.md](features/files-folders.md), [upload.md](features/upload.md))
| ID | Task | Issue | Trạng thái |
|---|---|---|---|
| M2-00 | (Làm đầu M2, sau khi M1 xong) Script quy trình `task-start`, `pr-open`, `roadmap-sync` + skill Claude Code bọc script; rút gọn AGENTS.md mục 3 | [#62](https://github.com/q2kit/qloud/issues/62) | ✅ [PR #91](https://github.com/q2kit/qloud/pull/91) |
| M2-01 | Hoàn thiện model Node (nền folder gốc ở M1-01), Blob, FileVersion; dịch vụ phân quyền (lúc này mới có owner) | [#17](https://github.com/q2kit/qloud/issues/17) | ✅ [PR #92](https://github.com/q2kit/qloud/pull/92) |
| M2-02 | API: tạo folder, liệt kê con, chi tiết node và breadcrumb, đổi tên, di chuyển | [#18](https://github.com/q2kit/qloud/issues/18) | ✅ [PR #94](https://github.com/q2kit/qloud/pull/94) |
| M2-03 | Wrapper S3 (`storage`): presign, multipart | [#19](https://github.com/q2kit/qloud/issues/19) | ✅ [PR #96](https://github.com/q2kit/qloud/pull/96) |
| M2-04 | API upload session: tạo, lấy part URL, lấy trạng thái, hoàn tất, hủy; giữ chỗ quota | [#20](https://github.com/q2kit/qloud/issues/20) | ✅ [PR #97](https://github.com/q2kit/qloud/pull/97) |
| M2-05 | API download (presigned GET) | [#21](https://github.com/q2kit/qloud/issues/21) | ✅ [PR #98](https://github.com/q2kit/qloud/pull/98) |
| M2-06 | Celery: dọn upload hết hạn, abort multipart | [#22](https://github.com/q2kit/qloud/issues/22) | ✅ [PR #99](https://github.com/q2kit/qloud/pull/99) |
| M2-07a | FE: màn hình Drive — duyệt (lưới/danh sách, sắp xếp, cuộn vô hạn, tạo folder, đổi tên, chi tiết). Task con của [#23](https://github.com/q2kit/qloud/issues/23) | [#100](https://github.com/q2kit/qloud/issues/100) | ✅ [PR #102](https://github.com/q2kit/qloud/pull/102) |
| M2-07b | FE: màn hình Drive — chọn nhiều, menu chuột phải, kéo thả để di chuyển. Task con của [#23](https://github.com/q2kit/qloud/issues/23) | [#101](https://github.com/q2kit/qloud/issues/101) | ✅ [PR #104](https://github.com/q2kit/qloud/pull/104) |
| M2-08a | FE: engine upload + khay upload, upload file (hàng đợi, song song, thử lại, tạm dừng/hủy, kéo thả file). Task con của [#24](https://github.com/q2kit/qloud/issues/24) | [#105](https://github.com/q2kit/qloud/issues/105) | ✅ [PR #107](https://github.com/q2kit/qloud/pull/107) |
| M2-08b | FE: upload cả folder, tiếp tục sau khi reload; BE `on_conflict` cho `POST /folders`. Task con của [#24](https://github.com/q2kit/qloud/issues/24) | [#106](https://github.com/q2kit/qloud/issues/106) | ✅ [PR #108](https://github.com/q2kit/qloud/pull/108) |
| M2-09 | API và FE: trang Gần đây (file của mình theo updated_at, core hiển thị file dùng chung) | [#25](https://github.com/q2kit/qloud/issues/25) | ✅ [PR #114](https://github.com/q2kit/qloud/pull/114) |
| M2-10 | Bổ sung hoàn thiện M2: E2E upload từ UI bị mất mạng/reload, tiếp tục part còn thiếu và kiểm tra download | [#26](https://github.com/q2kit/qloud/issues/26) | ✅ [PR #117](https://github.com/q2kit/qloud/pull/117) |
| M2-11 | FE: double click vùng trống của folder đang mở để mở modal tạo thư mục con (lưới/danh sách, folder gốc và lồng nhau) | [#109](https://github.com/q2kit/qloud/issues/109) | ✅ [PR #113](https://github.com/q2kit/qloud/pull/113) |
| M2-12 | Fix: vùng tương tác Drive giãn hết chiều cao còn lại để upload, kéo chọn và double click dùng được gần đáy màn hình; làm chung PR với M2-11 theo yêu cầu người dùng | [#111](https://github.com/q2kit/qloud/issues/111) | ✅ [PR #113](https://github.com/q2kit/qloud/pull/113) |
| M2-13 | FE: chỉ bật double click mở item/tạo thư mục trên desktop có chuột và hover; thiết bị cảm ứng dùng nút/menu hiện có, theo quyết định của owner trong #112 | [#112](https://github.com/q2kit/qloud/issues/112) | ✅ [PR #113](https://github.com/q2kit/qloud/pull/113) |

## M3 — Xem trước ([download-preview.md](features/download-preview.md))
| ID | Task | Issue | Trạng thái |
|---|---|---|---|
| M3-01 | Celery tạo thumbnail cho ảnh và PDF | [#27](https://github.com/q2kit/qloud/issues/27) | ✅ [PR #118](https://github.com/q2kit/qloud/pull/118) |
| M3-02 | API preview | [#28](https://github.com/q2kit/qloud/issues/28) | ✅ [PR #119](https://github.com/q2kit/qloud/pull/119) |
| M3-03 | FE: trình xem file (ảnh, PDF, video, nhảy trước/sau, tải về); link riêng cho file như folder (xem download-preview.md › Ghi chú cho M3) | [#29](https://github.com/q2kit/qloud/issues/29) | ✅ [PR #120](https://github.com/q2kit/qloud/pull/120) |
| M3-04 | Bổ sung thumbnail cho video MP4 trong worker và grid/list | [#121](https://github.com/q2kit/qloud/issues/121) | ✅ [PR #125](https://github.com/q2kit/qloud/pull/125) |
| M3-05 | Fix: bỏ polling chờ thumbnail; giữ trạng thái phát và vị trí video/audio khi refresh URL preview | [#126](https://github.com/q2kit/qloud/issues/126) | ✅ [PR #129](https://github.com/q2kit/qloud/pull/129) |
| M3-06 | Fix: chỉ nhận số trang PDF nguyên, không làm lỗi viewer khi nhập giá trị không hợp lệ | [#127](https://github.com/q2kit/qloud/issues/127) | ✅ [PR #130](https://github.com/q2kit/qloud/pull/130) |

## M4 — Thùng rác ([trash.md](features/trash.md))
| ID | Task | Issue | Trạng thái |
|---|---|---|---|
| M4-01 | API: đưa vào thùng rác, khôi phục, xóa vĩnh viễn, dọn sạch | [#30](https://github.com/q2kit/qloud/issues/30) | ✅ [PR #131](https://github.com/q2kit/qloud/pull/131) |
| M4-02 | Celery: tự xóa vĩnh viễn sau 30 ngày; xóa blob trên S3 | [#31](https://github.com/q2kit/qloud/issues/31) | ✅ [PR #132](https://github.com/q2kit/qloud/pull/132) |
| M4-03 | FE: trang Thùng rác, nút hoàn tác trên toast | [#32](https://github.com/q2kit/qloud/issues/32) | ✅ [PR #133](https://github.com/q2kit/qloud/pull/133) |
| M4-04 | FE: phím Delete đưa lựa chọn vào thùng rác | [#135](https://github.com/q2kit/qloud/issues/135) | ✅ [PR #138](https://github.com/q2kit/qloud/pull/138) |
| M4-05 | Thumbnail trong Thùng rác | [#136](https://github.com/q2kit/qloud/issues/136) | ✅ [PR #139](https://github.com/q2kit/qloud/pull/139) |
| M4-06 | Fix: kéo thumbnail di chuyển card node | [#137](https://github.com/q2kit/qloud/issues/137) | ✅ [PR #140](https://github.com/q2kit/qloud/pull/140) |

## M5 — Chia sẻ ([sharing.md](features/sharing.md))
| ID | Task | Issue | Trạng thái |
|---|---|---|---|
| M5-01 | Model Share, mở rộng dịch vụ phân quyền cho quyền thừa kế | [#33](https://github.com/q2kit/qloud/issues/33) | ✅ [PR #143](https://github.com/q2kit/qloud/pull/143) |
| M5-02 | API chia sẻ cho người dùng, danh sách "Được chia sẻ với tôi" | [#34](https://github.com/q2kit/qloud/issues/34) | ✅ [PR #145](https://github.com/q2kit/qloud/pull/145) |
| M5-03 | Model và API ShareLink, endpoint public | [#35](https://github.com/q2kit/qloud/issues/35) | ✅ [PR #146](https://github.com/q2kit/qloud/pull/146) |
| M5-04 | Email thông báo khi được chia sẻ | [#36](https://github.com/q2kit/qloud/issues/36) | ✅ [PR #148](https://github.com/q2kit/qloud/pull/148) |
| M5-05 | FE: hộp thoại chia sẻ, trang Được chia sẻ, trang link công khai | [#37](https://github.com/q2kit/qloud/issues/37) | ✅ [PR #151](https://github.com/q2kit/qloud/pull/151) |
| M5-06 | Bộ test phân quyền (ma trận role × thao tác) | [#38](https://github.com/q2kit/qloud/issues/38) | ✅ [PR #152](https://github.com/q2kit/qloud/pull/152) |
| M5-07 | Báo cáo vi phạm: model, API public, email cho admin, màn hình kiểm duyệt `/moderation` và audit trong Django admin, nút báo cáo trên S-12 | [#39](https://github.com/q2kit/qloud/issues/39) | ✅ [PR #153](https://github.com/q2kit/qloud/pull/153) |
| M5-08 | Link file chia sẻ riêng không mở được khi folder cha không có quyền | [#147](https://github.com/q2kit/qloud/issues/147) | ✅ [PR #149](https://github.com/q2kit/qloud/pull/149) |
| M5-09 | Đồng bộ danh sách folder khi upload/di chuyển hoàn tất trong lúc điều hướng | [#150](https://github.com/q2kit/qloud/issues/150) | ✅ [PR #154](https://github.com/q2kit/qloud/pull/154) |

## M6 — Tìm kiếm ([search.md](features/search.md))
| ID | Task | Issue | Trạng thái |
|---|---|---|---|
| M6-01 | pg_trgm, API search có bộ lọc | [#40](https://github.com/q2kit/qloud/issues/40) | ✅ [PR #156](https://github.com/q2kit/qloud/pull/156) |
| M6-02 | FE: command palette, trang kết quả | [#41](https://github.com/q2kit/qloud/issues/41) | ✅ [PR #157](https://github.com/q2kit/qloud/pull/157) |

## M7 — Phiên bản ([versioning.md](features/versioning.md))
| ID | Task | Issue | Trạng thái |
|---|---|---|---|
| M7-01 | Upload phiên bản mới cho file đã có (upload trùng tên thì hỏi người dùng) | [#42](https://github.com/q2kit/qloud/issues/42) | ✅ [PR #160](https://github.com/q2kit/qloud/pull/160) |
| M7-02 | API danh sách, tải về, khôi phục, xóa phiên bản | [#43](https://github.com/q2kit/qloud/issues/43) | ✅ [PR #162](https://github.com/q2kit/qloud/pull/162) |
| M7-03 | FE: tab Phiên bản trong panel chi tiết | [#44](https://github.com/q2kit/qloud/issues/44) | ✅ [PR #163](https://github.com/q2kit/qloud/pull/163) |
| M7-04 | Dọn phiên bản theo plan và đánh dấu Khóa | [#159](https://github.com/q2kit/qloud/issues/159) | ✅ [PR #176](https://github.com/q2kit/qloud/pull/176) |
| M7-05 | Fix sau review M7: tuổi phiên bản tính từ lúc bị thay thế (cần quyết định), job dọn lọc trước file cần dọn, "Thay thế" khi trùng tên folder, reset lỗi Khóa, đổi tên view | [#177](https://github.com/q2kit/qloud/issues/177) | ⬜ |

## M8 — Hoàn thiện và deploy ([quota.md](features/quota.md))
| ID | Task | Issue | Trạng thái |
|---|---|---|---|
| M8-01 | Trang dung lượng, cảnh báo khi gần đầy | [#45](https://github.com/q2kit/qloud/issues/45) | ✅ [PR #187](https://github.com/q2kit/qloud/pull/187) |
| M8-02 | Rà soát bảo mật, rà soát trợ năng | [#46](https://github.com/q2kit/qloud/issues/46) | ⬜ |
| M8-03 | Dockerfile production, Compose production, nginx (Origin Certificate, phục vụ FE tĩnh, proxy `/api`, real IP từ Cloudflare), hướng dẫn cấu hình Cloudflare và ufw | [#47](https://github.com/q2kit/qloud/issues/47) | ⬜ |
| M8-04 | Deploy tự động qua GitHub Actions lên VPS | [#48](https://github.com/q2kit/qloud/issues/48) | ⬜ |
| M8-05 | Backup Postgres hằng ngày, Sentry, log có cấu trúc | [#49](https://github.com/q2kit/qloud/issues/49) | ⬜ |
| M8-06 | Rate limit chung cho API (600 req/phút/user, tạo upload 60) | [#93](https://github.com/q2kit/qloud/issues/93) | ⬜ |
| M8-07 | Fix: smoke E2E chờ capability tạo folder trước khi kiểm tra cursor | [#155](https://github.com/q2kit/qloud/issues/155) | ⬜ |
| M8-08 | FE: phím tắt cho các thao tác chính và bảng phím tắt (`?`) | [#164](https://github.com/q2kit/qloud/issues/164) | ✅ [PR #192](https://github.com/q2kit/qloud/pull/192) |
| M8-09 | Celery đối soát quota hằng đêm, lệnh `reconcile_quota` | [#165](https://github.com/q2kit/qloud/issues/165) | ⬜ |
| M8-10 | FE: tab Chia sẻ trong panel chi tiết | [#166](https://github.com/q2kit/qloud/issues/166) | ✅ [PR #193](https://github.com/q2kit/qloud/pull/193) |
| M8-11a | Audit log BE (kế hoạch đã duyệt trên [#167](https://github.com/q2kit/qloud/issues/167)): `AuditEvent`, ghi sự kiện, API hoạt động, admin, dọn sau 365 ngày | [#196](https://github.com/q2kit/qloud/issues/196) | ✅ [PR #198](https://github.com/q2kit/qloud/pull/198) |
| M8-11b | FE: tab Hoạt động trong panel chi tiết (cần M8-11a) | [#197](https://github.com/q2kit/qloud/issues/197) | ✅ [PR #199](https://github.com/q2kit/qloud/pull/199) |
| M8-12 | FE: nút nổi "+" Tạo mới trên mobile | [#168](https://github.com/q2kit/qloud/issues/168) | 🟦 |
| M8-13 | E2E đa trình duyệt: Firefox và WebKit (NF-10) | [#169](https://github.com/q2kit/qloud/issues/169) | ⬜ |
| M8-14 | Đo và đảm bảo hiệu năng danh sách với folder 10.000 node (NF-01) | [#170](https://github.com/q2kit/qloud/issues/170) | ⬜ |
| M8-15 | Đồng bộ tiêu chí chấp nhận và trạng thái tài liệu feature với tiến độ | [#171](https://github.com/q2kit/qloud/issues/171) | ⬜ |
| M8-16 | Fix: E2E kéo/di chuyển đôi lúc mở folder đích với danh sách rỗng | [#115](https://github.com/q2kit/qloud/issues/115) | ⬜ |
| M8-17 | Fix: database pytest dùng lại làm cạn số cột của PostgreSQL | [#122](https://github.com/q2kit/qloud/issues/122) | ⬜ |
| M8-18 | Fix: E2E double click vùng trống cuối lưới Drive không ổn định | [#123](https://github.com/q2kit/qloud/issues/123) | ⬜ |
| M8-19 | Fix: E2E nhập số trang PDF đôi lúc vẫn ở trang 1 | [#144](https://github.com/q2kit/qloud/issues/144) | ⬜ |
| M8-20 | Rà soát câu chữ i18n (vi/en, email) cho tự nhiên và nhất quán | [#178](https://github.com/q2kit/qloud/issues/178) | ✅ [PR #179](https://github.com/q2kit/qloud/pull/179) |
| M8-21 | FE: Select và DatePicker thay cho ô chọn gốc của trình duyệt | [#180](https://github.com/q2kit/qloud/issues/180) | ✅ [PR #191](https://github.com/q2kit/qloud/pull/191) |
| M8-22 | Fix: mục được chia sẻ mở trong `/shared` (đóng trình xem, link trong email), `/drive` chỉ chứa dữ liệu của mình | [#194](https://github.com/q2kit/qloud/issues/194) | ✅ [PR #195](https://github.com/q2kit/qloud/pull/195) |
