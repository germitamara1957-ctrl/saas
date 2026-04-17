import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Zap,
  ArrowRight,
  CheckCircle2,
  Code2,
  Globe,
  Shield,
  BarChart3,
  Key,
  CreditCard,
  Lock,
  Users,
  Sparkles,
  ChevronRight,
  Moon,
  Sun,
  Languages,
  Loader2,
} from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useState, useEffect } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface Plan {
  id: number;
  name: string;
  description: string | null;
  monthlyCredits: string;
  rpm: number;
  maxApiKeys: number;
  modelsAllowed: string[];
  priceUsd: string;
  isActive: boolean;
}

const GATEWAY_BASE = window.location.origin;

const CODE_SAMPLES: Record<string, string> = {
  python: `import requests

response = requests.post(
    "${GATEWAY_BASE}/v1/chat/completions",
    headers={
        "Authorization": "Bearer sk-xxxxxxxxxxxxxxxx",
        "Content-Type": "application/json",
    },
    json={
        "model": "gemini-3.0-flash-preview",
        "messages": [
            {"role": "user", "content": "مرحباً! ما هو الذكاء الاصطناعي؟"}
        ],
        "stream": False
    }
)

data = response.json()
print(data["content"])`,

  javascript: `const response = await fetch(
  "${GATEWAY_BASE}/v1/chat/completions",
  {
    method: "POST",
    headers: {
      "Authorization": "Bearer sk-xxxxxxxxxxxxxxxx",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gemini-3.0-flash-preview",
      messages: [
        { role: "user", content: "مرحباً! ما هو الذكاء الاصطناعي؟" }
      ],
      stream: false
    })
  }
);

const data = await response.json();
console.log(data.content);`,

  curl: `curl -X POST ${GATEWAY_BASE}/v1/chat/completions \\
  -H "Authorization: Bearer sk-xxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gemini-3.0-flash-preview",
    "messages": [
      {"role": "user", "content": "مرحباً!"}
    ],
    "stream": false
  }'`,
};

const FEATURE_ICONS = [Key, Shield, BarChart3, CreditCard, Lock, Users];

// ─── Adaptive grid columns based on plan count ───────────────────────────────
function gridClass(count: number): string {
  if (count === 1) return "max-w-sm mx-auto";
  if (count === 2) return "md:grid-cols-2 max-w-2xl mx-auto";
  if (count === 3) return "md:grid-cols-3";
  if (count === 4) return "md:grid-cols-2 lg:grid-cols-4";
  return "md:grid-cols-2 lg:grid-cols-3"; // 5+
}

// ─── Middle plan gets "popular" badge for any count ──────────────────────────
function isFeaturedPlan(idx: number, total: number): boolean {
  if (total === 1) return true;
  return idx === Math.floor(total / 2);
}

// ─── Build feature rows from plan data (no hardcoded text) ───────────────────
function buildFeatures(plan: Plan, isAr: boolean): { icon: string; label: string }[] {
  const price = parseFloat(plan.priceUsd);
  const credits = parseFloat(plan.monthlyCredits);
  const items: { icon: string; label: string }[] = [];

  // Credits
  if (credits >= 1000) {
    items.push({ icon: "💰", label: isAr ? `${(credits / 1000).toLocaleString()}K رصيد/شهرياً` : `${(credits / 1000).toLocaleString()}K credits/month` });
  } else {
    items.push({ icon: "💰", label: isAr ? `${credits.toLocaleString()} رصيد/شهرياً` : `${credits.toLocaleString()} credits/month` });
  }

  // RPM
  items.push({ icon: "⚡", label: isAr ? `${plan.rpm.toLocaleString()} طلب/دقيقة` : `${plan.rpm.toLocaleString()} req/min` });

  // Models
  const modelCount = plan.modelsAllowed.length;
  items.push({ icon: "🤖", label: isAr
    ? modelCount > 0 ? `${modelCount} نموذج ذكاء اصطناعي` : "جميع النماذج"
    : modelCount > 0 ? `${modelCount} AI models` : "All models"
  });

  // API Keys
  items.push({ icon: "🔑", label: isAr
    ? `${plan.maxApiKeys} ${plan.maxApiKeys === 1 ? "مفتاح API" : "مفاتيح API"}`
    : `${plan.maxApiKeys} API key${plan.maxApiKeys !== 1 ? "s" : ""}`
  });

  // Tier-based features derived from price position (no hardcoding)
  if (price === 0) {
    items.push({ icon: "📊", label: isAr ? "لوحة تحكم أساسية" : "Basic dashboard" });
    items.push({ icon: "🌐", label: isAr ? "دعم المجتمع" : "Community support" });
  } else if (price <= 50) {
    items.push({ icon: "📊", label: isAr ? "تحليلات متقدمة" : "Advanced analytics" });
    items.push({ icon: "📧", label: isAr ? "دعم عبر البريد الإلكتروني" : "Email support" });
    items.push({ icon: "🔔", label: isAr ? "تنبيهات انخفاض الرصيد" : "Low credit alerts" });
  } else {
    items.push({ icon: "📊", label: isAr ? "تحليلات متقدمة ومخصصة" : "Custom analytics" });
    items.push({ icon: "🎯", label: isAr ? "SLA 99.9% وقت التشغيل" : "99.9% uptime SLA" });
    items.push({ icon: "🛡️", label: isAr ? "دعم مخصص على مدار الساعة" : "24/7 dedicated support" });
    items.push({ icon: "🔑", label: isAr ? "نشر خاص متاح" : "Private deployment available" });
  }

  return items;
}

interface PricingGridProps {
  plans: Plan[];
  isAr: boolean;
  navigate: (path: string) => void;
  t: (key: string) => string;
}

function PricingGrid({ plans, isAr, navigate, t }: PricingGridProps) {
  return (
    <div className={`grid grid-cols-1 gap-6 items-stretch ${gridClass(plans.length)}`}>
      {plans.map((plan, idx) => {
        const featured = isFeaturedPlan(idx, plans.length);
        const price = parseFloat(plan.priceUsd);
        const isFree = price === 0;
        const features = buildFeatures(plan, isAr);

        return (
          <div
            key={plan.id}
            className={`flex flex-col rounded-2xl bg-background overflow-hidden relative transition-all duration-200 ${
              featured
                ? "border-2 border-primary shadow-xl shadow-primary/10 scale-[1.02]"
                : "border border-border/60 hover:border-border hover:shadow-md"
            }`}
          >
            {/* Popular badge */}
            {featured && (
              <div className="absolute top-0 inset-x-0 flex justify-center">
                <Badge className="rounded-none rounded-b-md px-4 py-0.5 text-xs bg-primary text-primary-foreground">
                  {t("landing.plans.popular")}
                </Badge>
              </div>
            )}

            {/* Header */}
            <div className={`p-7 ${featured ? "pt-9" : ""}`}>
              <h3 className="font-bold text-xl mb-1">{plan.name}</h3>
              {plan.description && (
                <p className="text-muted-foreground text-sm mb-5 leading-relaxed">
                  {plan.description}
                </p>
              )}

              {/* Price */}
              <div className="flex items-end gap-1 mb-6">
                {isFree ? (
                  <span className={`text-4xl font-extrabold ${featured ? "text-primary" : ""}`}>
                    {isAr ? "مجاني" : "Free"}
                  </span>
                ) : (
                  <>
                    <span className={`text-4xl font-extrabold ${featured ? "text-primary" : ""}`}>
                      ${price % 1 === 0 ? price.toFixed(0) : price.toFixed(2)}
                    </span>
                    <span className="text-muted-foreground mb-1.5 text-sm">
                      {isAr ? "/شهر" : "/mo"}
                    </span>
                  </>
                )}
              </div>

              <Button
                variant={featured ? "default" : "outline"}
                className="w-full"
                onClick={() => navigate("/signup")}
              >
                {t("landing.plans.cta")}
              </Button>
            </div>

            {/* Features */}
            <div className={`border-t flex-1 p-7 space-y-3 ${featured ? "border-primary/20" : "border-border/60"}`}>
              {features.map((f) => (
                <div key={f.label} className="flex items-start gap-2.5 text-sm">
                  <span className="text-base leading-none mt-0.5 shrink-0">{f.icon}</span>
                  <span>{f.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  const isAr = i18n.language === "ar";
  const [activeCode, setActiveCode] = useState<"python" | "javascript" | "curl">("python");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);

  useEffect(() => {
    fetch("/api/public/plans")
      .then((r) => r.json())
      .then((data: Plan[]) => setPlans(data.filter((p) => p.isActive)))
      .catch(() => setPlans([]))
      .finally(() => setPlansLoading(false));
  }, []);

  const switchLang = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem("lang", lang);
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  };

  const features = (t("landing.features.items", { returnObjects: true }) as { title: string; desc: string }[]);
  const steps = (t("landing.howItWorks.steps", { returnObjects: true }) as { num: string; title: string; desc: string }[]);
  const textModels = (t("landing.models.textModels", { returnObjects: true }) as string[]);
  const imageModels = (t("landing.models.imageModels", { returnObjects: true }) as string[]);
  const videoModels = (t("landing.models.videoModels", { returnObjects: true }) as string[]);

  const stats = [
    { value: t("landing.hero.stat1Value"), label: t("landing.hero.stat1Label") },
    { value: t("landing.hero.stat2Value"), label: t("landing.hero.stat2Label") },
    { value: t("landing.hero.stat3Value"), label: t("landing.hero.stat3Label") },
    { value: t("landing.hero.stat4Value"), label: t("landing.hero.stat4Label") },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col" dir={isAr ? "rtl" : "ltr"}>

      {/* ─── Sticky Header ─── */}
      <header className="border-b bg-background/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="bg-primary rounded-lg p-1.5">
              <Zap className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg tracking-tight">AI Gateway</span>
          </div>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-muted-foreground">
            {(["features", "models", "howItWorks", "pricing"] as const).map((key) => (
              <a
                key={key}
                href={`#${key}`}
                className="hover:text-foreground transition-colors"
              >
                {t(`landing.nav.${key}`)}
              </a>
            ))}
          </nav>

          {/* Right controls */}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={toggle} className="text-muted-foreground hover:text-foreground h-8 w-8">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground h-8 w-8">
                  <Languages className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align={isAr ? "start" : "end"}>
                <DropdownMenuItem onClick={() => switchLang("ar")} className={i18n.language === "ar" ? "font-bold" : ""}>
                  🇸🇦 العربية
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => switchLang("en")} className={i18n.language === "en" ? "font-bold" : ""}>
                  🇺🇸 English
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="sm" onClick={() => navigate("/login")} className="hidden sm:flex">
              {t("landing.nav.signIn")}
            </Button>
            <Button size="sm" onClick={() => navigate("/signup")} className="gap-1.5">
              {t("landing.nav.getStarted")}
              {isAr ? <ArrowRight className="h-3.5 w-3.5 rotate-180" /> : <ArrowRight className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </header>

      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden pt-20 pb-28 px-4">
        {/* background blobs */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full bg-primary/5 blur-3xl" />
        </div>

        <div className="max-w-5xl mx-auto text-center">
          <Badge variant="secondary" className="mb-6 px-4 py-1.5 text-sm gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {t("landing.hero.badge")}
          </Badge>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
            <span className="text-primary">{t("landing.hero.title1")} </span>
            {t("landing.hero.title2")}
          </h1>

          <p className="text-lg sm:text-xl text-muted-foreground mb-10 max-w-3xl mx-auto leading-relaxed">
            {t("landing.hero.subtitle")}
          </p>

          <div className="flex flex-wrap gap-4 justify-center mb-4">
            <Button size="lg" onClick={() => navigate("/signup")} className="px-8 text-base gap-2">
              {t("landing.hero.cta")}
              {isAr ? <ArrowRight className="h-4 w-4 rotate-180" /> : <ArrowRight className="h-4 w-4" />}
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate("/portal/docs")} className="px-8 text-base">
              {t("landing.hero.ctaSecondary")}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{t("landing.hero.noCreditCard")}</p>

          {/* Stats row */}
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6">
            {stats.map((s) => (
              <div key={s.label} className="p-4 rounded-2xl bg-muted/50 border border-border/50">
                <div className="text-3xl font-extrabold text-primary">{s.value}</div>
                <div className="text-sm text-muted-foreground mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features ─── */}
      <section id="features" className="py-24 px-4 bg-muted/30 border-t">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">{t("landing.features.title")}</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">{t("landing.features.subtitle")}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => {
              const Icon = FEATURE_ICONS[i] ?? Zap;
              return (
                <div key={i} className="group p-6 rounded-2xl bg-background border border-border/60 hover:border-primary/30 hover:shadow-md transition-all duration-200">
                  <div className="bg-primary/10 rounded-xl p-3 w-fit mb-4 text-primary group-hover:bg-primary/15 transition-colors">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{f.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── Models ─── */}
      <section id="models" className="py-24 px-4 border-t">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">{t("landing.models.title")}</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">{t("landing.models.subtitle")}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Text */}
            <div className="rounded-2xl border border-border/60 overflow-hidden">
              <div className="bg-blue-500/10 border-b border-border/60 px-6 py-4 flex items-center gap-3">
                <div className="bg-blue-500/20 rounded-lg p-2">
                  <Globe className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="font-semibold">{t("landing.models.text")}</h3>
              </div>
              <ul className="p-4 space-y-2">
                {textModels.map((m) => (
                  <li key={m} className="flex items-center gap-2 text-sm py-1.5 px-2 rounded-lg hover:bg-muted/50 transition-colors">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>{m}</span>
                  </li>
                ))}
                <li className="flex items-center gap-2 text-sm py-1.5 px-2 text-muted-foreground">
                  <ChevronRight className="h-4 w-4" />
                  <span>{isAr ? "و 33 نموذجاً آخر..." : "And 33 more..."}</span>
                </li>
              </ul>
            </div>

            {/* Image */}
            <div className="rounded-2xl border border-border/60 overflow-hidden">
              <div className="bg-purple-500/10 border-b border-border/60 px-6 py-4 flex items-center gap-3">
                <div className="bg-purple-500/20 rounded-lg p-2">
                  <Sparkles className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
                <h3 className="font-semibold">{t("landing.models.image")}</h3>
              </div>
              <ul className="p-4 space-y-2">
                {imageModels.map((m) => (
                  <li key={m} className="flex items-center gap-2 text-sm py-1.5 px-2 rounded-lg hover:bg-muted/50 transition-colors">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Video */}
            <div className="rounded-2xl border border-border/60 overflow-hidden">
              <div className="bg-rose-500/10 border-b border-border/60 px-6 py-4 flex items-center gap-3">
                <div className="bg-rose-500/20 rounded-lg p-2">
                  <Zap className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                </div>
                <h3 className="font-semibold">{t("landing.models.video")}</h3>
              </div>
              <ul className="p-4 space-y-2">
                {videoModels.map((m) => (
                  <li key={m} className="flex items-center gap-2 text-sm py-1.5 px-2 rounded-lg hover:bg-muted/50 transition-colors">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ─── How it works ─── */}
      <section id="howItWorks" className="py-24 px-4 bg-muted/30 border-t">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">{t("landing.howItWorks.title")}</h2>
            <p className="text-muted-foreground text-lg">{t("landing.howItWorks.subtitle")}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            {/* connector lines (desktop) */}
            <div aria-hidden className="hidden md:block absolute top-10 left-1/3 right-1/3 h-0.5 bg-gradient-to-r from-primary/20 via-primary/50 to-primary/20" />
            {steps.map((s, i) => (
              <div key={i} className="flex flex-col items-center text-center p-6">
                <div className="relative mb-6">
                  <div className="w-20 h-20 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center text-3xl font-extrabold text-primary">
                    {s.num}
                  </div>
                </div>
                <h3 className="font-semibold text-xl mb-3">{s.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Code Snippet ─── */}
      <section className="py-24 px-4 border-t">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">{t("landing.code.title")}</h2>
            <p className="text-muted-foreground text-lg">{t("landing.code.subtitle")}</p>
          </div>

          <Card className="bg-zinc-950 dark:bg-zinc-900 border-zinc-800 text-zinc-100 overflow-hidden shadow-2xl">
            {/* Tab bar */}
            <div className="flex items-center gap-1 px-4 pt-3 pb-0 border-b border-zinc-800 bg-zinc-900/50">
              <div className="flex gap-1.5 me-4">
                <div className="w-3 h-3 rounded-full bg-red-500/70" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                <div className="w-3 h-3 rounded-full bg-green-500/70" />
              </div>
              {(["python", "javascript", "curl"] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setActiveCode(lang)}
                  className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors border-b-2 ${
                    activeCode === lang
                      ? "text-white border-primary bg-zinc-800"
                      : "text-zinc-400 border-transparent hover:text-zinc-200"
                  }`}
                >
                  <Code2 className="inline h-3.5 w-3.5 me-1.5 opacity-70" />
                  {lang === "javascript" ? "Node.js" : lang.charAt(0).toUpperCase() + lang.slice(1)}
                </button>
              ))}
            </div>
            <CardContent className="p-6">
              <pre dir="ltr" className="text-sm leading-relaxed overflow-x-auto text-zinc-100 font-mono">
                <code>{CODE_SAMPLES[activeCode]}</code>
              </pre>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ─── Pricing ─── */}
      <section id="pricing" className="py-24 px-4 bg-muted/30 border-t">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">{t("landing.plans.title")}</h2>
            <p className="text-muted-foreground text-lg">{t("landing.plans.subtitle")}</p>
          </div>

          {plansLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : plans.length === 0 ? (
            <p className="text-center text-muted-foreground">
              {isAr ? "لا توجد خطط متاحة حالياً." : "No plans available at the moment."}
            </p>
          ) : (
            <PricingGrid plans={plans} isAr={isAr} navigate={navigate} t={t} />
          )}
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="py-24 px-4 border-t relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5" />
        </div>
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-8">
            <Zap className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">{t("landing.cta.title")}</h2>
          <p className="text-muted-foreground text-lg mb-10 max-w-xl mx-auto">{t("landing.cta.subtitle")}</p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Button size="lg" onClick={() => navigate("/signup")} className="px-10 text-base gap-2">
              {t("landing.cta.button")}
              {isAr ? <ArrowRight className="h-4 w-4 rotate-180" /> : <ArrowRight className="h-4 w-4" />}
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate("/login")} className="px-10 text-base">
              {t("landing.cta.buttonSecondary")}
            </Button>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t py-10 px-4 bg-muted/30">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex flex-col items-center md:items-start gap-2">
              <div className="flex items-center gap-2">
                <div className="bg-primary rounded p-1">
                  <Zap className="h-3.5 w-3.5 text-primary-foreground" />
                </div>
                <span className="font-bold text-base">AI Gateway</span>
              </div>
              <p className="text-sm text-muted-foreground">{t("landing.footer.tagline")}</p>
            </div>

            <div className="flex gap-8 text-sm text-muted-foreground">
              <button className="hover:text-foreground transition-colors" onClick={() => navigate("/login")}>
                {t("landing.footer.portal")}
              </button>
              <button className="hover:text-foreground transition-colors" onClick={() => navigate("/admin/login")}>
                {t("landing.footer.admin")}
              </button>
              <button className="hover:text-foreground transition-colors" onClick={() => navigate("/signup")}>
                {t("landing.nav.getStarted")}
              </button>
              <button className="hover:text-foreground transition-colors" onClick={() => navigate("/privacy")}>
                {isAr ? "الخصوصية" : "Privacy"}
              </button>
              <button className="hover:text-foreground transition-colors" onClick={() => navigate("/terms")}>
                {isAr ? "الشروط" : "Terms"}
              </button>
            </div>

            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} AI Gateway. {t("landing.footer.rights")}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
