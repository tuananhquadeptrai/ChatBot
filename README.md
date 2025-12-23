# 📱 Facebook Messenger Debt Tracker Bot v2.5

Bot Facebook Messenger để theo dõi nợ cá nhân, sử dụng Google Sheets làm database.

**✨ Tính năng mới v2.5: Animations** - Bot sinh động hơn với typing indicator + random emoji!

## 🚀 Tính năng

### 📝 Ghi nợ / Trả nợ

| Lệnh | Mô tả | Ví dụ |
|------|-------|-------|
| `no [số tiền] @[người] [nội dung]` | Ghi nợ (format cũ) | `no 50k @Bao tiền cơm` |
| `no [người] [số tiền] [nội dung]` | Ghi nợ (format mới) | `no tuan anh 50k tiền cơm` |
| `[người] no [số tiền] [nội dung]` | Ghi nợ (tên trước) | `tuan anh no 50k tiền cơm` |
| `tra [số tiền] @[người] [nội dung]` | Trả nợ (format cũ) | `tra 20k @Bao` |
| `tra [người] [số tiền] [nội dung]` | Trả nợ (format mới) | `tra bao 50k lương về` |
| `[người] tra [số tiền] [nội dung]` | Trả nợ (tên trước) | `bao tra 50k` |

**💡 Mẹo ghi nợ nhanh:**
- Gõ không dấu: `Tuan` = `Tuấn` = `tuan`
- Không cần `@`: `no bao 50k` thay vì `no @Bao 50k`
- Tên trước hay lệnh trước đều được: `bao no 50k` = `no bao 50k`
- Dùng số thứ tự: `no 50k @1 tiền cơm` (bạn số 1 trong danh sách)
- Nếu gõ sai tên, bot sẽ hiện danh sách để bạn chọn

### 📊 Xem nợ

| Lệnh | Mô tả |
|------|-------|
| `check` | Xem tổng hợp tất cả |
| `check @Bao` | Xem chi tiết với @Bao |
| `check conno` | Chỉ xem người còn nợ |
| `pending` | Xem nợ chờ xác nhận |

### 🔗 Liên kết bạn bè

| Lệnh | Mô tả |
|------|-------|
| `alias @TenBan` | Đổi tên hiển thị (tự động đặt từ Facebook) |
| `sharecode` | Tạo mã kết nối thủ công (hết hạn 24h) |
| `link ABC123 @Bao` | Liên kết với bạn bè bằng mã |
| `friends` | Xem danh sách bạn đã liên kết |
| `id` | Xem ID và alias của mình |

### ✅ Xác nhận nợ

Khi nhận thông báo nợ, bạn sẽ thấy **2 nút bấm**:
- `✅ Xác nhận` - Đồng ý khoản nợ
- `❌ Từ chối` - Không đồng ý

Hoặc gõ lệnh: `ok ABC123` / `huy ABC123`

### 🔧 Tiện ích khác

| Lệnh | Mô tả |
|------|-------|
| `xoa` | Xóa giao dịch gần nhất |
| `tim [từ khóa]` | Tìm kiếm giao dịch |
| `thang nay` | Thống kê tháng này |
| `tuan nay` | Thống kê tuần này |
| `help` | Xem hướng dẫn |

### 💰 Format số tiền

| Viết | Giá trị |
|------|---------|
| `50k` | 50,000đ |
| `100K` | 100,000đ |
| `1m` | 1,000,000đ |
| `1tr` | 1,000,000đ |
| `1.5m` | 1,500,000đ |
| `50k5` | 50,500đ |

## 🔄 Workflow Đồng bộ 2 chiều (v2.2 - Đơn giản hóa!)

### Cách mới (v2.2) - Tự động liên kết

```
┌─────────────────────────────────────────────────────────────┐
│  1. Cả 2 người chat với bot lần đầu                         │
│     Bot tự động đặt alias từ tên Facebook                   │
│     → A được đặt tên @Tuan                                  │
│     → B được đặt tên @Bao                                   │
├─────────────────────────────────────────────────────────────┤
│  2. A ghi nợ @Bao (chưa liên kết)                           │
│     A: no 50k @Bao tiền cơm                                 │
│     Bot: 🔍 Tìm thấy @Bao (Nguyễn Văn Bảo)                  │
│          Bạn muốn liên kết và ghi nợ?                       │
│          [✅ Đúng, liên kết]  [❌ Không phải]                │
├─────────────────────────────────────────────────────────────┤
│  3. A bấm "Đúng, liên kết"                                  │
│     Bot: ✅ Đã liên kết với @Bao!                           │
│     Bot: ⏳ Đã gửi yêu cầu xác nhận đến @Bao                │
├─────────────────────────────────────────────────────────────┤
│  4. B nhận thông báo với nút bấm                            │
│     Bot → B: 📥 NỢ MỚI TỪ @Tuan                             │
│              💰 50,000đ - tiền cơm                          │
│              [✅ Xác nhận]  [❌ Từ chối]                     │
├─────────────────────────────────────────────────────────────┤
│  5. B bấm "Xác nhận"                                        │
│     Bot → A: ✅ @Bao đã xác nhận!                           │
│     Bot → B: ✅ Đã xác nhận nợ 50k                          │
└─────────────────────────────────────────────────────────────┘
```

### Cách cũ (v2.0) - Liên kết thủ công bằng sharecode

Vẫn hoạt động nếu muốn liên kết trước:
1. B: `sharecode` → nhận mã ABC123
2. A: `link ABC123 @Bao`
3. Bắt đầu ghi nợ

### Xử lý trùng tên

Nếu có nhiều người cùng tên "Bao":
```
A: no 50k @Bao tiền cơm

Bot: 🔍 Tìm thấy 2 người tên "Bao":
     1) @Bao - Nguyễn Văn Bảo
     2) @Bao2 - Trần Minh Bảo
     
     👇 Chọn đúng người:
     [@Bao]  [@Bao2]
```

## 📋 Yêu cầu

- Node.js >= 18
- Facebook Page + Developer App
- Google Cloud Service Account
- Google Sheets

## ⚙️ Cài đặt

### 1. Clone và cài dependencies

```bash
git clone https://github.com/tuananhquadeptrai/ChatBot.git
cd ChatBot
npm install
```

### 2. Cấu hình Google Sheets

1. Tạo Google Sheet mới với header row:
   ```
   Date | UserID | Debtor | Type | Amount | Content | DebtorUserID | Status | DebtCode
   ```
   *(Bot sẽ tự tạo các cột mới nếu thiếu)*

2. Tạo Service Account tại [Google Cloud Console](https://console.cloud.google.com):
   - IAM & Admin → Service Accounts → Create
   - Tạo key JSON

3. Share Google Sheet với email của Service Account (Editor permission)

### 3. Cấu hình Facebook

1. Tạo Facebook App tại [developers.facebook.com](https://developers.facebook.com)
2. Thêm product "Messenger"
3. Tạo/Liên kết Facebook Page
4. Lấy Page Access Token
5. Đăng ký Webhook với events: `messages`

### 4. Cấu hình Environment Variables

```bash
cp .env.example .env
# Điền các giá trị vào file .env
```

| Biến | Mô tả |
|------|-------|
| `PAGE_ACCESS_TOKEN` | Token từ Facebook Developer Console |
| `VERIFY_TOKEN` | Token tự đặt để verify webhook |
| `GOOGLE_SHEET_ID` | ID từ URL Google Sheet |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Email từ Service Account JSON |
| `GOOGLE_PRIVATE_KEY` | Private key từ Service Account JSON |

### 5. Chạy local

```bash
npm start
# hoặc
npm run dev  # với auto-reload
```

## 🌐 Deploy lên Render

1. Push code lên GitHub
2. Tạo Web Service trên [render.com](https://render.com)
3. Connect GitHub repo
4. Cấu hình:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Thêm Environment Variables
6. Deploy

### Giữ app thức với cron-job.org

Render free tier sẽ ngủ sau 15 phút. Dùng [cron-job.org](https://cron-job.org):
- URL: `https://your-app.onrender.com/`
- Schedule: Every 14 minutes

### Đăng ký Webhook với Facebook

1. Trên Facebook Developer Console → Messenger → Settings → Webhooks
2. Callback URL: `https://your-app.onrender.com/webhook`
3. Verify Token: Giống với `VERIFY_TOKEN` trong `.env`
4. Subscribe events: `messages`

## 📊 Cấu trúc Google Sheets

### Sheet 1: Transactions (Mặc định)

| Date | UserID | Debtor | Type | Amount | Content | DebtorUserID | Status | DebtCode |
|------|--------|--------|------|--------|---------|--------------|--------|----------|
| 22/12/2024, 10:30:00 | 123456 | Bao | DEBT | 50000 | tiền cơm | 789012 | PENDING | ABC123 |
| 22/12/2024, 14:00:00 | 123456 | Chung | PAID | 20000 | trả bớt | | CONFIRMED | |

### Sheet 2: Aliases

| UserID | Alias | CreatedAt |
|--------|-------|-----------|
| 123456 | Tuan | 2024-12-22T10:00:00Z |
| 789012 | Bao | 2024-12-22T10:05:00Z |

### Sheet 3: FriendLinks

| UserID_A | UserID_B | AliasOfBForA | AliasOfAForB | Status | Code | CreatedAt |
|----------|----------|--------------|--------------|--------|------|-----------|
| 123456 | 789012 | Bao | Tuan | ACTIVE | AUTO | 2024-12-23 |

## 📁 Cấu trúc project

```
├── index.js          # Main application
├── package.json      # Dependencies
├── .env.example      # Environment template
├── .gitignore        # Git ignore rules
└── README.md         # Documentation
```

## 🔐 Bảo mật

- Không commit file `.env`
- Sử dụng HTTPS (Render tự động cấp SSL)
- Service Account chỉ có quyền truy cập Sheet được share
- Chỉ người được tag mới có thể xác nhận/từ chối nợ
- Mã kết nối bạn bè hết hạn sau 24h

## 📝 Changelog

### v2.5 (2024-12-23)
- ✨ **Animations**: Bot sinh động hơn!
  - Typing indicator ("đang nhập...") trước mỗi tin nhắn
  - Random delay 300-700ms (giống người thật)
  - Random emoji (✅🎉👍💪🙌) cho mỗi response
  - Greeting emoji đa dạng (👋😊🙂✨) cho user mới
- ⚠️ **Security warning**: Cảnh báo rõ ràng khi thiếu APP_SECRET

### v2.4 (2024-12-23)
- 🐛 **Bug fixes**:
  - Fix per-debtor lookup: `check @bao` giờ match `@Bao` đúng
  - Fix quick reply @1: dùng alias đã resolve thay vì số
  - Fix handleStats: thêm 2-way sync (count cả DebtorUserID)
- 🔒 **Security**: Thêm webhook signature verification với APP_SECRET
- ⚡ **Performance**: Cache alias thay vì N lần API calls trong handleCheckDebt

### v2.3 (2024-12-23)
- ✨ **Flexible Input**: Gõ tự nhiên không cần @
  - `tuan anh no 50k tien com` (tên trước)
  - `no tuan anh 50k tien com` (lệnh trước, tên giữa)
  - `tra bao 50k` (trả nợ linh hoạt)
- ✨ **Accent-insensitive matching**: `tuan` = `Tuấn`
- ✨ **Multi-word names**: Hỗ trợ tên có nhiều từ (Tuấn Anh, Minh Đức...)
- 🔧 Giữ nguyên backward compatibility với format cũ (@mention)

### v2.2 (2024-12-23)
- ✨ **Auto-alias**: Tự động đặt tên từ Facebook khi chat lần đầu
- ✨ **Semi-auto link**: Ghi nợ người lạ → bot gợi ý liên kết (không cần sharecode)
- ✨ **Xác nhận bằng nút bấm**: Nhận nợ có nút [✅ Xác nhận] [❌ Từ chối]
- ✨ **Xử lý trùng tên**: Nếu có nhiều người cùng tên, bot hiện danh sách chọn
- 🔧 Giảm 80% thao tác onboarding

### v2.1 (2024-12-23)
- ✨ **@mention thông minh**: Gõ không cần dấu (`@Tuan` = `@Tuấn`)
- ✨ **Shortcut @1, @2**: Dùng số thứ tự thay cho tên bạn bè
- ✨ **Quick Reply**: Nếu gõ sai tên, bot hiện danh sách để chọn
- 🔧 Cải thiện trải nghiệm gõ trên mobile

### v2.0 (2024-12-23)
- ✨ Thêm tính năng đồng bộ 2 chiều
- ✨ Liên kết bạn bè với sharecode
- ✨ Xác nhận/từ chối nợ
- ✨ Chỉ tính nợ CONFIRMED vào tổng
- 🔧 Tự động tạo sheet Aliases và FriendLinks

### v1.0 (2024-12-22)
- 🎉 Initial release
- 📝 Ghi nợ, trả nợ
- 📊 Xem tổng hợp, thống kê
- 🔍 Tìm kiếm, xóa giao dịch

## 📝 License

MIT
