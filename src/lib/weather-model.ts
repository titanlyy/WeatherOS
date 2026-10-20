export type PsiKey = "good" | "moderate" | "unhealthy" | "very" | "hazard";
export type PmKey = "normal" | "elevated" | "high" | "very-high";
export type ThemeId = "cyber" | "solar";

export type Station = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  tempC: number | null;
  humidity: number | null;
  rainMm: number | null;
  windFromDeg: number | null;
  windKnots: number | null;
};

export type Region = {
  id: string;
  lat: number;
  lon: number;
  psi: number | null;
  pm25h: number | null;
  pm25: number | null;
  pm10: number | null;
  o3: number | null;
  no2: number | null;
  so2: number | null;
  co: number | null;
};

export type AreaNow = {
  name: string;
  lat: number;
  lon: number;
  forecast: string;
};

export type PeriodOutlook = {
  text: string;
  regions: { id: string; text: string }[];
};

export type DayOutlook = {
  day: string;
  date: string;
  summary: string;
  text: string;
  tempLow: number | null;
  tempHigh: number | null;
  windDir: string | null;
  windLow: number | null;
  windHigh: number | null;
};

export type Briefing = {
  fetchedAt: string;
  partial: boolean;
  failed: boolean;
  stations: Station[];
  regions: Region[];
  psiUpdated: string | null;
  pmUpdated: string | null;
  uv: { value: number; hour: string } | null;
  nowcast: { validText: string | null; updated: string | null; areas: AreaNow[] } | null;
  day: {
    validText: string | null;
    summary: string | null;
    tempLow: number | null;
    tempHigh: number | null;
    rhLow: number | null;
    rhHigh: number | null;
    windDir: string | null;
    windLow: number | null;
    windHigh: number | null;
    periods: PeriodOutlook[];
  } | null;
  outlook: DayOutlook[];
};

export const REGION_ORDER = ["north", "south", "east", "west", "central"] as const;

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export function compass(deg: number): string {
  const i = Math.round(deg / 22.5) % 16;
  return COMPASS[(i + 16) % 16] ?? "N";
}

export function knotsToKmh(knots: number): number {
  return knots * 1.852;
}

export function psiKey(value: number): PsiKey {
  if (value <= 50) return "good";
  if (value <= 100) return "moderate";
  if (value <= 200) return "unhealthy";
  if (value <= 300) return "very";
  return "hazard";
}

export function psiLabel(value: number): string {
  const key = psiKey(value);
  if (key === "good") return "Good";
  if (key === "moderate") return "Moderate";
  if (key === "unhealthy") return "Unhealthy";
  if (key === "very") return "Very unhealthy";
  return "Hazardous";
}

export function pmKey(value: number): PmKey {
  if (value <= 55) return "normal";
  if (value <= 150) return "elevated";
  if (value <= 250) return "high";
  return "very-high";
}

export function pmLabel(value: number): string {
  const key = pmKey(value);
  if (key === "normal") return "Normal";
  if (key === "elevated") return "Elevated";
  if (key === "high") return "High";
  return "Very high";
}

export function forecastTone(text: string): "calm" | "wet" | "storm" {
  const t = text.toLowerCase();
  if (t.includes("thunder") || t.includes("heavy")) return "storm";
  if (t.includes("rain") || t.includes("shower")) return "wet";
  return "calm";
}

export function mean(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function windSummary(stations: Station[]): { fromDeg: number; kmh: number } | null {
  let x = 0;
  let y = 0;
  let speed = 0;
  let n = 0;
  for (const s of stations) {
    if (s.windFromDeg == null || s.windKnots == null) continue;
    const to = ((s.windFromDeg + 180) * Math.PI) / 180;
    const w = Math.max(s.windKnots, 0.2);
    x += Math.sin(to) * w;
    y += Math.cos(to) * w;
    speed += s.windKnots;
    n += 1;
  }
  if (!n || (x === 0 && y === 0)) return null;
  const toDeg = (Math.atan2(x, y) * 180) / Math.PI;
  const fromDeg = (toDeg + 180 + 360) % 360;
  return { fromDeg, kmh: knotsToKmh(speed / n) };
}

export function worstRegion(regions: Region[]): Region | null {
  const ranked = regions.filter((r) => r.psi != null);
  ranked.sort((a, b) => (b.psi ?? 0) - (a.psi ?? 0));
  return ranked[0] ?? null;
}

export function formatClock(date: Date): string {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatStamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function round1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(n >= 10 ? 0 : 1);
}
