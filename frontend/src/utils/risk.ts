import type { RiskLevel } from "../types";

export const riskLevels: RiskLevel[] = [
  "Low",
  "Moderate",
  "High",
  "Severe",
  "No Travel",
];

export const riskColors: Record<RiskLevel, string> = {
  Low: "#16a34a",
  Moderate: "#eab308",
  High: "#f97316",
  Severe: "#dc2626",
  "No Travel": "#7f1d1d",
};

export const routeColors = ["#2563eb", "#7c3aed", "#0891b2"];

export function formatShortDateTime(value: string | number): string {
  return new Date(value).toLocaleString([], {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDateTime(value: string | number): string {
  return new Date(value).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
