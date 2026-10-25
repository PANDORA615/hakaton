import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  FileJson,
  Info,
  LayoutDashboard,
  LogOut,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
  AlertTriangle,
  Clock,
  RefreshCw,
  CheckCircle2,
  LockKeyhole,
  ExternalLink,
  Zap,
  Upload,
  Menu,
  Moon,
  Sun,
  Monitor,
  ClipboardList,
  BookOpen,
  Sparkles,
  Plus,
  Palette,
  Globe,
  Radar,
} from "lucide-react";
import { api, ApiError, setCSRF, levels, money, date, Level, setDisplayPreferences, displayFromEuro, euroCentsFromDisplay, currencySymbol, formatReason, Currency, Language, FxRates } from "./api";
import { installTranslations } from "./i18n";
import { GlobalSearch, HelpCenter, GuideDialog, FoxQuestionDialog, GUIDE_ENTRIES, AppView, HelpTarget } from './navigation';
import { CompetitorRadar } from './competitorRadar';
import "./style.css";

const client = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 1000 },
  },
});
const ordered: Level[] = ["high", "medium", "low", "unknown"];
const levelColors: Record<Level, string> = {
  high: "#ec6459",
  medium: "#efad43",
  low: "#43a887",
  unknown: "#a8adb7",
};
type View = AppView;
type Theme = "system" | "light" | "dark";

function initialTheme(): Theme {
  const saved = localStorage.getItem("aeza-theme-preference");
  if (saved === "light" || saved === "dark") return saved;
  return "system";
}

function nextTheme(theme: Theme, systemDark: boolean): Theme {
  if (theme === "system") return systemDark ? "light" : "dark";
  if (theme === (systemDark ? "light" : "dark")) return systemDark ? "dark" : "light";
  return "system";
}

function ThemeToggle({
  theme,
  systemDark,
  onToggle,
}: {
  theme: Theme;
  systemDark: boolean;
  onToggle: () => void;
}) {
  const upcomingTheme = nextTheme(theme, systemDark);
  const label =
    upcomingTheme === "system"
      ? "Как в системе"
      : upcomingTheme === "dark"
        ? "Тёмная тема"
        : "Светлая тема";
  const currentLabel =
    theme === "system" ? "как в системе" : theme === "dark" ? "тёмная" : "светлая";
  return (
    <button
      className="theme-toggle icon-btn"
      type="button"
      onClick={onToggle}
      aria-label={`Тема: ${currentLabel}. Переключить на: ${label.toLowerCase()}`}
      title={`Тема: ${currentLabel}`}
    >
      {theme === "system" ? (
        <Monitor size={18} />
      ) : theme === "dark" ? (
        <Moon size={18} />
      ) : (
        <Sun size={18} />
      )}
    </button>
  );
}

function Logo() {
  return (
    <div className="logo" aria-label="Aéza">
      a<span>é</span>za<span className="logo-dot">.</span>
    </div>
  );
}
function Badge({ level }: { level: Level }) {
  return (
    <span className={"badge " + level}>
      <i />
      {levels[level]}
    </span>
  );
}
function Score({ score, level }: { score: number | null; level: Level }) {
  return (
    <div className="score">
      <strong>{score === null ? "—" : Math.round(score)}</strong>
      <div>
        <i
          style={{
            width: score === null ? "0" : score + "%",
            background: levelColors[level],
          }}
        />
      </div>
    </div>
  );
}
function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="error">
      <AlertTriangle size={17} />
      {message}
    </div>
  );
}
function Loading() {
  return (
    <div className="loading">
      <RefreshCw size={21} className="spin" /> Загружаем данные…
    </div>
  );
}

function OidcDemo({
  onBack,
  onLogin,
  theme,
  systemDark,
  onToggleTheme,
  initialRemember,
}: {
  onBack: () => void;
  onLogin: (u: any) => void;
  theme: Theme;
  systemDark: boolean;
  onToggleTheme: () => void;
  initialRemember: boolean;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [login, setLogin] = useState("admin");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [account, setAccount] = useState<any>(null);
  const [rememberMe, setRememberMe] = useState(initialRemember);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const user = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ login, password, remember_me: rememberMe }),
      });
      setCSRF(user.csrf_token);
      setAccount(user);
      setPassword("");
      setStep(3);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="oidc-demo-page">
      <div className="oidc-demo-theme">
        <ThemeToggle theme={theme} systemDark={systemDark} onToggle={onToggleTheme} />
      </div>
      <div className="oidc-demo-shell">
        <div className="oidc-demo-heading">
          <Logo />
          <span className="oidc-demo-pill">Демонстрация единого входа</span>
        </div>
        <div className="oidc-demo-steps" aria-label={`Шаг ${step} из 3`}>
          {[1, 2, 3].map((number) => (
            <span key={number} className={number <= step ? "active" : ""} />
          ))}
        </div>
        <section className="oidc-demo-card">
          <span className="oidc-demo-icon">
            {step === 3 ? <CheckCircle2 size={26} /> : <ShieldCheck size={26} />}
          </span>
          <div className="oidc-demo-kicker">Шаг {step} из 3 · Демо-провайдер</div>
          {step === 1 && (
            <>
              <h1>Переход к провайдеру</h1>
              <p>Вход через OIDC перенаправляет вас на страницу организации, которая подтверждает личность.</p>
              <div className="oidc-demo-flow">
                <span>Aéza Retention</span><ArrowRight size={18} /><span>Провайдер входа</span>
              </div>
              <button className="primary oidc-demo-action" onClick={() => setStep(2)}>
                Продолжить <ArrowRight size={18} />
              </button>
            </>
          )}
          {step === 2 && (
            <form onSubmit={confirm} className="oidc-demo-form">
              <h1>Подтвердите личность</h1>
              <p>Для безопасной демонстрации используйте действующий логин и пароль администратора. Настоящий OIDC-провайдер проверял бы их на своей стороне.</p>
              {error && <ErrorBox message={error} />}
              <label>Логин<input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required /></label>
              <label>Пароль<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required /></label>
              <label className="remember-choice"><input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />Запомнить меня</label>
              <button className="primary oidc-demo-action" disabled={pending}>
                {pending ? "Проверяем…" : "Подтвердить вход"} <ArrowRight size={18} />
              </button>
            </form>
          )}
          {step === 3 && (
            <>
              <h1>Личность подтверждена</h1>
              <p>Демонстрационный переход завершён. Откройте панель с обычной защищённой сессией приложения.</p>
              <div className="oidc-demo-flow">
                <span>Провайдер входа</span><ArrowRight size={18} /><span>Aéza Retention</span>
              </div>
              <button className="primary oidc-demo-action" onClick={() => onLogin(account)}>
                Открыть панель <ArrowRight size={18} />
              </button>
            </>
          )}
        </section>
        {step !== 3 && (
          <button className="oidc-demo-back" onClick={onBack}>
            <ChevronLeft size={17} /> Вернуться к обычному входу
          </button>
        )}
        <p className="oidc-demo-disclaimer">Это демонстрация экранов входа. Реальная проверка OIDC заработает после подключения провайдера и HTTPS.</p>
      </div>
    </main>
  );
}

function oidcErrorMessage(code: string | null) {
  if (code === "oidc_unauthorized") return "Учётная запись провайдера не разрешена для этого приложения. Обратитесь к администратору.";
  if (code) return "Не удалось завершить единый вход. Попробуйте ещё раз или войдите по паролю.";
  return "";
}

function LoginPage({
  onLogin,
  theme,
  systemDark,
  onToggleTheme,
  language,
  onLanguage,
  authReady,
}: {
  onLogin: (u: any) => void;
  theme: Theme;
  systemDark: boolean;
  onToggleTheme: () => void;
  language: Language;
  onLanguage: (value: Language) => void;
  authReady: boolean;
}) {
  const [login, setLogin] = useState("admin"),
    [password, setPassword] = useState(""),
    [error, setError] = useState(() => oidcErrorMessage(new URLSearchParams(window.location.search).get("auth_error"))),
    [pending, setPending] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [showOidcDemo, setShowOidcDemo] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("auth_error")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    api<{ oidc: boolean }>("/auth/methods")
      .then((methods) => setOidcEnabled(methods.oidc))
      .catch(() => {});
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!authReady) return;
    setPending(true);
    setError("");
    try {
      const u = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ login, password, remember_me: rememberMe }),
      });
      setCSRF(u.csrf_token);
      onLogin(u);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  if (showOidcDemo) {
    return <OidcDemo onBack={() => setShowOidcDemo(false)} onLogin={onLogin} theme={theme} systemDark={systemDark} onToggleTheme={onToggleTheme} initialRemember={rememberMe} />;
  }
  return (
    <main className="login-page">
      <div className="login-story">
        <Logo />
        <div className="login-orb" />
        <div className="story-copy">
          <span className="eyebrow">АНАЛИТИКА УДЕРЖАНИЯ</span>
          <h1>
            Замечайте риск.
            <br />
            Сохраняйте
            <br />
            <em>отношения.</em>
          </h1>
          <p>
            Клиенты, которым нужно внимание.
            <br />
            Причины, которые можно объяснить.
            <br />
            Решения, основанные на данных.
          </p>
          <span className="story-footer">
            <Activity size={17} /> Aéza Retention · beta 0.8
          </span>
        </div>
      </div>
      <div className="login-form-area">
        <div className="login-theme-toggle">
          <button className="login-language-button" type="button" aria-label={language === 'ru' ? 'Switch to English' : 'Переключить на русский'} onClick={() => onLanguage(language === 'ru' ? 'en' : 'ru')}><Globe size={16} />{language === 'ru' ? 'EN' : 'RU'}</button>
          <ThemeToggle theme={theme} systemDark={systemDark} onToggle={onToggleTheme} />
        </div>
        <form onSubmit={submit} className="login-form">
          <span className="square-icon">
            <LockKeyhole size={24} />
          </span>
          <h2>Рады видеть вас</h2>
          <p>Войдите в панель аналитики</p>
          {error && <ErrorBox message={error} />}
          <label>
            Логин
            <input
              name="username"
              autoComplete="username"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              required
            />
          </label>
          <label>
            Пароль
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Введите пароль администратора"
              required
            />
          </label>
          <label className="remember-choice"><input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />Запомнить меня</label>
          <button className="primary" disabled={pending || !authReady}>
            {pending ? "Входим…" : "Войти в панель"}
            <ArrowRight size={18} />
          </button>
          {oidcEnabled && (
            <a className="oidc-button" href={`/api/v1/auth/oidc/start?remember_me=${rememberMe}`} onClick={(event) => {
              if (!authReady) { event.preventDefault(); return; }
              sessionStorage.setItem("aeza-oidc-return", "1");
            }}>
              Войти через единый вход
              <ArrowRight size={17} />
            </a>
          )}
          {!oidcEnabled && (
            <button className="oidc-button" type="button" disabled={!authReady} onClick={() => setShowOidcDemo(true)}>
              Посмотреть вход через OIDC <ArrowRight size={17} />
            </button>
          )}
          <div className="login-secure">
            <ShieldCheck size={16} /> Данные доступны только после входа
          </div>
        </form>
        <div className="login-bottom">Анализатор риска непродления услуг</div>
      </div>
    </main>
  );
}

function App() {
  const [user, setUser] = useState<any>(null),
    [authReady, setAuthReady] = useState(false),
    [view, setView] = useState<View>("overview"),
    [customerId, setCustomerId] = useState<number | null>(null),
    [connection, setConnection] = useState("Подключение…"),
    [mobile, setMobile] = useState(false),
    [profileMenuOpen, setProfileMenuOpen] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [guideStep, setGuideStep] = useState<number | null>(null),
    [foxMenuOpen, setFoxMenuOpen] = useState(false),
    [foxQuestionOpen, setFoxQuestionOpen] = useState(false),
    [welcomeVisible, setWelcomeVisible] = useState(false),
    [horizonPending, setHorizonPending] = useState(false),
    [toast, setToast] = useState("");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [currency, setCurrency] = useState<Currency>(() => {
    const saved = localStorage.getItem("aeza-currency");
    return saved === "USD" || saved === "EUR" ? saved : "RUB";
  });
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem("aeza-language") === "en" ? "en" : "ru");
  const [assistantEnabled, setAssistantEnabled] = useState(() => localStorage.getItem('aeza-assistant-enabled') !== 'false');
  const [focusScenario, setFocusScenario] = useState(false);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const qc = useQueryClient();
  const authGeneration = useRef(0);
  const assistantDockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!foxMenuOpen) return;
    const outside = (event: PointerEvent) => { if (!assistantDockRef.current?.contains(event.target as Node)) setFoxMenuOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [foxMenuOpen]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const resolvedTheme =
      theme === "system" ? (systemDark ? "dark" : "light") : theme;
    document.documentElement.dataset.theme = resolvedTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      resolvedTheme === "dark" ? "#090909" : "#f8f6f4",
    );
    if (theme === "system") localStorage.removeItem("aeza-theme-preference");
    else localStorage.setItem("aeza-theme-preference", theme);
  }, [theme, systemDark]);
  function toggleTheme() {
    setTheme((current) => nextTheme(current, systemDark));
  }
  useEffect(() => {
    const generation = authGeneration.current;
    const params = new URLSearchParams(window.location.search);
    const oidcReturn = sessionStorage.getItem("aeza-oidc-return") === "1" && params.get("oidc_login") === "success";
    sessionStorage.removeItem("aeza-oidc-return");
    if (params.has("oidc_login")) {
      params.delete("oidc_login");
      window.history.replaceState({}, "", window.location.pathname + (params.size ? `?${params}` : ""));
    }
    api("/auth/me")
      .then(async (u) => {
        if (generation === authGeneration.current) {
          setCSRF(u.csrf_token);
          if (u.remember_me || oidcReturn) { setWelcomeVisible(true); setUser(u); }
          else {
            try { await api("/auth/logout", { method: "POST" }); } catch { /* The next login replaces this session. */ }
            setCSRF("");
          }
        }
      })
      .catch(() => {})
      .finally(() => setAuthReady(true));
    const expire = () => {
      authGeneration.current += 1;
      setUser(null);
      setWelcomeVisible(false);
      setCSRF("");
      qc.clear();
    };
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, []);
  useEffect(() => {
    if (!user) return;
    const source = new EventSource("/api/v1/events");
    source.onopen = () => setConnection("Обновляется автоматически");
    source.onerror = () => setConnection("Восстанавливаем связь");
    source.addEventListener("calculation", () => {
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["customer"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["snapshot"] });
    });
    return () => source.close();
  }, [user]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!welcomeVisible || !user) return;
    const timer = window.setTimeout(() => setWelcomeVisible(false), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1200 : 2100);
    return () => window.clearTimeout(timer);
  }, [welcomeVisible, user]);
  const summary = useQuery({
    queryKey: ["summary"],
    queryFn: () => api("/analytics/summary"),
    enabled: !!user,
    refetchInterval: 5000,
  });
  const fx = useQuery<FxRates>({
    queryKey: ["fx-rates"],
    queryFn: () => api("/fx/rates"),
    enabled: !!user,
    refetchInterval: 60 * 60 * 1000,
  });
  setDisplayPreferences(currency, language, fx.data);
  useEffect(() => {
    localStorage.setItem("aeza-currency", currency);
    localStorage.setItem("aeza-language", language);
    document.documentElement.lang = language;
  }, [currency, language]);
  useEffect(() => installTranslations(language), [language]);
  useEffect(() => {
    localStorage.setItem('aeza-assistant-enabled', String(assistantEnabled));
    if (!assistantEnabled) { setGuideStep(null); setFoxMenuOpen(false); setFoxQuestionOpen(false); }
  }, [assistantEnabled]);
  useEffect(() => {
    if (user && assistantEnabled && !localStorage.getItem('aeza-assistant-seen')) {
      setGuideStep(0);
      setView('overview');
    }
  }, [user, assistantEnabled]);
  useEffect(() => { if (!user) setGuideStep(null); }, [user]);
  const accountSummary = useQuery({
    queryKey: ["account"],
    queryFn: () => api("/account"),
    enabled: !!user,
  });
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
      authGeneration.current += 1;
      setCSRF("");
      setUser(null);
      setWelcomeVisible(false);
      qc.clear();
    } catch (e) {
      setToast((e as Error).message);
    }
  }
  function navigate(v: View) {
    setView(v);
    setMobile(false);
    setProfileMenuOpen(false);
    setSearchOpen(false);
  }
  function goToHelpTarget(target: HelpTarget) {
    if (target === 'search') { setSearchOpen(true); return; }
    if (target === 'scenario') { openScenario(); return; }
    if (target === 'horizon') {
      navigate('overview');
      window.setTimeout(() => document.querySelector<HTMLElement>('.horizon-filter-trigger')?.focus(), 0);
      return;
    }
    navigate(target);
  }
  function startGuide() {
    setAssistantEnabled(true);
    setFoxMenuOpen(false);
    setFoxQuestionOpen(false);
    setGuideStep(0);
    navigate('overview');
  }
  function closeGuide() {
    localStorage.setItem('aeza-assistant-seen', '1');
    setGuideStep(null);
  }
  function changeGuideStep(next: number) {
    if (next >= GUIDE_ENTRIES.length) { closeGuide(); return; }
    const index = Math.max(0, next);
    setGuideStep(index);
    const target = GUIDE_ENTRIES[index].target;
    if (target === 'search') { navigate('customers'); setSearchOpen(true); }
    else goToHelpTarget(target);
  }
  useEffect(() => {
    if (!mobile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobile(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobile]);
  async function changeHorizon(days: number) {
    setHorizonPending(true);
    try {
      const settings = await api('/model/settings');
      await api('/model/settings', { method: 'PATCH', body: JSON.stringify({
        expected_settings_version: settings.settings_version,
        horizon_days: days,
        urgency_days: Math.min(settings.urgency_days, days),
      }) });
      await qc.invalidateQueries({ queryKey: ['summary'] });
      await qc.invalidateQueries({ queryKey: ['settings'] });
      await qc.invalidateQueries({ queryKey: ['customers'] });
      await qc.invalidateQueries({ queryKey: ['customer'] });
      setToast(`Горизонт анализа: ${days} дн.`);
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setHorizonPending(false);
    }
  }
  function openCustomer(id: number) {
    setFocusScenario(false);
    setCustomerId(id);
  }
  async function openScenario() {
    try {
      const customers = await api("/customers?sort_by=score&sort_order=desc&page_size=1");
      if (!customers.items.length) {
        setToast("В данных пока нет клиентов для расчёта сценария");
        return;
      }
      setFocusScenario(true);
      setCustomerId(customers.items[0].id);
    } catch (error) {
      setToast((error as Error).message);
    }
  }
  function showForecast() {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    document.getElementById("forecast-chart")?.scrollIntoView({ behavior });
  }
  if (!user)
    return (
      <LoginPage
        onLogin={(value) => { authGeneration.current += 1; setWelcomeVisible(true); setUser(value); }}
        theme={theme}
        systemDark={systemDark}
        onToggleTheme={toggleTheme}
        language={language}
        onLanguage={setLanguage}
        authReady={authReady}
      />
    );
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="Закрыть навигацию"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={"sidebar " + (mobile ? "open" : "")} id="mobile-navigation">
        <Logo />
        <div className="workspace">
          <span className="workspace-icon">
            <Activity size={18} />
          </span>
          <div>
            Центр удержания<span>{summary.data?.risk_counts.high ?? "—"} клиентов с высоким риском</span>
          </div>
          <ChevronRight size={15} />
        </div>
        <span className="nav-label">АНАЛИТИКА</span>
        <nav className={`navigation navigation-${view}`}>
          {(
            [
              ["overview", LayoutDashboard, "Обзор рисков"],
              ["customers", Users, "Клиенты"],
              ["competitors", Radar, "Конкурентный радар"],
              ["settings", SlidersHorizontal, "Модель риска"],
              ["source", Database, "Источники данных"],
              ["actions", ClipboardList, "Работа с клиентами"],
              ["outcomes", CheckCircle2, "Результаты"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              {label}
              {id === "customers" && summary.data && (
                <span className="nav-count">{summary.data.customer_count}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="model-note">
            <span className="model-note-icon">
              <ShieldCheck size={21} />
            </span>
            <strong>Понятная модель</strong>
            <p>
              Каждая оценка объяснима.
              <br />
              Каждый фактор под контролем.
            </p>
            <button onClick={() => navigate("settings")}>
              Настроить модель <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="menu-btn icon-btn"
              aria-label="Открыть навигацию"
              aria-expanded={mobile}
              aria-controls="mobile-navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb">Аналитика</span>
            <ChevronRight size={13} />
            <strong>
              {
                {
                  overview: "Обзор рисков",
                  customers: "Клиенты",
                  competitors: "Конкурентный радар",
                  settings: "Модель риска",
                  source: "Источники данных",
                  actions: "Работа с клиентами",
                  outcomes: "Результаты",
                  account: "Аккаунт",
                  appearance: "Настройки сайта",
                  help: "Справочник",
                }[view]
              }
            </strong>
          </div>
          <GlobalSearch language={language} open={searchOpen} onOpenChange={setSearchOpen} onNavigate={goToHelpTarget} onCustomer={(id) => { navigate('customers'); openCustomer(id); }} />
          <div className="topbar-right">
            <span
              className={
                "connection " +
                (connection.startsWith("Обновляется") ? "online" : "")
              }
            >
              <i />
              {connection}
            </span>
            <span className="topbar-divider" />
            <ThemeToggle
              theme={theme}
              systemDark={systemDark}
              onToggle={toggleTheme}
            />
            <div className="profile-menu" onMouseEnter={() => setProfileMenuOpen(true)} onMouseLeave={() => setProfileMenuOpen(false)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setProfileMenuOpen(false); }} onKeyDown={(event) => { if (event.key === 'Escape') setProfileMenuOpen(false); }}>
              <button className="small-avatar" aria-label="Меню аккаунта" aria-haspopup="menu" aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen((open) => window.matchMedia("(hover: hover)").matches ? true : !open)}>{(accountSummary.data?.display_name || user.login).slice(0, 1).toUpperCase()}</button>
              {profileMenuOpen && <div className="profile-menu-panel" role="menu">
                <div className="profile-menu-user"><strong>{accountSummary.data?.display_name || "Администратор"}</strong><span>{user.login}</span></div>
                <button role="menuitem" onClick={() => navigate("account")}><Settings2 size={17} /> Настройки аккаунта</button>
                <button role="menuitem" onClick={() => navigate("appearance")}><Palette size={17} /> Настройки сайта</button>
                <button role="menuitem" onClick={() => navigate("help")}><BookOpen size={17} /> Справочник</button>
                <button role="menuitem" onClick={() => navigate("settings")}><SlidersHorizontal size={17} /> Модель риска</button>
                <button role="menuitem" onClick={() => { setProfileMenuOpen(false); logout(); }}><LogOut size={17} /> Выйти</button>
              </div>}
            </div>
          </div>
        </header>
        <main className="main-content" key={view}>
          {summary.isError && <ErrorBox message={summary.error.message} />}
          <div className="page-heading">
            <div>
              <div className="eyebrow">AÉZA RETENTION</div>
              <h1>
                {
                  {
                    overview: "Обзор рисков",
                    customers: "Клиенты",
                    competitors: "Конкурентный радар",
                    settings: "Модель риска",
                    source: "Источники данных",
                    actions: "Работа с клиентами",
                    outcomes: "Результаты",
                    account: "Аккаунт",
                    appearance: "Настройки сайта",
                    help: "Справочник",
                  }[view]
                }
              </h1>
              <p>
                {
                  {
                    overview: "Вовремя заметить риск. Сохранить клиента.",
                    customers: "Приоритеты для вашей следующей коммуникации.",
                    competitors: "Сравнение тарифов и аргументы, подтверждённые данными.",
                    settings: "Прозрачные правила. Управляемые коэффициенты.",
                    source: "Исходные данные и качество прогноза.",
                    actions: "Контакты и результаты работы с клиентами.",
                    outcomes: "Фактически отмеченные продления после контакта.",
                    account: "Профиль, безопасность и способы входа.",
                    appearance: "Тема, язык и валюта отображения.",
                    help: "Ответы по каждому разделу и быстрые переходы.",
                  }[view]
                }
              </p>
            </div>
            <div className="heading-actions">
              <HorizonFilter value={summary.data?.horizon_days ?? 7} disabled={horizonPending || !summary.data} onChange={changeHorizon} />
              {view === "overview" && (
                <>
                  <button className="secondary" onClick={showForecast}>
                    <Activity size={16} /> К графику
                  </button>
                  <button className="primary" onClick={openScenario}>
                    <SlidersHorizontal size={16} /> Что если?
                  </button>
                </>
              )}
            </div>
          </div>
          {summary.data && (
            <div className="version-line">
              <span>
                <i className="tiny-dot" />
                {summary.data.time_mode === "fixed"
                  ? "Фиксированное время"
                  : "Текущее время"}{" "}
                · {date(summary.data.as_of)} МСК
              </span>
              <span>
                Расчёт #{summary.data.calculation_version} · данные v
                {summary.data.source_version}
              </span>
            </div>
          )}
          {view === "overview" &&
            (summary.data ? (
              <>
                <Overview
                  data={summary.data}
                  currency={currency}
                  fx={fx.data}
                  onCustomers={() => navigate("customers")}
                  onSource={() => navigate("source")}
                  onForecast={showForecast}
                />
                <CustomerTable compact onSelect={openCustomer} />
              </>
            ) : (
              <Loading />
            ))}
          {view === "customers" && <CustomerTable onSelect={openCustomer} sourceVersion={summary.data?.source_version} onCreated={(id) => { qc.invalidateQueries(); setToast(`Клиент #${id} добавлен в реестр`); openCustomer(id); }} />}
          {view === "competitors" && <CompetitorRadar language={language} />}
          {view === "appearance" && <SitePreferences theme={theme} onTheme={setTheme} currency={currency} onCurrency={setCurrency} language={language} onLanguage={setLanguage} fx={fx.data} onRefresh={() => qc.invalidateQueries({ queryKey: ["fx-rates"] })} assistantEnabled={assistantEnabled} onAssistant={setAssistantEnabled} onStartGuide={startGuide} />}
          {view === "help" && <HelpCenter language={language} onGo={goToHelpTarget} onStartGuide={startGuide} />}
          {view === "settings" && <ModelSettings onSuccess={setToast} />}
          {view === "source" && (
            <SourcePanel summary={summary.data} onSuccess={setToast} />
          )}
          {view === "actions" && <ActionQueue onSelect={openCustomer} onSuccess={setToast} />}
          {view === "outcomes" && <OutcomesPanel onSelect={openCustomer} />}
          {view === "account" && <AccountSettings data={accountSummary.data} pending={accountSummary.isPending} error={accountSummary.error as Error | null}
            onSaved={(updated) => { qc.setQueryData(["account"], updated); setUser((current: any) => ({ ...current, login: updated.login })); setToast("Профиль сохранён"); }}
            onSuccess={setToast} onLogout={logout} />}
          <footer className="page-footer">
            <span>© 2026 · Aéza Retention</span>
            <span>
              Индекс риска — объяснимая оценка, а не вероятность оттока
            </span>
          </footer>
        </main>
      </div>
      {customerId !== null && (
        <CustomerDrawer key={customerId} id={customerId} currency={currency} fx={fx.data} focusScenario={focusScenario} onClose={() => setCustomerId(null)} onSuccess={setToast} />
      )}
      {assistantEnabled && guideStep === null && <div className="assistant-dock" ref={assistantDockRef} onMouseEnter={() => setFoxMenuOpen(true)} onMouseLeave={() => setFoxMenuOpen(false)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFoxMenuOpen(false); }} onKeyDown={(event) => { if (event.key === 'Escape') setFoxMenuOpen(false); }}>
        {foxMenuOpen && <div className="assistant-menu" id="assistant-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setFoxMenuOpen(false); setFoxQuestionOpen(true); }}><Sparkles size={17} />{language === 'ru' ? 'Спросить у лисёнка' : 'Ask the fox'}</button>
          <button type="button" role="menuitem" onClick={startGuide}><BookOpen size={17} />{language === 'ru' ? 'Навигация по сайту' : 'Site navigation'}</button>
        </div>}
        <button className="assistant-launch" type="button" onClick={() => setFoxMenuOpen(open => window.matchMedia('(hover: hover)').matches ? true : !open)} aria-label={language === 'ru' ? 'Открыть меню лисёнка Aéza' : 'Open Aéza fox menu'} aria-haspopup="menu" aria-expanded={foxMenuOpen} aria-controls={foxMenuOpen ? 'assistant-menu' : undefined}><img src="/fox-assistant.png" alt="" aria-hidden="true" /><span>{language === 'ru' ? 'Лисёнок Aéza' : 'Aéza fox'}</span></button>
      </div>}
      {foxQuestionOpen && <FoxQuestionDialog language={language} onClose={() => setFoxQuestionOpen(false)} onNavigate={(target) => { setFoxQuestionOpen(false); goToHelpTarget(target); }} />}
      {guideStep !== null && <GuideDialog language={language} step={guideStep} onPrevious={() => changeGuideStep(guideStep - 1)} onNext={() => changeGuideStep(guideStep + 1)} onClose={closeGuide} />}
      {welcomeVisible && <div className="welcome-overlay" role="status" aria-live="polite"><div className="welcome-card"><img src="/fox-celebrate.png" alt="" aria-hidden="true" /><span>AÉZA RETENTION</span><h2>{language === 'ru' ? 'Добро пожаловать,' : 'Welcome,'}<br /><strong>{accountSummary.data?.display_name?.trim() || user.login}</strong></h2><p>{language === 'ru' ? 'Подготавливаем рабочую панель' : 'Preparing your dashboard'}</p><i aria-hidden="true" /></div></div>}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {toast}
          <button onClick={() => setToast("")} aria-label="Закрыть уведомление">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function Overview({
  data,
  currency,
  fx,
  onCustomers,
  onSource,
  onForecast,
}: {
  data: any;
  currency: Currency;
  fx?: FxRates;
  onCustomers: () => void;
  onSource: () => void;
  onForecast: () => void;
}) {
  const history = useQuery({
    queryKey: ["history", data.source_version],
    queryFn: () => api("/analytics/history?limit=20"),
  });
  const total = data.customer_count || 1,
    calendar = data.renewal_calendar || [],
    max = Math.max(...calendar.map((d: any) => d.due_eur), 1);
  const gradient = ordered
    .map(
      (k, i) =>
        `${levelColors[k]} ${(ordered.slice(0, i).reduce((n, j) => n + data.risk_counts[j], 0) / total) * 100}% ${(ordered.slice(0, i + 1).reduce((n, j) => n + data.risk_counts[j], 0) / total) * 100}%`,
    )
    .join(",");
  return (
    <>
      <p className="currency-note">Валюта: {currency} · {currency === "EUR" ? "исходные данные в евро" : `курс ЦБ РФ на ${fx?.rate_date || "24.10.2026"}: €1 = ${(fx?.rates_rub.EUR || 90.2429).toFixed(4)} ₽${currency === "USD" ? `, $1 = ${(fx?.rates_rub.USD || 80.5381).toFixed(4)} ₽` : ""}`}{fx?.stale ? " · ожидается обновление курса" : ""}</p>
      <section className="kpi-grid">
        <button className="kpi kpi-main kpi-interactive" type="button" onClick={onForecast} aria-label="Платежи под риском. Открыть график прогноза">
          <span className="kpi-top">
            <span>Платежи под риском</span>
            <ArrowUpRight size={19} />
          </span>
          <strong>{money(data.loss_eur)}</strong>
          <span className="kpi-sub">
            Сценарная сумма за {data.horizon_days} дней
          </span>
          <span className="kpi-bottom">
            <span className="light-tag">
              {data.money_partial ? "Частичная оценка" : "Полная оценка"}
            </span>
            <span>С учётом баланса и риска</span>
          </span>
          <span className="kpi-decoration" />
        </button>
        <button className="kpi kpi-interactive" type="button" onClick={onCustomers} aria-label="Клиенты с высоким риском. Открыть список клиентов">
          <span className="kpi-top">
            <span>Высокий риск</span>
            <span className="metric-icon coral">
              <Users size={19} />
            </span>
          </span>
          <strong>
            {data.risk_counts.high}
            <small>клиентов</small>
          </strong>
          <span className="kpi-sub">Нуждаются в вашем внимании</span>
          <span className="kpi-link">
            Посмотреть клиентов <ArrowRight size={15} />
          </span>
        </button>
        <button className="kpi kpi-interactive" type="button" onClick={onForecast} aria-label="Не покрыто балансом. Открыть график прогноза">
          <span className="kpi-top">
            <span>Не покрыто балансом</span>
            <span className="metric-icon orange">
              <Activity size={19} />
            </span>
          </span>
          <strong>{money(data.unfunded_eur)}</strong>
          <span className="kpi-sub">
            Из {money(data.due_eur)} известных платежей
          </span>
          <span className="kpi-footnote">
            <Info size={14} /> Без повторного учёта средств
          </span>
        </button>
        <button className="kpi kpi-interactive" type="button" onClick={onCustomers} aria-label="Клиенты в анализе. Открыть список клиентов">
          <span className="kpi-top">
            <span>Клиентов в анализе</span>
            <span className="metric-icon neutral">
              <Users size={19} />
            </span>
          </span>
          <strong>
            {data.customer_count}
            <small>всего</small>
          </strong>
          <span className="kpi-sub">
            {data.service_count} услуг · {data.transaction_count} транзакций
          </span>
          <span className="kpi-footnote">
            <span className="green-dot" />
            {data.scored_customer_count} с полной оценкой
          </span>
        </button>
      </section>
      {data.money_unknown_services > 0 && (
        <button className="quality-banner" onClick={onSource}>
          <span className="banner-icon">
            <Info size={19} />
          </span>
          <span>
            <strong>Часть данных требует внимания</strong>
            <span>
              У {data.money_unknown_services} услуг статус не согласуется со
              сроком оплаты. Они исключены из денежной оценки.
            </span>
          </span>
          <span className="banner-link">
            Проверить данные <ArrowRight size={16} />
          </span>
        </button>
      )}
      <section className="chart-grid">
        <div className="panel distribution">
          <div className="panel-heading">
            <div>
              <h2>Распределение риска</h2>
              <p>Текущая оценка клиентской базы</p>
            </div>
            <span className="subtle-tag">{data.customer_count} клиентов</span>
          </div>
          <div className="distribution-body">
            <div
              className="donut"
              role="img"
              aria-label={ordered
                .map((k) => levels[k] + ": " + data.risk_counts[k])
                .join(", ")}
              style={{ background: `conic-gradient(${gradient})` }}
            >
              <div>
                <strong>{data.scored_customer_count}</strong>
                <span>оценены</span>
              </div>
            </div>
            <div className="legend">
              {ordered.map((k) => (
                <div key={k}>
                  <span>
                    <i style={{ background: levelColors[k] }} />
                    {levels[k]}
                  </span>
                  <strong>
                    {data.risk_counts[k]}
                    <small>
                      {Math.round((data.risk_counts[k] / total) * 100)}%
                    </small>
                  </strong>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="panel calendar" id="forecast-chart">
          <div className="panel-heading">
            <div>
              <h2>Прогноз по дням</h2>
              <p>Платежи и сценарная сумма под риском, {currencySymbol()}</p>
            </div>
            <span className="chart-key">
              <i />
              Платежи
              <i className="risk-key" />
              Под риском
            </span>
          </div>
          <div className="bar-chart">
            <div className="chart-gridlines">
              <span>{money(max)}</span>
              <span>{money(max / 2)}</span>
              <span>0 {currencySymbol()}</span>
            </div>
            <div className="bars">
              {calendar.map((d: any) => (
                <div className="bar-col" key={d.day}>
                  <div className="bar-space">
                    <div
                      className="bar"
                      style={{
                        height: `${Math.max((d.due_eur / max) * 100, d.due_eur ? 3 : 0)}%`,
                      }}
                      tabIndex={0}
                      aria-label={`${d.day}: платежи ${money(d.due_eur)}, под риском ${money(d.risk_eur)}, услуг со средним или высоким риском ${d.risk_services}`}
                    >
                      <span>
                        Платежи: {money(d.due_eur)}
                        <small>Под риском: {money(d.risk_eur)}</small>
                      </span>
                    </div>
                    <div
                      className="bar bar-risk"
                      style={{ height: `${Math.max((d.risk_eur / max) * 100, d.risk_eur ? 3 : 0)}%` }}
                      title={`${d.risk_services} услуг со средним или высоким риском`}
                    />
                  </div>
                  <span>
                    {new Date(d.day + "T12:00:00Z").toLocaleDateString(
                      "ru-RU",
                      { day: "numeric", month: "short" },
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="chart-note">
            <Info size={13} /> Расписание по текущим данным; фактическая оплата
            может отличаться
          </div>
        </div>
      </section>
      <section className="panel history-panel">
        <div className="panel-heading">
          <div>
            <h2>История статусов услуг</h2>
            <p>Факт из загруженных снимков отдельно от прогноза выше</p>
          </div>
          <span className="subtle-tag">{history.data?.snapshots.length ?? 0} версий</span>
        </div>
        {history.isError && <ErrorBox message={history.error.message} />}
        <div className="history-list">
          {history.data?.snapshots.map((snapshot: any) => (
            <details key={snapshot.source_version}>
              <summary>
                <strong>Данные v{snapshot.source_version}</strong>
                <span>{date(snapshot.imported_at)} МСК</span>
                <span>{snapshot.transitions.length} смен статуса</span>
                <span>{snapshot.deleted_count} удалений</span>
              </summary>
              <div className="history-details">
                {snapshot.transitions.length ? snapshot.transitions.map((transition: any) => (
                  <p key={transition.service_id}>#{transition.service_id} {transition.name}: {transition.from_status} → {transition.to_status}</p>
                )) : <p>Изменений статусов относительно предыдущего снимка нет.</p>}
              </div>
            </details>
          ))}
          {!history.isPending && !history.data?.snapshots.length && <p>История появится после загрузки данных.</p>}
        </div>
      </section>
    </>
  );
}

function HorizonFilter({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (value: number) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const presets = [
    { value: 1, label: '1 день' },
    { value: 7, label: '7 дней' },
    { value: 14, label: '2 недели' },
    { value: 30, label: '1 месяц' },
  ];
  const options = presets.some((item) => item.value === value) ? presets : [{ value, label: `${value} дней` }, ...presets];
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    root.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <div className="risk-filter horizon-filter" ref={root}>
    <button ref={trigger} type="button" className="period horizon-filter-trigger" aria-label="Горизонт анализа" aria-haspopup="listbox" aria-expanded={open} disabled={disabled}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } if (event.key === 'Escape') setOpen(false); }}>
      <Clock size={15} /><span>Горизонт: {options.find((item) => item.value === value)?.label}</span><ChevronDown size={14} />
    </button>
    {open && <div className="risk-filter-menu horizon-filter-menu" role="listbox" aria-label="Горизонт анализа">
      {options.map((item, index) => <button key={item.value} type="button" role="option" aria-selected={value === item.value} className="risk-filter-option"
        onClick={() => { onChange(item.value); setOpen(false); trigger.current?.focus(); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const items = root.current?.querySelectorAll<HTMLElement>('[role="option"]');
            items?.[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
          }
        }}>
        <span className="risk-filter-dot" />{item.label}{value === item.value && <Check size={15} />}
      </button>)}
    </div>}
  </div>;
}

function RiskLevelFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = [{ value: "", label: "Все уровни" }, ...ordered.map((key) => ({ value: key, label: levels[key] }))];
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    const selected = root.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    selected?.focus();
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  return (
    <div className={`risk-filter risk-filter-${value || "all"}`} ref={root}>
      <button ref={trigger} className="risk-filter-trigger" type="button" aria-label="Уровень риска" aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); } }}>
        <SlidersHorizontal size={15} />
        <span className="risk-filter-dot" />
        <span>{options.find((item) => item.value === value)?.label}</span>
        <ChevronDown size={15} />
      </button>
      {open && <div className="risk-filter-menu" role="listbox" aria-label="Уровень риска">
        {options.map((item, index) => <button key={item.value} type="button" role="option" aria-selected={value === item.value}
          className={`risk-filter-option risk-filter-${item.value || "all"}`}
          onClick={() => { onChange(item.value); setOpen(false); trigger.current?.focus(); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const items = root.current?.querySelectorAll<HTMLElement>('[role="option"]');
              items?.[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
            }
          }}>
          <span className="risk-filter-dot" />{item.label}{value === item.value && <Check size={15} />}
        </button>)}
      </div>}
    </div>
  );
}

function SitePreferences({ theme, onTheme, currency, onCurrency, language, onLanguage, fx, onRefresh, assistantEnabled, onAssistant, onStartGuide }: {
  theme: Theme; onTheme: (value: Theme) => void;
  currency: Currency; onCurrency: (value: Currency) => void;
  language: Language; onLanguage: (value: Language) => void;
  fx?: FxRates; onRefresh: () => void;
  assistantEnabled: boolean; onAssistant: (value: boolean) => void; onStartGuide: () => void;
}) {
  return <div className="preferences-grid">
    <section className="panel preference-card">
      <div className="panel-heading"><div><h2><Palette size={20} /> Оформление</h2><p>Подберите вид сайта для своего устройства.</p></div></div>
      <div className="choice-row" role="group" aria-label="Тема сайта">
        {([['system', Monitor, 'Системная'], ['light', Sun, 'Светлая'], ['dark', Moon, 'Тёмная']] as const).map(([value, Icon, label]) =>
          <button key={value} className={theme === value ? 'choice active' : 'choice'} aria-pressed={theme === value} onClick={() => onTheme(value)}><Icon size={19} />{label}</button>)}
      </div>
    </section>
    <section className="panel preference-card">
      <div className="panel-heading"><div><h2><Globe size={20} /> Язык</h2><p>Язык интерфейса сохраняется на этом устройстве.</p></div></div>
      <div className="choice-row" role="group" aria-label="Язык интерфейса">
        <button className={language === 'ru' ? 'choice active' : 'choice'} aria-pressed={language === 'ru'} onClick={() => onLanguage('ru')}>Русский</button>
        <button className={language === 'en' ? 'choice active' : 'choice'} aria-pressed={language === 'en'} onClick={() => onLanguage('en')}>English</button>
      </div>
    </section>
    <section className="panel preference-card preference-wide">
      <div className="panel-heading"><div><h2>Валюта отображения</h2><p>Расчёты и исходные данные остаются в евро. Меняются только отображаемые суммы и ввод сценария.</p></div></div>
      <div className="choice-row" role="group" aria-label="Валюта отображения">
        {([['RUB','₽ Рубли'], ['USD','$ Доллары'], ['EUR','€ Евро']] as const).map(([value,label]) =>
          <button key={value} className={currency === value ? 'choice active' : 'choice'} aria-pressed={currency === value} onClick={() => onCurrency(value)}>{label}</button>)}
      </div>
      <div className="fx-status"><span>ЦБ РФ · дата курса: {fx?.rate_date || '24.10.2026'}{fx?.stale ? ' · резервный курс, ожидается обновление' : ''}</span><span>€1 = {(fx?.rates_rub.EUR || 90.2429).toFixed(4)} ₽ · $1 = {(fx?.rates_rub.USD || 80.5381).toFixed(4)} ₽</span><button className="secondary" onClick={onRefresh}><RefreshCw size={15} /> Проверить курс</button></div>
    </section>
    <section className="panel preference-card preference-wide assistant-preference">
      <div className="panel-heading"><div><h2><Sparkles size={20} /> {language === 'ru' ? 'Помощник по сайту' : 'Site assistant'}</h2><p>{language === 'ru' ? 'Подсказки при первом входе и кнопка быстрого запуска.' : 'First-visit guidance and a quick launch button.'}</p></div></div>
      <div className="assistant-preference-controls">
        <label className="assistant-switch"><span>{language === 'ru' ? 'Показывать помощника' : 'Show assistant'}</span><input type="checkbox" role="switch" checked={assistantEnabled} onChange={event => onAssistant(event.target.checked)} /><i aria-hidden="true" /></label>
        {assistantEnabled && <button className="secondary" onClick={onStartGuide}><Sparkles size={16} /> {language === 'ru' ? 'Пройти обучение заново' : 'Replay guide'}</button>}
      </div>
      <small>{language === 'ru' ? 'Выбор сохраняется на этом устройстве. Справочник в меню профиля доступен всегда.' : 'This choice is saved on this device. The guide in the profile menu stays available.'}</small>
    </section>
  </div>;
}

function NewCustomerDialog({ sourceVersion, onClose, onCreated }: { sourceVersion: number; onClose: () => void; onCreated: (id: number) => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [balance, setBalance] = useState('0');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const scrollWithWheel = (event: WheelEvent) => {
      if (!event.deltaY || dialog.scrollHeight <= dialog.clientHeight) return;
      const atTop = dialog.scrollTop <= 0;
      const atBottom = dialog.scrollTop + dialog.clientHeight >= dialog.scrollHeight - 1;
      if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) return;
      event.preventDefault();
      dialog.scrollTop += event.deltaY;
    };
    dialog.addEventListener('wheel', scrollWithWheel, { passive: false });
    return () => dialog.removeEventListener('wheel', scrollWithWheel);
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true); setError('');
    try {
      const cents = euroCentsFromDisplay(Number(balance.replace(',', '.')));
      if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Проверьте сумму баланса');
      const result = await api('/customers', { method: 'POST', body: JSON.stringify({ email: email.trim(), phone: phone.trim() || null, balance_cents: cents, expected_source_version: sourceVersion }) });
      onCreated(result.id);
    } catch (cause) { setError((cause as Error).message); } finally { setPending(false); }
  }
  return <div className="drawer-overlay customer-create-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="panel customer-create-dialog" role="dialog" aria-modal="true" aria-label="Добавить клиента" tabIndex={-1}>
      <div className="panel-heading"><div><h2>Новый клиент</h2><p>ID присвоится автоматически после сохранения.</p></div><button className="icon-btn" aria-label="Закрыть" onClick={onClose}><X size={19} /></button></div>
      <form onSubmit={submit} className="customer-create-form">
        <label>Email клиента<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={320} autoFocus placeholder="client@example.com" /></label>
        <label>Номер для обратной связи<input type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={32} placeholder="+7 999 123 45 67" /></label>
        <label>Основной баланс, {currencySymbol()}<input type="text" inputMode="decimal" value={balance} onChange={(event) => setBalance(event.target.value)} required /></label>
        <small>Услуги можно загрузить через снимок данных. Импорт снимка полностью заменяет текущий реестр.</small>
        {error && <ErrorBox message={error} />}
        <button className="primary" type="submit" disabled={pending}>{pending ? 'Сохраняем…' : 'Добавить в реестр'}</button>
      </form>
    </section>
  </div>;
}

function CustomerTable({
  compact = false,
  onSelect,
  sourceVersion,
  onCreated,
}: {
  compact?: boolean;
  onSelect: (id: number) => void;
  sourceVersion?: number;
  onCreated?: (id: number) => void;
}) {
  const [sort, setSort] = useState("score"),
    [order, setOrder] = useState("desc"),
    [search, setSearch] = useState(""),
    [level, setLevel] = useState(""),
    [page, setPage] = useState(1),
    [showCreate, setShowCreate] = useState(false);
  const query = useQuery({
    queryKey: ["customers", sort, order, search, level, page, compact],
    queryFn: () =>
      api(
        `/customers?sort_by=${sort}&sort_order=${order}&search=${encodeURIComponent(search)}&page=${page}&page_size=${compact ? 5 : 10}${level ? "&risk_level=" + level : ""}`,
      ),
    refetchInterval: 5000,
  });
  function sorting(key: string) {
    setOrder(key === sort && order === "desc" ? "asc" : "desc");
    setSort(key);
    setPage(1);
  }
  const cols = [
    ["id", "ID"],
    ["email", "Клиент"],
    ["balance", "Баланс"],
    ["totalReplenished", "Пополнено всего"],
    ["score", "Risk-score"],
  ];
  return (
    <section className="panel customer-panel">
      <div className="panel-heading">
        <div>
          <h2>
            {compact ? "Кому уделить внимание" : "Рейтинг клиентов"}
            <span className="count-tag">{query.data?.total ?? "—"}</span>
          </h2>
          <p>
            {compact
              ? "Клиенты по убыванию индекса риска"
              : "Сортируйте, изучайте причины и выбирайте приоритеты"}
          </p>
        </div>
        <div className="table-tools">
          {!compact && <button className="primary add-customer-button" onClick={() => setShowCreate(true)}><Plus size={16} /> Добавить клиента</button>}
          <div className="search">
            <Search size={16} />
            <input
              aria-label="Поиск клиента"
              placeholder="Email или ID клиента"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <RiskLevelFilter value={level} onChange={(selected) => { setLevel(selected); setPage(1); }} />
        </div>
      </div>
      {query.isError && <ErrorBox message={query.error.message} />}
      <p className="table-scroll-hint">Таблица прокручивается в стороны →</p>
      <div className="table-scroll" tabIndex={0} aria-label="Таблица клиентов, прокручивается горизонтально">
        <table>
          <thead>
            <tr>
              {cols.map(([key, label]) => (
                <th
                  key={key}
                  aria-sort={
                    sort === key
                      ? order === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button onClick={() => sorting(key)}>
                    {label}
                    {sort === key ? (
                      order === "desc" ? (
                        <ArrowDown size={13} />
                      ) : (
                        <ArrowUp size={13} />
                      )
                    ) : (
                      <span className="sort-placeholder">↕</span>
                    )}
                  </button>
                </th>
              ))}
              <th>Уровень риска</th>
              <th>Основная причина</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {query.data?.items.map((c: any) => (
              <tr key={c.id} onClick={() => onSelect(c.id)}>
                <td className="id-cell">#{c.id}</td>
                <td>
                  <button
                    className="client-cell"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(c.id);
                    }}
                  >
                    <span
                      className={
                        "client-avatar " + (c.id >= 1000 ? "demo-avatar" : "")
                      }
                    >
                      {c.email.slice(0, 1).toUpperCase()}
                    </span>
                    <span>
                      {c.email}
                      <small>
                        {c.service_count} услуги
                        {c.id >= 1000 ? " · демосценарий" : ""}
                      </small>
                    </span>
                  </button>
                </td>
                <td className="number">{money(c.balance / 100)}</td>
                <td className="number muted">
                  {money(c.totalReplenished / 100)}
                </td>
                <td>
                  <Score score={c.score} level={c.risk_level} />
                </td>
                <td>
                  <Badge level={c.risk_level} />
                </td>
                <td className="reason-cell">
                  <span title={formatReason(c.reason)}>{formatReason(c.reason)}</span>
                </td>
                <td>
                  <button
                    className="icon-btn"
                    aria-label={"Открыть клиента " + c.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(c.id);
                    }}
                  >
                    <ArrowUpRight size={17} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {query.isPending && <Loading />}
      {query.data?.total === 0 && (
        <div className="empty">
          <Search size={28} />
          <h3>Клиенты не найдены</h3>
          <p>Попробуйте другой запрос или уровень риска</p>
        </div>
      )}
      {showCreate && sourceVersion && <NewCustomerDialog sourceVersion={sourceVersion} onClose={() => setShowCreate(false)} onCreated={(id) => { setShowCreate(false); onCreated?.(id); }} />}
      <div className="table-footer">
        <span>
          {query.data?.total
            ? `Показано ${(page - 1) * (compact ? 5 : 10) + 1}–${Math.min(page * (compact ? 5 : 10), query.data.total)} из ${query.data.total}`
            : "Нет результатов"}
        </span>
        <div>
          <button
            className="icon-btn"
            aria-label="Предыдущая страница"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="page-index">{page}</span>
          <button
            className="icon-btn"
            aria-label="Следующая страница"
            disabled={
              !query.data || page * (compact ? 5 : 10) >= query.data.total
            }
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}

function CustomerDrawer({ id, currency, fx, focusScenario, onClose, onSuccess }: { id: number; currency: Currency; fx?: FxRates; focusScenario: boolean; onClose: () => void; onSuccess: (message: string) => void }) {
  const query = useQuery({
    queryKey: ["customer", id],
    queryFn: () => api("/customers/" + id),
    refetchInterval: 5000,
  });
  const queryClient = useQueryClient();
  const scenarioRef = useRef<HTMLElement>(null);
  const [scenarioBalance, setScenarioBalance] = useState("");
  const [scenarioService, setScenarioService] = useState("");
  const [scenarioAuto, setScenarioAuto] = useState(false);
  const [scenario, setScenario] = useState<any>(null);
  const [scenarioError, setScenarioError] = useState("");
  const [actionError, setActionError] = useState("");
  const [scenarioPending, setScenarioPending] = useState(false);
  useEffect(() => { setScenarioBalance(""); setScenario(null); }, [currency]);
  function scenarioPayload() {
    const payload: Record<string, number | boolean> = {};
    if (scenarioBalance !== "") payload.balance_cents = euroCentsFromDisplay(Number(scenarioBalance));
    if (scenarioService) {
      payload.service_id = Number(scenarioService);
      payload.auto_prolong = scenarioAuto;
    }
    return payload;
  }
  async function runScenario() {
    setScenarioPending(true);
    setScenarioError("");
    try {
      const payload = scenarioPayload();
      if (typeof payload.balance_cents === 'number' && (!Number.isSafeInteger(payload.balance_cents) || payload.balance_cents < 0)) throw new Error('Проверьте сумму баланса');
      const result = await api(`/customers/${id}/simulate`, { method: "POST", body: JSON.stringify(payload) });
      setScenario({ ...result, customer_id: id, inputs: JSON.stringify(payload) });
    } catch (error) {
      setScenarioError((error as Error).message);
    } finally {
      setScenarioPending(false);
    }
  }
  async function addAction() {
    setActionError("");
    try {
      const existing = await api("/actions");
      if (existing.items.some((item: any) => item.customer_id === id)) {
        onSuccess("Клиент уже добавлен в работу");
        return;
      }
      await api(`/actions/${id}`, { method: "PUT", body: JSON.stringify({ status: "open", note: "" }) });
      await queryClient.invalidateQueries({ queryKey: ["actions"] });
      onSuccess("Клиент добавлен в работу");
    } catch (error) {
      setActionError((error as Error).message);
    }
  }
  useEffect(() => {
    if (focusScenario && query.data) {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      scenarioRef.current?.scrollIntoView({ behavior, block: "start" });
    }
  }, [focusScenario, query.data]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = old;
    };
  }, [onClose]);
  const c = query.data,
    statuses: Record<string, string> = {
      active: "Активна",
      suspended: "Выключена",
      blocked: "Заблокирована",
      deleted: "Удалена",
      prolong_wait: "Ожидает оплаты",
    };
  const scenarioStale = scenario && c && (scenario.customer_id !== id || scenario.calculation_version !== c.calculation_version || scenario.source_version !== c.source_version || scenario.settings_version !== c.settings_version || scenario.inputs !== JSON.stringify(scenarioPayload()));
  const scenarioExamples = c?.services?.filter((service: any) => service.status !== 'deleted').slice(0, 2) ?? [];
  function applyScenarioExample(service: any, index: number) {
    setScenarioService(String(service.id));
    setScenarioAuto(!service.autoProlong);
    if (index === 0) {
      const suggestedBalance = Math.max(c.balance, service.price ?? 0) / 100;
      setScenarioBalance(displayFromEuro(suggestedBalance).toFixed(2));
    } else {
      setScenarioBalance("");
    }
    setScenario(null);
    setScenarioError("");
  }
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={"Карточка клиента " + id}
        className="drawer"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <span>КАРТОЧКА КЛИЕНТА · #{id}</span>
          <button
            className="icon-btn"
            onClick={onClose}
            aria-label="Закрыть карточку"
            autoFocus
          >
            <X size={22} />
          </button>
        </header>
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorBox message={query.error.message} />
        ) : (
          <>
            <div className="drawer-title">
              <span className="big-avatar">{c.email[0].toUpperCase()}</span>
              <h2>{c.email}</h2>
              <small className="customer-id-label">ID #{c.id}</small>
              {c.phone && <a className="customer-phone" href={`tel:${c.phone}`}>Позвонить: {c.phone}</a>}
              <Badge level={c.risk_level} />
            </div>
            <div className="drawer-score">
              <div>
                <span>Индекс риска</span>
                <strong>
                  {c.score === null ? "—" : c.score}
                  <small>/ 100</small>
                </strong>
              </div>
              <p>{formatReason(c.reason)}</p>
            </div>
            <div className="drawer-finance">
              <div>
                <span>Основной баланс</span>
                <strong>{money(c.balance / 100)}</strong>
              </div>
              <div>
                <span>
                  Бонусы ·{" "}
                  {c.bonusState === "unlocked" ? "доступны" : "заблокированы"}
                </span>
                <strong>{money(c.bonusBalance / 100)}</strong>
              </div>
              <div>
                <span>Доступно для услуг</span>
                <strong>{money(c.available_cents / 100)}</strong>
              </div>
              <div>
                <span>
                  Платежи под риском{c.money_partial ? " · частично" : ""}
                </span>
                <strong className="orange-text">{money(c.loss_eur)}</strong>
              </div>
            </div>
            <div className="drawer-explainer">
              <Info size={17} />
              <span>
                Сумма под риском учитывает цену услуг, индекс и покрытие общим
                балансом. Это сценарная оценка, а не гарантированная потеря.
              </span>
            </div>
            <button className="secondary drawer-action" onClick={addAction}>
              <ClipboardList size={16} /> Добавить в работу
            </button>
            {actionError && <ErrorBox message={actionError} />}
            <section className="scenario-panel" ref={scenarioRef}>
              <h3>Что если?</h3>
              <p>Измените баланс или автопродление услуги и сравните результат. Исходные данные не сохраняются.</p>
              {scenarioExamples.length > 0 && <div className="scenario-examples" aria-label="Примеры сценариев">
                <span>Быстрые примеры</span>
                <div>
                  {scenarioExamples.map((service: any, index: number) => <button type="button" className="scenario-example" key={service.id} onClick={() => applyScenarioExample(service, index)}>
                    <strong>{index + 1}. {service.name}</strong>
                    <small>{index === 0 ? `Баланс для оплаты + автопродление ${service.autoProlong ? 'выключить' : 'включить'}` : `Автопродление ${service.autoProlong ? 'выключить' : 'включить'}`}</small>
                  </button>)}
                </div>
              </div>}
              <label>
                Основной баланс, {currencySymbol()}
                <input type="number" min="0" step="0.01" value={scenarioBalance} placeholder={displayFromEuro(c.balance / 100).toFixed(2)} onChange={(event) => setScenarioBalance(event.target.value)} />
              </label>
              <small>{currency === "EUR" ? "Исходные суммы хранятся в евро." : `Курс ЦБ РФ на ${fx?.rate_date || "24.10.2026"}: €1 = ${(fx?.rates_rub.EUR || 90.2429).toFixed(4)} ₽${currency === "USD" ? `; $1 = ${(fx?.rates_rub.USD || 80.5381).toFixed(4)} ₽` : ""}.`}{fx?.stale ? " Курс ожидает обновления." : ""}</small>
              <label>
                Услуга
                <select value={scenarioService} onChange={(event) => {
                  const service = c.services.find((item: any) => String(item.id) === event.target.value);
                  setScenarioService(event.target.value);
                  setScenarioAuto(service?.autoProlong ?? false);
                }}>
                  <option value="">Не менять автопродление</option>
                  {c.services.map((service: any) => <option value={service.id} key={service.id}>{service.name}</option>)}
                </select>
              </label>
              {scenarioService && <label className="scenario-check"><input type="checkbox" checked={scenarioAuto} onChange={(event) => setScenarioAuto(event.target.checked)} /> Включить автопродление</label>}
              <button className="primary scenario-submit" disabled={scenarioPending || (!scenarioService && scenarioBalance === "")} onClick={runScenario}>{scenarioPending ? 'Рассчитываем…' : 'Рассчитать сценарий'}</button>
              {scenarioError && <ErrorBox message={scenarioError} />}
              {scenarioStale && <p className="scenario-stale">Данные или параметры сценария изменились. Пересчитайте его.</p>}
              {scenario && !scenarioStale && <div className="scenario-result">
                <span>Индекс: {scenario.before.score ?? "—"} → <strong>{scenario.after.score ?? "—"}</strong></span>
                <span>Уровень риска: {levels[scenario.before.risk_level as Level]} → <strong>{levels[scenario.after.risk_level as Level]}</strong></span>
                <span>Под риском: {money(scenario.before.loss_eur)} → <strong>{money(scenario.after.loss_eur)}</strong></span>
                <span>Баланс: {money(scenario.before.balance / 100)} → <strong>{money(scenario.after.balance / 100)}</strong></span>
                {scenarioService && <span>Услуга: автопродление {scenario.before.services.find((item: any) => item.id === Number(scenarioService))?.autoProlong ? 'включено' : 'выключено'} → <strong>{scenarioAuto ? 'включено' : 'выключено'}</strong></span>}
                <p>{scenario.after.reason}</p>
                {scenario.before.score === scenario.after.score && scenario.before.loss_eur === scenario.after.loss_eur && <small>При выбранных параметрах оценка не изменилась. Проверьте срок услуги и ближайшие платежи.</small>}
                <small>Расчёт #{scenario.calculation_version} · {date(scenario.as_of)} МСК · только пробный результат</small>
              </div>}
            </section>
            <h3 className="section-label">
              Услуги клиента <span>{c.services.length}</span>
            </h3>
            {c.services.map((s: any) => (
              <article className="service-card" key={s.id}>
                <div className="service-heading">
                  <div>
                    <strong>{s.name}</strong>
                    <span>
                      {statuses[s.status]} · {money(s.price / 100)} /{" "}
                      {
                        (
                          {
                            hour: "час",
                            week: "неделя",
                            month: "месяц",
                            quarter_year: "квартал",
                            half_year: "полгода",
                            year: "год",
                          } as Record<string, string>
                        )[s.paymentTerm]
                      }
                    </span>
                  </div>
                  <Badge level={s.risk_level} />
                </div>
                <div className="service-facts">
                  <span>
                    <Clock size={13} />
                    {date(s.expiresAt)} МСК
                  </span>
                  <span>
                    {s.autoProlong ? <Check size={13} /> : <X size={13} />}
                    Автопродление {s.autoProlong ? "включено" : "отключено"}
                  </span>
                </div>
                {s.quality_warning ? (
                  <div className="inline-warning">
                    <AlertTriangle size={16} />
                    {formatReason(s.quality_warning)}
                  </div>
                ) : (
                  <div className="feature-list">
                    {s.reasons.map((r: any, i: number) => (
                      <div key={i}>
                        <span>{formatReason(r.text)}</span>
                        {r.contribution !== undefined && (
                          <strong>+{r.contribution.toFixed(1)}</strong>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {s.loss_eur !== null && (
                  <div className="service-money">
                    <span>К оплате: {money(s.due_cents / 100)}</span>
                    <span>Не покрыто: {money(s.unfunded_cents / 100)}</span>
                    <strong>Под риском: {money(s.loss_eur)}</strong>
                  </div>
                )}
              </article>
            ))}
            <div className="drawer-version">
              Расчёт #{c.calculation_version} · {date(c.as_of)} МСК
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function OutcomesPanel({ onSelect }: { onSelect: (id: number) => void }) {
  const query = useQuery({ queryKey: ['action-outcomes'], queryFn: () => api('/actions/outcomes'), refetchInterval: 5000 });
  if (query.isError) return <ErrorBox message={query.error.message} />;
  if (query.isPending) return <Loading />;
  const data = query.data;
  return <div className="outcomes-layout">
    <section className="outcome-kpis">
      <article className="panel outcome-kpi"><span>Продлили после контакта</span><strong>{data.renewed}</strong><small>Отмеченный факт продления</small></article>
      <article className="panel outcome-kpi"><span>Не продлили</span><strong>{data.not_renewed}</strong><small>Отмеченный факт отказа</small></article>
      <article className="panel outcome-kpi"><span>Ожидают результата</span><strong>{data.pending}</strong><small>Записи без отмеченного итога</small></article>
      <article className="panel outcome-kpi"><span>Доля продлений</span><strong>{data.renewal_share_pct === null ? '—' : `${data.renewal_share_pct}%`}</strong><small>Среди {data.known_total} известных итогов</small></article>
    </section>
    <section className="panel outcome-history">
      <div className="panel-heading"><div><h2>Зафиксированные результаты</h2><p>Результаты вводятся вручную в разделе «Работа с клиентами».</p></div></div>
      {data.items.length === 0 ? <div className="empty"><CheckCircle2 size={28} /><h3>Результатов пока нет</h3><p>После общения с клиентом отметьте, продлил ли он услугу.</p></div> :
        <div className="outcome-list">{data.items.map((item: any) => <div className="outcome-row" key={item.id}>
          <button disabled={!item.customer} onClick={() => onSelect(item.customer_id)}>{item.customer?.email || `Клиент #${item.customer_id} · нет в текущих данных`}</button>
          <span className={`outcome-badge outcome-${item.outcome}`}>{item.outcome === 'renewed' ? 'Продлил' : 'Не продлил'}</span>
          <time>{item.outcome_recorded_at ? `${date(item.outcome_recorded_at)} МСК` : 'Дата неизвестна'}</time>
        </div>)}</div>}
      <p className="outcome-disclaimer">Эти числа показывают отмеченные итоги. Они не доказывают, что продление произошло именно благодаря контакту.</p>
    </section>
  </div>;
}

function ActionQueue({ onSelect, onSuccess }: { onSelect: (id: number) => void; onSuccess: (message: string) => void }) {
  const query = useQuery({ queryKey: ["actions"], queryFn: () => api("/actions"), refetchInterval: 5000 });
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState(() => {
    const saved = localStorage.getItem('aeza-action-filter');
    return ['all', 'due', 'open', 'contacted', 'resolved'].includes(saved || '') ? saved! : 'all';
  });
  useEffect(() => { localStorage.setItem('aeza-action-filter', filter); }, [filter]);
  if (query.isError) return <ErrorBox message={query.error.message} />;
  if (query.isPending) return <Loading />;
  const items = query.data.items as any[];
  const activeCount = items.filter((item) => item.status !== 'resolved').length;
  const due = (item: any) => item.status !== 'resolved' && item.next_contact_at && Date.parse(item.next_contact_at) <= Date.now();
  const dueCount = items.filter(due).length;
  const visible = (filter === 'all' ? items : filter === 'due' ? items.filter(due) : items.filter((item) => item.status === filter))
    .sort((a: any, b: any) => Number(due(b)) - Number(due(a)) || a.id - b.id);
  const filters = [
    ['all', 'Все'], ['due', 'Напоминания'], ['open', 'В работе'], ['contacted', 'Связались'], ['resolved', 'Завершено'],
  ];
  return <section className="panel action-panel">
    <div className="panel-heading"><div><h2>Очередь контактов</h2><p>Назначайте ответственного, планируйте следующий звонок и фиксируйте каждый разговор.</p></div><span className="subtle-tag">{activeCount} активных</span></div>
    {dueCount > 0 && <div className="action-reminder" role="status">Пора связаться с {dueCount} клиентами. Откройте «Напоминания».</div>}
    <div className="action-filters" aria-label="Фильтр контактов">{filters.map(([key, label]) => <button key={key} type="button" className={filter === key ? 'selected' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label} <span>{key === 'all' ? items.length : key === 'due' ? dueCount : items.filter((item) => item.status === key).length}</span></button>)}</div>
    {items.length === 0 && <div className="empty"><ClipboardList size={28} /><h3>Очередь пуста</h3><p>Откройте клиента и нажмите «Добавить в работу».</p></div>}
    {items.length > 0 && visible.length === 0 && <div className="empty"><ClipboardList size={28} /><h3>Нет записей с таким статусом</h3></div>}
    <div className="action-list">{visible.map((action: any) => <ActionCard key={action.id} action={action} onSelect={onSelect} onSuccess={onSuccess} onSaved={() => queryClient.invalidateQueries({ queryKey: ["actions"] })} />)}</div>
  </section>;
}

function ActionCard({ action, onSelect, onSuccess, onSaved }: { action: any; onSelect: (id: number) => void; onSuccess: (message: string) => void; onSaved: () => void }) {
  const asLocal = (value: string | null) => value ? new Date(value).toLocaleString('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(' ', 'T') : '';
  const [status, setStatus] = useState(action.status);
  const [note, setNote] = useState(action.note);
  const [outcome, setOutcome] = useState(action.outcome ?? 'pending');
  const [assignee, setAssignee] = useState(action.assignee ?? '');
  const [nextContact, setNextContact] = useState(asLocal(action.next_contact_at));
  const [channel, setChannel] = useState('call');
  const [contactNote, setContactNote] = useState('');
  const [baseVersion, setBaseVersion] = useState(action.version);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<any>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const queryClient = useQueryClient();
  useEffect(() => {
    if (dirty) {
      if (action.version !== baseVersion) setConflict(action);
    } else {
      setStatus(action.status);
      setNote(action.note);
      setOutcome(action.outcome ?? 'pending');
      setAssignee(action.assignee ?? '');
      setNextContact(asLocal(action.next_contact_at));
      setBaseVersion(action.version);
      setConflict(null);
    }
  }, [action.version]);
  function loadCurrent(current: any, keepDraft: boolean) {
    if (!keepDraft) {
      setStatus(current.status);
      setNote(current.note);
      setOutcome(current.outcome ?? 'pending');
      setAssignee(current.assignee ?? '');
      setNextContact(asLocal(current.next_contact_at));
      setDirty(false);
    }
    setBaseVersion(current.version);
    setConflict(null);
    setError('');
  }
  async function save() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const saved = await api(`/actions/${action.customer_id}`, { method: "PUT", body: JSON.stringify({ status, note, outcome, assignee, next_contact_at: nextContact ? new Date(nextContact).toISOString() : null, expected_version: baseVersion }) });
      setBaseVersion(saved.version);
      setDirty(false);
      setConflict(null);
      onSaved();
      await queryClient.invalidateQueries({ queryKey: ['action-outcomes'] });
      onSuccess("Результат работы сохранён");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) setConflict(cause.detail?.current ?? action);
      setError((cause as Error).message);
    } finally {
      setPending(false);
    }
  }
  async function recordContact() {
    if (pending || !contactNote.trim() || dirty) return;
    setPending(true);
    setError('');
    try {
      const saved = await api(`/actions/${action.customer_id}/contacts`, { method: 'POST', body: JSON.stringify({ channel, note: contactNote.trim(), next_contact_at: nextContact ? new Date(nextContact).toISOString() : null, expected_version: baseVersion }) });
      setBaseVersion(saved.version);
      setContactNote('');
      onSaved();
      onSuccess('Контакт добавлен в историю');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) setConflict(cause.detail?.current ?? action);
      setError((cause as Error).message);
    } finally {
      setPending(false);
    }
  }
  const overdue = action.status !== 'resolved' && action.next_contact_at && Date.parse(action.next_contact_at) <= Date.now();
  return <article className="action-card">
    <div className="action-card-head">
      <button disabled={!action.customer} onClick={() => onSelect(action.customer_id)}>{action.customer?.email ?? `Клиент #${action.customer_id} · нет в текущих данных`}</button>
      <span>{action.customer ? <Badge level={action.customer.risk_level} /> : "Нет в текущем снимке"}</span>
    </div>
    {action.customer?.phone && <a className="action-phone" href={`tel:${action.customer.phone}`}>Позвонить: {action.customer.phone}</a>}
    {action.customer && <p>{formatReason(action.customer.reason)} · {money(action.customer.loss_eur)} под риском</p>}
    {action.next_contact_at && <p className={overdue ? 'action-due overdue' : 'action-due'}>{overdue ? 'Напоминание: срок наступил' : 'Следующий контакт'} · {date(action.next_contact_at)} МСК</p>}
    <div className="action-fields">
      <label>Ответственный<input value={assignee} maxLength={80} onChange={(event) => { setAssignee(event.target.value); setDirty(true); }} placeholder="Имя сотрудника" /></label>
      <label>Следующий контакт<input type="datetime-local" value={nextContact} onChange={(event) => { setNextContact(event.target.value); setDirty(true); }} /></label>
      <label>Статус<select value={status} onChange={(event) => { setStatus(event.target.value); setDirty(true); }}><option value="open">В работе</option><option value="contacted">Связались</option><option value="resolved">Завершено</option></select></label>
      <label>Итог продления<select value={outcome} onChange={(event) => { setOutcome(event.target.value); setDirty(true); }}><option value="pending">Ожидаем</option><option value="renewed">Продлил</option><option value="not_renewed">Не продлил</option></select></label>
      <label>Заметка<textarea value={note} maxLength={2000} onChange={(event) => { setNote(event.target.value); setDirty(true); }} placeholder="Что обсудили с клиентом" /></label>
    </div>
    {error && <ErrorBox message={error} />}
    {conflict && <div className="action-conflict" role="alert"><strong>Запись обновилась в другой вкладке</strong><p>Актуальная заметка: {conflict.note || 'без заметки'}. Ваш черновик сохранён в форме.</p><div><button type="button" className="secondary" onClick={() => loadCurrent(conflict, false)}>Загрузить актуальное</button><button type="button" className="secondary" onClick={() => loadCurrent(conflict, true)}>Оставить мой черновик</button></div></div>}
    <div className="action-card-foot"><span>Обновлено {date(action.updated_at)} МСК</span><button className="primary" disabled={pending} onClick={save}>Сохранить</button></div>
    <div className="action-contact-form"><strong>Записать разговор</strong><div className="action-fields"><label>Канал<select value={channel} onChange={(event) => setChannel(event.target.value)}><option value="call">Звонок</option><option value="email">Письмо</option><option value="chat">Чат</option><option value="other">Другое</option></select></label><label>Итог контакта<textarea value={contactNote} maxLength={2000} onChange={(event) => setContactNote(event.target.value)} placeholder="Что обсудили и о чём договорились" /></label></div><button className="secondary" type="button" disabled={pending || dirty || !contactNote.trim()} onClick={recordContact}>Добавить в историю</button>{dirty && <small>Сначала сохраните изменения карточки.</small>}</div>
    <details className="action-history"><summary>История контактов · {action.contacts?.length ?? 0}</summary>{action.contacts?.length ? <ol>{action.contacts.map((contact: any) => <li key={contact.id}><strong>{contact.channel === 'call' ? 'Звонок' : contact.channel === 'email' ? 'Письмо' : contact.channel === 'chat' ? 'Чат' : 'Другое'}</strong> · {date(contact.contacted_at)} МСК<p>{contact.note}</p></li>)}</ol> : <p>Пока нет записанных разговоров.</p>}</details>
  </article>;
}

function ModelSettings({ onSuccess }: { onSuccess: (s: string) => void }) {
  const q = useQuery({
      queryKey: ["settings"],
      queryFn: () => api("/model/settings"),
    }),
    qc = useQueryClient();
  const [draft, setDraft] = useState<any>(null),
    [baseVersion, setBaseVersion] = useState(0),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (q.data && !draft) {
      setDraft(q.data);
      setBaseVersion(q.data.settings_version);
    }
  }, [q.data]);
  async function save() {
    setPending(true);
    setError("");
    try {
      const { features, settings_version, ...payload } = draft;
      await api("/model/settings", {
        method: "PATCH",
        body: JSON.stringify({
          ...payload,
          expected_settings_version: baseVersion,
        }),
      });
      await qc.invalidateQueries();
      const fresh = await api("/model/settings");
      setDraft(fresh);
      setBaseVersion(fresh.settings_version);
      onSuccess("Настройки сохранены. Оценки пересчитаны.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  if (q.isError) return <ErrorBox message={q.error.message} />;
  if (!draft) return <Loading />;
  return (
    <div className="settings-layout">
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Коэффициенты риска</h2>
            <p>Веса определяют вклад каждого признака в итоговую оценку</p>
          </div>
          <span className="subtle-tag">Версия {baseVersion}</span>
        </div>
        {error && <ErrorBox message={error} />}
        <div className="settings-body">
          {Object.entries(draft.features).map(([key, f]: [string, any]) => (
            <div className="weight-row" key={key}>
              <div>
                <strong>{f.label}</strong>
                <p>{f.description}</p>
              </div>
              <div className="weight-control">
                <input
                  aria-label={"Вес: " + f.label}
                  type="range"
                  min="0"
                  max="100"
                  value={Math.min(draft.weights[key], 100)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      weights: {
                        ...draft.weights,
                        [key]: Number(e.target.value),
                      },
                    })
                  }
                />
                <input
                  aria-label={"Числовой вес: " + f.label}
                  type="number"
                  min="0"
                  max="10000"
                  value={draft.weights[key]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      weights: {
                        ...draft.weights,
                        [key]: Number(e.target.value),
                      },
                    })
                  }
                />
              </div>
            </div>
          ))}
          <h3>Параметры расчёта</h3>
          <div className="parameter-grid">
            {[
              ["horizon_days", "Горизонт, дней", 1, 30, 1],
              ["urgency_days", "Окно срочности, дней", 1, 30, 1],
              ["medium_threshold", "Средний риск от", 1, 99, 1],
              ["high_threshold", "Высокий риск от", 1, 100, 1],
              ["funded_multiplier", "Множитель при покрытии", 0, 1, 0.05],
            ].map(([key, label, min, max, step]) => (
              <label key={String(key)}>
                {label}
                <input
                  type="number"
                  min={Number(min)}
                  max={Number(max)}
                  step={Number(step)}
                  value={draft[String(key)]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      [String(key)]: Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
          </div>
        </div>
        <div className="settings-actions">
          <button
            className="secondary"
            disabled={pending}
            onClick={() => {
              setDraft(q.data);
              setBaseVersion(q.data.settings_version);
              setError("");
            }}
          >
            Отменить изменения
          </button>
          <button className="primary" disabled={pending} onClick={save}>
            {pending ? (
              <RefreshCw size={17} className="spin" />
            ) : (
              <Check size={17} />
            )}
            Сохранить и пересчитать
          </button>
        </div>
      </section>
      <aside className="settings-aside">
        <span className="square-icon">
          <SlidersHorizontal size={23} />
        </span>
        <h2>Модель без чёрного ящика</h2>
        <p>
          Индекс — взвешенная сумма признаков, нормированная к шкале от 0 до
          100.
        </p>
        <div className="formula">
          100 × Σ(вес × признак)
          <hr />Σ весов
        </div>
        <ul>
          <li>Нулевой вес отключает признак</li>
          <li>Настройки сохраняются в базе</li>
          <li>Все открытые вкладки обновляются автоматически</li>
        </ul>
        <div className="aside-note">
          <Info size={17} />
          <span>
            Изменение весов меняет индекс, но не превращает его в статистическую
            вероятность ухода.
          </span>
        </div>
      </aside>
    </div>
  );
}

function AccountSettings({ data, pending, error, onSaved, onSuccess, onLogout }: {
  data: any;
  pending: boolean;
  error: Error | null;
  onSaved: (updated: any) => void;
  onSuccess: (message: string) => void;
  onLogout: () => void;
}) {
  const [profile, setProfile] = useState({ login: "", display_name: "", email: "", current_password: "" });
  const [password, setPassword] = useState({ current: "", next: "", confirm: "" });
  const [profileError, setProfileError] = useState("");
  const [securityError, setSecurityError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingSecurity, setSavingSecurity] = useState(false);
  const qc = useQueryClient();
  useEffect(() => {
    if (data) setProfile({ login: data.login, display_name: data.display_name, email: data.email, current_password: "" });
  }, [data?.login, data?.display_name, data?.email]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setProfileError("");
    setSavingProfile(true);
    try {
      const updated = await api("/account/profile", { method: "PUT", body: JSON.stringify(profile) });
      setProfile((current) => ({ ...current, current_password: "" }));
      onSaved(updated);
    } catch (cause) {
      setProfileError((cause as Error).message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setSecurityError("");
    if (password.next !== password.confirm) {
      setSecurityError("Новые пароли не совпадают");
      return;
    }
    setSavingSecurity(true);
    try {
      await api("/account/password", { method: "POST", body: JSON.stringify({ current_password: password.current, new_password: password.next }) });
      setPassword({ current: "", next: "", confirm: "" });
      await qc.invalidateQueries({ queryKey: ["account"] });
      onSuccess("Пароль изменён. Другие сеансы завершены.");
    } catch (cause) {
      setSecurityError((cause as Error).message);
    } finally {
      setSavingSecurity(false);
    }
  }

  async function revokeSessions() {
    setSecurityError("");
    setSavingSecurity(true);
    try {
      const result = await api("/account/sessions/revoke", { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["account"] });
      onSuccess(`Завершено других сеансов: ${result.revoked}`);
    } catch (cause) {
      setSecurityError((cause as Error).message);
    } finally {
      setSavingSecurity(false);
    }
  }
  if (pending) return <Loading />;
  if (error) return <ErrorBox message={error.message} />;
  if (!data) return null;
  return (
    <div className="account-layout">
      <section className="panel account-panel">
        <div className="account-hero">
          <span className="account-avatar">{data.display_name.slice(0, 1).toUpperCase()}</span>
          <div><span className="eyebrow">ПРОФИЛЬ</span><h2>{data.display_name}</h2><p>@{data.login} · ID {data.id}</p></div>
        </div>
        <form onSubmit={saveProfile} className="account-form">
          <h3>Данные аккаунта</h3>
          <p>Имя показывается в панели. Email сохраняется в профиле как контактная информация.</p>
          {profileError && <ErrorBox message={profileError} />}
          <div className="account-fields">
            <label>Отображаемое имя<input value={profile.display_name} onChange={(event) => setProfile({ ...profile, display_name: event.target.value })} maxLength={80} required autoComplete="name" /></label>
            <label>Логин<input value={profile.login} onChange={(event) => setProfile({ ...profile, login: event.target.value })} minLength={3} maxLength={40} pattern="[A-Za-z0-9_.-]+" required autoComplete="username" /></label>
            <label className="account-field-wide">Контактный email<input value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} type="email" maxLength={254} placeholder="name@example.com" autoComplete="email" /></label>
            {profile.login !== data.login && <label className="account-field-wide">Текущий пароль для смены логина<input value={profile.current_password} onChange={(event) => setProfile({ ...profile, current_password: event.target.value })} type="password" required autoComplete="current-password" /></label>}
          </div>
          <button className="primary" disabled={savingProfile}><Check size={17} />{savingProfile ? "Сохраняем…" : "Сохранить профиль"}</button>
        </form>
      </section>
      <div className="account-side">
        <section className="panel account-panel">
          <div className="account-section-heading"><LockKeyhole size={20} /><div><h3>Безопасность и вход</h3><p>Смена пароля завершит все другие сеансы.</p></div></div>
          {securityError && <ErrorBox message={securityError} />}
          <form onSubmit={changePassword} className="account-form account-password-form">
            <label>Текущий пароль<input value={password.current} onChange={(event) => setPassword({ ...password, current: event.target.value })} type="password" autoComplete="current-password" required /></label>
            <label>Новый пароль<input value={password.next} onChange={(event) => setPassword({ ...password, next: event.target.value })} type="password" minLength={12} autoComplete="new-password" required /></label>
            <label>Повторите новый пароль<input value={password.confirm} onChange={(event) => setPassword({ ...password, confirm: event.target.value })} type="password" minLength={12} autoComplete="new-password" required /></label>
            <button className="primary" disabled={savingSecurity}><ShieldCheck size={17} />Изменить пароль</button>
          </form>
        </section>
        <section className="panel account-panel">
          <div className="account-section-heading"><Activity size={20} /><div><h3>Активность аккаунта</h3><p>Информация о ваших сеансах.</p></div></div>
          <dl className="account-facts">
            <div><dt>Последний вход</dt><dd>{data.last_login_at ? `${date(data.last_login_at)} МСК` : "Нет данных"}</dd></div>
            <div><dt>Текущий сеанс до</dt><dd>{date(data.session_expires_at)} МСК</dd></div>
            <div><dt>Активных сеансов</dt><dd>{data.active_sessions}</dd></div>
            <div><dt>Запоминание входа</dt><dd>{data.remember_me ? "Включено" : "До перезагрузки страницы"}</dd></div>
            <div><dt>Пароль изменён</dt><dd>{data.password_changed_at ? `${date(data.password_changed_at)} МСК` : "Не менялся"}</dd></div>
            <div><dt>Единый вход</dt><dd>{data.oidc_available ? "Подключён" : "Ожидает настройки провайдера"}</dd></div>
          </dl>
          <div className="account-actions">
            <button className="secondary" onClick={revokeSessions} disabled={savingSecurity || data.active_sessions < 2}>Завершить другие сеансы</button>
            <button className="secondary" onClick={onLogout}><LogOut size={16} /> Выйти из аккаунта</button>
          </div>
        </section>
      </div>
    </div>
  );
}

function SourcePanel({
  summary,
  onSuccess,
}: {
  summary: any;
  onSuccess: (s: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState<"original" | "import" | null>(null),
    [result, setResult] = useState<any>(null),
    qc = useQueryClient();
  async function action(kind: "original" | "import" | "demo") {
    setPending(true);
    setError("");
    try {
      let r;
      if (kind === "demo" || kind === "original")
        r = await api("/source/" + kind, { method: "POST" });
      else {
        const body = JSON.parse(await file!.text());
        r = await api("/source/snapshot", {
          method: "PUT",
          body: JSON.stringify(body),
        });
      }
      setResult(r);
      setConfirm(null);
      await qc.invalidateQueries();
      onSuccess(
        kind === "demo"
          ? "Демосценарии добавлены к текущим данным"
          : "Данные загружены. Расчёт обновлён.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  async function download() {
    try {
      const data = await api("/source/snapshot");
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "snapshot.json";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="source-stats">
        <div>
          <Database size={21} />
          <span>
            <strong>{summary?.customer_count ?? "—"}</strong> аккаунтов
          </span>
        </div>
        <div>
          <Activity size={21} />
          <span>
            <strong>{summary?.service_count ?? "—"}</strong> услуг
          </span>
        </div>
        <div>
          <FileJson size={21} />
          <span>
            <strong>{summary?.transaction_count ?? "—"}</strong> транзакций
          </span>
        </div>
        <button className="secondary" onClick={download}>
          <Download size={16} />
          Экспорт snapshot
        </button>
      </div>
      {error && <ErrorBox message={error} />}
      <div className="source-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Импорт снимка данных</h2>
              <p>Полная замена аккаунтов, услуг и транзакций</p>
            </div>
            <Upload size={20} />
          </div>
          <div className="source-body">
            <label className="file-drop">
              <span className="square-icon">
                <FileJson size={24} />
              </span>
              <strong>{file ? file.name : "Выберите JSON-файл"}</strong>
              <span>Массивы accounts, services, transactions · до 20 МБ</span>
              <input
                type="file"
                accept=".json,application/json"
                aria-label="Выбрать snapshot JSON"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && f.size > 20 * 1024 * 1024) {
                    setError("Размер файла превышает 20 МБ");
                    setFile(null);
                  } else {
                    setFile(f || null);
                    setError("");
                  }
                }}
              />
            </label>
            <p className="source-hint">
              Перед заменой проверяем структуру, связи и ограничения. Если есть
              ошибка, текущие данные сохраняются.
            </p>
            <button
              className="primary"
              disabled={!file || pending}
              onClick={() => setConfirm("import")}
            >
              <Upload size={16} />
              Проверить и загрузить
            </button>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Данные для проверки</h2>
              <p>Оригинальный набор и отдельные сценарии</p>
            </div>
            <Zap size={20} />
          </div>
          <div className="source-body">
            <div className="source-option">
              <strong>Исходный набор организаторов</strong>
              <p>
                10 аккаунтов · 30 услуг · 100 транзакций. Без изменения дат и
                статусов.
              </p>
              <button
                className="secondary"
                disabled={pending}
                onClick={() => setConfirm("original")}
              >
                Загрузить оригинал <ArrowRight size={15} />
              </button>
            </div>
            <div className="source-option">
              <strong>Согласованные демосценарии</strong>
              <p>
                Добавляет 6 клиентов с разными рисками к текущему набору. Адреса
                начинаются с demo-.
              </p>
              <button
                className="secondary"
                disabled={pending}
                onClick={() => action("demo")}
              >
                Добавить демосценарии <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </section>
      </div>
      {confirm && (
        <div className="confirm-box" role="alert">
          <AlertTriangle size={21} />
          <div>
            <strong>Заменить текущий снимок?</strong>
            <p>
              Будут заменены данные клиентов, услуг и транзакций. Настройки
              модели сохранятся. Перед заменой можно экспортировать текущий
              snapshot.
            </p>
            <div>
              <button
                className="primary"
                disabled={pending}
                onClick={() => action(confirm)}
              >
                {pending ? "Проверяем…" : "Подтвердить замену"}
              </button>
              <button
                className="secondary"
                disabled={pending}
                onClick={() => setConfirm(null)}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
      {result && (
        <div className="success-line">
          <CheckCircle2 size={17} />
          Обновление завершено. Версия источника {result.source_version}, расчёт
          #{result.calculation_version}.
        </div>
      )}
      <section className="panel quality-panel">
        <div className="panel-heading">
          <div>
            <h2>Качество исходных данных</h2>
            <p>
              Несогласованные состояния исключаются из прогноза до уточнения
            </p>
          </div>
          <span className="subtle-tag">
            {summary?.warnings.length ?? 0} замечаний
          </span>
        </div>
        {summary?.warnings.length ? (
          <div className="quality-list">
            {summary.warnings.map((w: any) => (
              <div key={w.service_id}>
                <AlertTriangle size={16} />
                <span>
                  Услуга <strong>#{w.service_id}</strong> · клиент #
                  {w.customer_id}
                </span>
                <p>{formatReason(w.message)}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            <CheckCircle2 size={26} />
            <p>Противоречий жизненного цикла не найдено</p>
          </div>
        )}
      </section>
      <div className="api-links">
        <a href="/api/v1/docs" target="_blank" rel="noreferrer">
          Swagger / OpenAPI <ExternalLink size={14} />
        </a>
        <a href="/metrics" target="_blank" rel="noreferrer">
          Метрики Prometheus <ExternalLink size={14} />
        </a>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
