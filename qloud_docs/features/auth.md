# Xác thực và tài khoản (F-AUTH)

**Trạng thái:** Đang làm · **Milestone:** M1 · **Màn hình:** S-01 đến S-04, S-13

Đặc tả M1 và kế hoạch M1-01 đã được [chủ repo duyệt](https://github.com/q2kit/qloud/issues/10#issuecomment-6088713465).

M1-01 triển khai model User/Plan, tạo folder gốc và gán plan nguyên tử khi lưu user mới (qua manager hoặc `save()`),
cùng Django admin và dịch vụ khóa/mở khóa.
Locale mặc định ở model là `vi`, theme mặc định là `system`; caller truyền locale đã xác định khi tạo user.
Folder gốc lưu tên kỹ thuật `Drive`; tên hiển thị trên frontend lấy từ i18n.

Khóa user qua `suspend_user(user, reason=...)` ghi thời điểm/lý do và tăng `session_version`.
Hash xác thực session phụ thuộc mật khẩu và bộ đếm này, nên mọi session cũ mất hiệu lực, không cần quét bảng session.
Session được xóa khi truy cập lần tiếp theo với hash cũ; cơ chế hoạt động với DB, cached_db và cache session engine.
Backend xác thực chặn cả đăng nhập mới và sử dụng session của user đang khóa; mở khóa không giảm bộ đếm nên không phục hồi session cũ.
Trong admin dùng action khóa/mở khóa; trường khóa chỉ đọc để mọi thao tác đi qua dịch vụ.
Admin không xóa được user (xóa tài khoản nằm ngoài phạm vi, và xóa sẽ vượt qua kiểm tra superuser cuối cùng); thay vào đó thì khóa.
Action từ chối toàn bộ lô nếu chứa chính admin đang thao tác hoặc khiến không còn superuser active/staff/chưa bị khóa.
Dịch vụ khóa dòng user đích cùng toàn bộ superuser theo thứ tự UUID, để vẫn còn người quản trị và tránh deadlock; superuser ít và thao tác hiếm nên khóa cả nhóm không đáng kể.
Khóa lại user đã bị khóa không đổi thời điểm, lý do hay bộ đếm session; action báo số tài khoản được giữ nguyên.
Form admin chỉ kiểm tra superuser cuối cùng khi bỏ một cờ `is_active`/`is_staff`/`is_superuser`, trong transaction giữ khóa tới khi lưu;
sửa các trường khác không khóa nhóm superuser. Trường quyền không có trên form được coi là giữ nguyên.
`User.save()` không có `update_fields` chỉ ghi các trường đã thay đổi từ lúc load/lưu (so với snapshot cập nhật khi load, `refresh_from_db` và lưu);
đổi trực tiếp suspension, session version, counter hoặc cờ quyền sẽ báo ValidationError.
Password không thuộc nhóm này: `set_password()` rồi `save()` là luồng chuẩn của Django và allauth, và bản cũ không ghi đè được vì chỉ trường đổi mới được ghi.
Không dùng fetch mode `FETCH_PEERS` cho User: Django nạp trường deferred cho các instance cùng nhóm mà không qua `refresh_from_db`, nên snapshot coi trường đó là đã đổi.
Các đường ghi trạng thái phải dùng `update_fields` rõ ràng; counter phải cập nhật trong transaction có khóa hoặc `F()`.
Admin chỉ ghi trường thực sự đổi; service khóa/mở khóa dùng khóa dòng và danh sách trường rõ ràng.
Việc đổi từ ModelBackend sang AccountBackend và hash session mới khiến session trước M1-01 phải đăng nhập lại; chưa có production.
Lỗi thiếu plan/inactive có mã ổn định và thông báo gettext `vi`/`en`; `createsuperuser` chuyển lỗi thành CommandError.
M1-02 phải chuyển các ValidationError provisioning thành lỗi đăng ký trong adapter/API allauth, thay vì để trả 500.
Việc chặn user bị khóa hiện nằm ở `AccountBackend.user_can_authenticate`. Backend của allauth (đăng nhập OAuth, login by code) không đi qua đây,
nên M1-02 phải dùng backend kế thừa cùng kiểm tra `suspended_at` và chặn trong adapter allauth, có test cho user bị khóa đăng nhập bằng OAuth.
Kiểm tra share link của owner bị khóa sẽ triển khai ở M5 khi có model ShareLink.

### M1-02: API auth (allauth headless)
- Endpoint nằm dưới `/api/auth/browser/v1/` (client `browser`, session cookie); danh sách và định dạng xem [api.md](../api.md#auth-apiauthbrowserv1).
  `HEADLESS_ONLY`: không có trang HTML của allauth, mọi màn hình do SPA đảm nhận.
- Đăng ký bằng email + một mật khẩu. Đăng ký xong thì đăng nhập luôn và nhận email xác thực (`ACCOUNT_EMAIL_VERIFICATION = "optional"`);
  cờ `EmailAddress.verified` của allauth là căn cứ để chặn upload/chia sẻ ở M2/M5.
- `locale` lấy từ `Accept-Language` (qua LocaleMiddleware); ngôn ngữ khác `vi`/`en` thì dùng `vi`.
- Kiểm tra mật khẩu dùng `AUTH_PASSWORD_VALIDATORS`, kể cả độ giống với email: input đăng ký headless của allauth bỏ qua bước này nên được kế thừa lại (`EmailAwareSignupInput`).
- Đăng ký bị đóng (403) khi `SIGNUP_ENABLED=false` hoặc chưa có plan mặc định.
- Login nhận thêm `remember`: có thì session sống `SESSION_COOKIE_AGE` (30 ngày); không có thì cookie hết khi đóng trình duyệt (`SESSION_EXPIRE_AT_BROWSER_CLOSE`). Session tạo lúc đăng ký cũng hết khi đóng trình duyệt.
- Link trong email trỏ về SPA (`HEADLESS_FRONTEND_URLS`): `/verify-email/{key}`, `/password/reset/{key}`. Key trong link đã được URL-encode; SPA gửi lại key đã decode.
- Đặt lại mật khẩu đổi hash session nên mọi session cũ mất hiệu lực; không tự đăng nhập sau khi đặt lại.
- Đăng nhập sai và quên mật khẩu trả cùng một phản hồi dù email có tồn tại hay không.
  Đăng ký bằng email đã có trả `email_taken`: với xác thực `optional` thì không giấu được, vì đăng ký thành công là đăng nhập luôn. Rate limit ở M1-04 giới hạn việc dò email.
- User bị khóa: `AccountBackend` (kế thừa backend của allauth) từ chối khi đăng nhập và khi nạp session; đăng nhập đúng mật khẩu chỉ nhận phản hồi 401 chung.
  `AccountAdapter.pre_login` chặn thêm các luồng không qua `authenticate()` (OAuth ở M1-03, login by code).
### M1-04: rate limit, Turnstile, email
- **Rate limit** (allauth, đếm trong cache Redis nên đúng khi chạy nhiều instance): đăng nhập 10 lần/phút/IP và 5 lần sai/phút/email;
  đăng ký 10/phút/IP; quên mật khẩu 10/phút/IP và 5/phút/email; đặt lại mật khẩu bằng key 10/phút/IP.
  Vượt giới hạn trả **429** (`{"status": 429}`), kể cả khóa theo email khi đăng nhập sai (allauth trả 400 `too_many_login_attempts`, view đăng nhập đổi thành 429).
- **IP của client:** `TRUSTED_CLIENT_IP_HEADER` (→ `ALLAUTH_TRUSTED_CLIENT_IP_HEADER`). Production mặc định `CF-Connecting-IP`: firewall chỉ cho Cloudflare vào (ADR-0006) nên header này tin được. Dev để trống, dùng `REMOTE_ADDR`.
- **Turnstile:** đăng ký (email, và bước hoàn tất đăng ký OAuth nếu có) và quên mật khẩu nhận thêm `turnstile_token`; server gọi `siteverify` của Cloudflare kèm IP client.
  Token sai, thiếu, hoặc không gọi được Cloudflare thì trả 400 `captcha_invalid` ở trường `turnstile_token`. Đăng nhập không cần Turnstile (đã có rate limit).
  `TURNSTILE_SECRET_KEY` trống thì bỏ qua kiểm tra (test); production từ chối khởi động khi key trống hoặc là test key của Cloudflare. Dev dùng test key trong `.env.example`: luôn qua, cần mạng.
- **Email:** adapter render email trong request (ngôn ngữ = `locale` của user nếu đã có, nếu không thì ngôn ngữ của request), rồi đẩy task Celery `accounts.tasks.send_email`
  sau khi transaction commit. Lỗi SMTP được thử lại tối đa 5 lần, backoff tới 10 phút. Không có worker thì email không được gửi; worker dev trên macOS: xem [#86](https://github.com/q2kit/qloud/issues/86).
- **Template** `vi`/`en` ở `accounts/templates/account/email/` (dạng text): xác thực email, đặt lại mật khẩu, yêu cầu đặt lại cho email chưa có tài khoản, đăng ký trùng email.
  Chuỗi dịch nằm trong catalog của `accounts`; app `accounts` đứng trước allauth trong `INSTALLED_APPS` để template và bản dịch này được ưu tiên.

### M1-03: OAuth Google và GitHub
- Luồng: SPA gửi form `POST /api/auth/browser/v1/auth/provider/redirect` (`provider`, `callback_url`, `process` = `login` hoặc `connect`) → provider → callback
  `/api/auth/oauth/<provider>/login/callback/` → redirect về `callback_url` của SPA. Lỗi thì về `/login?error=...`.
- Email đã được provider xác thực trùng với tài khoản có sẵn thì đăng nhập vào tài khoản đó và tự liên kết provider
  (`SOCIALACCOUNT_EMAIL_AUTHENTICATION` + `_AUTO_CONNECT`). Cả Google và GitHub đều trả cờ xác thực cho từng email.
  Email chưa được provider xác thực thì không liên kết: người dùng đăng nhập bằng mật khẩu rồi liên kết với `process=connect`.
- Nếu email của tài khoản có sẵn **chưa xác thực ở Qloud**, allauth xóa mật khẩu của tài khoản đó khi liên kết, để người đăng ký trước bằng email của người khác không còn vào được;
  đổi mật khẩu làm đổi hash session nên session cũ của họ cũng mất hiệu lực. Tài khoản tạo bằng `createsuperuser` chưa có dòng EmailAddress nên cũng thuộc trường hợp này.
- Tài khoản mới tạo qua OAuth: email lấy từ provider (đã xác thực thì không gửi email xác thực), không có mật khẩu,
  `display_name` và `avatar_url` lấy từ provider, `locale` từ `Accept-Language`. Đăng ký đóng (`SIGNUP_ENABLED` hoặc thiếu plan mặc định) thì không tạo tài khoản qua OAuth.
- User bị khóa không đăng nhập được qua OAuth: `AccountAdapter.pre_login` từ chối trước khi tạo session.
- Gỡ liên kết qua `DELETE /api/auth/browser/v1/account/providers`; allauth từ chối nếu đó là phương thức đăng nhập cuối cùng (chưa đặt mật khẩu và không còn provider khác).
- Không lưu token của provider (`SOCIALACCOUNT_STORE_TOKENS` mặc định tắt). Google dùng PKCE và `access_type=online`.


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
- OAuth: mỗi môi trường (dev, production) dùng OAuth app riêng; client id và secret đặt trong `qloud_backend/.env`.
  Provider nào để trống `*_CLIENT_ID` thì bị tắt và không xuất hiện trong `/api/auth/browser/v1/config`. Hướng dẫn chi tiết ở mục dưới.
- SMTP và Turnstile: xem các quy tắc ở trên; production dùng key thật, dev và test dùng Mailpit và test key của Cloudflare.

### Cấu hình OAuth Google và GitHub

Callback URL có dạng `{APP_BASE_URL}/api/auth/oauth/<provider>/login/callback/`, phải khớp **từng ký tự** (kể cả `/` cuối) với URL đăng ký ở provider:

| Môi trường | Google | GitHub |
|---|---|---|
| Dev (qua Vite :5173) | `http://localhost:5173/api/auth/oauth/google/login/callback/` | `http://localhost:5173/api/auth/oauth/github/login/callback/` |
| Production | `https://<APP_DOMAIN>/api/auth/oauth/google/login/callback/` | `https://<APP_DOMAIN>/api/auth/oauth/github/login/callback/` |

Django dựng callback URL từ request, nên reverse proxy phải giữ nguyên header `Host` và gửi `X-Forwarded-Proto` (production đã bật `SECURE_PROXY_SSL_HEADER`).
Vite proxy ở dev cấu hình `changeOrigin: false` để giữ nguyên `Host: localhost:5173`, nên dùng URL dev ở trên chứ không phải cổng 8000.

**Google** ([Google Cloud Console](https://console.cloud.google.com/)):
1. Tạo hoặc chọn một project.
2. Vào **APIs & Services › OAuth consent screen** (Google Auth Platform):
   - **Branding:** tên ứng dụng, email hỗ trợ, domain ứng dụng (production).
   - **Audience:** chọn *External*. Khi còn ở trạng thái *Testing* thì chỉ các *Test users* trong danh sách đăng nhập được; chuyển sang *In production* khi mở cho mọi người.
   - **Data access:** scope `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`. Đây là scope không nhạy cảm, không cần Google thẩm định.
3. Vào **Clients › Create client**: loại *Web application*; ở **Authorized redirect URIs** thêm callback URL của môi trường đó. Không cần *Authorized JavaScript origins*.
4. Chép *Client ID* và *Client secret* vào `qloud_backend/.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

**GitHub** (**Settings › Developer settings › OAuth Apps › New OAuth App**; app của tổ chức thì tạo trong settings của tổ chức):
1. *Application name*: ví dụ `Qloud (dev)`; *Homepage URL*: `APP_BASE_URL`; *Authorization callback URL*: callback URL của môi trường đó.
   Mỗi OAuth app chỉ có một callback URL, nên dev và production cần hai app. Không bật *Device Flow*.
2. Sau khi tạo, bấm **Generate a new client secret** (secret chỉ hiện một lần).
3. Chép vào `qloud_backend/.env`: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.

**Áp dụng và kiểm tra:** khởi động lại backend (cấu hình provider được đọc lúc khởi động), rồi mở
`{APP_BASE_URL}/api/auth/browser/v1/config`: `data.socialaccount.providers` phải liệt kê provider vừa cấu hình.
Lỗi `redirect_uri_mismatch` (Google) hoặc *redirect_uri is not associated* (GitHub) nghĩa là callback URL đăng ký không khớp với URL ở bảng trên.

## Tiêu chí chấp nhận
- [ ] Đăng ký → nhận email xác thực → bấm link → tài khoản được xác thực.
- [ ] Đăng nhập, đăng xuất. Truy cập route cần đăng nhập khi chưa đăng nhập thì bị chuyển về `/login?next=...`.
- [ ] Đăng nhập qua Google và GitHub thành công, kể cả khi liên kết vào tài khoản đã có.
- [ ] Quên mật khẩu → email → đặt mật khẩu mới → mọi session cũ bị hủy.
- [ ] Đổi ngôn ngữ hoặc giao diện thì UI áp dụng ngay và vẫn giữ sau khi reload.
- [ ] Vượt rate limit thì nhận 429 và UI hiện thông báo thân thiện.

## Ngoài phạm vi
2FA, xóa tài khoản (để sau, nhưng phải tính tới khi thiết kế), SSO doanh nghiệp.
