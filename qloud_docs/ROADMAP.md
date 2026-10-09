# Roadmap & tiến độ

> Đọc file này đầu mỗi phiên làm việc. Agent cập nhật trạng thái ngay khi bắt đầu và khi kết thúc một task.
>
> Mỗi task có một GitHub Issue (cột *Issue*); PR đóng issue bằng `Closes #n`. Quy trình: AGENTS.md mục 3.
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
| ID | Task | Issue | Trạng thái |
|---|---|---|---|
| M0-01 | Viết AGENTS.md và bộ docs ban đầu | — | ✅ |
| M0-02 | Duyệt docs và trả lời open-questions | — | ✅ |
| M0-03 | Thêm `.gitignore`, `.editorconfig`, README gốc (git repo và LICENSE MIT đã có sẵn) | [#1](https://github.com/q2kit/qloud/issues/1) | ✅ |
| M0-04 | `docker-compose.yml` cho dev: Postgres, Redis, LocalStack (tự tạo bucket, cấu hình CORS), Mailpit; có `.env.example` | [#2](https://github.com/q2kit/qloud/issues/2) | ✅ |
| M0-05 | Khung BE: Django + DRF + settings theo môi trường + Celery + health endpoint + ruff/mypy/pytest | [#3](https://github.com/q2kit/qloud/issues/3) | ✅ |
| M0-06 | Khung FE: Vite + React + TS + Tailwind + shadcn + Router + Query + i18n + dark mode + Vitest | [#4](https://github.com/q2kit/qloud/issues/4) | ✅ |
| M0-07 | Design tokens và các layout chính (sidebar, header, khung panel chi tiết) | [#5](https://github.com/q2kit/qloud/issues/5) | ✅ |
| M0-08 | Sinh API client cho FE từ OpenAPI schema | [#6](https://github.com/q2kit/qloud/issues/6) | ⬜ |
| M0-09 | GitHub Actions: lint, typecheck, test, build BE/FE; kiểm tra giấy phép; gitleaks; kiểm tra tiêu đề/body PR và cảnh báo thiếu cập nhật ROADMAP; sau đó bật required checks | [#7](https://github.com/q2kit/qloud/issues/7) | ✅ |
| M0-10 | Khung Playwright E2E và đưa vào CI | [#8](https://github.com/q2kit/qloud/issues/8) | ⬜ |
| M0-11 | Cập nhật mục "Lệnh thường dùng" trong AGENTS.md | [#9](https://github.com/q2kit/qloud/issues/9) | ⬜ |
| M0-12 | Git hooks bằng lefthook: format/lint file đã stage, gitleaks, kiểm tra commit message, tên branch, chặn push `master`, typecheck/test phía có thay đổi | [#61](https://github.com/q2kit/qloud/issues/61) | 🟦 |

## M1 — Xác thực ([auth.md](features/auth.md))
| ID | Task | Issue | Trạng thái |
|---|---|---|---|
| M1-01 | Model User và Plan (seed `free-2026`, `friends-2026`), khóa user, `get_limits()`, tạo folder gốc và gán plan khi đăng ký, Django admin cho plan/user | [#10](https://github.com/q2kit/qloud/issues/10) | ⬜ |
| M1-02 | allauth headless: đăng ký, đăng nhập, đăng xuất, xác thực email, quên mật khẩu | [#11](https://github.com/q2kit/qloud/issues/11) | ⬜ |
| M1-03 | OAuth Google và GitHub, liên kết tài khoản theo email đã xác thực | [#12](https://github.com/q2kit/qloud/issues/12) | ⬜ |
| M1-04 | Rate limit và Cloudflare Turnstile cho auth; gửi email qua SMTP bằng Celery, template email `vi`/`en` | [#13](https://github.com/q2kit/qloud/issues/13) | ⬜ |
| M1-05 | FE: màn hình S-01 đến S-04, bảo vệ route | [#14](https://github.com/q2kit/qloud/issues/14) | ⬜ |
| M1-06 | FE: cài đặt hồ sơ, ngôn ngữ, giao diện (S-13) | [#15](https://github.com/q2kit/qloud/issues/15) | ⬜ |
| M1-07 | E2E cho luồng auth | [#16](https://github.com/q2kit/qloud/issues/16) | ⬜ |

## M2 — Folder, file, upload, download ([files-folders.md](features/files-folders.md), [upload.md](features/upload.md))
| ID | Task | Issue | Trạng thái |
|---|---|---|---|
| M2-00 | (Làm đầu M2, sau khi M1 xong) Script quy trình `task-start`, `pr-open`, `roadmap-sync` + skill Claude Code bọc script; rút gọn AGENTS.md mục 3 | [#62](https://github.com/q2kit/qloud/issues/62) | ⬜ |
| M2-01 | Model Node, Blob, FileVersion; dịch vụ phân quyền (lúc này mới có owner) | [#17](https://github.com/q2kit/qloud/issues/17) | ⬜ |
| M2-02 | API: tạo folder, liệt kê con, chi tiết node và breadcrumb, đổi tên, di chuyển | [#18](https://github.com/q2kit/qloud/issues/18) | ⬜ |
| M2-03 | Wrapper S3 (`storage`): presign, multipart | [#19](https://github.com/q2kit/qloud/issues/19) | ⬜ |
| M2-04 | API upload session: tạo, lấy part URL, lấy trạng thái, hoàn tất, hủy; giữ chỗ quota | [#20](https://github.com/q2kit/qloud/issues/20) | ⬜ |
| M2-05 | API download (presigned GET) | [#21](https://github.com/q2kit/qloud/issues/21) | ⬜ |
| M2-06 | Celery: dọn upload hết hạn, abort multipart | [#22](https://github.com/q2kit/qloud/issues/22) | ⬜ |
| M2-07 | FE: màn hình Drive (lưới/danh sách, sắp xếp, chọn nhiều, menu chuột phải, kéo thả để di chuyển) | [#23](https://github.com/q2kit/qloud/issues/23) | ⬜ |
| M2-08 | FE: trình quản lý upload (hàng đợi, song song, thử lại, resume sau khi reload, khay upload, kéo thả upload cả folder) | [#24](https://github.com/q2kit/qloud/issues/24) | ⬜ |
| M2-09 | FE: trang Gần đây | [#25](https://github.com/q2kit/qloud/issues/25) | ⬜ |
| M2-10 | E2E: tạo folder, upload file lớn, ngắt rồi resume, download | [#26](https://github.com/q2kit/qloud/issues/26) | ⬜ |

## M3 — Xem trước ([download-preview.md](features/download-preview.md))
| ID | Task | Issue | Trạng thái |
|---|---|---|---|
| M3-01 | Celery tạo thumbnail cho ảnh và PDF | [#27](https://github.com/q2kit/qloud/issues/27) | ⬜ |
| M3-02 | API preview | [#28](https://github.com/q2kit/qloud/issues/28) | ⬜ |
| M3-03 | FE: trình xem file (ảnh, PDF, video, nhảy trước/sau, tải về) | [#29](https://github.com/q2kit/qloud/issues/29) | ⬜ |

## M4 — Thùng rác ([trash.md](features/trash.md))
| ID | Task | Issue | Trạng thái |
|---|---|---|---|
| M4-01 | API: đưa vào thùng rác, khôi phục, xóa vĩnh viễn, dọn sạch | [#30](https://github.com/q2kit/qloud/issues/30) | ⬜ |
| M4-02 | Celery: tự xóa vĩnh viễn sau 30 ngày; xóa blob trên S3 | [#31](https://github.com/q2kit/qloud/issues/31) | ⬜ |
| M4-03 | FE: trang Thùng rác, nút hoàn tác trên toast | [#32](https://github.com/q2kit/qloud/issues/32) | ⬜ |

## M5 — Chia sẻ ([sharing.md](features/sharing.md))
| ID | Task | Issue | Trạng thái |
|---|---|---|---|
| M5-01 | Model Share, mở rộng dịch vụ phân quyền cho quyền thừa kế | [#33](https://github.com/q2kit/qloud/issues/33) | ⬜ |
| M5-02 | API chia sẻ cho người dùng, danh sách "Được chia sẻ với tôi" | [#34](https://github.com/q2kit/qloud/issues/34) | ⬜ |
| M5-03 | Model và API ShareLink, endpoint public | [#35](https://github.com/q2kit/qloud/issues/35) | ⬜ |
| M5-04 | Email thông báo khi được chia sẻ | [#36](https://github.com/q2kit/qloud/issues/36) | ⬜ |
| M5-05 | FE: hộp thoại chia sẻ, trang Được chia sẻ, trang link công khai | [#37](https://github.com/q2kit/qloud/issues/37) | ⬜ |
| M5-06 | Bộ test phân quyền (ma trận role × thao tác) | [#38](https://github.com/q2kit/qloud/issues/38) | ⬜ |
| M5-07 | Báo cáo vi phạm: model, API public, email cho admin, công cụ kiểm duyệt trong Django admin, nút báo cáo trên S-12 | [#39](https://github.com/q2kit/qloud/issues/39) | ⬜ |

## M6 — Tìm kiếm ([search.md](features/search.md))
| ID | Task | Issue | Trạng thái |
|---|---|---|---|
| M6-01 | pg_trgm, API search có bộ lọc | [#40](https://github.com/q2kit/qloud/issues/40) | ⬜ |
| M6-02 | FE: command palette, trang kết quả | [#41](https://github.com/q2kit/qloud/issues/41) | ⬜ |

## M7 — Phiên bản ([versioning.md](features/versioning.md))
| ID | Task | Issue | Trạng thái |
|---|---|---|---|
| M7-01 | Upload phiên bản mới cho file đã có (upload trùng tên thì hỏi người dùng) | [#42](https://github.com/q2kit/qloud/issues/42) | ⬜ |
| M7-02 | API danh sách, tải về, khôi phục, xóa phiên bản | [#43](https://github.com/q2kit/qloud/issues/43) | ⬜ |
| M7-03 | FE: tab Phiên bản trong panel chi tiết | [#44](https://github.com/q2kit/qloud/issues/44) | ⬜ |

## M8 — Hoàn thiện và deploy ([quota.md](features/quota.md))
| ID | Task | Issue | Trạng thái |
|---|---|---|---|
| M8-01 | Trang dung lượng, cảnh báo khi gần đầy | [#45](https://github.com/q2kit/qloud/issues/45) | ⬜ |
| M8-02 | Rà soát bảo mật, rà soát trợ năng | [#46](https://github.com/q2kit/qloud/issues/46) | ⬜ |
| M8-03 | Dockerfile production, Compose production, nginx (Origin Certificate, phục vụ FE tĩnh, proxy `/api`, real IP từ Cloudflare), hướng dẫn cấu hình Cloudflare và ufw | [#47](https://github.com/q2kit/qloud/issues/47) | ⬜ |
| M8-04 | Deploy tự động qua GitHub Actions lên VPS | [#48](https://github.com/q2kit/qloud/issues/48) | ⬜ |
| M8-05 | Backup Postgres hằng ngày, Sentry, log có cấu trúc | [#49](https://github.com/q2kit/qloud/issues/49) | ⬜ |

---

## Nhật ký

> Mới nhất ở trên cùng. Mỗi dòng gồm: ngày — task — tóm tắt — người hoặc agent thực hiện.

- 2026-10-10 — M0-12 — Git hooks bằng lefthook 2.2.1: pre-commit (ruff, prettier + eslint trên file đã stage, gitleaks), commit-msg (Conventional Commits), pre-push (tên branch, chặn push `master`, kiểm tra phía có thay đổi). Quy tắc dùng chung ở `scripts/conventions.py` (hook + CI). Bật required checks `CI OK` + `PR conventions` (strict). — AI agent
- 2026-10-10 — M0-07 — Hoàn thiện design tokens và application shell responsive; đã kiểm tra local, chờ duyệt PR. — Codex
- 2026-10-10 — M0-07 — Review lần 2: rebase lên master, sửa phím tắt `i` bỏ qua mọi kiểu `contenteditable` (kèm test), đưa ảnh chụp vào `ui-ux.md`, đánh dấu M0-09 ✅. — Claude
- 2026-10-10 — M0-09 — CI GitHub Actions: backend (ruff, mypy, migration check, pytest), frontend (lint, format, typecheck, test, build), kiểm tra giấy phép (`scripts/check_licenses.py`), gitleaks, kiểm tra PR (`scripts/check_pr.py`), job tổng hợp `CI OK`. Action ghim theo SHA. LocalStack trong CI hoãn tới M2-03. — AI agent
- 2026-10-10 — — Viết lại các câu gọi người duyệt bằng danh xưng cho tự nhiên hơn (docs, AGENTS.md, README, mô tả issue). — AI agent
- 2026-10-10 — — Kế hoạch cưỡng chế rule bằng công cụ: mở rộng M0-09 (CI: giấy phép, gitleaks, kiểm tra PR, required checks); thêm M0-12 (git hooks bằng lefthook, #61); thêm M2-00 (script quy trình + skill, #62). — AI agent
- 2026-10-10 — — Sửa quy tắc rebase: chỉ rebase khi base branch có commit mới (kiểm tra bằng `git merge-base --is-ancestor`), không rebase vô điều kiện. — AI agent
- 2026-10-10 — — Đánh dấu M0-06 ✅ (đã merge ở #55). Thêm quy tắc đồng bộ trạng thái ROADMAP sau khi merge; hướng dẫn tạo `.env` dùng `cp -n` để không ghi đè secret. — AI agent
- 2026-10-10 — M0-06 — Dựng khung SPA với React, Vite, TypeScript, Tailwind/shadcn, Router, Query, i18n, theme, fetch CSRF và Vitest (Codex). Review: sửa `typecheck` (trước đó không kiểm tra file nào), bọc truy cập localStorage, dùng lucide-react 1.53.0 thay vì bỏ qua `minimumReleaseAge` của pnpm. — Codex + Claude
- 2026-10-10 — M0-05 — Khung BE: Django 6.1 + DRF + Celery trên Python 3.14 (uv), settings base/dev/test/prod, `/api/v1/health`, định dạng lỗi chung, cursor pagination, BaseModel UUIDv7, custom User tối thiểu (tạo trước migration đầu tiên), email theo `MAILERS` của Django 6.1. 19 test, coverage 100%, ruff + mypy strict sạch. — AI agent
- 2026-10-10 — — Thêm quy tắc luôn rebase lên base branch trước khi làm task và trước khi push/tạo PR. — AI agent
- 2026-10-09 — — Thêm quy tắc branch, commit message và PR (tiêu đề PR theo Conventional Commits + task ID; body tiếng Việt theo template) vào conventions.md và AGENTS.md; cập nhật PR template. — AI agent
- 2026-10-09 — M0-04 — `docker-compose.yml` (Postgres 18, Redis 8.10, LocalStack 2026.9.1, Mailpit 1.31) + script tạo bucket/CORS/lifecycle; `.env.example` cho compose và backend. Đã kiểm tra CORS, presigned multipart, ListParts, Range trên LocalStack. Chốt LocalStack thay MinIO (ADR-0007) và pnpm cho FE. — AI agent
- 2026-10-09 — M0-03 — Thêm `.gitignore`, `.editorconfig`, README gốc. — AI agent
- 2026-10-09 — — Đổi phương án deploy: Cloudflare proxy (Full strict, Origin Certificate) + nginx trên VPS, bỏ Caddy (ADR-0006). — AI agent
- 2026-10-09 — — Commit "Init" (docs). Tạo label, 9 milestone và 49 issue (#1–#49) trên GitHub cho các task; thêm cột Issue vào ROADMAP; thêm quy trình làm việc bằng `gh` vào AGENTS.md; domain cấu hình qua `.env`. — AI agent
- 2026-10-09 — M0-02 — Chốt: chống bot bằng Turnstile + plan mặc định 5 GB (bạn bè dùng `friends-2026`); báo cáo vi phạm + admin gỡ link/khóa user; deploy toàn bộ (cả FE) lên VPS, cùng origin. Docs được duyệt. — AI agent
- 2026-10-09 — M0-02 — Nâng bảng công nghệ lên bản ổn định mới nhất (Django 6.1, Python 3.14, PostgreSQL 18, React 19, Vite 8, TS 7, Tailwind 4); thêm luật "tra phiên bản trên registry, không dựa vào trí nhớ" vào AGENTS.md. — AI agent
- 2026-10-09 — M0-02 — Cập nhật docs theo câu trả lời: storage do `.env` quyết định, đăng ký mở + SMTP riêng, giới hạn theo Plan (ADR-0005), chọn pypdfium2 cho PDF, quy tắc giấy phép, hướng UI (teal, Be Vietnam Pro). — AI agent

- 2026-10-09 — M0-01 — Viết AGENTS.md và bộ docs ban đầu (overview, requirements, architecture, data-model, api, ui-ux, conventions, features, ADR). Chờ duyệt. — AI agent
