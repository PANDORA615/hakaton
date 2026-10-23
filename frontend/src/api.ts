let csrf = "";
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
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : body.detail?.map((d: any) => d.msg).join("; ") || "Ошибка запроса",
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
export const money = (n: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(n);
export const date = (s: string) =>
  new Date(s).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
