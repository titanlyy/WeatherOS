import { useEffect, useMemo, useState } from "react";
import { CloudSun, Leaf, Radio, Wind } from "lucide-react";
import { getBriefing } from "@/lib/weather.functions";
import type { Briefing, Region, Station, ThemeId } from "@/lib/weather-model";
import {
  REGION_ORDER,
  compass,
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
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
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
        <Kpi label="Air" value={avgTemp == null ? "—" : `${round1(avgTemp)}°`} note="station mean" />
        <Kpi label="Humidity" value={avgHum == null ? "—" : `${Math.round(avgHum)}%`} note="station mean" />
        <Kpi
          label="Wind"
          value={wind ? compass(wind.fromDeg) : "—"}
          note={wind ? `${round1(wind.kmh)} km/h mean, blowing from` : "awaiting stations"}
        />
        <Kpi
          label="Worst PSI"
          value={worst?.psi == null ? "—" : String(Math.round(worst.psi))}
          note={worst ? `${title(worst.id)} · ${psiLabel(worst.psi ?? 0)}` : "24-hour"}
          tone={worst?.psi == null ? undefined : psiKey(worst.psi)}
        />
      </div>

      {loading && !briefing ? (
        <div className="mx-4 mb-3 h-1 overflow-hidden rounded-full bg-surface-2">
          <div className="acquire h-full w-1/3 bg-primary" />
        </div>
      ) : null}
      {error ? <p className="mx-4 mb-3 text-sm text-accent">{error}</p> : null}

      <div className="mid flex-1 px-3 pb-3 lg:px-4">
        <aside className="side mb-3 space-y-3 lg:mb-0 lg:pr-3">
          <section className="panel p-3">
            <h2 className="font-display text-sm tracking-wide">Regions</h2>
            <p className="mb-2 text-xs text-muted">24h PSI · 1h PM2.5 µg/m³</p>
            <ul className="space-y-2">
              {regions.map((region) => (
                <li key={region.id}>
                  <button
                    type="button"
                    className="flex w-full min-h-11 items-center gap-3 rounded-md border border-line bg-bg px-2 py-2 text-left"
                    onClick={() => setFocus({ lon: region.lon, lat: region.lat, nonce: Date.now() })}
                  >
                    <span className={`size-2.5 shrink-0 rounded-full ${dotClass(region)}`} />
                    <span className="w-16 text-sm">{title(region.id)}</span>
                    <span className="text-lg tabular-nums">{region.psi == null ? "—" : Math.round(region.psi)}</span>
                    <span className="text-xs text-muted">{region.psi == null ? "" : psiLabel(region.psi)}</span>
                    <span className="ml-auto text-right text-xs">
                      <span className="block tabular-nums">{region.pm25h == null ? "—" : Math.round(region.pm25h)}</span>
                      <span className="text-muted">{region.pm25h == null ? "" : pmLabel(region.pm25h)}</span>
                    </span>
                  </button>
                </li>
              ))}
              {!regions.length ? <li className="text-sm text-muted">Region readings land with the first successful PSI pull.</li> : null}
            </ul>
          </section>
          {worst ? <Pollutants region={worst} /> : null}
          <UvBlock briefing={briefing} />
        </aside>

        <section className="map-pane panel overflow-hidden lg:mr-3">
          <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1">
            {(
              [
                ["wind", "Wind"],
                ["rain", "Rain"],
                ["haze", "Haze"],
                ["nowcast", "Nowcast"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
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
            onSelect={setSelected}
          />
          {selected ? (
            <div className="absolute bottom-12 left-3 right-3 z-10 panel p-3 sm:right-auto sm:w-80">
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
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
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
          Readings from the National Environment Agency via data.gov.sg, Singapore Open Data Licence. Map tiles © OpenFreeMap /
          OpenStreetMap contributors. Not an official NEA site.
        </p>
      </section>
    </div>
  );
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note: string; tone?: string }) {
  return (
    <div className="panel px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
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
    ["PM2.5 24h", region.pm25],
    ["PM10 24h", region.pm10],
    ["O₃ sub", region.o3],
    ["NO₂ 1h", region.no2],
    ["SO₂ 24h", region.so2],
    ["CO sub", region.co],
  ] as const;
  return (
    <section className="panel p-3">
      <h2 className="font-display text-sm tracking-wide">Sub-indices · {title(region.id)}</h2>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2 border-b border-line py-1">
            <dt className="text-muted">{label}</dt>
            <dd className="tabular-nums">{value == null ? "—" : Math.round(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function UvBlock({ briefing }: { briefing: Briefing | null }) {
  return (
    <section className="panel p-3">
      <h2 className="font-display text-sm tracking-wide">UV index</h2>
      <p className="mt-1 font-display text-3xl">{briefing?.uv ? briefing.uv.value : "—"}</p>
      <p className="text-xs text-muted">{briefing?.uv ? `Hour ${formatStamp(briefing.uv.hour)}` : "Daylight hours only"}</p>
    </section>
  );
}

function DayCard({ briefing }: { briefing: Briefing | null }) {
  const day = briefing?.day;
  return (
    <section className="panel p-3">
      <h2 className="font-display text-sm tracking-wide">Next 24 hours</h2>
      <p className="mt-1 text-lg font-display">{day?.summary ?? "—"}</p>
      <p className="text-xs text-muted">{day?.validText ?? "Waiting on the forecast feed"}</p>
      <p className="mt-2 text-sm tabular-nums">
        {day?.tempLow ?? "—"}–{day?.tempHigh ?? "—"}°C · RH {day?.rhLow ?? "—"}–{day?.rhHigh ?? "—"}% · {day?.windDir ?? "—"}{" "}
        {day?.windLow ?? "—"}–{day?.windHigh ?? "—"} km/h
      </p>
      <ul className="mt-3 space-y-2">
        {(day?.periods ?? []).map((period) => (
          <li key={period.text}>
            <p className="text-xs text-muted">{period.text}</p>
            <p className="text-sm">{period.regions.map((r) => `${title(r.id)} ${r.text}`).join(" · ")}</p>
          </li>
        ))}
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
