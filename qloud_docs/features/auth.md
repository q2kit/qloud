# Xác thực và tài khoản (F-AUTH)

**Trạng thái:** Nháp · **Milestone:** M1 · **Màn hình:** S-01 đến S-04, S-13

## User stories
- Là khách, tôi muốn đăng ký bằng email và mật khẩu, để có Drive riêng.
- Là khách, tôi muốn đăng nhập bằng Google hoặc GitHub, để không phải nhớ thêm mật khẩu.
- Là người dùng, tôi muốn đặt lại mật khẩu khi quên.
- Là người dùng, tôi muốn đổi tên hiển thị, ngôn ngữ và giao diện, và liên kết hoặc gỡ liên kết với Google/GitHub.

## Quy tắc nghiệp vụ
- Email là duy nhất và không phân biệt hoa thường. **Phải xác thực email** trước khi được upload hoặc chia sẻ (vẫn được đăng nhập để xem).
- Mật khẩu: tối thiểu 8 ký tự, kiểm tra bằng các validator mặc định của Django (độ phổ biến, độ giống với email). Băm bằng Argon2.
- Đăng nhập OAuth bằng email trùng với một tài khoản đã có: chỉ **tự liên kết** khi email phía nhà cung cấp đã được xác thực. Nếu không thì yêu cầu đăng nhập bằng cách cũ rồi tự liên kết.
- Không được gỡ phương thức đăng nhập cuối cùng (ví dụ tài khoản chỉ có Google và chưa đặt mật khẩu).
- Khi đăng ký: tạo folder gốc, gán **plan mặc định hiện tại** (xem quota.md), `locale` lấy từ trình duyệt.
- **Đăng ký mở** cho mọi người, bằng email/mật khẩu hoặc OAuth. Có cờ cấu hình `SIGNUP_ENABLED` để đóng đăng ký khi cần.
- Email (xác thực, đặt lại mật khẩu, thông báo chia sẻ) gửi qua **SMTP riêng**, cấu hình qua `.env` (`EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`, `DEFAULT_FROM_EMAIL`).
  Gửi bất đồng bộ qua Celery. Dev dùng Mailpit để xem email.
- Session cookie: HttpOnly, Secure, SameSite=Lax, có hạn 30 ngày nếu chọn "Ghi nhớ", nếu không thì hết khi đóng trình duyệt.
- **Chống bot:** form đăng ký (gồm cả bước hoàn tất đăng ký qua OAuth nếu có) và form quên mật khẩu dùng **Cloudflare Turnstile**, kiểm tra phía server.
  Key nằm trong `.env` (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`); khi chạy dev và test thì dùng test key của Cloudflare.
- User bị khóa (`suspended_at`) thì không đăng nhập được, và nhận thông báo chung.
- Rate limit: 10 lần thử đăng nhập mỗi phút trên mỗi IP, 5 lần mỗi phút trên mỗi email. Thông báo lỗi không được để lộ email có tồn tại hay không.

## Cấu hình
- OAuth: tạo OAuth app trên Google Cloud Console và GitHub Developer Settings, callback URL theo domain đang chạy;
  client id và secret đặt trong `qloud_backend/.env`. Mỗi môi trường (dev, production) dùng app riêng.
- SMTP và Turnstile: xem các quy tắc ở trên; production dùng key thật, dev và test dùng Mailpit và test key của Cloudflare.

## Tiêu chí chấp nhận
- [ ] Đăng ký → nhận email xác thực → bấm link → tài khoản được xác thực.
- [ ] Đăng nhập, đăng xuất. Truy cập route cần đăng nhập khi chưa đăng nhập thì bị chuyển về `/login?next=...`.
- [ ] Đăng nhập qua Google và GitHub thành công, kể cả khi liên kết vào tài khoản đã có.
- [ ] Quên mật khẩu → email → đặt mật khẩu mới → mọi session cũ bị hủy.
- [ ] Đổi ngôn ngữ hoặc giao diện thì UI áp dụng ngay và vẫn giữ sau khi reload.
- [ ] Vượt rate limit thì nhận 429 và UI hiện thông báo thân thiện.

## Ngoài phạm vi
2FA, xóa tài khoản (để sau, nhưng phải tính tới khi thiết kế), SSO doanh nghiệp.
