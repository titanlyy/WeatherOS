import { useMemo, useState } from "react";
import type { AreaNow, Region, Station } from "@/lib/weather-model";
import { forecastTone, knotsToKmh, psiKey, round1 } from "@/lib/weather-model";
import { SG_FRAME, SG_RING } from "@/lib/sg-coast";

type Layers = { wind: boolean; rain: boolean; haze: boolean; nowcast: boolean };

type Props = {
  stations: Station[];
  regions: Region[];
  areas: AreaNow[];
  theme: string;
  layers: Layers;
  focus: { lon: number; lat: number; nonce: number } | null;
  onSelect: (station: Station) => void;
};

const VB_W = 1000;
const VB_H = 620;

const PSI_COLOR: Record<string, string> = {
  good: "var(--color-good)",
  moderate: "var(--color-moderate)",
  unhealthy: "var(--color-unhealthy)",
  very: "var(--color-very)",
  hazard: "var(--color-hazard)",
};

function project(lon: number, lat: number): [number, number] {
  const x = ((lon - SG_FRAME.minLon) / (SG_FRAME.maxLon - SG_FRAME.minLon)) * VB_W;
  const y = ((SG_FRAME.maxLat - lat) / (SG_FRAME.maxLat - SG_FRAME.minLat)) * VB_H;
  return [x, y];
}

export function WireMap({ stations, regions, areas, layers, focus, onSelect }: Props) {
  const [tip, setTip] = useState<string | null>(null);
  const coast = useMemo(() => SG_RING.map(([lon, lat]) => project(lon, lat).map((n) => n.toFixed(1)).join(",")).join(" "), []);
  const grid = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let lon = 103.65; lon < 104.05; lon += 0.1) {
      const [x] = project(lon, SG_FRAME.minLat);
      lines.push({ x1: x, y1: 0, x2: x, y2: VB_H });
    }
    for (let lat = 1.25; lat < 1.46; lat += 0.05) {
      const [, y] = project(SG_FRAME.minLon, lat);
      lines.push({ x1: 0, y1: y, x2: VB_W, y2: y });
    }
    return lines;
  }, []);
  const winds = stations.filter((s) => s.windFromDeg != null);
  const rain = stations.filter((s) => (s.rainMm ?? 0) > 0);
  const focusPt = focus ? project(focus.lon, focus.lat) : null;

  return (
    <div className="absolute inset-0">
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-full w-full"
        role="img"
        aria-label="Singapore wire map"
        preserveAspectRatio="xMidYMid meet"
      >
        <rect width={VB_W} height={VB_H} fill="var(--color-bg)" />
        {grid.map((line) => (
          <line key={`${line.x1}-${line.y1}-${line.x2}`} {...line} stroke="var(--color-line)" strokeWidth="1" />
        ))}
        <polygon points={coast} fill="var(--color-surface-2)" stroke="var(--color-primary)" strokeWidth="2.4" />
        <polygon points={coast} fill="none" stroke="var(--color-primary)" strokeWidth="7" opacity="0.18" />
        {layers.haze
          ? regions.map((region) => {
              const [x, y] = project(region.lon, region.lat);
              const color = PSI_COLOR[region.psi != null ? psiKey(region.psi) : "moderate"] ?? "var(--color-muted)";
              return (
                <g key={region.id}>
                  <circle cx={x} cy={y} r="78" fill={color} opacity="0.22" />
                  <text x={x} y={y - 8} textAnchor="middle" fill="var(--color-fg)" fontSize="15" fontFamily="var(--font-body)">
                    {region.id}
                  </text>
                  <text x={x} y={y + 12} textAnchor="middle" fill={color} fontSize="16" fontFamily="var(--font-display)">
                    {region.psi == null ? "" : Math.round(region.psi)}
                  </text>
                </g>
              );
            })
          : null}
        {layers.nowcast
          ? areas.map((area) => {
              const [x, y] = project(area.lon, area.lat);
              const tone = forecastTone(area.forecast);
              const color = tone === "storm" ? "var(--color-accent)" : tone === "wet" ? "var(--color-moderate)" : "var(--color-muted)";
              return (
                <circle
                  key={area.name}
                  cx={x}
                  cy={y}
                  r="5"
                  fill={color}
                  onClick={() => setTip(`${area.name} · ${area.forecast}`)}
                >
                  <title>
                    {area.name}: {area.forecast}
                  </title>
                </circle>
              );
            })
          : null}
        {layers.rain
          ? rain.map((station) => {
              const [x, y] = project(station.lon, station.lat);
              const r = 8 + Math.min(station.rainMm ?? 0, 12);
              return <circle key={`rain-${station.id}`} cx={x} cy={y} r={r} fill="none" stroke="var(--color-accent)" strokeWidth="1.6" opacity="0.85" />;
            })
          : null}
        {layers.wind
          ? winds.map((station) => {
              const [x, y] = project(station.lon, station.lat);
              const toward = ((station.windFromDeg ?? 0) + 180) % 360;
              const scale = 0.85 + Math.min(station.windKnots ?? 1, 14) / 16;
              const hot = (station.rainMm ?? 0) > 0;
              return (
                <g
                  key={station.id}
                  transform={`translate(${x} ${y}) rotate(${toward}) scale(${scale})`}
                  className="cursor-pointer"
                  onClick={() => onSelect(station)}
                >
                  <title>
                    {station.name}
                    {station.windKnots != null ? ` · ${round1(knotsToKmh(station.windKnots))} km/h` : ""}
                  </title>
                  <polygon points="0,-16 5,8 0,4 -5,8" fill={hot ? "var(--color-accent)" : "var(--color-primary)"} />
                  <circle cx="0" cy="0" r="16" fill="transparent" />
                </g>
              );
            })
          : null}
        {focusPt ? <circle cx={focusPt[0]} cy={focusPt[1]} r="18" fill="none" stroke="var(--color-fg)" strokeWidth="1.5" /> : null}
      </svg>
      <div className="scanlines" />
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2 text-xs">
        <span className="panel px-2 py-1 text-muted">
          {winds.length} wind stations · {rain.length} reporting rain
        </span>
        {tip ? <span className="panel px-2 py-1">{tip}</span> : null}
      </div>
    </div>
  );
}
