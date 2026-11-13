import { badRequest } from "./http.ts";

export function requireString(body: Record<string, unknown>, field: string, maxLength = 200): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest(`${field} is required`);
  }
  if (value.length > maxLength) throw badRequest(`${field} must be at most ${maxLength} characters`);
  return value.trim();
}

/** Money is always an integer number of cents (minor units). Never floats. */
export function requireCents(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw badRequest(`${field} must be a positive integer number of cents`);
  }
  return value;
}

export function requireCurrency(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) {
    throw badRequest(`${field} must be a 3-letter ISO currency code`);
  }
  return value;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function requireDate(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || !isIsoDate(value)) {
    throw badRequest(`${field} must be a date in YYYY-MM-DD format`);
  }
  return value;
}

export function parseId(raw: string, what: string): number {
  if (!/^\d+$/.test(raw)) throw badRequest(`Invalid ${what} id`);
  return Number(raw);
}
