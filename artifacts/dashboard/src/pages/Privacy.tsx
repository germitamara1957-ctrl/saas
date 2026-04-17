import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function Privacy() {
  const { t: _t } = useTranslation();
  const isAr = i18n.language === "ar";

  return (
    <div className="min-h-screen bg-background" dir={isAr ? "rtl" : "ltr"}>
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="font-semibold text-lg">
            AI Gateway
          </Link>
          <Link to="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className={`h-4 w-4 ${isAr ? "ml-2 rotate-180" : "mr-2"}`} />
              {isAr ? "العودة" : "Back"}
            </Button>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-3xl">
        {isAr ? <PrivacyAr /> : <PrivacyEn />}
      </main>
    </div>
  );
}

function PrivacyEn() {
  return (
    <article className="prose prose-slate dark:prose-invert max-w-none">
      <h1>Privacy Policy</h1>
      <p className="text-sm text-muted-foreground">Last updated: April 17, 2026</p>

      <h2>1. Information We Collect</h2>
      <p>
        We collect account information you provide (email, name, password hash) when you register;
        usage metadata required to operate the service (API request counts, model names, token usage,
        timestamps, IP address); and billing information needed to manage your account credits.
      </p>

      <h2>2. How We Use Your Information</h2>
      <ul>
        <li>To authenticate you and operate the API gateway service.</li>
        <li>To bill, deduct credits, and produce usage reports.</li>
        <li>To enforce rate limits, fraud prevention, and the safety guardrails described in our Terms.</li>
        <li>To send essential transactional notifications (e.g. low-credit alerts via your configured webhooks/email).</li>
      </ul>

      <h2>3. Data Sharing with Upstream Providers</h2>
      <p>
        Prompts and completions you submit are forwarded to the upstream AI provider (Google Vertex AI
        and other configured providers) solely to fulfill your request. Their handling of that content
        is governed by their respective privacy policies. We do not sell your prompts or completions.
      </p>

      <h2>4. Retention</h2>
      <ul>
        <li>Account data: retained while your account is active and for 30 days after deletion.</li>
        <li>Request/response bodies (when log capture is enabled): retained for 30 days, then truncated.</li>
        <li>Aggregated usage metrics: retained for 24 months for billing and analytics.</li>
      </ul>

      <h2>5. Your Rights</h2>
      <p>
        You may export all data associated with your account at any time from Settings → Export Data.
        You may request account deletion by contacting support; we will erase personal data within 30 days
        except where retention is required by law.
      </p>

      <h2>6. Security</h2>
      <p>
        Passwords are hashed with scrypt. API keys and TOTP secrets are stored encrypted at rest. All
        traffic is served over TLS. Two-factor authentication is available for admin accounts.
      </p>

      <h2>7. Cookies</h2>
      <p>
        We use a single session cookie (HttpOnly, Secure, SameSite=Lax) to keep you signed in. We do
        not use third-party advertising or analytics cookies.
      </p>

      <h2>8. Contact</h2>
      <p>
        Questions or requests: contact your account administrator or write to the email shown in the
        application footer.
      </p>
    </article>
  );
}

function PrivacyAr() {
  return (
    <article className="prose prose-slate dark:prose-invert max-w-none text-right">
      <h1>سياسة الخصوصية</h1>
      <p className="text-sm text-muted-foreground">آخر تحديث: 17 أبريل 2026</p>

      <h2>1. المعلومات التي نجمعها</h2>
      <p>
        نجمع بيانات الحساب التي تقدمها (البريد الإلكتروني، الاسم، تجزئة كلمة المرور) عند التسجيل؛
        وبيانات الاستخدام اللازمة لتشغيل الخدمة (عدد الطلبات، أسماء النماذج، استخدام التوكنات،
        الطوابع الزمنية، عنوان IP)؛ وبيانات الفوترة اللازمة لإدارة الرصيد.
      </p>

      <h2>2. كيف نستخدم بياناتك</h2>
      <ul>
        <li>للمصادقة عليك وتشغيل بوابة الواجهة البرمجية.</li>
        <li>للفوترة وخصم الأرصدة وإصدار تقارير الاستخدام.</li>
        <li>لتطبيق حدود المعدل ومنع الاحتيال وضوابط السلامة الموضحة في الشروط.</li>
        <li>لإرسال الإشعارات الضرورية (مثل تنبيهات انخفاض الرصيد عبر webhooks/البريد).</li>
      </ul>

      <h2>3. مشاركة البيانات مع الموردين</h2>
      <p>
        تُمرَّر الطلبات والاستجابات التي ترسلها إلى مزود الذكاء الاصطناعي الأساسي (Google Vertex AI
        وغيره) لتلبية طلبك فقط. تخضع معالجة هذا المحتوى لدى الطرف المزود لسياسات الخصوصية الخاصة به.
        لا نبيع طلباتك أو استجاباتك.
      </p>

      <h2>4. مدة الاحتفاظ</h2>
      <ul>
        <li>بيانات الحساب: تُحفظ ما دام الحساب نشطًا و30 يومًا بعد الحذف.</li>
        <li>محتوى الطلبات والاستجابات (عند تفعيل التسجيل): يُحفظ 30 يومًا ثم يُختصر.</li>
        <li>مقاييس الاستخدام التجميعية: تُحفظ 24 شهرًا لأغراض الفوترة والتحليلات.</li>
      </ul>

      <h2>5. حقوقك</h2>
      <p>
        يمكنك تنزيل جميع بياناتك من الإعدادات ← تصدير البيانات. يمكنك طلب حذف الحساب عبر التواصل مع
        الدعم، وسنحذف البيانات الشخصية خلال 30 يومًا ما لم يُلزمنا القانون بخلاف ذلك.
      </p>

      <h2>6. الأمان</h2>
      <p>
        تُجزَّأ كلمات المرور بـ scrypt. تُخزَّن مفاتيح الـAPI وأسرار TOTP مشفرة. جميع حركة المرور
        تجري عبر TLS. التحقق بخطوتين متاح لحسابات الإدارة.
      </p>

      <h2>7. ملفات تعريف الارتباط</h2>
      <p>
        نستخدم ملف ارتباط واحد للجلسة (HttpOnly، Secure، SameSite=Lax) لإبقائك مسجَّل الدخول. لا نستخدم
        أي ملفات إعلانات أو تتبع تابعة لجهات خارجية.
      </p>

      <h2>8. التواصل</h2>
      <p>
        لأي استفسار: تواصل مع مسؤول الحساب أو عبر البريد المعروض في تذييل التطبيق.
      </p>
    </article>
  );
}
