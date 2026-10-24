let csrf = "";
export class ApiError extends Error {
  constructor(message: string, public status: number, public detail: any) {
    super(message);
    this.name = "ApiError";
  }
}
export function setCSRF(value: string) {
  csrf = value;
}
export async function api<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api/v1" + path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    if (
      response.status === 401 &&
      path !== "/auth/login" &&
      path !== "/auth/me"
    )
      window.dispatchEvent(new Event("session-expired"));
    const body = await response
      .json()
      .catch(() => ({ detail: "Сервер недоступен" }));
    throw new ApiError(
      typeof body.detail === "string"
        ? body.detail
        : typeof body.detail?.message === "string"
          ? body.detail.message
          : Array.isArray(body.detail)
            ? body.detail.map((d: any) => d.msg).join("; ")
            : "Ошибка запроса",
      response.status,
      body.detail,
    );
  }
  return response.json();
}
export type Level = "high" | "medium" | "low" | "unknown";
export const levels: Record<Level, string> = {
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
  unknown: "Нет оценки",
};
export type Currency = "RUB" | "USD" | "EUR";
export type Language = "ru" | "en";
export type FxRates = { rates_rub: { EUR: number; USD: number }; rate_date: string; stale: boolean; fetched_at: string | null; source: string };
let selectedCurrency: Currency = "RUB";
let selectedLanguage: Language = "ru";
let rates: FxRates = { rates_rub: { EUR: 90.2429, USD: 80.5381 }, rate_date: "24.10.2026", stale: true, fetched_at: null, source: "https://www.cbr.ru/scripts/XML_daily.asp" };
export const setDisplayPreferences = (currency: Currency, language: Language, nextRates?: FxRates) => {
  selectedCurrency = currency;
  selectedLanguage = language;
  if (nextRates) rates = nextRates;
};
export const currencySymbol = () => ({ RUB: "₽", USD: "$", EUR: "€" })[selectedCurrency];
export const displayFromEuro = (euros: number) => selectedCurrency === "EUR" ? euros :
  selectedCurrency === "RUB" ? euros * rates.rates_rub.EUR : euros * rates.rates_rub.EUR / rates.rates_rub.USD;
export const euroCentsFromDisplay = (value: number) => Math.round(
  (selectedCurrency === "EUR" ? value : selectedCurrency === "RUB" ? value / rates.rates_rub.EUR : value * rates.rates_rub.USD / rates.rates_rub.EUR) * 100,
);
export const money = (euros: number) =>
  new Intl.NumberFormat(selectedLanguage === "ru" ? "ru-RU" : "en-US", {
    style: "currency",
    currency: selectedCurrency,
    maximumFractionDigits: 2,
  }).format(displayFromEuro(euros));
const reasonTexts: Record<string, string> = {
  "Автопродление отключено для предстоящего платежа": "Auto-renewal is off for the upcoming payment",
  "Автопродление включено": "Auto-renewal is on",
  "В горизонте нет платежей для продления": "No renewal payments in the horizon",
  "Услуга ожидает оплаты": "Service awaits payment",
  "Ожидания оплаты нет": "No pending payment",
  "Ближайшие платежи покрыты, выраженных факторов риска нет": "Upcoming payments are covered; no major risk factors",
  "Нет услуг, доступных для продления": "No services eligible for renewal",
  "Оценка неполная: несогласованные сроки услуг": "Incomplete assessment: inconsistent service dates",
  "Услуга удалена": "Service deleted",
  "Продление заблокировано": "Renewal blocked",
  "Дата создания услуги позже времени расчёта": "Service created after analysis time",
  "Ожидание оплаты началось до срока окончания услуги": "Payment wait started before service expiry",
  "Срок услуги истёк, но источник сохраняет действующий статус": "Service expired but source still marks it active",
};
export const formatReason = (reason: string) => reason.split("; ").map((part) => {
  const funding = /^Не покрыто балансом: ([\d.]+) ₽$/.exec(part);
  if (funding) return `${selectedLanguage === "ru" ? "Не покрыто балансом" : "Unfunded"}: ${money(Number(funding[1]) / 90.2429)}`;
  if (selectedLanguage === "ru") return part;
  if (reasonTexts[part]) return reasonTexts[part];
  return part.replace(/^До срока оплаты: ([\d.]+) дн\.$/, "Until payment: $1 days")
    .replace(/^Просрочка оплаты: ([\d.]+) дн\.$/, "Payment overdue: $1 days")
    .replace(/^Ожидание оплаты длится ([\d.]+) дн\. при допустимых 5 днях$/, "Payment has been pending for $1 days (limit: 5 days)");
}).join("; ");
export const date = (s: string) =>
  new Date(s).toLocaleString(selectedLanguage === "ru" ? "ru-RU" : "en-US", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
