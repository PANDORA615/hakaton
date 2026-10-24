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
// The source snapshot stores euro cents. Keep a fixed rate so historical
// calculations and what-if inputs use the same conversion.
export const RUB_PER_EUR = 90.2429;
export const rublesFromEuro = (euros: number) => Math.round(euros * RUB_PER_EUR * 100) / 100;
export const euroCentsFromRubles = (rubles: number) => Math.round((rubles / RUB_PER_EUR) * 100);
export const money = (euros: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(rublesFromEuro(euros));
export const date = (s: string) =>
  new Date(s).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
