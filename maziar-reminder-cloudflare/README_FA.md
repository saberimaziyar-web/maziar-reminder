# یادآور مازیار – نسخه Cloudflare

این پروژه یک PWA فارسی با منطقه زمانی ثابت `Asia/Tehran` است. برای اعلان در پس‌زمینه به Cloudflare Worker، پایگاه داده D1، HTTPS و کلیدهای VAPID نیاز دارد.

## نکته مهم
این پروژه را هنوز روی اینترنت منتشر نکرده‌ایم. صرفاً آپلود فایل‌ها در GitHub باعث فعال شدن اعلان‌ها نمی‌شود. مراحل اتصال Cloudflare و ساخت D1 و تنظیم Secrets باید انجام شود.

## فایل‌ها
- `src/index.js`: API، زمان‌بندی هر دقیقه و ارسال Web Push
- `public/`: رابط کاربری، PWA و Service Worker
- `migrations/0001_init.sql`: ساخت جدول‌ها
- `wrangler.toml`: تنظیمات Cloudflare

## آماده‌سازی VAPID
پس از نصب Node.js، در پوشه پروژه اجرا کن:

```bash
node scripts/generate-vapid.mjs
```

خروجی سه مقدار می‌دهد. آن‌ها را در Cloudflare Worker به‌عنوان Secrets/Variables تنظیم کن:
- `VAPID_PUBLIC_KEY` (متغیر متنی)
- `VAPID_PRIVATE_KEY` (Secret)
- `VAPID_SUBJECT` (مثلاً `mailto:your-email@example.com`)

## انتشار با Wrangler
```bash
npm install
npx wrangler login
npx wrangler d1 create maziar-reminder-db
```
شناسه دیتابیس برگشتی را در `wrangler.toml` به‌جای `REPLACE_WITH_D1_DATABASE_ID` قرار بده.

```bash
npx wrangler d1 migrations apply maziar-reminder-db --remote
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
npx wrangler deploy
```

## محدودیت و رفتار اعلان
- زمان‌بند Cloudflare با Cron هر دقیقه اجرا می‌شود؛ بنابراین اعلان دقیقاً در ثانیه مشخص تضمین نمی‌شود و معمولاً در همان دقیقه ارسال خواهد شد.
- اعلان به مجوز Chrome، اتصال اینترنت، تنظیمات باتری/اعلان اندروید و سرویس Push دستگاه وابسته است.
- برای نصب، سایت را در Chrome باز کن و از منوی مرورگر `Add to Home screen` یا `Install app` را بزن.
- بعد از باز کردن سایت، دکمه «فعال‌سازی اعلان‌ها» را بزن و سپس اعلان آزمایشی را امتحان کن.

## افزودن یادآوری‌های اولیه
برای جلوگیری از تغییر ناخواسته برنامه دارویی، دیتابیس در شروع خالی است. یادآوری‌ها را از داخل برنامه وارد کن و زمان مصرف داروها را مطابق نسخه پزشک ثبت کن.
