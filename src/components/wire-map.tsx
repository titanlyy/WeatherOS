import { useEffect, useRef, useState } from "react";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { AreaNow, Region, Station, ThemeId } from "@/lib/weather-model";
import { forecastTone, psiKey } from "@/lib/weather-model";

type Layers = { wind: boolean; rain: boolean; haze: boolean; nowcast: boolean };

type Props = {
  stations: Station[];
  regions: Region[];
  areas: AreaNow[];
  theme: ThemeId;
  layers: Layers;
  focus: { lon: number; lat: number; nonce: number } | null;
  onSelect: (station: Station) => void;
};

type MlMap = import("maplibre-gl").Map;
type MlNs = typeof import("maplibre-gl");

function token(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function styleForTheme(): import("maplibre-gl").StyleSpecification {
  const bg = token("--color-bg", "#07090d");
  const water = token("--color-surface", "#10161c");
  const line = token("--color-line", "#24323a");
  const primary = token("--color-primary", "#2ee6a6");
  const muted = token("--color-muted", "#8ea0a8");
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      ofm: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": bg } },
      {
        id: "water",
        type: "fill",
        source: "ofm",
        "source-layer": "water",
        paint: { "fill-color": water },
      },
      {
        id: "waterway",
        type: "line",
        source: "ofm",
        "source-layer": "waterway",
        paint: { "line-color": line, "line-width": 0.8 },
      },
      {
        id: "roads",
        type: "line",
        source: "ofm",
        "source-layer": "transportation",
        filter: ["!", ["in", ["get", "class"], ["literal", ["path", "service", "track"]]]],
        paint: { "line-color": primary, "line-opacity": 0.28, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.6, 13, 1.6] },
      },
      {
        id: "roads-major",
        type: "line",
        source: "ofm",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary"]]],
        paint: { "line-color": primary, "line-opacity": 0.85, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.1, 13, 2.4] },
      },
      {
        id: "boundary",
        type: "line",
        source: "ofm",
        "source-layer": "boundary",
        filter: ["<=", ["get", "admin_level"], 4],
        paint: { "line-color": primary, "line-width": 1.4, "line-opacity": 0.7 },
      },
      {
        id: "places",
        type: "symbol",
        source: "ofm",
        "source-layer": "place",
        filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
        layout: {
          "text-field": ["get", "name:en"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
        },
        paint: { "text-color": muted, "text-halo-color": bg, "text-halo-width": 1.2 },
      },
    ],
  };
}

const PSI_COLOR: Record<string, string> = {
  good: "--color-good",
  moderate: "--color-moderate",
  unhealthy: "--color-unhealthy",
  very: "--color-very",
  hazard: "--color-hazard",
};

export function WireMap({ stations, regions, areas, theme, layers, focus, onSelect }: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const nsRef = useRef<MlNs | null>(null);
  const markers = useRef<{ id: string; marker: import("maplibre-gl").Marker; el: HTMLButtonElement }[]>([]);
  const [ready, setReady] = useState(0);
  const stationsRef = useRef(stations);
  stationsRef.current = stations;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    let dead = false;
    const node = host.current;
    if (!node) return;
    void import("maplibre-gl").then((ns) => {
      if (dead || !host.current) return;
      ns.setWorkerUrl(maplibreWorkerUrl);
      nsRef.current = ns;
      const map = new ns.Map({
        container: host.current,
        style: styleForTheme(),
        center: [103.8198, 1.3521],
        zoom: 10.35,
        minZoom: 9.2,
        maxZoom: 14.5,
        attributionControl: false,
        maxBounds: [
          [103.45, 1.12],
          [104.15, 1.52],
        ],
      });
      map.addControl(new ns.AttributionControl({ compact: true }), "bottom-right");
      map.addControl(new ns.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => {
        if (!dead) setReady((n) => n + 1);
      });
      mapRef.current = map;
    });
    return () => {
      dead = true;
      markers.current.forEach((m) => m.marker.remove());
      markers.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (!map.getLayer("bg")) return;
      const bg = token("--color-bg", "#07090d");
      const water = token("--color-surface", "#10161c");
      const line = token("--color-line", "#24323a");
      const primary = token("--color-primary", "#2ee6a6");
      const muted = token("--color-muted", "#8ea0a8");
      map.setPaintProperty("bg", "background-color", bg);
      map.setPaintProperty("water", "fill-color", water);
      map.setPaintProperty("waterway", "line-color", line);
      map.setPaintProperty("roads", "line-color", primary);
      map.setPaintProperty("roads", "line-opacity", 0.28);
      map.setPaintProperty("roads-major", "line-color", primary);
      map.setPaintProperty("roads-major", "line-opacity", 0.85);
      map.setPaintProperty("boundary", "line-color", primary);
      map.setPaintProperty("places", "text-color", muted);
      map.setPaintProperty("places", "text-halo-color", bg);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [theme, ready]);

  useEffect(() => {
    const map = mapRef.current;
    const ns = nsRef.current;
    if (!map || !ns) return;
    const sync = () => {
      const wanted = new Map(stations.filter((s) => s.windFromDeg != null).map((s) => [s.id, s]));
      const keep = new Set<string>();
      for (const entry of markers.current) {
        const station = wanted.get(entry.id);
        if (!station || !layers.wind) {
          entry.marker.remove();
          continue;
        }
        keep.add(entry.id);
        const arrow = entry.el.querySelector(".wind-arrow") as HTMLElement | null;
        if (arrow && station.windFromDeg != null) {
          const toward = (station.windFromDeg + 180) % 360;
          const scale = 0.75 + Math.min(station.windKnots ?? 1, 12) / 18;
          arrow.style.transform = `rotate(${toward}deg) scale(${scale})`;
        }
        entry.el.dataset.hot = station.rainMm && station.rainMm > 0 ? "true" : "false";
        entry.el.setAttribute("aria-label", `${station.name} wind`);
      }
      markers.current = markers.current.filter((entry) => keep.has(entry.id));
      if (!layers.wind) return;
      for (const station of wanted.values()) {
        if (keep.has(station.id) || station.windFromDeg == null) continue;
        const el = document.createElement("button");
        el.type = "button";
        el.className = "wind-pin";
        el.dataset.hot = station.rainMm && station.rainMm > 0 ? "true" : "false";
        el.setAttribute("aria-label", `${station.name} wind`);
        const arrow = document.createElement("span");
        arrow.className = "wind-arrow flow";
        const toward = (station.windFromDeg + 180) % 360;
        const scale = 0.75 + Math.min(station.windKnots ?? 1, 12) / 18;
        arrow.style.transform = `rotate(${toward}deg) scale(${scale})`;
        el.appendChild(arrow);
        el.addEventListener("click", () => {
          const current = stationsRef.current.find((s) => s.id === station.id);
          if (current) onSelectRef.current(current);
        });
        const marker = new ns.Marker({ element: el, anchor: "center" })
          .setLngLat([station.lon, station.lat])
          .addTo(map);
        markers.current.push({ id: station.id, marker, el });
      }
    };
    if (map.isStyleLoaded()) sync();
    else map.once("load", sync);
  }, [stations, layers.wind, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const draw = () => {
      const hazeData = {
        type: "FeatureCollection" as const,
        features: regions.map((r) => ({
          type: "Feature" as const,
          properties: {
            id: r.id,
            color: token(PSI_COLOR[r.psi != null ? psiKey(r.psi) : "moderate"] ?? "--color-muted", "#8ea0a8"),
          },
          geometry: { type: "Point" as const, coordinates: [r.lon, r.lat] },
        })),
      };
      const rainData = {
        type: "FeatureCollection" as const,
        features: stations
          .filter((s) => (s.rainMm ?? 0) > 0)
          .map((s) => ({
            type: "Feature" as const,
            properties: { mm: s.rainMm ?? 0 },
            geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] },
          })),
      };
      const areaData = {
        type: "FeatureCollection" as const,
        features: areas.map((a) => ({
          type: "Feature" as const,
          properties: { name: a.name, forecast: a.forecast, tone: forecastTone(a.forecast) },
          geometry: { type: "Point" as const, coordinates: [a.lon, a.lat] },
        })),
      };
      upsert(map, "haze", hazeData);
      upsert(map, "rain", rainData);
      upsert(map, "areas", areaData);
      if (!map.getLayer("haze-glow")) {
        map.addLayer({
          id: "haze-glow",
          type: "circle",
          source: "haze",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 28, 12, 70],
            "circle-color": ["get", "color"],
            "circle-opacity": 0.22,
            "circle-blur": 0.65,
          },
        });
        map.addLayer({
          id: "rain-ring",
          type: "circle",
          source: "rain",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["get", "mm"], 0, 6, 10, 18],
            "circle-color": token("--color-accent", "#ff4d8d"),
            "circle-opacity": 0.35,
            "circle-stroke-width": 1,
            "circle-stroke-color": token("--color-accent", "#ff4d8d"),
          },
        });
        map.addLayer({
          id: "area-dot",
          type: "circle",
          source: "areas",
          paint: {
            "circle-radius": 3.5,
            "circle-color": [
              "match",
              ["get", "tone"],
              "storm",
              token("--color-accent", "#ff4d8d"),
              "wet",
              token("--color-moderate", "#e6c15a"),
              token("--color-muted", "#8ea0a8"),
            ],
            "circle-opacity": 0.9,
          },
        });
        map.on("click", "area-dot", (event) => {
          const feature = event.features?.[0];
          const props = feature?.properties;
          if (!nsRef.current || !props || !feature) return;
          const coords = (feature.geometry as { type: "Point"; coordinates: [number, number] }).coordinates;
          new nsRef.current.Popup({ closeButton: true, offset: 8 })
            .setLngLat(coords)
            .setHTML(
              `<div class="text-xs"><div class="font-display text-sm">${escapeHtml(String(props.name))}</div><div class="text-muted">${escapeHtml(String(props.forecast))}</div></div>`,
            )
            .addTo(map);
        });
      }
      map.setLayoutProperty("haze-glow", "visibility", layers.haze ? "visible" : "none");
      map.setLayoutProperty("rain-ring", "visibility", layers.rain ? "visible" : "none");
      map.setLayoutProperty("area-dot", "visibility", layers.nowcast ? "visible" : "none");
    };
    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
  }, [stations, regions, areas, layers.haze, layers.rain, layers.nowcast, theme, ready]);

  useEffect(() => {
    if (!focus || !mapRef.current) return;
    mapRef.current.flyTo({ center: [focus.lon, focus.lat], zoom: 12, essential: true });
  }, [focus]);

  return (
    <div className="relative h-full min-h-0">
      <div ref={host} className="absolute inset-0" />
      <div className="scanlines" />
      <StationHint stations={stations} />
    </div>
  );
}

function StationHint({ stations }: { stations: Station[] }) {
  const raining = stations.filter((s) => (s.rainMm ?? 0) > 0).length;
  const windy = stations.filter((s) => s.windFromDeg != null).length;
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex gap-2 text-xs">
      <span className="panel px-2 py-1 text-muted">
        {windy} wind stations · {raining} reporting rain
      </span>
    </div>
  );
}

function upsert(map: MlMap, id: string, data: { type: "FeatureCollection"; features: object[] }) {
  const source = map.getSource(id) as import("maplibre-gl").GeoJSONSource | undefined;
  if (source) source.setData(data);
  else map.addSource(id, { type: "geojson", data });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "\u0026amp;";
    if (ch === "<") return "\u0026lt;";
    if (ch === ">") return "\u0026gt;";
    if (ch === '"') return "\u0026quot;";
    return "\u0026#39;";
  });
}
