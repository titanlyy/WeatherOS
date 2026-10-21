import { createServerFn } from "@tanstack/react-start";
import type { AreaNow, Briefing, DayOutlook, PeriodOutlook, Region, Station } from "./weather-model";

const BASE = "https://api-open.data.gov.sg/v2/real-time/api";
const UA = "WeatherOS/1.0 (+https://github.com/titanlyy/WeatherOS)";
const TTL_MS = 75_000;
const WINDOW_MS = 10_200;

const FAST = [
  "air-temperature",
  "relative-humidity",
  "wind-direction",
  "wind-speed",
  "psi",
  "two-hr-forecast",
] as const;

const REST = ["rainfall", "pm25", "twenty-four-hr-forecast", "four-day-outlook", "uv"] as const;

type Feed = Record<string, unknown> | null;
type Feeds = Record<string, Feed>;

let cache: { at: number; partial: boolean; data: Briefing; feeds: Feeds } | null = null;
let fastFlight: Promise<Briefing> | null = null;
let restFlight: Promise<void> | null = null;
let waveAt = 0;
let filledAt = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFeed(path: string, waitOnLimit: boolean): Promise<Feed> {
  const url = `${BASE}/${path}`;
  const tries = waitOnLimit ? 2 : 1;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": UA },
      });
      if (res.status === 429) {
        if (attempt + 1 >= tries) return null;
        await sleep(WINDOW_MS);
        continue;
      }
      if (!res.ok) return null;
      const json = (await res.json()) as { code?: number; name?: string; data?: unknown };
      if (json.name === "TOO_MANY_REQUESTS" || (json.code && json.code !== 0 && json.data == null)) {
        if (attempt + 1 >= tries) return null;
        await sleep(WINDOW_MS);
        continue;
      }
      return (json.data ?? null) as Feed;
    } catch {
      if (attempt + 1 >= tries) return null;
      await sleep(400);
    }
  }
  return null;
}

async function wave(paths: readonly string[], feeds: Feeds, waitOnLimit: boolean) {
  const rows = await Promise.all(paths.map(async (path) => [path, await fetchFeed(path, waitOnLimit)] as const));
  for (const [path, data] of rows) feeds[path] = data;
}

type StationRow = {
  id?: string;
  name?: string;
  location?: { latitude?: number; longitude?: number };
};

type ReadingBlock = {
  timestamp?: string;
  data?: { stationId?: string; value?: number }[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function stationCatalog(feed: Feed): StationRow[] {
  const rows = feed?.stations;
  return Array.isArray(rows) ? (rows as StationRow[]) : [];
}

function latestValues(feed: Feed): Map<string, number> {
  const map = new Map<string, number>();
  const readings = Array.isArray(feed?.readings) ? (feed?.readings as ReadingBlock[]) : [];
  const latest = [...readings].sort((a, b) => String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? "")))[0];
  for (const row of latest?.data ?? []) {
    if (row.stationId && typeof row.value === "number" && Number.isFinite(row.value)) {
      map.set(row.stationId, row.value);
    }
  }
  return map;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function regionBag(raw: unknown): Record<string, number | null> {
  const rec = asRecord(raw) ?? {};
  const out: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(rec)) out[key] = num(value);
  return out;
}

function buildStations(feeds: Record<string, Feed>): Station[] {
  const byId = new Map<string, Station>();
  const catalogs = [
    feeds["air-temperature"],
    feeds["relative-humidity"],
    feeds["wind-direction"],
    feeds["wind-speed"],
    feeds.rainfall,
  ];
  for (const feed of catalogs) {
    for (const row of stationCatalog(feed)) {
      if (!row.id || !row.location) continue;
      const lat = num(row.location.latitude);
      const lon = num(row.location.longitude);
      if (lat == null || lon == null) continue;
      const existing = byId.get(row.id);
      byId.set(row.id, {
        id: row.id,
        name: row.name && row.name !== row.id ? row.name : (existing?.name ?? row.id),
        lat,
        lon,
        tempC: existing?.tempC ?? null,
        humidity: existing?.humidity ?? null,
        rainMm: existing?.rainMm ?? null,
        windFromDeg: existing?.windFromDeg ?? null,
        windKnots: existing?.windKnots ?? null,
      });
    }
  }
  const temp = latestValues(feeds["air-temperature"] ?? null);
  const humidity = latestValues(feeds["relative-humidity"] ?? null);
  const rain = latestValues(feeds.rainfall ?? null);
  const dir = latestValues(feeds["wind-direction"] ?? null);
  const speed = latestValues(feeds["wind-speed"] ?? null);
  for (const station of byId.values()) {
    station.tempC = temp.get(station.id) ?? null;
    station.humidity = humidity.get(station.id) ?? null;
    station.rainMm = rain.get(station.id) ?? null;
    station.windFromDeg = dir.get(station.id) ?? null;
    station.windKnots = speed.get(station.id) ?? null;
  }
  return [...byId.values()].filter(
    (s) => s.tempC != null || s.humidity != null || s.rainMm != null || s.windFromDeg != null,
  );
}

function buildRegions(psi: Feed, pm: Feed): { regions: Region[]; psiUpdated: string | null; pmUpdated: string | null } {
  const meta = new Map<string, { lat: number; lon: number }>();
  for (const feed of [psi, pm]) {
    const rows = Array.isArray(feed?.regionMetadata) ? feed.regionMetadata : [];
    for (const row of rows) {
      const rec = asRecord(row);
      const loc = asRecord(rec?.labelLocation);
      const name = typeof rec?.name === "string" ? rec.name.toLowerCase() : "";
      const lat = num(loc?.latitude);
      const lon = num(loc?.longitude);
      if (name && lat != null && lon != null) meta.set(name, { lat, lon });
    }
  }
  const psiItem = Array.isArray(psi?.items) ? asRecord(psi.items[0]) : null;
  const pmItem = Array.isArray(pm?.items) ? asRecord(pm.items[0]) : null;
  const psiRead = asRecord(psiItem?.readings) ?? {};
  const pmRead = asRecord(pmItem?.readings) ?? {};
  const psi24 = regionBag(psiRead.psi_twenty_four_hourly);
  const pm24 = regionBag(psiRead.pm25_twenty_four_hourly);
  const pm10 = regionBag(psiRead.pm10_twenty_four_hourly);
  const o3 = regionBag(psiRead.o3_sub_index);
  const no2 = regionBag(psiRead.no2_one_hour_max);
  const so2 = regionBag(psiRead.so2_twenty_four_hourly);
  const co = regionBag(psiRead.co_sub_index);
  const pm1 = regionBag(pmRead.pm25_one_hourly);
  const ids = new Set<string>([...meta.keys(), ...Object.keys(psi24), ...Object.keys(pm1)]);
  const regions: Region[] = [...ids]
    .filter((id) => id !== "national")
    .map((id) => ({
      id,
      lat: meta.get(id)?.lat ?? 1.3521,
      lon: meta.get(id)?.lon ?? 103.8198,
      psi: psi24[id] ?? null,
      pm25h: pm1[id] ?? null,
      pm25: pm24[id] ?? null,
      pm10: pm10[id] ?? null,
      o3: o3[id] ?? null,
      no2: no2[id] ?? null,
      so2: so2[id] ?? null,
      co: co[id] ?? null,
    }));
  return {
    regions,
    psiUpdated: typeof psiItem?.timestamp === "string" ? psiItem.timestamp : null,
    pmUpdated: typeof pmItem?.timestamp === "string" ? pmItem.timestamp : null,
  };
}

function buildNowcast(feed: Feed): Briefing["nowcast"] {
  if (!feed) return null;
  const meta = new Map<string, { lat: number; lon: number }>();
  const areasMeta = Array.isArray(feed.area_metadata) ? feed.area_metadata : [];
  for (const row of areasMeta) {
    const rec = asRecord(row);
    const loc = asRecord(rec?.label_location);
    const name = typeof rec?.name === "string" ? rec.name : "";
    const lat = num(loc?.latitude);
    const lon = num(loc?.longitude);
    if (name && lat != null && lon != null) meta.set(name, { lat, lon });
  }
  const item = Array.isArray(feed.items) ? asRecord(feed.items[0]) : null;
  const forecasts = Array.isArray(item?.forecasts) ? item.forecasts : [];
  const areas: AreaNow[] = [];
  for (const row of forecasts) {
    const rec = asRecord(row);
    const name = typeof rec?.area === "string" ? rec.area : "";
    const forecast = typeof rec?.forecast === "string" ? rec.forecast : "";
    const loc = meta.get(name);
    if (!name || !forecast || !loc) continue;
    areas.push({ name, forecast, lat: loc.lat, lon: loc.lon });
  }
  const valid = asRecord(item?.valid_period);
  return {
    validText: typeof valid?.text === "string" ? valid.text : null,
    updated: typeof item?.timestamp === "string" ? item.timestamp : null,
    areas,
  };
}

function buildDay(feed: Feed): Briefing["day"] {
  if (!feed) return null;
  const record = Array.isArray(feed.records) ? asRecord(feed.records[0]) : null;
  const general = asRecord(record?.general);
  if (!general) return null;
  const valid = asRecord(general.validPeriod);
  const temperature = asRecord(general.temperature);
  const humidity = asRecord(general.relativeHumidity);
  const wind = asRecord(general.wind);
  const speed = asRecord(wind?.speed);
  const forecast = asRecord(general.forecast);
  const periodsRaw = Array.isArray(record?.periods) ? record.periods : [];
  const periods: PeriodOutlook[] = periodsRaw.map((row) => {
    const rec = asRecord(row);
    const time = asRecord(rec?.timePeriod);
    const regions = asRecord(rec?.regions) ?? {};
    return {
      text: typeof time?.text === "string" ? time.text : "Period",
      regions: Object.entries(regions).map(([id, value]) => ({
        id,
        text: typeof asRecord(value)?.text === "string" ? String(asRecord(value)?.text) : "—",
      })),
    };
  });
  return {
    validText: typeof valid?.text === "string" ? valid.text : null,
    summary: typeof forecast?.text === "string" ? forecast.text : null,
    tempLow: num(temperature?.low),
    tempHigh: num(temperature?.high),
    rhLow: num(humidity?.low),
    rhHigh: num(humidity?.high),
    windDir: typeof wind?.direction === "string" ? wind.direction : null,
    windLow: num(speed?.low),
    windHigh: num(speed?.high),
    periods,
  };
}

function buildOutlook(feed: Feed): DayOutlook[] {
  const record = Array.isArray(feed?.records) ? asRecord(feed.records[0]) : null;
  const forecasts = Array.isArray(record?.forecasts) ? record.forecasts : [];
  return forecasts.map((row) => {
    const rec = asRecord(row);
    const forecast = asRecord(rec?.forecast);
    const temperature = asRecord(rec?.temperature);
    const wind = asRecord(rec?.wind);
    const speed = asRecord(wind?.speed);
    return {
      day: typeof rec?.day === "string" ? rec.day : "Day",
      date: typeof rec?.timestamp === "string" ? rec.timestamp : "",
      summary: typeof forecast?.summary === "string" ? forecast.summary.trim() : "",
      text: typeof forecast?.text === "string" ? forecast.text : "",
      tempLow: num(temperature?.low),
      tempHigh: num(temperature?.high),
      windDir: typeof wind?.direction === "string" ? wind.direction : null,
      windLow: num(speed?.low),
      windHigh: num(speed?.high),
    };
  });
}

function buildUv(feed: Feed): Briefing["uv"] {
  const record = Array.isArray(feed?.records) ? asRecord(feed.records[0]) : null;
  const index = Array.isArray(record?.index) ? record.index : [];
  const first = asRecord(index[0]);
  const value = num(first?.value);
  if (value == null) return null;
  return { value, hour: typeof first?.hour === "string" ? first.hour : "" };
}

function assemble(feeds: Feeds): Briefing {
  const missing = [...FAST, ...REST].filter((path) => !feeds[path]);
  const { regions, psiUpdated, pmUpdated } = buildRegions(feeds.psi ?? null, feeds.pm25 ?? null);
  const stations = buildStations(feeds);
  const failed = stations.length === 0 && regions.length === 0;
  return {
    fetchedAt: new Date().toISOString(),
    partial: missing.length > 0 && !failed,
    failed,
    stations,
    regions,
    psiUpdated,
    pmUpdated,
    uv: buildUv(feeds.uv ?? null),
    nowcast: buildNowcast(feeds["two-hr-forecast"] ?? null),
    day: buildDay(feeds["twenty-four-hr-forecast"] ?? null),
    outlook: buildOutlook(feeds["four-day-outlook"] ?? null),
  };
}

async function fillRest() {
  if (restFlight) return restFlight;
  if (cache && !cache.partial && Date.now() - cache.at < TTL_MS) return;
  if (Date.now() - filledAt < WINDOW_MS) return;
  restFlight = (async () => {
    const wait = Math.max(0, WINDOW_MS - (Date.now() - waveAt));
    if (wait) await sleep(wait);
    const feeds: Feeds = { ...(cache?.feeds ?? {}) };
    const missing = [...FAST, ...REST].filter((path) => !feeds[path]);
    if (missing.length) await wave(missing, feeds, true);
    const data = assemble(feeds);
    filledAt = Date.now();
    waveAt = filledAt;
    if (!data.failed) cache = { at: filledAt, partial: data.partial, data, feeds };
  })().finally(() => {
    restFlight = null;
  });
  return restFlight;
}

async function loadFast(): Promise<Briefing> {
  if (fastFlight) return fastFlight;
  fastFlight = (async () => {
    const feeds: Feeds = {};
    await wave(FAST, feeds, false);
    waveAt = Date.now();
    const data = assemble(feeds);
    if (!data.failed) cache = { at: Date.now(), partial: data.partial, data, feeds };
    void fillRest();
    return data;
  })().finally(() => {
    fastFlight = null;
  });
  return fastFlight;
}

export const getBriefing = createServerFn({ method: "GET" }).handler(async () => {
  if (cache && !cache.partial && Date.now() - cache.at < TTL_MS) return cache.data;
  if (cache && (cache.data.stations.length > 0 || cache.data.regions.length > 0)) {
    void fillRest();
    return cache.data;
  }
  return loadFast();
});

if (typeof window === "undefined") void loadFast();
