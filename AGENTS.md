# AGENTS.md — Hướng dẫn cho AI agent làm việc trên Qloud

Qloud là ứng dụng lưu trữ và chia sẻ file trên web (cùng loại với Google Drive, nhưng có thiết kế riêng).
Toàn bộ dự án được phát triển bởi AI agent; mọi quyết định lớn và mọi lần merge đều do người duyệt.
File này là **luật làm việc**. Nếu tài liệu khác mâu thuẫn với file này thì theo file này, và báo lại để sửa.

---

## 1. Cấu trúc repo

```
/
├── AGENTS.md            # File này — luật cho agent
├── CLAUDE.md            # Chỉ trỏ tới AGENTS.md
├── qloud_docs/          # Tài liệu: nguồn sự thật về sản phẩm, kiến trúc, tiến độ
├── qloud_backend/       # Django + DRF (Python)
└── qloud_frontend/      # React + TypeScript (Vite)
```

Đọc [qloud_docs/README.md](qloud_docs/README.md) để biết từng tài liệu dùng vào việc gì.

## 2. Ngôn ngữ

- **Tài liệu, mô tả task, trao đổi trong phiên làm việc:** tiếng Việt.
- **Code, tên biến, comment trong code, commit message, tên branch, tên file code:** tiếng Anh.
- **Chuỗi hiển thị trên UI:** không viết cứng trong code, luôn dùng i18n key (hỗ trợ `vi` và `en`, mặc định `vi`).

## 3. Quy trình cho mỗi phiên làm việc

Repo: `q2kit/qloud` trên GitHub, nhánh chính là **`master`**. Mọi thao tác với GitHub dùng **`gh` CLI** (đã đăng nhập sẵn).
Mỗi task trong ROADMAP có một **GitHub Issue** tương ứng (cột *Issue* trong ROADMAP). Mỗi task được giao qua **một Pull Request**.

1. **Định hướng.**
   - Đọc [qloud_docs/ROADMAP.md](qloud_docs/ROADMAP.md) và [qloud_docs/open-questions.md](qloud_docs/open-questions.md).
   - Xem trạng thái trên GitHub: `gh pr list`, `gh pr list --state merged --limit 5`, `gh issue list --milestone "<milestone>"`.
     Đối chiếu với ROADMAP: PR đã merge mà task vẫn là 🟦 thì phải đồng bộ (xem bước 9). Có PR nào đang mở, đang bị yêu cầu sửa (review) hay CI đỏ thì xử lý trước, rồi mới làm task mới.
   - Chọn task tiếp theo: task chưa làm, đứng đầu milestone hiện tại, và không phụ thuộc vào task nào chưa xong.
2. **Nhận task.**
   - `gh issue view <n>` để đọc issue.
   - `gh issue edit <n> --add-assignee @me --add-label status:in-progress`.
   - Tạo branch từ `master` mới nhất: `git switch master && git pull --ff-only && git switch -c <type>/<task-id>-<slug>`, ví dụ `feat/M2-04-upload-session`.
   - **Tiếp tục một branch đã có** (làm tiếp task, sửa theo review): kiểm tra base trước khi làm, **chỉ rebase nếu base có commit mới**: `git fetch origin && git merge-base --is-ancestor origin/<base> HEAD || git rebase origin/<base>`.
3. **Đọc ngữ cảnh.** Đọc file feature liên quan trong `qloud_docs/features/`, cùng các phần liên quan
   của `architecture.md`, `data-model.md`, `api.md`, `ui-ux.md` và `conventions.md`. Không đọc thừa những gì không cần.
4. **Lập kế hoạch.** Với task lớn (nhiều file, schema mới, API mới): viết kế hoạch ngắn thành comment trên issue (`gh issue comment <n>`),
   thêm label `needs:owner-decision` và báo lại. **Chờ được duyệt** rồi mới code. Task nhỏ, rõ ràng thì làm luôn.
5. **Thực hiện.** Code + test đi cùng nhau (xem mục 6). Mỗi PR chỉ chứa một task. Commit nhỏ, theo Conventional Commits.
6. **Kiểm tra trên máy.** Chạy lint, type check và test của phần đã sửa. Không mở PR khi test còn đỏ.
7. **Cập nhật tài liệu, bắt buộc, trong cùng PR:**
   - Đổi trạng thái task trong `ROADMAP.md` thành 🟦 (chờ duyệt), và thêm một dòng vào mục *Nhật ký*.
   - Nếu hành vi, API, schema hay màn hình thay đổi thì sửa tài liệu tương ứng.
   - Nếu có quyết định kiến trúc mới thì tạo ADR trong `qloud_docs/adr/`.
   - Nếu phát sinh câu hỏi chưa trả lời được thì ghi vào `open-questions.md`.
8. **Mở PR.**
   - **Trước khi push hoặc tạo PR, kiểm tra base branch; chỉ rebase nếu base có commit mới**: `git fetch origin && git merge-base --is-ancestor origin/<base> HEAD || git rebase origin/<base>`.
     Nếu có rebase: giải quyết conflict (nếu có), chạy lại lint và test rồi mới push.
   - `git push -u origin HEAD` (sau khi rebase một branch đã push thì dùng `git push --force-with-lease`),
     rồi `gh pr create --base <base> --title "<type>(<scope>): <subject> [<task-id>]" --body-file <file>`.
   - Body PR theo [.github/pull_request_template.md](.github/pull_request_template.md), và **phải có `Closes #<n>`**.
   - Theo dõi CI bằng `gh pr checks --watch`. CI đỏ thì sửa cho tới khi xanh.
9. **Review và merge.** **Agent không tự merge.** Chỉ merge (`gh pr merge --squash --delete-branch`) khi được yêu cầu rõ ràng cho đúng PR đó.
   Có góp ý review thì đọc bằng `gh pr view <n> --comments`, sửa trên cùng branch, rồi trả lời từng góp ý.
   Đổi trạng thái task trong ROADMAP sang ✅:
   - **Agent merge** (khi được yêu cầu): push một commit đổi sang ✅ vào chính PR đó, rồi mới merge.
   - **PR được merge từ bên ngoài phiên:** ở đầu phiên làm việc tiếp theo, agent kiểm tra các PR đã merge (`gh pr list --state merged`).
     Nếu task tương ứng trong ROADMAP vẫn là 🟦 thì đổi sang ✅ trong PR kế tiếp; nếu chưa có PR nào sắp mở thì mở một PR nhỏ chỉ để làm việc này.
   - Không để ROADMAP trên `master` lệch với GitHub quá một phiên làm việc.
10. **Báo cáo.** Tóm tắt: link PR, đã làm gì, đã kiểm tra thế nào, còn tồn đọng gì.

**Các tình huống khác:**
- Phát hiện bug hoặc việc ngoài phạm vi task: không sửa lẫn vào PR hiện tại. Tạo issue mới: `gh issue create --label bug|enhancement --milestone ...`.
  Nếu đó là việc phải làm trong MVP thì thêm dòng vào ROADMAP.
- Bị chặn: thêm label `status:blocked`, comment lý do trên issue, và đánh dấu ⛔ trong ROADMAP.
- Task quá lớn so với một PR: chia thành các task con `M2-04a`, `M2-04b`, mỗi task con có issue riêng, rồi cập nhật ROADMAP.

**Nhãn (label) dùng trên GitHub:**
- `area:backend`, `area:frontend`, `area:infra`, `area:docs`: phần của hệ thống mà task động tới.
- `type:feature`, `type:chore`, `type:test`, cùng `bug` và `enhancement`: loại việc.
- `status:in-progress`, `status:blocked`, `needs:owner-decision`: trạng thái.

Milestone trên GitHub trùng tên với milestone trong ROADMAP (M0…M8).

> Nguyên tắc: **docs và code phải luôn khớp nhau.** Người hoặc agent đọc docs phải nắm được hệ thống đang làm được gì và tiến độ tới đâu.

## 4. Những việc PHẢI hỏi trước khi làm

- Thêm, đổi hoặc bỏ một **công nghệ chính**: framework, database, hạ tầng, dịch vụ trả phí.
- Thêm **dependency mới** không nằm trong danh sách ở `architecture.md` (thư viện nhỏ dùng cho dev hoặc test thì có thể tự thêm, nhưng phải ghi lại).
- Thay đổi **data model** theo kiểu phá vỡ dữ liệu hiện có: xóa hoặc đổi tên cột/bảng, migration không đảo ngược được.
- Thay đổi **API đã công bố** theo kiểu không tương thích ngược.
- Bất cứ thay đổi nào về **bảo mật, xác thực, phân quyền**, ngoài việc làm đúng như tài liệu đã mô tả.
- Thay đổi **phạm vi sản phẩm**: thêm hoặc bớt tính năng so với `requirements.md`.
- Thay đổi **hướng thiết kế UI** (design system, màu, bố cục tổng thể).
- Thao tác khó hoàn tác: xóa dữ liệu, force push lên `master` hoặc branch của người khác, sửa lịch sử git đã merge, thao tác trên môi trường production.
  (Rebase rồi `--force-with-lease` trên branch làm việc của chính mình thì được phép.)
- Sửa các file luật: `AGENTS.md` và `qloud_docs/conventions.md`.

Những việc được **tự làm**: code theo task đã có trong ROADMAP, viết test, refactor nội bộ không đổi hành vi,
sửa bug, cập nhật docs cho khớp với code, tạo branch, commit, push branch, tạo issue và PR, comment trên issue hoặc PR.
**Không được** push thẳng lên `master`, tự merge PR khi chưa được đồng ý, đóng issue của người khác, hay sửa cấu hình repo (branch protection, secrets).

## 5. Công nghệ đã chốt (tóm tắt)

| Phần | Lựa chọn |
|---|---|
| Backend | Python 3.14, Django 6.1, Django REST Framework, drf-spectacular (OpenAPI) |
| Auth | django-allauth (headless): email/mật khẩu, Google, GitHub |
| Tác vụ nền | Celery + Redis |
| Database | PostgreSQL 18 |
| Lưu file | Object storage tương thích S3. Dùng AWS S3 hay Cloudflare R2 là do `.env` quyết định; code không phụ thuộc nhà cung cấp. Dev và CI: LocalStack (cần auth token) |
| Frontend | pnpm, React 19, TypeScript 6 (7 chưa tương thích typescript-eslint — #56), Vite 8, React Router 8, TanStack Query 5, Tailwind CSS 4, shadcn/ui (Radix), i18next |
| Test | pytest (BE), Vitest + Testing Library (FE), Playwright (E2E) |
| Email | SMTP riêng (cấu hình qua `.env`); dev dùng Mailpit |
| Hạ tầng | Docker Compose, VPS, GitHub Actions |
| Giấy phép | MIT. Chỉ dùng dependency có giấy phép permissive (xem `conventions.md`) |

Chi tiết và lý do: xem [qloud_docs/architecture.md](qloud_docs/architecture.md) và thư mục `qloud_docs/adr/`.

**Luật về phiên bản:** dùng **bản ổn định mới nhất** của mọi công nghệ.
- **Không dựa vào trí nhớ** để chọn phiên bản, vì kiến thức của model có thể đã cũ.
  Trước khi thêm hoặc khởi tạo một package, tra phiên bản trên registry (`pip index versions <pkg>` / PyPI JSON API, `npm view <pkg> version`).
- Đọc **tài liệu chính thức của đúng phiên bản đang dùng** (release notes, hướng dẫn migration) trước khi dùng API mới. Không viết theo cú pháp của phiên bản cũ.
- Kiểm tra tính tương thích giữa các package (ví dụ một thư viện Django đã hỗ trợ Django 6.1 chưa). Nếu bản mới nhất chưa tương thích thì dùng bản thấp hơn gần nhất, và ghi lý do vào `architecture.md`.
- Ghim phiên bản bằng lockfile (`uv.lock` cho BE, `pnpm-lock.yaml` cho FE). Bảng phiên bản trong `architecture.md` phải khớp với lockfile.
- Dependabot hoặc Renovate tự mở PR nâng phiên bản; nâng major version thì phải hỏi trước.

## 6. Tiêu chuẩn chất lượng (Definition of Done)

Một task chỉ được tính là xong khi đạt đủ các điều sau:

- [ ] Đáp ứng mọi tiêu chí chấp nhận (acceptance criteria) trong file feature.
- [ ] Có test:
  - BE: unit test cho logic nghiệp vụ; API test cho mọi endpoint, gồm cả trường hợp lỗi và **trường hợp không có quyền**.
  - FE: test cho component và hook có logic; Playwright E2E cho luồng chính của feature.
- [ ] Lint, format và type check đều sạch (ruff, mypy cho BE; eslint, prettier, tsc cho FE).
- [ ] Migration chạy được trên database trống và trên database đã có dữ liệu.
- [ ] Không có chuỗi UI viết cứng; có đủ bản dịch `vi` và `en`.
- [ ] UI dùng được ở cả light mode và dark mode, và responsive tới màn hình 360px.
- [ ] Docs đã được cập nhật (mục 3, bước 6).

## 7. Nguyên tắc kỹ thuật bắt buộc

Hiện tại chỉ có ít người dùng, nhưng hệ thống phải được thiết kế để **mở rộng được** mà không phải viết lại:

- **Byte của file không bao giờ đi qua server ứng dụng.** Upload và download dùng presigned URL thẳng tới S3.
- **Kiểm tra quyền ở phía server, cho mọi request.** Không tin bất cứ thứ gì từ client. Mọi truy vấn file và folder phải đi qua lớp phân quyền chung, không tự viết truy vấn riêng lẻ.
- **Server stateless:** không lưu trạng thái trên đĩa local hay trong bộ nhớ process. Có thể chạy nhiều instance song song.
- **ID công khai dùng UUID**, không để lộ ID tự tăng.
- **Phân trang mọi danh sách** (dùng cursor pagination). Không có endpoint nào trả toàn bộ dữ liệu.
- **Tránh N+1 query:** dùng `select_related`/`prefetch_related`; test cho các endpoint danh sách có kiểm tra số lượng query.
- **Việc nặng thì đưa vào Celery:** thumbnail, dọn thùng rác, dọn upload dở dang.
- **Cấu hình lấy từ biến môi trường** (12-factor). Không commit secret.
- **Quota và số liệu dung lượng phải nhất quán:** cập nhật trong transaction, có khóa phù hợp.

## 8. Lệnh thường dùng

> Mọi khối lệnh chạy được từ **bất kỳ thư mục nào trong repo** và dán nguyên khối vào **một** terminal.
> Quy tắc khi viết thêm: `cd` theo đường dẫn từ gốc repo (`git rev-parse --show-toplevel`); nối lệnh bằng `&&` để dừng khi có bước lỗi;
> lệnh chỉ chạy một lần và lệnh có thể xóa/ghi đè dữ liệu luôn nằm ở khối riêng.

**Cài đặt lần đầu** (chạy lại cũng an toàn: chỉ tạo `.env` khi chưa có, không bao giờ ghi đè):

```bash
cd "$(git rev-parse --show-toplevel)" &&
  { [ -f .env ] || cp .env.example .env; } &&                                    # rồi điền LOCALSTACK_AUTH_TOKEN
  { [ -f qloud_backend/.env ] || cp qloud_backend/.env.example qloud_backend/.env; } &&
  brew install lefthook gitleaks && lefthook install &&   # git hooks (lefthook.yml)
  (cd qloud_backend && uv sync) &&
  (cd qloud_frontend && pnpm install && pnpm exec playwright install chromium)
```

**Chạy dev** — hạ tầng trước, rồi mỗi server một terminal:

```bash
cd "$(git rev-parse --show-toplevel)" && docker compose up -d --wait   # Postgres, Redis, LocalStack (S3), Mailpit
```

```bash
cd "$(git rev-parse --show-toplevel)/qloud_backend" && uv run python manage.py migrate && uv run python manage.py runserver
```

```bash
cd "$(git rev-parse --show-toplevel)/qloud_frontend" && pnpm dev
```

```bash
cd "$(git rev-parse --show-toplevel)/qloud_backend" && uv run celery -A config worker -l info   # chỉ khi cần worker
```

| Địa chỉ | Là gì |
|---|---|
| http://localhost:5173 | Frontend (Vite, proxy `/api` và `/admin` sang :8000) |
| http://localhost:8000/api/v1/health · `/api/docs/` · `/admin/` | Backend: health, Swagger UI, Django admin |
| http://localhost:8025 | Mailpit (email dev) |
| http://localhost:4566 | LocalStack S3 (bucket `qloud-dev`) |

**Kiểm tra trước khi mở PR** — giống CI (cần hạ tầng đang chạy):

```bash
cd "$(git rev-parse --show-toplevel)/qloud_backend" && uv run ruff format --check . && uv run ruff check . && uv run mypy . && uv run pytest --cov
cd "$(git rev-parse --show-toplevel)/qloud_frontend" && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test:coverage && pnpm build && pnpm test:e2e
```

**Sau khi đổi API** — sinh lại schema và type, commit cả hai (CI chặn nếu cũ):

```bash
cd "$(git rev-parse --show-toplevel)/qloud_backend" && uv run python manage.py spectacular --file openapi.yaml --validate --fail-on-warn
cd "$(git rev-parse --show-toplevel)/qloud_frontend" && pnpm api:generate
```

**Lệnh hay dùng khác:**

| Việc | Lệnh (từ thư mục tương ứng) |
|---|---|
| Tự sửa format + lint | BE: `uv run ruff check --fix . && uv run ruff format .` · FE: `pnpm format && pnpm lint --fix` |
| Tạo migration | BE: `uv run python manage.py makemigrations <app>` |
| Tạo tài khoản admin | BE: `uv run python manage.py createsuperuser` |
| Chạy một test | BE: `uv run pytest apps/core/tests/test_health.py -k ok` · FE: `pnpm vitest run src/app/router.test.tsx` · E2E: `pnpm test:e2e -g "404"` |
| Xem report E2E | FE: `pnpm exec playwright show-report` |
| Dừng hạ tầng (giữ dữ liệu) | gốc repo: `docker compose down` |

**Xóa toàn bộ dữ liệu dev** (Postgres, Redis, file trên LocalStack) — **không hoàn tác được, phải hỏi trước khi chạy**:

```bash
cd "$(git rev-parse --show-toplevel)" && docker compose down -v
```

## 9. Git

- `master` luôn ở trạng thái deploy được, được bảo vệ, chỉ nhận thay đổi qua PR (squash merge).
- **Branch:** `<type>/<task-id>-<slug>`, tạo từ `master` mới nhất, một branch cho một task. Cập nhật bằng rebase; force push chỉ dùng `--force-with-lease` trên branch của mình. Chi tiết (gồm cả branch nối tiếp): [conventions.md › Branch](qloud_docs/conventions.md#branch).
- **Commit message:** Conventional Commits, tiếng Anh, `<type>(<scope>): <subject>`, footer `Refs #<n>`. Chi tiết: [conventions.md › Commit message](qloud_docs/conventions.md#commit-message).
- **Git hooks** (lefthook) kiểm tra format/lint, secret, commit message, tên branch và chặn push lên `master`. **Không dùng `--no-verify`** nếu chưa được cho phép; hook sai thì sửa hook.
- **PR:** tiêu đề `<type>(<scope>): <subject> [<task-id>]` (tiếng Anh — thành commit squash trên `master`); body tiếng Việt theo template, có `Closes #<n>`, cách kiểm tra *đã thực sự chạy*, và lưu ý cho reviewer. Chi tiết: [conventions.md › Pull Request](qloud_docs/conventions.md#pull-request).
- Mỗi commit chứa thay đổi code cùng với thay đổi docs tương ứng.
