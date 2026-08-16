# SuperBack Gulf Store

متجر عربي RTL لمنتج SuperBack™ بسعر 99 ر.س والدفع عند الاستلام داخل السعودية.

## تشغيل محلي

```bash
npm install
ADMIN_USER=admin ADMIN_PASS='ضع-كلمة-مرور-قوية' npm start
```

المتجر: `http://localhost:3000`
لوحة التحكم: `http://localhost:3000/admin`

## أهم التحسينات

- طلبات COD مع تحقق من رقم الجوال السعودي.
- منع duplicate orders خلال 30 دقيقة لنفس الرقم.
- Rate limiting على إنشاء الطلبات.
- Honeypot ضد bots.
- UTM attribution محفوظ مع الطلب.
- حالات COD كاملة: جديد، تم الاتصال، مؤكد، تجهيز، شحن، تسليم، ملغي، لم يرد، رقم خاطئ، رفض الاستلام.
- تصدير CSV وExcel.
- حماية Admin بـBasic Auth مع رفض التشغيل في Production بدون بيانات دخول.
- كتابة ذرية للطلبات ونسخة احتياطية يومية عند استخدام تخزين JSON.
- صفحة سياسات مبدئية.

## التخزين

النسخة الحالية تستخدم `orders.json` لتظل مجانية وبسيطة. يجب استخدام تخزين دائم أو نقل الطلبات إلى Supabase/Postgres قبل التوسع؛ يوجد `supabase.sql` لتجهيز الجدول.

## التسويق

يدعم الروابط:
`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`

مثال:
`/?utm_source=tiktok&utm_medium=organic&utm_campaign=superback&utm_content=video1`
