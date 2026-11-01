# Discord Whitelist Bot + FiveM

Bộ source này gồm:

- Discord Bot bằng discord.js
- Discord OAuth2 Verify
- Form đăng ký bằng Discord Modal
- Panel Admin duyệt / từ chối
- MySQL
- Mã bảo lãnh có slot
- FiveM whitelist check bằng oxmysql
- Role Verified / Whitelisted
- Thông báo DM khi duyệt / từ chối

## 1. Yêu cầu

- Node.js 24+
- MySQL 8+
- Discord Server
- FiveM Server
- oxmysql

## 2. Cài bot

```bash
npm install
```

Copy:

```text
.env.example -> .env
```

Điền các biến trong `.env`.

Bắt buộc có:

```env
DISCORD_TOKEN=
CLIENT_ID=
CLIENT_SECRET=
GUILD_ID=
WHITELIST_REVIEW_CHANNEL_ID=
BASE_URL=
```

## 3. Tạo database

Mở MySQL Workbench và chạy:

```text
sql/schema.sql
```

## 4. Tạo Discord Application

Vào Discord Developer Portal.

Tạo Application -> Bot.

Lấy:

- Bot Token
- Application ID / Client ID
- Client Secret

Điền vào `.env`.

OAuth2 Redirect URL phải đúng:

```text
BASE_URL + OAUTH_CALLBACK_PATH
```

Ví dụ:

```text
https://abc123.ngrok-free.app/oauth/callback
```

## 5. Chạy local

Terminal:

```bash
npm run deploy
npm start
```

Nếu thấy:

```text
Logged in as ...
Web server: http://localhost:3000
Listening on port 3000
```

là bot đã chạy.

## 6. Test OAuth2

Discord Verify cần URL có thể truy cập từ Internet.

Có thể dùng ngrok:

```bash
ngrok http 3000
```

Sau đó đổi:

```env
BASE_URL=https://YOUR-NGROK-DOMAIN
```

và đăng ký Redirect URL:

```text
https://YOUR-NGROK-DOMAIN/oauth/callback
```

Nếu dùng ngrok domain cố định thì thuận tiện hơn.

## 7. Tạo panel

Trong Discord chạy:

```text
/setup
```

Bot sẽ gửi panel.

## 8. Quy trình

Người chơi:

```text
Verify
  ↓
Discord OAuth2
  ↓
Đăng Ký
  ↓
Modal
  ↓
MySQL
  ↓
Kênh review
```

Staff:

```text
Duyệt
  ↓
whitelist_players.status = active
  ↓
Cấp role Whitelisted
  ↓
DM người chơi
```

FiveM:

```text
playerConnecting
  ↓
GetPlayerIdentifiers
  ↓
discord ID
  ↓
MySQL whitelist_players
  ↓
active -> cho vào
không có -> kick
```

## 9. Mã bảo lãnh

Người dùng đủ điều kiện bấm nút **Xin mã bảo lãnh** trong panel Embed Bảo Lãnh (`/setup-guarantee`).

Bot tạo:

```text
MCR-XXXX-XXXX
```

Người khác bấm:

```text
🎟️ Nhập mã bảo lãnh
```

Mã có số slot được cấu hình bằng:

```env
GUARANTEE_SLOTS_PER_PLAYER=1
```

## 10. Bảo mật

Không commit `.env`.

Thêm:

```text
.env
node_modules/
```

vào `.gitignore`.

Không gửi Bot Token hoặc Client Secret cho người khác.

## 11. Có thể mở rộng

Có thể bổ sung:

- Panel web Admin
- Tìm đơn theo Discord ID
- Ban whitelist
- Revoke whitelist
- Số lần đăng ký
- Hệ thống ticket
- Chống spam
- Blacklist
- Log audit
- Liên kết Rockstar/license
- Đồng bộ role Discord
- Thống kê whitelist
