# 📱 Facebook Messenger Debt Tracker Bot

Bot Facebook Messenger để theo dõi nợ cá nhân, sử dụng Google Sheets làm database.

## 🚀 Tính năng

| Lệnh | Mô tả | Ví dụ |
|------|-------|-------|
| `no [số tiền] [nội dung]` | Ghi nợ mới | `no 50k tiền cơm` |
| `nợ [số tiền] [nội dung]` | Ghi nợ mới (có dấu) | `nợ 100k mua đồ` |
| `tra [số tiền] [nội dung]` | Trả nợ | `tra 20k` |
| `trả [số tiền] [nội dung]` | Trả nợ (có dấu) | `trả 500k lương về` |
| `check` / `tong` / `show no` | Xem tổng nợ | `check` |
| `help` | Xem hướng dẫn | `help` |

### 💰 Format số tiền
- `50k` → 50,000đ
- `1m` → 1,000,000đ
- `1.5m` → 1,500,000đ

## 📋 Yêu cầu

- Node.js >= 18
- Facebook Page + Developer App
- Google Cloud Service Account
- Google Sheets

## ⚙️ Cài đặt

### 1. Clone và cài dependencies

```bash
npm install
```

### 2. Cấu hình Google Sheets

1. Tạo Google Sheet mới với header row:
   ```
   Date | UserID | Type | Amount | Content
   ```

2. Tạo Service Account tại [Google Cloud Console](https://console.cloud.google.com):
   - IAM & Admin → Service Accounts → Create
   - Tạo key JSON

3. Share Google Sheet với email của Service Account (Editor permission)

### 3. Cấu hình Facebook

1. Tạo Facebook App tại [developers.facebook.com](https://developers.facebook.com)
2. Thêm product "Messenger"
3. Tạo/Liên kết Facebook Page
4. Lấy Page Access Token

### 4. Cấu hình Environment Variables

```bash
cp .env.example .env
# Điền các giá trị vào file .env
```

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

### Đăng ký Webhook với Facebook

1. Trên Facebook Developer Console → Messenger → Settings → Webhooks
2. Callback URL: `https://your-app.onrender.com/webhook`
3. Verify Token: Giống với `VERIFY_TOKEN` trong `.env`
4. Subscribe các events: `messages`

## 📊 Cấu trúc Google Sheet

| Date | UserID | Type | Amount | Content |
|------|--------|------|--------|---------|
| 22/12/2024, 10:30:00 | 123456789 | DEBT | 50000 | tiền cơm |
| 22/12/2024, 14:00:00 | 123456789 | PAID | 20000 | trả bớt |

## 📁 Cấu trúc project

```
├── index.js          # Main application
├── package.json      # Dependencies
├── .env.example      # Environment template
└── README.md         # Documentation
```

## 🔐 Bảo mật

- Không commit file `.env`
- Sử dụng HTTPS (Render tự động cấp SSL)
- Service Account chỉ có quyền truy cập Sheet được share

## 📝 License

MIT
# ChatBot
