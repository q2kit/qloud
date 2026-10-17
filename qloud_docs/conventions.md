# Quy ước

> File luật. Mọi thay đổi trong file này phải được duyệt trước.

## Chung
- Code, comment, commit: tiếng Anh. Tài liệu: tiếng Việt.
- Chỉ viết comment để giải thích *tại sao*. Không viết comment lặp lại điều code đã nói rõ.
- Không để code chết, không để lại `print` hay `console.log`. Mỗi TODO phải kèm task ID, ví dụ `# TODO(M3-04): ...`.

## Giấy phép dependency
- Dự án là mã nguồn mở, giấy phép **MIT**. Dependency phải có giấy phép permissive.
- **Danh sách cho phép** (SPDX): MIT, MIT-0, 0BSD, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, PSF-2.0, Python-2.0, HPND, MPL-2.0, Unlicense, CC0-1.0, BlueOak-1.0.0, Zlib.
  Với biểu thức `A OR B` chỉ cần một vế được phép; `A AND B` thì cả hai.
- **Ngoại lệ theo từng package** (ghi lý do, khớp đúng chuỗi giấy phép): LGPL cho thư viện liên kết động (psycopg); FFmpeg/ffprobe LGPL-2.1-or-later cho subprocess thumbnail trên worker, chỉ build không GPL/nonfree/version3 bằng `scripts/build_ffmpeg.py`, giữ shared libraries, source và notice (owner duyệt [#121](https://github.com/q2kit/qloud/issues/121#issuecomment-6103108839)); nội dung không phải code như font (OFL-1.1) hay dữ liệu dùng lúc build (CC-BY-4.0, caniuse-lite).
- **Cấm GPL, AGPL** và giấy phép không phải mã nguồn mở (SSPL, BUSL, Commons Clause…). Nếu thật sự cần thì phải hỏi trước.
- CI kiểm tra bằng `scripts/check_licenses.py` (dữ liệu từ `pip-licenses` và `pnpm licenses list`). Giấy phép lạ hoặc không xác định thì **fail** cho tới khi được xem xét và thêm vào danh sách hoặc ngoại lệ.

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
- Gọi API qua client có kiểu `api` (`src/lib/api/client.ts`) + `unwrap()`; không dùng `fetch` trực tiếp. Đổi API thì sinh lại `openapi.yaml` và `schema.d.ts` (xem `api.md`).
- Mọi chuỗi UI dùng `t('...')`. Mọi màu dùng token.
- Truy cập được bằng bàn phím: phần tử tương tác phải là `button` hoặc `a` thật, có focus ring.

## Test
| Tầng | Công cụ | Bắt buộc |
|---|---|---|
| BE unit | pytest | Mọi service và selector có logic |
| BE API | pytest + DRF APIClient | Mọi endpoint: thành công, sai dữ liệu, chưa đăng nhập, **không có quyền** |
| BE S3 | LocalStack (dev và CI) | Luồng upload multipart, presign |
| FE unit | Vitest + Testing Library + MSW | Component và hook có logic |
| E2E | Playwright (`qloud_frontend/e2e/`) | Luồng chính của từng feature (đăng ký, upload, chia sẻ, xóa và khôi phục…). Chạy trên stack thật, **không mock API**; tìm phần tử theo role/nhãn, không theo class CSS |

- Coverage tối thiểu: BE 85%, FE 70% (CI chặn PR nếu coverage thấp hơn ngưỡng; chưa so sánh mức tăng/giảm giữa các PR). Test không được phụ thuộc thứ tự chạy hay mạng ngoài.
- Endpoint danh sách phải có test kiểm tra số lượng query (`django_assert_max_num_queries`).

## Git và CI

> Quy tắc đặt tên (type, scope, branch, tiêu đề PR) chỉ định nghĩa ở `scripts/conventions.py`, dùng chung cho git hooks và CI.
> Muốn thêm scope thì sửa file đó và danh sách dưới đây cùng lúc.

### Branch
- `master` được bảo vệ: chỉ nhận thay đổi qua PR, squash merge, khi CI xanh. **Không** commit hay push thẳng.
- **Tạm thời** PR của task và Dependabot vào `develop` (cũng không commit hay push thẳng); CI chỉ chạy với PR vào `master`, nên PR vào `develop` phải qua kiểm tra trên máy (`scripts/workflow.py pr-open`).
- **Tên:** `<type>/<task-id>-<slug>`; việc không thuộc task nào thì bỏ `<task-id>`. `slug` tiếng Anh, kebab-case, tối đa 40 ký tự.
  Ví dụ: `feat/M2-04-upload-session`, `docs/commit-pr-rules`.
- Một branch cho một task và một PR, tạo từ `develop` mới nhất. Không dùng lại branch đã merge.
- **Chỉ rebase khi base có commit mới**, kiểm tra trước khi bắt đầu làm và trước khi push/tạo PR:
  `git fetch origin && git merge-base --is-ancestor origin/<base> HEAD || git rebase origin/<base>`.
  Có rebase thì chạy lại lint và test rồi mới push. **Không** merge base vào branch làm việc. PR báo conflict thì tự rebase và giải quyết.
- **Force push:** chỉ trên branch của chính mình, sau khi rebase, luôn dùng `--force-with-lease`. Cấm với `master` và branch của người khác.
- **Branch nối tiếp (stacked)** chỉ khi task mới cần code của PR chưa merge: tạo từ branch kia, `gh pr create --base <branch-kia>`, ghi rõ ở đầu body.
  PR kia merge xong thì `git rebase --onto origin/develop <commit-cuối-của-branch-kia>` và `gh pr edit <n> --base develop`.
- Việc kéo dài nhiều phiên: push sớm, mở PR nháp (`--draft`), xong thì `gh pr ready`. Sau khi merge: xóa branch local và `git fetch --prune`.

### Commit message
[Conventional Commits](https://www.conventionalcommits.org/), tiếng Anh: `<type>(<scope>): <subject>`, rồi body, rồi footer.

- **type:** `feat`, `fix`, `docs`, `test`, `refactor` (không đổi hành vi), `perf`, `chore` (cấu hình, tooling), `ci`, `build` (Docker, dependency).
- **scope** (bắt buộc): BE là tên Django app (`accounts`, `drive`, `uploads`, `sharing`, `trash`, `search`, `storage`, `core`);
  FE là `fe` hoặc `fe-<feature>`; khác: `api`, `dev`, `env`, `ci`, `deploy`, `deps`, `repo`, `docs`, `roadmap`, `adr`.
- **subject:** mệnh lệnh ("add", không phải "added"), chữ đầu viết thường, không dấu chấm cuối; cả dòng đầu tối đa 72 ký tự.
- **body:** giải thích *tại sao*, xuống dòng ở 72 ký tự. **footer:** `Refs #<n>` (không dùng `Closes` trong commit);
  thay đổi phá vỡ tương thích thì `BREAKING CHANGE: ...` và `!` sau scope; commit do AI agent tạo thì dòng cuối là `Co-Authored-By: <model> <noreply@anthropic.com>`.
- Mỗi commit là một thay đổi logic, build và test vẫn chạy. Không trộn format lại code với thay đổi logic.

### Pull Request
- **Tiêu đề** (tiếng Anh, thành commit squash): `<type>(<scope>): <subject> [<task-id>]`, tối đa **65 ký tự** (GitHub thêm ` (#123)`).
  Ví dụ `feat(uploads): add multipart upload session API [M2-04]`.
- **Body** (tiếng Việt) theo `.github/pull_request_template.md`:
  - `Closes #<n>` cho mỗi issue; PR không thuộc task nào thì ghi rõ.
  - Thay đổi chính: *cái gì* và *tại sao*, không dán diff.
  - Cách kiểm tra: lệnh **đã thực sự chạy** và kết quả; điều chưa kiểm tra được thì ghi rõ.
  - Lưu ý cho reviewer: migration, biến môi trường, dependency mới (kèm giấy phép), thao tác thủ công, rủi ro.
  - Ảnh chụp light và dark khi đổi UI.
  - PR do AI agent tạo: dòng cuối là `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Một PR một task. Quá 600 dòng thay đổi (không tính lockfile và code sinh tự động) thì cân nhắc chia nhỏ.

### Kiểm tra tự động
- **Required checks** của `master` (strict): `CI OK` (`.github/workflows/ci.yml`) và `PR conventions` (`pr.yml`). Cả hai workflow tạm thời chỉ chạy với PR vào `master`.
  - `ci.yml` chỉ chạy phía có thay đổi: Backend (ruff, mypy, migration còn thiếu, `check --deploy`, pytest, giấy phép, test của `scripts/`),
    Frontend (lint, format, typecheck, test, build, giấy phép, type API khớp `openapi.yaml`), E2E (Playwright trên stack thật), gitleaks.
  - `pr.yml`: tiêu đề, `Closes #n` khi có task ID, tên branch (trừ branch của Dependabot); cảnh báo khi sửa code mà không sửa ROADMAP.
- **Git hooks** (`lefthook.yml`): pre-commit format/lint file đã stage + gitleaks; commit-msg; pre-push kiểm tra tên branch, chặn push `master` và `develop`,
  chạy typecheck và test phía có thay đổi. Không dùng `--no-verify` khi chưa được cho phép.
- **Dependabot** (`.github/dependabot.yml`) mở PR `chore(deps): Bump ...` hằng tuần (kiểm tra PR bỏ qua chữ hoa và độ dài tiêu đề của bot);
  bản major phải hỏi trước khi merge; `@types/node` giữ cùng major với Node.
- Action bên thứ ba ghim theo commit SHA (kèm comment phiên bản).
