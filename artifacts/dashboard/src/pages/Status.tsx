import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, AlertCircle, Wrench } from "lucide-react";

interface Incident {
  id: number;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  status: string;
  severity: string;
  startedAt: string;
  resolvedAt: string | null;
}

interface StatusSummary {
  status: "operational" | "degraded" | "major_outage" | "unknown";
  uptime: { last24h: number; last7d: number; last30d: number };
  activeIncidents: Incident[];
  recentIncidents: Incident[];
}

const STATUS_META = {
  operational:  { color: "text-green-600 dark:text-green-400",  bg: "bg-green-500/10",   icon: CheckCircle2 },
  degraded:     { color: "text-amber-600 dark:text-amber-400",  bg: "bg-amber-500/10",   icon: AlertTriangle },
  major_outage: { color: "text-red-600 dark:text-red-400",      bg: "bg-red-500/10",     icon: AlertCircle },
  unknown:      { color: "text-slate-600 dark:text-slate-400",  bg: "bg-slate-500/10",   icon: Wrench },
} as const;

const SEVERITY_BADGE: Record<string, string> = {
  minor:       "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300",
  major:       "bg-orange-500/10 text-orange-700 border-orange-500/30 dark:text-orange-300",
  critical:    "bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-300",
  maintenance: "bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-300",
};

export default function Status() {
  const { t } = useTranslation();
  const isAr = i18n.language === "ar";
  const [data, setData] = useState<StatusSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.dir = isAr ? "rtl" : "ltr";
    document.documentElement.lang = isAr ? "ar" : "en";
  }, [isAr]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/status/summary", { credentials: "omit" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as StatusSummary;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const switchLang = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem("lang", lang);
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  };

  if (error && !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  const meta = STATUS_META[data.status] ?? STATUS_META.unknown;
  const StatusIcon = meta.icon;

  return (
    <div className="min-h-screen bg-muted/40">
      <header className={`border-b bg-card ${isAr ? "text-right" : ""}`}>
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold">{t("status.title")}</h1>
          <div className="flex gap-2 text-sm">
            <button onClick={() => switchLang("en")} className={isAr ? "" : "font-bold"}>🇺🇸 EN</button>
            <button onClick={() => switchLang("ar")} className={isAr ? "font-bold" : ""}>🇸🇦 AR</button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <Card>
          <CardContent className="pt-6">
            <div className={`flex items-center gap-4 ${isAr ? "flex-row-reverse" : ""} ${meta.bg} rounded-lg p-6`}>
              <StatusIcon className={`h-10 w-10 ${meta.color}`} />
              <div className={isAr ? "text-right" : ""}>
                <p className={`text-2xl font-bold ${meta.color}`}>{t(`status.overall.${data.status}`)}</p>
                <p className="text-sm text-muted-foreground">{t("status.lastChecked")}: {new Date().toLocaleTimeString(isAr ? "ar-SA" : "en-US")}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { key: "last24h" as const, label: t("status.uptime24h") },
            { key: "last7d"  as const, label: t("status.uptime7d") },
            { key: "last30d" as const, label: t("status.uptime30d") },
          ].map((u) => (
            <Card key={u.key}>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{u.label}</CardTitle></CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{data.uptime[u.key].toFixed(2)}%</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader><CardTitle>{t("status.activeIncidents")}</CardTitle></CardHeader>
          <CardContent>
            {data.activeIncidents.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("status.noActiveIncidents")}</p>
            ) : (
              <div className="space-y-3">
                {data.activeIncidents.map((inc) => (
                  <IncidentRow key={inc.id} inc={inc} isAr={isAr} t={t} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t("status.recentIncidents")}</CardTitle></CardHeader>
          <CardContent>
            {data.recentIncidents.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("status.noRecentIncidents")}</p>
            ) : (
              <div className="space-y-3">
                {data.recentIncidents.map((inc) => (
                  <IncidentRow key={inc.id} inc={inc} isAr={isAr} t={t} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function IncidentRow({ inc, isAr, t }: { inc: Incident; isAr: boolean; t: (k: string) => string }) {
  const title = isAr ? inc.titleAr : inc.titleEn;
  const body = isAr ? inc.bodyAr : inc.bodyEn;
  return (
    <div className={`border rounded-lg p-4 ${isAr ? "text-right" : ""}`}>
      <div className={`flex items-start justify-between gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium">{title}</h4>
          {body && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-line">{body}</p>}
        </div>
        <div className={`flex flex-col gap-1 ${isAr ? "items-start" : "items-end"}`}>
          <Badge variant="outline" className={SEVERITY_BADGE[inc.severity] ?? ""}>{t(`status.severity.${inc.severity}`)}</Badge>
          <Badge variant="outline">{t(`status.statusValues.${inc.status}`)}</Badge>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        {new Date(inc.startedAt).toLocaleString(isAr ? "ar-SA" : "en-US")}
        {inc.resolvedAt ? ` → ${new Date(inc.resolvedAt).toLocaleString(isAr ? "ar-SA" : "en-US")}` : ""}
      </p>
    </div>
  );
}
