import { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, Users, Key, BarChart3, Settings, LogOut, Cloud, Moon, Sun, Languages, DollarSign, Shield, Tag, SlidersHorizontal, AlertTriangle, Gift } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@/lib/theme";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function AdminLayout({ children }: { children: ReactNode }) {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const { t } = useTranslation();
  const isAr = i18n.language === "ar";

  const navigation = [
    { name: t("nav.dashboard"), href: "/admin", icon: LayoutDashboard, exact: true },
    { name: t("nav.developers"), href: "/admin/developers", icon: Users, exact: false },
    { name: t("nav.apiKeys"), href: "/admin/api-keys", icon: Key, exact: false },
    { name: t("nav.analytics"), href: "/admin/analytics", icon: BarChart3, exact: false },
    { name: t("nav.plans"), href: "/admin/plans", icon: Settings, exact: false },
    { name: t("nav.providers"), href: "/admin/providers", icon: Cloud, exact: false },
    { name: t("nav.pricing"), href: "/admin/pricing", icon: DollarSign, exact: false },
    { name: "Audit Log", href: "/admin/audit-log", icon: Shield, exact: false },
    { name: t("nav.promoCodes"), href: "/admin/promo-codes", icon: Tag, exact: false },
    { name: isAr ? "الإحالة" : "Referrals", href: "/admin/referrals", icon: Gift, exact: false },
    { name: t("nav.incidents") || "Incidents", href: "/admin/incidents", icon: AlertTriangle, exact: false },
    { name: "Settings", href: "/admin/settings", icon: SlidersHorizontal, exact: false },
  ];

  const handleLogout = async () => {
    await logout("admin");
    navigate("/admin/login");
  };

  const switchLang = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem("lang", lang);
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  };

  return (
    <div className={`flex h-screen bg-muted/40 ${isAr ? "flex-row-reverse" : ""}`}>
      <div className={`w-64 bg-card ${isAr ? "border-l" : "border-r"} flex flex-col`}>
        <div className="h-16 flex items-center px-6 border-b">
          <span className="text-lg font-semibold tracking-tight">{t("admin.title")}</span>
        </div>
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navigation.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              end={item.exact}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${isAr ? "flex-row-reverse" : ""} ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.name}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t space-y-2">
          <div className={`flex items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              title={t("theme.toggle")}
              className="text-muted-foreground hover:text-foreground"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                  <Languages className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align={isAr ? "end" : "start"}>
                <DropdownMenuItem onClick={() => switchLang("en")} className={i18n.language === "en" ? "font-bold" : ""}>
                  🇺🇸 {t("language.en")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => switchLang("ar")} className={i18n.language === "ar" ? "font-bold" : ""}>
                  🇸🇦 {t("language.ar")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className={`flex items-center justify-between ${isAr ? "flex-row-reverse" : ""}`}>
            <span className="text-sm font-medium text-muted-foreground truncate" title={user?.email}>{user?.email}</span>
            <button
              onClick={handleLogout}
              className="text-muted-foreground hover:text-destructive transition-colors p-2 rounded-md hover:bg-muted"
              title={t("auth.signOut")}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
