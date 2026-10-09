# Roadmap & tiến độ

> Đọc file này đầu mỗi phiên làm việc. Agent cập nhật trạng thái ngay khi bắt đầu và khi kết thúc một task.
>
> Trạng thái: ⬜ Chưa làm · 🟨 Đang làm · 🟦 Chờ duyệt · ✅ Xong · ⛔ Bị chặn (ghi lý do)

## Tổng quan milestone

| Milestone | Mục tiêu | Trạng thái |
|---|---|---|
| M0 | Nền tảng: docs, khung BE/FE, Docker, CI | 🟨 |
| M1 | Xác thực và tài khoản | ⬜ |
| M2 | Folder, file, upload chia chunk, download | ⬜ |
| M3 | Xem trước và thumbnail | ⬜ |
| M4 | Thùng rác | ⬜ |
| M5 | Chia sẻ (cho người dùng và qua link) | ⬜ |
| M6 | Tìm kiếm | ⬜ |
| M7 | Phiên bản file | ⬜ |
| M8 | Quota UI, hoàn thiện, deploy production | ⬜ |

## M0 — Nền tảng
| ID | Task | Trạng thái |
|---|---|---|
| M0-01 | Viết AGENTS.md và bộ docs ban đầu | ✅ |
| M0-02 | Chủ dự án duyệt docs và trả lời open-questions | ✅ |
| M0-03 | Thêm `.gitignore`, `.editorconfig`, README gốc (git repo và LICENSE MIT đã có sẵn) | ⬜ |
| M0-04 | `docker-compose.yml` cho dev: Postgres, Redis, MinIO (tự tạo bucket, cấu hình CORS), Mailpit; có `.env.example` | ⬜ |
| M0-05 | Khung BE: Django + DRF + settings theo môi trường + Celery + health endpoint + ruff/mypy/pytest | ⬜ |
| M0-06 | Khung FE: Vite + React + TS + Tailwind + shadcn + Router + Query + i18n + dark mode + Vitest | ⬜ |
| M0-07 | Design tokens và các layout chính (sidebar, header, khung panel chi tiết) | ⬜ |
| M0-08 | Sinh API client cho FE từ OpenAPI schema | ⬜ |
| M0-09 | GitHub Actions: lint, type check, test BE/FE, build, kiểm tra giấy phép dependency | ⬜ |
| M0-10 | Khung Playwright E2E và đưa vào CI | ⬜ |
| M0-11 | Cập nhật mục "Lệnh thường dùng" trong AGENTS.md | ⬜ |

## M1 — Xác thực ([auth.md](features/auth.md))
| ID | Task | Trạng thái |
|---|---|---|
| M1-01 | Model User và Plan (seed `free-2026`, `friends-2026`), khóa user, `get_limits()`, tạo folder gốc và gán plan khi đăng ký, Django admin cho plan/user | ⬜ |
| M1-02 | allauth headless: đăng ký, đăng nhập, đăng xuất, xác thực email, quên mật khẩu | ⬜ |
| M1-03 | OAuth Google và GitHub, liên kết tài khoản theo email đã xác thực | ⬜ |
| M1-04 | Rate limit và Cloudflare Turnstile cho auth; gửi email qua SMTP bằng Celery, template email `vi`/`en` | ⬜ |
| M1-05 | FE: màn hình S-01 đến S-04, bảo vệ route | ⬜ |
| M1-06 | FE: cài đặt hồ sơ, ngôn ngữ, giao diện (S-13) | ⬜ |
| M1-07 | E2E cho luồng auth | ⬜ |

## M2 — Folder, file, upload, download ([files-folders.md](features/files-folders.md), [upload.md](features/upload.md))
| ID | Task | Trạng thái |
|---|---|---|
| M2-01 | Model Node, Blob, FileVersion; dịch vụ phân quyền (lúc này mới có owner) | ⬜ |
| M2-02 | API: tạo folder, liệt kê con, chi tiết node và breadcrumb, đổi tên, di chuyển | ⬜ |
| M2-03 | Wrapper S3 (`storage`): presign, multipart | ⬜ |
| M2-04 | API upload session: tạo, lấy part URL, lấy trạng thái, hoàn tất, hủy; giữ chỗ quota | ⬜ |
| M2-05 | API download (presigned GET) | ⬜ |
| M2-06 | Celery: dọn upload hết hạn, abort multipart | ⬜ |
| M2-07 | FE: màn hình Drive (lưới/danh sách, sắp xếp, chọn nhiều, menu chuột phải, kéo thả để di chuyển) | ⬜ |
| M2-08 | FE: trình quản lý upload (hàng đợi, song song, thử lại, resume sau khi reload, khay upload, kéo thả upload cả folder) | ⬜ |
| M2-09 | FE: trang Gần đây | ⬜ |
| M2-10 | E2E: tạo folder, upload file lớn, ngắt rồi resume, download | ⬜ |

## M3 — Xem trước ([download-preview.md](features/download-preview.md))
| ID | Task | Trạng thái |
|---|---|---|
| M3-01 | Celery tạo thumbnail cho ảnh và PDF | ⬜ |
| M3-02 | API preview | ⬜ |
| M3-03 | FE: trình xem file (ảnh, PDF, video, nhảy trước/sau, tải về) | ⬜ |

## M4 — Thùng rác ([trash.md](features/trash.md))
| ID | Task | Trạng thái |
|---|---|---|
| M4-01 | API: đưa vào thùng rác, khôi phục, xóa vĩnh viễn, dọn sạch | ⬜ |
| M4-02 | Celery: tự xóa vĩnh viễn sau 30 ngày; xóa blob trên S3 | ⬜ |
| M4-03 | FE: trang Thùng rác, nút hoàn tác trên toast | ⬜ |

## M5 — Chia sẻ ([sharing.md](features/sharing.md))
| ID | Task | Trạng thái |
|---|---|---|
| M5-01 | Model Share, mở rộng dịch vụ phân quyền cho quyền thừa kế | ⬜ |
| M5-02 | API chia sẻ cho người dùng, danh sách "Được chia sẻ với tôi" | ⬜ |
| M5-03 | Model và API ShareLink, endpoint public | ⬜ |
| M5-04 | Email thông báo khi được chia sẻ | ⬜ |
| M5-05 | FE: hộp thoại chia sẻ, trang Được chia sẻ, trang link công khai | ⬜ |
| M5-06 | Bộ test phân quyền (ma trận role × thao tác) | ⬜ |
| M5-07 | Báo cáo vi phạm: model, API public, email cho admin, công cụ kiểm duyệt trong Django admin, nút báo cáo trên S-12 | ⬜ |

## M6 — Tìm kiếm ([search.md](features/search.md))
| ID | Task | Trạng thái |
|---|---|---|
| M6-01 | pg_trgm, API search có bộ lọc | ⬜ |
| M6-02 | FE: command palette, trang kết quả | ⬜ |

## M7 — Phiên bản ([versioning.md](features/versioning.md))
| ID | Task | Trạng thái |
|---|---|---|
| M7-01 | Upload phiên bản mới cho file đã có (upload trùng tên thì hỏi người dùng) | ⬜ |
| M7-02 | API danh sách, tải về, khôi phục, xóa phiên bản | ⬜ |
| M7-03 | FE: tab Phiên bản trong panel chi tiết | ⬜ |

## M8 — Hoàn thiện và deploy ([quota.md](features/quota.md))
| ID | Task | Trạng thái |
|---|---|---|
| M8-01 | Trang dung lượng, cảnh báo khi gần đầy | ⬜ |
| M8-02 | Rà soát bảo mật, rà soát trợ năng | ⬜ |
| M8-03 | Dockerfile production, Compose production, Caddy (TLS, phục vụ FE tĩnh, proxy `/api`) | ⬜ |
| M8-04 | Deploy tự động qua GitHub Actions lên VPS | ⬜ |
| M8-05 | Backup Postgres hằng ngày, Sentry, log có cấu trúc | ⬜ |

---

## Nhật ký

> Mới nhất ở trên cùng. Mỗi dòng gồm: ngày — task — tóm tắt — người hoặc agent thực hiện.

- 2026-10-09 — M0-02 — Chốt: chống bot bằng Turnstile + plan mặc định 5 GB (bạn bè dùng `friends-2026`); báo cáo vi phạm + admin gỡ link/khóa user; deploy toàn bộ (cả FE) lên VPS, cùng origin. Docs được duyệt. — AI agent
- 2026-10-09 — M0-02 — Nâng bảng công nghệ lên bản ổn định mới nhất (Django 6.1, Python 3.14, PostgreSQL 18, React 19, Vite 8, TS 7, Tailwind 4); thêm luật "tra phiên bản trên registry, không dựa vào trí nhớ" vào AGENTS.md. — AI agent
- 2026-10-09 — M0-02 — Cập nhật docs theo câu trả lời: storage do `.env` quyết định, đăng ký mở + SMTP riêng, giới hạn theo Plan (ADR-0005), chọn pypdfium2 cho PDF, quy tắc giấy phép, hướng UI (teal, Be Vietnam Pro). — AI agent

- 2026-10-09 — M0-01 — Viết AGENTS.md và bộ docs ban đầu (overview, requirements, architecture, data-model, api, ui-ux, conventions, features, ADR). Chờ chủ dự án duyệt. — AI agent
