import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function Terms() {
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
        {isAr ? <TermsAr /> : <TermsEn />}
      </main>
    </div>
  );
}

function TermsEn() {
  return (
    <article className="prose prose-slate dark:prose-invert max-w-none">
      <h1>Terms of Service</h1>
      <p className="text-sm text-muted-foreground">Last updated: April 17, 2026</p>

      <h2>1. Acceptance</h2>
      <p>
        By creating an account or sending a request to the API, you agree to these Terms. If you do
        not agree, do not use the service.
      </p>

      <h2>2. Service Description</h2>
      <p>
        AI Gateway is a developer platform that proxies requests to upstream AI providers (e.g. Google
        Vertex AI), with billing via prepaid credits, usage logging, and webhooks for events. Upstream
        provider quality, availability, and pricing depend on those providers.
      </p>

      <h2>3. Account &amp; API Keys</h2>
      <ul>
        <li>You are responsible for keeping your password and API keys secret.</li>
        <li>Each API key is shown once at creation; lost keys must be rotated.</li>
        <li>You must use a valid email and you may be required to verify it.</li>
      </ul>

      <h2>4. Acceptable Use</h2>
      <p>You agree not to use the service to:</p>
      <ul>
        <li>Generate child sexual abuse material, content that incites real-world violence, or content
          that violates applicable law.</li>
        <li>Attempt to bypass safety guardrails, rate limits, or billing controls.</li>
        <li>Resell access in a way that exceeds the rate limits of your plan.</li>
      </ul>
      <p>
        Repeated guardrail violations may result in temporary suspension or account termination.
      </p>

      <h2>5. Credits, Billing &amp; Refunds</h2>
      <ul>
        <li>The service operates on prepaid credits. Account credit and top-up credit are deducted per
          request based on the cost table for each model.</li>
        <li>Plan credits granted monthly do not roll over unless the plan explicitly states so.</li>
        <li>All sales are final. Unused credits are non-refundable except where required by law.</li>
      </ul>

      <h2>6. Rate Limits &amp; Soft Limits</h2>
      <p>
        Each plan has a requests-per-minute (RPM) limit and per-plan caps on API keys and webhooks.
        Requests above your RPM are rejected with HTTP 429.
      </p>

      <h2>7. Service Availability</h2>
      <p>
        We aim for high availability but do not guarantee uninterrupted service. Maintenance windows
        and upstream provider incidents may cause downtime. The /healthz endpoint reflects current
        service status.
      </p>

      <h2>8. Liability</h2>
      <p>
        The service is provided “as is” without warranties of any kind. To the maximum extent permitted
        by law, our aggregate liability for any claim is limited to the amount you paid for the service
        in the 30 days preceding the claim.
      </p>

      <h2>9. Termination</h2>
      <p>
        You may delete your account at any time. We may suspend or terminate accounts that violate
        these Terms, with prior notice where reasonably possible.
      </p>

      <h2>10. Changes</h2>
      <p>
        We may update these Terms; the “Last updated” date will reflect the change. Continued use after
        changes means you accept the updated Terms.
      </p>

      <h2>11. Governing Law</h2>
      <p>
        These Terms are governed by the laws of the jurisdiction stated in your account agreement.
      </p>
    </article>
  );
}

function TermsAr() {
  return (
    <article className="prose prose-slate dark:prose-invert max-w-none text-right">
      <h1>شروط الاستخدام</h1>
      <p className="text-sm text-muted-foreground">آخر تحديث: 17 أبريل 2026</p>

      <h2>1. القبول</h2>
      <p>
        بإنشاء حساب أو إرسال أي طلب إلى الواجهة البرمجية فإنك توافق على هذه الشروط. إذا لم توافق فلا
        تستخدم الخدمة.
      </p>

      <h2>2. وصف الخدمة</h2>
      <p>
        بوابة الذكاء الاصطناعي منصة للمطورين تُمرِّر الطلبات إلى مزودين أساسيين (مثل Google Vertex
        AI)، مع فوترة برصيد مدفوع مقدمًا، وسجل استخدام، وwebhooks للأحداث. تعتمد جودة المزود الأساسي
        وتوفره وأسعاره عليه.
      </p>

      <h2>3. الحساب ومفاتيح API</h2>
      <ul>
        <li>أنت مسؤول عن سرية كلمة المرور ومفاتيح API الخاصة بك.</li>
        <li>يُعرض كل مفتاح API مرة واحدة عند إنشائه؛ في حال فقده يجب تدويره.</li>
        <li>يجب استخدام بريد إلكتروني صحيح وقد يُطلب منك التحقق منه.</li>
      </ul>

      <h2>4. الاستخدام المقبول</h2>
      <p>تتعهد بعدم استخدام الخدمة في:</p>
      <ul>
        <li>إنتاج محتوى استغلال جنسي للأطفال، أو تحريض على عنف فعلي، أو ما يخالف القانون المعمول به.</li>
        <li>محاولة الالتفاف على ضوابط السلامة أو حدود المعدل أو ضوابط الفوترة.</li>
        <li>إعادة بيع الوصول بطريقة تتجاوز حدود معدل خطتك.</li>
      </ul>
      <p>
        قد يؤدي تكرار انتهاكات ضوابط السلامة إلى إيقاف مؤقت أو إنهاء الحساب.
      </p>

      <h2>5. الأرصدة والفوترة والاسترداد</h2>
      <ul>
        <li>تعمل الخدمة برصيد مدفوع مقدمًا. يُخصم الرصيد التشغيلي ورصيد الشحن لكل طلب وفق جدول التكلفة
          لكل نموذج.</li>
        <li>الأرصدة الشهرية الممنوحة بالخطة لا تُرحَّل ما لم تنص الخطة على ذلك صراحة.</li>
        <li>جميع المبيعات نهائية. الأرصدة غير المستهلكة غير قابلة للاسترداد إلا إذا اشترط القانون ذلك.</li>
      </ul>

      <h2>6. حدود المعدل والحدود الناعمة</h2>
      <p>
        لكل خطة حد للطلبات في الدقيقة (RPM) وعدد أقصى لمفاتيح API وWebhooks. تُرفض الطلبات التي تتجاوز
        الحد بـ HTTP 429.
      </p>

      <h2>7. توفر الخدمة</h2>
      <p>
        نسعى لتوفر مرتفع لكننا لا نضمن استمرارية مطلقة. قد تتسبب نوافذ الصيانة وحوادث المزود الأساسي
        في انقطاعات. تعكس نقطة /healthz حالة الخدمة الحالية.
      </p>

      <h2>8. المسؤولية</h2>
      <p>
        تُقدَّم الخدمة "كما هي" دون ضمانات من أي نوع. وإلى أقصى حد يسمح به القانون، تقتصر مسؤوليتنا
        الكلية عن أي مطالبة على المبلغ المدفوع للخدمة خلال 30 يومًا قبل المطالبة.
      </p>

      <h2>9. الإنهاء</h2>
      <p>
        يحق لك حذف حسابك في أي وقت. ويحق لنا إيقاف أو إنهاء الحسابات التي تخالف هذه الشروط، مع إشعار
        مسبق حيثما أمكن.
      </p>

      <h2>10. التعديلات</h2>
      <p>
        قد نُحدِّث هذه الشروط؛ ويعكس تاريخ "آخر تحديث" التغيير. استمرارك في الاستخدام بعد التعديل يعني
        موافقتك على الشروط المُحدَّثة.
      </p>

      <h2>11. القانون الحاكم</h2>
      <p>
        تخضع هذه الشروط للقوانين المنصوص عليها في اتفاقية حسابك.
      </p>
    </article>
  );
}
