# Quy ước

> File luật. Mọi thay đổi trong file này phải được duyệt trước.

## Chung
- Code, comment, commit: tiếng Anh. Tài liệu: tiếng Việt.
- Chỉ viết comment để giải thích *tại sao*. Không viết comment lặp lại điều code đã nói rõ.
- Không để code chết, không để lại `print` hay `console.log`. Mỗi TODO phải kèm task ID, ví dụ `# TODO(M3-04): ...`.

## Giấy phép dependency
- Dự án dùng giấy phép **MIT**. Chỉ dùng dependency có giấy phép permissive: MIT, BSD, Apache-2.0, ISC, PSF, HPND, MPL-2.0, Unlicense.
- LGPL chỉ dùng được khi là thư viện liên kết động và đã ghi lại lý do (ví dụ psycopg).
- **Cấm GPL và AGPL** trong code được import hoặc đóng gói. Nếu thật sự cần thì phải hỏi trước.
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
### Branch
- `master` là nhánh chính, được bảo vệ (branch protection): **không commit hay push thẳng**, chỉ nhận thay đổi qua PR và squash merge.
- **Tên branch:** `<type>/<task-id>-<slug>`
  - `type`: dùng chung danh sách với commit — `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`, `build`.
  - `task-id`: ID trong ROADMAP, ví dụ `M2-04`. Việc không thuộc task nào thì bỏ phần này.
  - `slug`: tiếng Anh, kebab-case, chỉ gồm `a-z`, `0-9` và `-`, tối đa 40 ký tự.
  - Ví dụ: `feat/M2-04-upload-session`, `fix/M2-04-quota-race`, `chore/M0-04-dev-compose`, `docs/commit-pr-rules`.
- **Một branch cho một task và một PR.** Không dùng lại branch đã merge; việc mới thì tạo branch mới.
- **Tạo branch từ `master` mới nhất:** `git switch master && git pull --ff-only && git switch -c <branch>`.
- **Branch nối tiếp (stacked):** chỉ dùng khi task mới cần code của một PR chưa merge.
  - Tạo branch từ branch của PR kia, và mở PR với `--base <branch-kia>`. Đầu body PR ghi rõ là phụ thuộc PR nào.
  - Sau khi PR kia merge: `git rebase --onto origin/master <commit-cuối-của-branch-kia>`, rồi `gh pr edit <n> --base master`.
- **Kiểm tra base branch** (`master`, hoặc branch cha nếu là branch nối tiếp) vào hai thời điểm, và **chỉ rebase khi base có commit mới** (branch chưa chứa `origin/<base>`):
  1. **Trước khi bắt đầu làm task**, kể cả khi tiếp tục một branch đã có từ phiên trước.
  2. **Trước khi push hoặc tạo PR.**

  Lệnh: `git fetch origin && git merge-base --is-ancestor origin/<base> HEAD || git rebase origin/<base>`
  (`merge-base --is-ancestor` trả về thành công nghĩa là branch đã chứa base mới nhất → không cần rebase.)
  Nếu có rebase: giải quyết conflict (nếu có), chạy lại lint và test, rồi mới push. Base không đổi thì không rebase.
  **Không** merge base branch vào branch làm việc.
- Khi PR báo conflict trên GitHub: agent tự rebase và giải quyết conflict, không cần chờ.
  Conflict ở Nhật ký ROADMAP thì giữ dòng của cả hai bên, dòng mới hơn ở trên.
- **Force push:** chỉ được làm trên branch làm việc của chính mình, sau khi rebase, và luôn dùng `--force-with-lease`. **Cấm** force push lên `master` hoặc lên branch của người khác.
- **Việc kéo dài nhiều phiên:** push branch sớm và mở PR ở dạng nháp (`gh pr create --draft`), để tiến độ hiện trên GitHub.
  Khi xong thì chuyển sang chờ review bằng `gh pr ready`.
- **Sau khi merge:** xóa branch trên remote (`gh pr merge --squash --delete-branch`, hoặc GitHub tự xóa), xóa branch local, và chạy `git fetch --prune`.
- Không để branch không có PR tồn tại quá một phiên làm việc; bỏ việc thì xóa branch đó.

### Commit message
Theo [Conventional Commits](https://www.conventionalcommits.org/), **tiếng Anh**:

```
<type>(<scope>): <subject>

<body — không bắt buộc>

<footer>
```

- **type:** `feat` (tính năng), `fix` (sửa bug), `docs`, `test`, `refactor` (không đổi hành vi), `perf`, `chore` (cấu hình, repo, dev tooling), `ci`, `build` (Docker, dependency).
- **scope** (bắt buộc), chọn đúng nơi thay đổi:
  - BE: tên Django app — `accounts`, `drive`, `uploads`, `sharing`, `trash`, `search`, `storage`, `core`.
  - FE: `fe` hoặc `fe-<feature>` — ví dụ `fe-upload`, `fe-ui`, `fe-i18n`.
  - Khác: `api` (OpenAPI/client), `dev` (môi trường dev), `env`, `ci`, `deploy`, `deps`, `repo`, `docs`, `roadmap`, `adr`.
- **subject:** câu mệnh lệnh ("add", không phải "added"/"adds"), viết thường chữ đầu, không có dấu chấm cuối, tối đa 72 ký tự cho cả dòng đầu.
- **body:** giải thích *tại sao* và các điểm không hiển nhiên; xuống dòng ở 72 ký tự. Không liệt kê lại diff.
- **footer:**
  - `Refs #<n>` để liên kết issue. Không dùng `Closes` trong commit — việc đóng issue do PR làm.
  - Thay đổi phá vỡ tương thích: `BREAKING CHANGE: <mô tả>` (và thêm `!` sau scope: `feat(api)!: ...`).
  - Commit do AI agent tạo: dòng cuối là trailer `Co-Authored-By: <tên model> <noreply@anthropic.com>`.
- Mỗi commit là **một thay đổi logic**, build/test vẫn chạy được. Không trộn format lại code với thay đổi logic.

Ví dụ:
```
feat(uploads): reserve quota when creating an upload session

Reservation happens under SELECT FOR UPDATE on the owner row so two
concurrent sessions cannot both pass the quota check.

Refs #20
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Pull Request
- **Tiêu đề:** cùng định dạng với commit, kèm task ID ở cuối: `<type>(<scope>): <subject> [<task-id>]`,
  ví dụ `feat(uploads): add multipart upload session API [M2-04]`.
  Vì merge kiểu squash, tiêu đề PR sẽ thành commit trên `master`, nên phải đúng Conventional Commits. Viết tiếng Anh.
- **Body:** **tiếng Việt**, theo `.github/pull_request_template.md`. Bắt buộc:
  - **Task:** task ID và `Closes #<n>` (mỗi issue một dòng `Closes`). PR không thuộc task nào thì ghi rõ lý do.
  - **Thay đổi chính:** gạch đầu dòng, nói *cái gì* và *tại sao*, không dán diff.
  - **Cách kiểm tra:** lệnh đã thực sự chạy và kết quả (ví dụ `pytest: 42 passed`). Không ghi là đã test nếu chưa chạy.
    Điều gì chưa kiểm tra được thì ghi rõ.
  - **Lưu ý cho reviewer:** migration mới, biến môi trường mới, dependency mới (kèm giấy phép), thao tác thủ công cần thực hiện (tạo secret, cấu hình…), rủi ro.
    Không có thì ghi "Không có".
  - **Ảnh chụp màn hình** (light và dark) khi có thay đổi UI.
  - **Checklist:** chỉ tick mục đã làm thật.
  - PR do AI agent tạo: dòng cuối là `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- PR **nối tiếp** (stacked, base không phải `master`): ghi rõ ở đầu body là phụ thuộc PR nào. Sau khi PR kia merge thì rebase lên `master` và đổi base.
- Một PR một task. PR quá 600 dòng thay đổi (không tính lockfile và code sinh tự động) thì cân nhắc chia nhỏ.
- **CI** (`.github/workflows/ci.yml`) chạy trên mỗi PR và mỗi lần push lên `master`:
  - **Backend** (khi `qloud_backend/` hoặc file dùng chung thay đổi): ruff format/check, mypy, kiểm tra migration còn thiếu, pytest + coverage (Postgres, Redis qua `docker compose`; LocalStack thêm ở M2-03), kiểm tra giấy phép.
  - **Frontend** (khi `qloud_frontend/` hoặc file dùng chung thay đổi): lint, format, typecheck, test + coverage, build, kiểm tra giấy phép.
  - **Secret scan:** gitleaks trên các commit của PR.
  - **PR conventions** (workflow riêng `.github/workflows/pr.yml`, chạy lại cả khi sửa tiêu đề/body; `scripts/check_pr.py`): tiêu đề đúng định dạng; có `[task-id]` thì body phải có `Closes #n`; cảnh báo nếu sửa code mà không sửa ROADMAP.
  - **CI OK:** job tổng hợp của `ci.yml`. *Required status checks* cần đặt: **`CI OK`** và **`PR conventions`**.
  - Kiểm tra giấy phép dùng `scripts/check_licenses.py`; LGPL chỉ được phép khi có trong `LGPL_ALLOWED` kèm lý do.
  - Action bên thứ ba được ghim theo commit SHA (kèm comment phiên bản).
- Merge vào `master` (squash) chỉ khi CI xanh và PR đã được duyệt.
- Thao tác GitHub (issue, PR, review, CI) dùng `gh` CLI. Quy trình chi tiết ở mục 3 của `AGENTS.md`.
