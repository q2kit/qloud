---
name: qloud-task
description: Làm một task của Qloud từ đầu tới cuối theo AGENTS.md mục 3 — chọn task, nhận issue, lập kế hoạch, mở PR, xử lý review, đồng bộ ROADMAP. Dùng khi được yêu cầu "làm/triển khai M<n>-<nn>", "tiếp tục M<n>", "làm task tiếp theo", sửa theo review của một PR, hoặc merge một PR.
---

# Làm một task của Qloud

Luật nằm ở [AGENTS.md](../../../AGENTS.md); skill này không thay luật, chỉ nói khi nào gọi lệnh nào
của `scripts/workflow.py` và những chỗ cần tự phán đoán. Mọi lệnh chạy từ bất kỳ thư mục nào trong repo.

## 1. Định hướng

```bash
python3 "$(git rev-parse --show-toplevel)/scripts/workflow.py" roadmap-sync --check
gh pr list
```

- `roadmap-sync --check` báo lệch (PR đã merge mà task chưa ✅): chạy `roadmap-sync` (không `--check`),
  rồi commit thay đổi vào PR sắp mở; nếu không có PR nào sắp mở thì mở một PR nhỏ `docs(roadmap): ...` chỉ cho việc này.
- PR đang mở bị yêu cầu sửa hoặc CI đỏ: xử lý trước (mục 5), rồi mới nhận task mới.
- Chọn task: chưa làm, đứng đầu milestone hiện tại, không phụ thuộc task chưa xong.
  Người dùng nêu task cụ thể thì làm task đó, nhưng vẫn báo nếu nó phụ thuộc task chưa xong.

## 2. Nhận task

```bash
python3 "$(git rev-parse --show-toplevel)/scripts/workflow.py" task-start <issue> --slug <english-kebab-slug>
```

Slug ngắn, tiếng Anh, nói task làm gì (`upload-session`, `auth-e2e`). Type lấy từ label của issue; label không rõ thì thêm `--type`.
Script tạo branch (hoặc chuyển sang branch đã có và chỉ rebase khi `master` có commit mới), gán issue, thêm `status:in-progress`.

Đọc kỹ các cảnh báo `⚠` của script:
- **File feature còn `Nháp`**: chưa được code. Nếu đây là task đầu của milestone thì nhờ duyệt các file feature của milestone
  (comment trên issue, label `needs:owner-decision`) và dừng lại chờ.
- **Bị chặn bởi issue đang mở** hoặc **task đã ✅**: báo người dùng trước khi làm tiếp.

## 3. Đọc ngữ cảnh và lập kế hoạch

- Đọc issue (`gh issue view <n>`), file feature, và chỉ những phần liên quan của `architecture.md`, `data-model.md`, `api.md`, `ui-ux.md`, `conventions.md`.
  Tra code hiện có trước khi thiết kế; làm theo cách code xung quanh đang làm.
- **Task lớn** (nhiều file, schema mới, API mới, hạ tầng mới, sửa file luật): viết kế hoạch ngắn bằng tiếng Việt vào comment trên issue,
  thêm label `needs:owner-decision`, báo người dùng, **dừng lại chờ duyệt**. Câu hỏi cần quyết định thì nêu kèm đề xuất của mình.
- Được duyệt thì gỡ label `needs:owner-decision`. Viết **quyết định** vào đúng tài liệu (feature, architecture, ADR…), không lưu hỏi–đáp.
- Task nhỏ, rõ ràng thì làm luôn.
- Những việc phải hỏi trước (AGENTS.md mục 4): công nghệ hay dependency mới, đổi schema phá dữ liệu, đổi API không tương thích,
  bảo mật/phân quyền, phạm vi sản phẩm, hướng thiết kế UI, thao tác khó hoàn tác, sửa `AGENTS.md` hay `conventions.md`.

## 4. Làm và mở PR

- Code cùng test (Definition of Done, AGENTS.md mục 6). Commit nhỏ theo Conventional Commits, mỗi commit có cả docs tương ứng.
- Docs trong cùng PR: hành vi, API, schema, màn hình đổi thì sửa tài liệu; quyết định kiến trúc mới thì thêm ADR.
- Việc ngoài phạm vi phát hiện được: tạo issue riêng (`gh issue create`), không sửa lẫn vào PR.
- Viết body PR theo `.github/pull_request_template.md` (tiếng Việt, có `Closes #<n>`, "Cách kiểm tra" chỉ ghi lệnh đã thực sự chạy), lưu ra file tạm, rồi:

```bash
python3 "$(git rev-parse --show-toplevel)/scripts/workflow.py" pr-open \
  --title "<type>(<scope>): <subject> [<task-id>]" --body-file <file> \
  --co-author "<model> <noreply@anthropic.com>" --watch
```

Script kiểm tra tiêu đề và body giống CI, rebase khi cần, đổi task sang 🟦 trong ROADMAP (commit riêng), chạy kiểm tra
của phần đã đổi (giống AGENTS.md mục 8, cần `docker compose up -d --wait`), push, tạo PR rồi chờ CI.
Kiểm tra nào đỏ thì sửa, commit, chạy lại lệnh. CI đỏ thì đọc log (`gh run view <id> --log-failed`), sửa, push lại cho tới khi xanh.
Chỉ dùng `--skip-e2e` khi không chạy được E2E trên máy, và ghi rõ điều đó trong body PR.

## 5. Review và merge

- Góp ý review: `gh pr view <n> --comments`. Sửa trên cùng branch (`task-start <issue> --slug <slug cũ>` để quay lại branch và rebase khi cần),
  chạy lại `pr-open` để kiểm tra và push, rồi trả lời từng góp ý.
- **Không tự merge.** Chỉ merge khi người dùng yêu cầu rõ ràng cho đúng PR đó; "OK" chung chung hay đồng ý cho PR trước không tính. Không chắc thì hỏi.
- Khi được yêu cầu merge:

```bash
python3 "$(git rev-parse --show-toplevel)/scripts/workflow.py" roadmap-sync --pr <n>
```

  Commit thay đổi ROADMAP (`docs(roadmap): mark <task-id> done [<task-id>]`), push, chờ CI xanh, rồi
  `gh pr merge <n> --squash --delete-branch`. Sau đó:

```bash
python3 "$(git rev-parse --show-toplevel)/scripts/workflow.py" roadmap-sync --github
```

  để gỡ `status:in-progress` khỏi issue đã đóng và đóng milestone không còn issue mở nào.

## 6. Báo cáo

Link PR, đã làm gì, đã kiểm tra thế nào (lệnh và kết quả thật), còn tồn đọng hay cần người dùng quyết gì.
