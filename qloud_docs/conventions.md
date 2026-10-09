# Quy ước

> File luật. Muốn thay đổi file này phải được chủ dự án đồng ý.

## Chung
- Code, comment, commit: tiếng Anh. Tài liệu: tiếng Việt.
- Chỉ viết comment để giải thích *tại sao*. Không viết comment lặp lại điều code đã nói rõ.
- Không để code chết, không để lại `print` hay `console.log`. Mỗi TODO phải kèm task ID, ví dụ `# TODO(M3-04): ...`.

## Giấy phép dependency
- Dự án dùng giấy phép **MIT**. Chỉ dùng dependency có giấy phép permissive: MIT, BSD, Apache-2.0, ISC, PSF, HPND, MPL-2.0, Unlicense.
- LGPL chỉ dùng được khi là thư viện liên kết động và đã ghi lại lý do (ví dụ psycopg).
- **Cấm GPL và AGPL** trong code được import hoặc đóng gói. Nếu thật sự cần thì phải hỏi chủ dự án.
- CI có bước kiểm tra giấy phép (`pip-licenses`, `license-checker`).

## Backend (Python / Django)
- Format và lint bằng `ruff`. Type check bằng `mypy` (strict cho `services` và `selectors`).
- Logic nghiệp vụ đặt trong `services.py` (ghi) và `selectors.py` (đọc). View và serializer chỉ làm phần mỏng.
- Thao tác ghi nhiều bảng phải bọc trong `transaction.atomic()`. Nếu có side effect bên ngoài (S3, Celery) thì dùng `transaction.on_commit`.
- Mọi truy vấn node đi qua `sharing.permissions`. Viết `Node.objects.filter(...)` trực tiếp trong view là **cấm**.
- Model: tên bảng `<app>_<model>`, có `id` UUID, `created_at`, `updated_at`.
- Migration: mỗi PR tạo tối đa một migration cho mỗi app. Migration phải đảo ngược được, trừ khi đã được duyệt.
- Mã lỗi API: định nghĩa tập trung trong `apps/core/errors.py`.

## Frontend (React / TypeScript)
- TypeScript `strict`, không dùng `any` (bắt buộc dùng `unknown` rồi thu hẹp kiểu).
- Component đặt tên PascalCase, mỗi file một component chính. Hook bắt đầu bằng `use`.
- Dữ liệu từ server chỉ lấy qua TanStack Query. Không lưu bản sao dữ liệu server vào Zustand.
- Mọi chuỗi UI dùng `t('...')`. Mọi màu dùng token.
- Truy cập được bằng bàn phím: phần tử tương tác phải là `button` hoặc `a` thật, có focus ring.

## Test
| Tầng | Công cụ | Bắt buộc |
|---|---|---|
| BE unit | pytest | Mọi service và selector có logic |
| BE API | pytest + DRF APIClient | Mọi endpoint: thành công, sai dữ liệu, chưa đăng nhập, **không có quyền** |
| BE S3 | LocalStack (dev và CI) | Luồng upload multipart, presign |
| FE unit | Vitest + Testing Library + MSW | Component và hook có logic |
| E2E | Playwright | Luồng chính của từng feature (đăng ký, upload, chia sẻ, xóa và khôi phục…) |

- Coverage tối thiểu: BE 85%, FE 70% (CI chặn PR nếu giảm). Test không được phụ thuộc thứ tự chạy hay mạng ngoài.
- Endpoint danh sách phải có test kiểm tra số lượng query (`django_assert_max_num_queries`).

## Git và CI
- Branch: `feat/<task-id>-<slug>`, `fix/...`, `docs/...`, `chore/...`.
- Commit theo Conventional Commits: `feat(sharing): add public share links`.
- PR theo `.github/pull_request_template.md`: task ID, `Closes #n`, thay đổi chính, cách test, ảnh chụp màn hình nếu có thay đổi UI.
- CI (GitHub Actions) chạy trên mỗi PR: lint, type check, test BE (Postgres, Redis, LocalStack dạng service; token lấy từ secret `LOCALSTACK_AUTH_TOKEN`), test FE, build FE, Playwright.
- Merge vào `master` (squash) chỉ khi CI xanh và chủ dự án đã duyệt.
- Thao tác GitHub (issue, PR, review, CI) dùng `gh` CLI. Quy trình chi tiết ở mục 3 của `AGENTS.md`.
