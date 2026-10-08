# شیفت‌یار ☕

اپ PWA مدیریت شیفت کافه: انتخاب شیفت، تولید خودکار برنامه، جایگزینی شیفت، چک‌لیست باز/بست، ثبت ساعت کاری، نوتیف تلگرام.

- فرانت‌اند: HTML/CSS/JS ساده (بدون build). فایل `index.html` باید ریشه‌ی ریپازیتوری باشه.
- قبل از انتشار، `js/config.js` رو با آدرس و کلید Supabase پر کن.
- دیتابیس: Supabase. فایل‌های `supabase/updates_2.sql` (ساعت کاری) و `supabase/updates_3.sql` (قانون عدم شیفت پشت‌سرهم) رو تو SQL Editor اجرا کن.
- تلگرام: فانکشن `supabase/functions/notify-telegram/index.ts` رو تو Edge Functions دیپلوی کن و Secret به اسم `TELEGRAM_BOT_TOKEN` بساز.
