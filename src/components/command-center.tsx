import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CloudSun, Leaf, Radio, Wind } from "lucide-react";
import { getBriefing } from "@/lib/weather.functions";
import type { Briefing, Region, Station, ThemeId } from "@/lib/weather-model";
import {
  REGION_ORDER,
  compass,
  forecastTone,
  formatClock,
  formatStamp,
  knotsToKmh,
  mean,
  pmLabel,
  psiKey,
  psiLabel,
  round1,
  windSummary,
  worstRegion,
} from "@/lib/weather-model";
import { WireMap } from "@/components/wire-map";

const REFRESH_MS = 90_000;

export function CommandCenter() {
  const [theme, setTheme] = useState<ThemeId>("cyber");
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState<Date | null>(null);
  const [selected, setSelected] = useState<Station | null>(null);
  const [focus, setFocus] = useState<{ lon: number; lat: number; nonce: number } | null>(null);
  const [layers, setLayers] = useState({ wind: true, rain: true, haze: true, nowcast: true });

  useEffect(() => {
    const saved = window.localStorage.getItem("weatheros-theme");
    if (saved === "solar" || saved === "cyber") setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "cyber" ? "#07090d" : "#f4f0e6");
    window.localStorage.setItem("weatheros-theme", theme);
  }, [theme]);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const data = await getBriefing();
        if (stop) return;
        setBriefing(data);
        setError(data.failed ? "NEA feeds did not answer. Retrying on the next cycle." : null);
      } catch (err) {
        if (stop) return;
        setError(err instanceof Error ? err.message : "Could not reach the briefing service.");
      } finally {
        if (!stop) setLoading(false);
      }
    };
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, []);

  const regions = useMemo(() => sortRegions(briefing?.regions ?? []), [briefing]);
  const wind = briefing ? windSummary(briefing.stations) : null;
  const temps = briefing?.stations.map((s) => s.tempC).filter((n): n is number => n != null) ?? [];
  const hums = briefing?.stations.map((s) => s.humidity).filter((n): n is number => n != null) ?? [];
  const avgTemp = mean(temps);
  const avgHum = mean(hums);
  const worst = briefing ? worstRegion(briefing.regions) : null;

  return (
    <div className="desk bg-bg text-fg">
      <header className="mast flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Radio className="size-5 text-primary" aria-hidden="true" />
          <div>
            <p className="font-display text-lg leading-none tracking-wide">WeatherOS</p>
            <p className="text-xs text-muted">Singapore · haze + weather desk</p>
          </div>
        </div>
        <p className="font-body text-sm text-primary tabular-nums sm:ml-4">{now ? formatClock(now) : "--:--:--"} SGT</p>
        <p className="text-xs text-muted">
          {briefing ? `Updated ${formatStamp(briefing.fetchedAt)}` : loading ? "Acquiring NEA feeds" : "No briefing"}
          {briefing?.partial ? " · partial" : ""}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm"
            onClick={() => setTheme(theme === "cyber" ? "solar" : "cyber")}
          >
            {theme === "cyber" ? <Leaf className="size-4 text-primary" /> : <CloudSun className="size-4 text-accent" />}
            {theme === "cyber" ? "Solarpunk" : "Cyberpunk"}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 px-3 py-3 sm:grid-cols-4 lg:px-4">
        <Kpi label="Air" value={avgTemp == null ? "—" : `${round1(avgTemp)}°`} note="station mean" tip={TEMP_TIP} />
        <Kpi label="Humidity" value={avgHum == null ? "—" : `${Math.round(avgHum)}%`} note="station mean" tip={HUM_TIP} />
        <Kpi
          label="Wind"
          value={wind ? compass(wind.fromDeg) : "—"}
          note={wind ? `${round1(wind.kmh)} km/h mean, blowing from` : "awaiting stations"}
          tip={WIND_TIP}
        />
        <Kpi
          label="Worst PSI"
          value={worst?.psi == null ? "—" : String(Math.round(worst.psi))}
          note={worst?.psi == null ? "24-hour" : `${title(worst.id)} · ${psiEffect(worst.psi)}`}
          tone={worst?.psi == null ? undefined : psiKey(worst.psi)}
          tip={PSI_TIP}
          hot={worst?.psi != null && worst.psi > 100}
        />
      </div>

      {loading && !briefing ? (
        <div className="mx-4 mb-3 h-1 overflow-hidden rounded-full bg-surface-2">
          <div className="acquire h-full w-1/3 bg-primary" />
        </div>
      ) : null}
      {error ? <p className="mx-4 mb-3 text-sm text-accent">{error}</p> : null}

      <div className="mid flex-1 px-3 pb-3 lg:px-4">
        <aside className="side mb-3 min-w-0 lg:mb-0 lg:pr-3">
          <section className="panel min-w-0 p-2.5">
            <h2 className="font-display text-sm tracking-wide">Regions</h2>
            <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 px-1.5 text-[10px] uppercase tracking-wide text-muted">
              <span />
              <Tip label="PSI" text={PSI_TIP}>
                <span className="block text-left">24h PSI</span>
              </Tip>
              <Tip label="PM2.5" text={PM_TIP}>
                <span className="block text-left">1h PM2.5</span>
              </Tip>
            </div>
            <ul>
              {regions.map((region) => (
                <li key={region.id} className="min-w-0 border-b border-line last:border-b-0">
                  <button
                    type="button"
                    className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-1.5 py-1 text-left"
                    title={regionTitle(region)}
                    onClick={() => setFocus({ lon: region.lon, lat: region.lat, nonce: Date.now() })}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`size-2 shrink-0 rounded-full ${dotClass(region)} ${(region.psi ?? 0) > 100 ? "pulse-dot" : ""}`} />
                      <span className="truncate text-sm">{title(region.id)}</span>
                    </span>
                    <span className="flex items-baseline justify-end gap-1">
                      <span className="text-sm tabular-nums">{region.psi == null ? "—" : Math.round(region.psi)}</span>
                      <span className="w-[4.6rem] text-left text-[10px] leading-none text-muted">{region.psi == null ? "" : psiLabel(region.psi)}</span>
                    </span>
                    <span className="flex items-baseline justify-end gap-1">
                      <span className="text-sm tabular-nums">{region.pm25h == null ? "—" : Math.round(region.pm25h)}</span>
                      <span className="w-14 whitespace-nowrap text-left text-[10px] leading-none text-muted">{region.pm25h == null ? "" : pmLabel(region.pm25h)}</span>
                    </span>
                  </button>
                </li>
              ))}
              {!regions.length ? <li className="px-1.5 py-2 text-sm text-muted">Region readings land with the first successful PSI pull.</li> : null}
            </ul>
            {worst ? <Pollutants region={worst} /> : null}
            <UvBlock briefing={briefing} />
          </section>
        </aside>

        <section className="map-pane panel overflow-hidden lg:mr-3">
          <div className="absolute left-3 top-3 z-20 flex flex-wrap gap-1">
            {(
              [
                ["wind", "Wind", "Arrows point where the wind is blowing. Click a station for its reading."],
                ["rain", "Rain", "Rings mark stations that are reporting rain right now."],
                ["haze", "Haze", "Tints each town by that region's 24-hour PSI."],
                ["nowcast", "Nowcast", "Shows the next two hours: forecast colour and weather icons."],
              ] as const
            ).map(([key, label, help]) => (
              <button
                key={key}
                type="button"
                title={help}
                aria-pressed={layers[key]}
                className={`min-h-11 rounded-md border px-3 text-xs ${layers[key] ? "border-primary bg-surface text-fg" : "border-line bg-bg text-muted"}`}
                onClick={() => setLayers((prev) => ({ ...prev, [key]: !prev[key] }))}
              >
                {label}
              </button>
            ))}
          </div>
          <WireMap
            stations={briefing?.stations ?? []}
            regions={regions}
            areas={briefing?.nowcast?.areas ?? []}
            theme={theme}
            layers={layers}
            focus={focus}
            validText={briefing?.nowcast?.validText ?? null}
            onSelect={setSelected}
          />
          {selected ? (
            <div className="absolute bottom-12 left-3 right-3 z-20 panel p-3 sm:right-auto sm:w-80">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-base leading-tight">{selected.name}</p>
                  <p className="text-xs text-muted">{selected.id}</p>
                </div>
                <button type="button" className="min-h-11 px-2 text-xs text-muted" onClick={() => setSelected(null)}>
                  Close
                </button>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <Stat k="Temp" v={selected.tempC == null ? "—" : `${round1(selected.tempC)}°C`} />
                <Stat k="Humidity" v={selected.humidity == null ? "—" : `${Math.round(selected.humidity)}%`} />
                <Stat
                  k="Wind from"
                  v={
                    selected.windFromDeg == null
                      ? "—"
                      : `${compass(selected.windFromDeg)} ${selected.windKnots == null ? "" : `${round1(knotsToKmh(selected.windKnots))} km/h`}`
                  }
                />
                <Stat k="Rain" v={selected.rainMm == null ? "—" : `${round1(selected.rainMm)} mm`} />
              </dl>
            </div>
          ) : null}
        </section>

        <aside className="side mt-3 space-y-3 lg:mt-0">
          <DayCard briefing={briefing} />
          <Nowcast briefing={briefing} onFocus={(lon, lat) => setFocus({ lon, lat, nonce: Date.now() })} />
        </aside>
      </div>

      <section className="outlook border-t border-line px-3 py-3 lg:px-4">
        <div className="mb-2 flex items-center gap-2">
          <Wind className="size-4 text-primary" aria-hidden="true" />
          <h2 className="font-display text-sm tracking-wide">Four-day outlook</h2>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(briefing?.outlook ?? []).map((day) => (
            <article key={day.date || day.day} className="panel p-3">
              <p className="text-xs text-muted">{day.day}</p>
              <p className="font-display text-base">{day.text || "—"}</p>
              <p className="text-sm text-muted">{day.summary}</p>
              <p className="mt-2 text-sm tabular-nums">
                {day.tempLow ?? "—"}–{day.tempHigh ?? "—"}°C · {day.windDir ?? "—"} {day.windLow ?? "—"}–{day.windHigh ?? "—"} km/h
              </p>
            </article>
          ))}
          {!briefing?.outlook.length && !loading ? <p className="text-sm text-muted">Outlook not in this pull.</p> : null}
        </div>
        <p className="mt-3 text-xs text-muted">
          Readings from the National Environment Agency via data.gov.sg. Map data © OpenStreetMap contributors. Planning
          areas © Urban Redevelopment Authority, Master Plan 2019. Singapore Open Data Licence. Not an official NEA site.
        </p>
      </section>
    </div>
  );
}

function Kpi({ label, value, note, tone, tip, hot }: { label: string; value: string; note: string; tone?: string; tip?: string; hot?: boolean }) {
  return (
    <div className={`panel kpi px-3 py-2 ${hot ? "hot" : ""}`}>
      <p className="text-xs text-muted">{tip ? <Tip label={label} text={tip}>{label}</Tip> : label}</p>
      <p className={`font-display text-3xl leading-none ${toneClass(tone)}`}>{value}</p>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function Pollutants({ region }: { region: Region }) {
  const rows = [
    ["PM2.5", region.pm25, PM25_SUB_TIP],
    ["PM10", region.pm10, PM10_TIP],
    ["O₃", region.o3, O3_TIP],
    ["NO₂", region.no2, NO2_TIP],
    ["SO₂", region.so2, SO2_TIP],
    ["CO", region.co, CO_TIP],
  ] as const;
  return (
    <div className="mt-1 border-t border-line pt-2">
      <h2 className="font-display text-xs tracking-wide">Sub-indices · {title(region.id)}</h2>
      <dl className="mt-1 grid grid-cols-3 gap-x-2 gap-y-0.5 text-xs">
        {rows.map(([label, value, help]) => (
          <div key={label} className="flex items-baseline justify-between gap-1">
            <dt className="text-muted">
              <Tip label={label} text={help}>{label}</Tip>
            </dt>
            <dd className={`tabular-nums ${value != null && value > 100 ? "text-unhealthy" : ""}`}>{value == null ? "—" : Math.round(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function UvBlock({ briefing }: { briefing: Briefing | null }) {
  const value = briefing?.uv?.value;
  const band = value == null ? null : uvBand(value);
  return (
    <div className="mt-2 flex items-baseline gap-2 border-t border-line pt-2">
      <Tip label="UV index" text={UV_TIP}>
        <span className="text-xs text-muted">UV</span>
      </Tip>
      <p className={`font-display text-xl leading-none ${band ? toneClass(band.tone) : ""}`}>{value ?? "—"}</p>
      <p className="min-w-0 text-xs leading-snug text-muted">{band ? band.effect : "Daylight hours only"}</p>
    </div>
  );
}

function DayCard({ briefing }: { briefing: Briefing | null }) {
  const day = briefing?.day;
  return (
    <section className="panel p-3">
      <h2 className="font-display text-sm tracking-wide">Next 24 hours</h2>
      <p className={`mt-1 font-display text-lg leading-tight ${fxClass(day?.summary ?? "")}`}>{day?.summary ?? "—"}</p>
      <p className="text-xs text-muted">{day?.validText ?? "Waiting on the forecast feed"}</p>
      <div className="mt-2 grid grid-cols-3 gap-1">
        <Tip label="Temperature" text={TEMP_TIP}>
          <span className="stat-chip">{day?.tempLow ?? "—"}–{day?.tempHigh ?? "—"}°</span>
        </Tip>
        <Tip label="Humidity" text={HUM_TIP}>
          <span className="stat-chip">RH {day?.rhLow ?? "—"}–{day?.rhHigh ?? "—"}%</span>
        </Tip>
        <Tip label="Wind" text={WIND_TIP}>
          <span className="stat-chip">{day?.windDir ?? "—"} {day?.windLow ?? "—"}–{day?.windHigh ?? "—"}</span>
        </Tip>
      </div>
      <ul className="mt-3 space-y-2">
        {(day?.periods ?? []).map((period) => {
          const tone = periodTone(period.regions);
          return (
            <li key={period.text} className={`period period-${tone}`}>
              <p className="text-xs text-muted">{period.text}</p>
              <ul className="mt-1 space-y-0.5">
                {orderForecast(period.regions).map((region) => (
                  <li key={region.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-muted">{title(region.id)}</span>
                    <span className={`text-right ${fxClass(region.text)}`}>{region.text}</span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Nowcast({ briefing, onFocus }: { briefing: Briefing | null; onFocus: (lon: number, lat: number) => void }) {
  const areas = briefing?.nowcast?.areas ?? [];
  const counts = new Map<string, number>();
  for (const area of areas) counts.set(area.forecast, (counts.get(area.forecast) ?? 0) + 1);
  return (
    <section className="panel p-3">
      <h2 className="font-display text-sm tracking-wide">2-hour nowcast</h2>
      <p className="text-xs text-muted">{briefing?.nowcast?.validText ?? "Area forecast"}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {[...counts.entries()].map(([label, count]) => (
          <span key={label} className="rounded-md border border-line px-2 py-1 text-xs">
            {label} · {count}
          </span>
        ))}
      </div>
      <ul className="mt-3 max-h-64 space-y-1 overflow-auto">
        {areas.map((area) => (
          <li key={area.name}>
            <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm" onClick={() => onFocus(area.lon, area.lat)}>
              <span>{area.name}</span>
              <span className="text-muted">{area.forecast}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function sortRegions(regions: Region[]) {
  return [...regions].sort((a, b) => REGION_ORDER.indexOf(a.id as (typeof REGION_ORDER)[number]) - REGION_ORDER.indexOf(b.id as (typeof REGION_ORDER)[number]));
}

function title(id: string) {
  return id.slice(0, 1).toUpperCase() + id.slice(1);
}

function dotClass(region: Region) {
  if (region.psi == null) return "bg-muted";
  return toneBg(psiKey(region.psi));
}

function toneClass(tone?: string) {
  if (!tone) return "text-fg";
  if (tone === "good" || tone === "normal") return "text-good";
  if (tone === "moderate" || tone === "elevated") return "text-moderate";
  if (tone === "unhealthy" || tone === "high") return "text-unhealthy";
  if (tone === "very" || tone === "very-high") return "text-very";
  if (tone === "hazard") return "text-hazard";
  return "text-fg";
}

function toneBg(tone: string) {
  if (tone === "good") return "bg-good";
  if (tone === "moderate") return "bg-moderate";
  if (tone === "unhealthy") return "bg-unhealthy";
  if (tone === "very") return "bg-very";
  if (tone === "hazard") return "bg-hazard";
  return "bg-muted";
}

const PSI_TIP =
  "24-hour Pollutant Standards Index, NEA's haze score. 0–50 good: be outside as usual. 51–100 moderate: fine for most people. 101–200 unhealthy: shorten outdoor exercise, especially for children, older adults, and anyone with asthma or heart disease. Above 200, stay indoors and keep windows shut.";
const PM_TIP =
  "PM2.5 is the amount of fine haze particles in one cubic metre of air, measured over the last hour. Under 55 is normal. 56–150 is elevated. Above 150, wear a mask outdoors and skip a long run. These particles travel deep into the lungs.";
const PM25_SUB_TIP =
  "24-hour PM2.5 sub-index, scored on the same 0–50 / 51–100 / 101–200 bands as PSI. This is the haze particle contribution to the main PSI number.";
const PM10_TIP =
  "Coarser dust, scored as a 24-hour sub-index like PSI. It irritates eyes, nose, and throat more than the deeper lungs. Above 100, the air feels gritty.";
const O3_TIP =
  "Ozone. It builds in strong afternoon sun and irritates airways. A high sub-index feels like a tight chest if you exercise outside. Same bands as PSI.";
const NO2_TIP =
  "Nitrogen dioxide, mostly from traffic. The figure is the highest 1-hour sub-index. It irritates airways. Above 100, busy roads are a poor place for a long walk.";
const SO2_TIP =
  "Sulphur dioxide, from industry and ships. A 24-hour sub-index. It can sting the throat and set off asthma. Above 100, limit time outdoors if you are sensitive.";
const CO_TIP =
  "Carbon monoxide from incomplete burning, as a sub-index rather than a raw gas reading. High values mean the air is poor for staying outside a long time.";
const UV_TIP =
  "Sunburn risk for this hour. 0–2 low: no extra protection. 3–5 moderate: sunscreen if you stay out. 6–7 high: hat, shade, and SPF from 11am to 4pm. 8–10 very high. 11 or more is extreme — keep midday time indoors.";
const HUM_TIP =
  "Relative humidity, averaged across stations. Singapore often sits above 70%. Over 80% feels heavy and sticky, and storms are more likely. It does not mean it is raining.";
const WIND_TIP =
  "The direction the wind is coming from, plus speed. Haze often arrives on a southwest or southeast wind. A fresher wind clears smoke through faster. Arrows on the map point where it is going.";
const TEMP_TIP = "Air temperature averaged from stations reporting right now. One neighbourhood can sit a degree or two off this figure.";

function psiEffect(value: number) {
  const key = psiKey(value);
  if (key === "good") return "go out as usual";
  if (key === "moderate") return "fine for most people";
  if (key === "unhealthy") return "cut long outdoor exercise";
  if (key === "very") return "avoid outdoor activity";
  return "stay indoors";
}

function pmEffect(value: number) {
  if (value <= 55) return "normal";
  if (value <= 150) return "elevated — ease off outdoor exercise";
  if (value <= 250) return "high — mask up outdoors";
  return "very high — stay indoors";
}

function regionTitle(region: Region) {
  const psi = region.psi == null ? "no PSI yet" : `${Math.round(region.psi)}, ${psiLabel(region.psi)}. ${psiEffect(region.psi)}`;
  const pm = region.pm25h == null ? "no PM2.5 yet" : `${Math.round(region.pm25h)} µg/m³, ${pmEffect(region.pm25h)}`;
  return `${title(region.id)}. 24-hour PSI ${psi}. 1-hour PM2.5 ${pm}. Click to show this region on the map.`;
}

function uvBand(value: number) {
  if (value <= 2) return { tone: "good", effect: "Low · no extra protection" };
  if (value <= 5) return { tone: "moderate", effect: "Moderate · sunscreen if you stay out" };
  if (value <= 7) return { tone: "unhealthy", effect: "High · shade from 11am to 4pm" };
  if (value <= 10) return { tone: "very", effect: "Very high · cover up at midday" };
  return { tone: "hazard", effect: "Extreme · stay out of the midday sun" };
}

function fxClass(text: string) {
  const tone = forecastTone(text);
  if (tone === "storm") return "fx-storm";
  if (tone === "wet") return "fx-wet";
  return "fx-calm";
}

function periodTone(regions: { text: string }[]) {
  let tone: "calm" | "wet" | "storm" = "calm";
  for (const region of regions) {
    const next = forecastTone(region.text);
    if (next === "storm") return "storm";
    if (next === "wet") tone = "wet";
  }
  return tone;
}

function orderForecast<T extends { id: string }>(regions: T[]) {
  const rank: Record<string, number> = { north: 0, south: 1, east: 2, west: 3, central: 4 };
  return [...regions].sort((a, b) => (rank[a.id] ?? 9) - (rank[b.id] ?? 9));
}

function Tip({ label, text, children }: { label: string; text: string; children: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ x: 12, y: 12, above: false });

  function placeTip() {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(288, window.innerWidth - 24);
    const x = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const above = rect.bottom + 150 > window.innerHeight;
    setPlace({ x, y: above ? rect.top - 8 : rect.bottom + 8, above });
    setOpen(true);
  }

  return (
    <span className="tip">
      <button
        ref={ref}
        type="button"
        className="tip-hit"
        aria-label={`${label}. ${text}`}
        aria-expanded={open}
        onMouseEnter={placeTip}
        onMouseLeave={() => setOpen(false)}
        onFocus={placeTip}
        onBlur={() => setOpen(false)}
        onClick={(event) => {
          event.stopPropagation();
          if (open) setOpen(false);
          else placeTip();
        }}
      >
        {children}
      </button>
      {open ? (
        <span role="tooltip" className="tip-pop" style={{ left: place.x, top: place.y, transform: place.above ? "translateY(-100%)" : undefined }}>
          <span className="tip-label">{label}</span>
          {text}
        </span>
      ) : null}
    </span>
  );
}
