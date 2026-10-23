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
} from "lucide-react";
import { api, setCSRF, levels, money, date, Level } from "./api";
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
type View = "overview" | "customers" | "settings" | "source" | "actions";
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

function LoginPage({
  onLogin,
  theme,
  systemDark,
  onToggleTheme,
}: {
  onLogin: (u: any) => void;
  theme: Theme;
  systemDark: boolean;
  onToggleTheme: () => void;
}) {
  const [login, setLogin] = useState("admin"),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const u = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ login, password }),
      });
      setCSRF(u.csrf_token);
      onLogin(u);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
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
            <Activity size={17} /> Aéza Retention · версия 0.4
          </span>
        </div>
      </div>
      <div className="login-form-area">
        <div className="login-theme-toggle">
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
          <button className="primary" disabled={pending}>
            {pending ? "Входим…" : "Войти в панель"}
            <ArrowRight size={18} />
          </button>
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
    [checking, setChecking] = useState(true),
    [view, setView] = useState<View>("overview"),
    [customerId, setCustomerId] = useState<number | null>(null),
    [connection, setConnection] = useState("Подключение…"),
    [mobile, setMobile] = useState(false),
    [toast, setToast] = useState("");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [focusScenario, setFocusScenario] = useState(false);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const qc = useQueryClient();
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
      resolvedTheme === "dark" ? "#141218" : "#f8f6f4",
    );
    if (theme === "system") localStorage.removeItem("aeza-theme-preference");
    else localStorage.setItem("aeza-theme-preference", theme);
  }, [theme, systemDark]);
  function toggleTheme() {
    setTheme((current) => nextTheme(current, systemDark));
  }
  useEffect(() => {
    api("/auth/me")
      .then((u) => {
        setCSRF(u.csrf_token);
        setUser(u);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
    const expire = () => {
      setUser(null);
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
  const summary = useQuery({
    queryKey: ["summary"],
    queryFn: () => api("/analytics/summary"),
    enabled: !!user,
    refetchInterval: 5000,
  });
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
      setCSRF("");
      setUser(null);
      qc.clear();
    } catch (e) {
      setToast((e as Error).message);
    }
  }
  function navigate(v: View) {
    setView(v);
    setMobile(false);
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
  if (checking) return <Loading />;
  if (!user)
    return (
      <LoginPage
        onLogin={setUser}
        theme={theme}
        systemDark={systemDark}
        onToggleTheme={toggleTheme}
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
      <aside className={"sidebar " + (mobile ? "open" : "")}>
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
              ["settings", SlidersHorizontal, "Модель риска"],
              ["source", Database, "Источники данных"],
              ["actions", ClipboardList, "Работа с клиентами"],
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
          <button className="profile" onClick={logout} title="Выйти">
            <span className="avatar">A</span>
            <span>
              Администратор<small>{user.login}</small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="menu-btn icon-btn"
              aria-label="Открыть навигацию"
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
                  settings: "Модель риска",
                  source: "Источники данных",
                  actions: "Работа с клиентами",
                }[view]
              }
            </strong>
          </div>
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
            <span className="small-avatar">A</span>
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
                    settings: "Модель риска",
                    source: "Источники данных",
                    actions: "Работа с клиентами",
                  }[view]
                }
              </h1>
              <p>
                {
                  {
                    overview: "Вовремя заметить риск. Сохранить клиента.",
                    customers: "Приоритеты для вашей следующей коммуникации.",
                    settings: "Прозрачные правила. Управляемые коэффициенты.",
                    source: "Исходные данные и качество прогноза.",
                    actions: "Контакты и результаты работы с клиентами.",
                  }[view]
                }
              </p>
            </div>
            <div className="heading-actions">
              <span className="period">
                <Clock size={15} /> Горизонт: {summary.data?.horizon_days ?? 7}{" "}
                дней
              </span>
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
                  onCustomers={() => navigate("customers")}
                  onSource={() => navigate("source")}
                />
                <CustomerTable compact onSelect={openCustomer} />
              </>
            ) : (
              <Loading />
            ))}
          {view === "customers" && <CustomerTable onSelect={openCustomer} />}
          {view === "settings" && <ModelSettings onSuccess={setToast} />}
          {view === "source" && (
            <SourcePanel summary={summary.data} onSuccess={setToast} />
          )}
          {view === "actions" && <ActionQueue onSelect={openCustomer} onSuccess={setToast} />}
          <footer className="page-footer">
            <span>© 2026 · Aéza Retention</span>
            <span>
              Индекс риска — объяснимая оценка, а не вероятность оттока
            </span>
          </footer>
        </main>
      </div>
      {customerId !== null && (
        <CustomerDrawer id={customerId} focusScenario={focusScenario} onClose={() => setCustomerId(null)} onSuccess={setToast} />
      )}
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
  onCustomers,
  onSource,
}: {
  data: any;
  onCustomers: () => void;
  onSource: () => void;
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
      <section className="kpi-grid">
        <div className="kpi kpi-main">
          <div className="kpi-top">
            <span>Платежи под риском</span>
            <ArrowUpRight size={19} />
          </div>
          <strong>{money(data.loss_eur)}</strong>
          <div className="kpi-sub">
            Сценарная сумма за {data.horizon_days} дней
          </div>
          <div className="kpi-bottom">
            <span className="light-tag">
              {data.money_partial ? "Частичная оценка" : "Полная оценка"}
            </span>
            <span>С учётом баланса и риска</span>
          </div>
          <div className="kpi-decoration" />
        </div>
        <div className="kpi">
          <div className="kpi-top">
            <span>Высокий риск</span>
            <span className="metric-icon coral">
              <Users size={19} />
            </span>
          </div>
          <strong>
            {data.risk_counts.high}
            <small>клиентов</small>
          </strong>
          <div className="kpi-sub">Нуждаются в вашем внимании</div>
          <button className="kpi-link" onClick={onCustomers}>
            Посмотреть клиентов <ArrowRight size={15} />
          </button>
        </div>
        <div className="kpi">
          <div className="kpi-top">
            <span>Не покрыто балансом</span>
            <span className="metric-icon orange">
              <Activity size={19} />
            </span>
          </div>
          <strong>{money(data.unfunded_eur)}</strong>
          <div className="kpi-sub">
            Из {money(data.due_eur)} известных платежей
          </div>
          <div className="kpi-footnote">
            <Info size={14} /> Без повторного учёта средств
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-top">
            <span>Клиентов в анализе</span>
            <span className="metric-icon neutral">
              <Users size={19} />
            </span>
          </div>
          <strong>
            {data.customer_count}
            <small>всего</small>
          </strong>
          <div className="kpi-sub">
            {data.service_count} услуг · {data.transaction_count} транзакций
          </div>
          <div className="kpi-footnote">
            <span className="green-dot" />
            {data.scored_customer_count} с полной оценкой
          </div>
        </div>
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
      <section className="chart-grid" id="forecast-chart">
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
        <div className="panel calendar">
          <div className="panel-heading">
            <div>
              <h2>Прогноз по дням</h2>
              <p>Платежи и сценарная сумма под риском, EUR</p>
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
              <span>0 €</span>
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

function CustomerTable({
  compact = false,
  onSelect,
}: {
  compact?: boolean;
  onSelect: (id: number) => void;
}) {
  const [sort, setSort] = useState("score"),
    [order, setOrder] = useState("desc"),
    [search, setSearch] = useState(""),
    [level, setLevel] = useState(""),
    [page, setPage] = useState(1);
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
          <div className="filter">
            <SlidersHorizontal size={15} />
            <select
              aria-label="Уровень риска"
              value={level}
              onChange={(e) => {
                setLevel(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Все уровни</option>
              {ordered.map((k) => (
                <option key={k} value={k}>
                  {levels[k]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      {query.isError && <ErrorBox message={query.error.message} />}
      <div className="table-scroll">
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
                  <span title={c.reason}>{c.reason}</span>
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

function CustomerDrawer({ id, focusScenario, onClose, onSuccess }: { id: number; focusScenario: boolean; onClose: () => void; onSuccess: (message: string) => void }) {
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
  const [scenarioPending, setScenarioPending] = useState(false);
  async function runScenario() {
    setScenarioPending(true);
    setScenarioError("");
    try {
      const payload: Record<string, number | boolean> = {};
      if (scenarioBalance !== "") payload.balance_cents = Math.round(Number(scenarioBalance) * 100);
      if (scenarioService) {
        payload.service_id = Number(scenarioService);
        payload.auto_prolong = scenarioAuto;
      }
      setScenario(await api(`/customers/${id}/simulate`, { method: "POST", body: JSON.stringify(payload) }));
    } catch (error) {
      setScenarioError((error as Error).message);
    } finally {
      setScenarioPending(false);
    }
  }
  async function addAction() {
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
      setScenarioError((error as Error).message);
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
              <p>{c.reason}</p>
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
            <section className="scenario-panel" ref={scenarioRef}>
              <h3>Что если?</h3>
              <p>Расчёт без изменения данных и настроек.</p>
              <label>
                Основной баланс, EUR
                <input type="number" min="0" step="0.01" value={scenarioBalance} placeholder={String(c.balance / 100)} onChange={(event) => setScenarioBalance(event.target.value)} />
              </label>
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
              <button className="primary" disabled={scenarioPending || (!scenarioService && scenarioBalance === "")} onClick={runScenario}>Рассчитать сценарий</button>
              {scenarioError && <ErrorBox message={scenarioError} />}
              {scenario && <div className="scenario-result">
                <span>Индекс: {scenario.before.score ?? "—"} → <strong>{scenario.after.score ?? "—"}</strong></span>
                <span>Под риском: {money(scenario.before.loss_eur)} → <strong>{money(scenario.after.loss_eur)}</strong></span>
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
                    {s.quality_warning}
                  </div>
                ) : (
                  <div className="feature-list">
                    {s.reasons.map((r: any, i: number) => (
                      <div key={i}>
                        <span>{r.text}</span>
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

function ActionQueue({ onSelect, onSuccess }: { onSelect: (id: number) => void; onSuccess: (message: string) => void }) {
  const query = useQuery({ queryKey: ["actions"], queryFn: () => api("/actions"), refetchInterval: 5000 });
  const queryClient = useQueryClient();
  if (query.isError) return <ErrorBox message={query.error.message} />;
  if (query.isPending) return <Loading />;
  return <section className="panel action-panel">
    <div className="panel-heading"><div><h2>Очередь контактов</h2><p>Добавляйте клиентов из карточки, фиксируйте результат общения.</p></div><span className="subtle-tag">{query.data.items.length} в работе</span></div>
    {query.data.items.length === 0 && <div className="empty"><ClipboardList size={28} /><h3>Очередь пуста</h3><p>Откройте клиента и нажмите «Добавить в работу».</p></div>}
    <div className="action-list">{query.data.items.map((action: any) => <ActionCard key={action.id} action={action} onSelect={onSelect} onSuccess={onSuccess} onSaved={() => queryClient.invalidateQueries({ queryKey: ["actions"] })} />)}</div>
  </section>;
}

function ActionCard({ action, onSelect, onSuccess, onSaved }: { action: any; onSelect: (id: number) => void; onSuccess: (message: string) => void; onSaved: () => void }) {
  const [status, setStatus] = useState(action.status);
  const [note, setNote] = useState(action.note);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setPending(true);
    setError("");
    try {
      await api(`/actions/${action.customer_id}`, { method: "PUT", body: JSON.stringify({ status, note }) });
      onSaved();
      onSuccess("Результат работы сохранён");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPending(false);
    }
  }
  return <article className="action-card">
    <div className="action-card-head">
      <button onClick={() => onSelect(action.customer_id)}>{action.customer?.email ?? `Клиент #${action.customer_id}`}</button>
      <span>{action.customer ? <Badge level={action.customer.risk_level} /> : "Нет в текущем снимке"}</span>
    </div>
    {action.customer && <p>{action.customer.reason} · {money(action.customer.loss_eur)} под риском</p>}
    <div className="action-fields">
      <label>Статус<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="open">В работе</option><option value="contacted">Связались</option><option value="resolved">Завершено</option></select></label>
      <label>Заметка<textarea value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} placeholder="Что обсудили с клиентом" /></label>
    </div>
    {error && <ErrorBox message={error} />}
    <div className="action-card-foot"><span>Обновлено {date(action.updated_at)} МСК</span><button className="primary" disabled={pending} onClick={save}>Сохранить</button></div>
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
                <p>{w.message}</p>
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
