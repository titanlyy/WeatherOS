import { useEffect, useRef } from "react";
import type { GeoJSON as GeoLayer, LayerGroup, Map as LeafletMap, Path, TileLayer } from "leaflet";
import type { Feature, FeatureCollection, GeoJsonObject } from "geojson";
import planning from "@/lib/planning-areas.json";
import type { AreaNow, Region, Station, ThemeId } from "@/lib/weather-model";
import { forecastTone, knotsToKmh, pmLabel, psiKey, psiLabel, round1 } from "@/lib/weather-model";

type Layers = { wind: boolean; rain: boolean; haze: boolean; nowcast: boolean };

type AreaProps = { name: string; region: string; lon: number; lat: number };

type Props = {
  stations: Station[];
  regions: Region[];
  areas: AreaNow[];
  theme: ThemeId;
  layers: Layers;
  focus: { lon: number; lat: number; nonce: number } | null;
  validText: string | null;
  onSelect: (station: Station) => void;
};

const COLLECTION = planning as FeatureCollection;

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const CITY = new Set([
  "downtown core",
  "museum",
  "newton",
  "orchard",
  "outram",
  "river valley",
  "rochor",
  "singapore river",
  "marina east",
  "marina south",
  "straits view",
]);

const PSI_HEX: Record<string, string> = {
  good: "#1f9d6a",
  moderate: "#c88812",
  unhealthy: "#e06a2c",
  very: "#d23b4a",
  hazard: "#9b1d38",
};

function esc(value: string) {
  return value
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;")
    .replace(/'/g, "\u0026#39;");
}

function matchForecast(name: string, lat: number, lon: number, areas: AreaNow[]): AreaNow | null {
  const key = name.toLowerCase();
  const direct = areas.find((area) => area.name.toLowerCase() === key);
  if (direct) return direct;
  if (CITY.has(key)) return areas.find((area) => area.name.toLowerCase() === "city") ?? null;
  if (key === "changi bay") return areas.find((area) => area.name.toLowerCase() === "changi") ?? null;
  let best: AreaNow | null = null;
  let bestD = Infinity;
  for (const area of areas) {
    const d = (area.lat - lat) ** 2 + (area.lon - lon) ** 2;
    if (d < bestD) {
      best = area;
      bestD = d;
    }
  }
  return best;
}

function nearest<T extends { lat: number; lon: number }>(lat: number, lon: number, rows: T[], max = Infinity): T | null {
  let best: T | null = null;
  let bestD = max;
  for (const row of rows) {
    const d = (row.lat - lat) ** 2 + (row.lon - lon) ** 2;
    if (d < bestD) {
      best = row;
      bestD = d;
    }
  }
  return best;
}

function wxKind(forecast: string): "sun" | "part" | "cloud" | "rain" | "storm" {
  const text = forecast.toLowerCase();
  if (text.includes("thunder")) return "storm";
  if (text.includes("rain") || text.includes("shower")) return "rain";
  if (text.includes("partly")) return "part";
  if (text.includes("cloud")) return "cloud";
  return "sun";
}

function wxFill(forecast: string): string {
  const kind = wxKind(forecast);
  if (kind === "storm") return "#e25b4a";
  if (kind === "rain") return "#3b82f6";
  if (kind === "cloud" || kind === "part") return "#8aa0ad";
  return "#e6b325";
}

function glyph(forecast: string): string {
  const kind = wxKind(forecast);
  const fill = kind === "storm" ? "#e25b4a" : kind === "rain" ? "#3b82f6" : "#d7e2ea";
  const sun = `<circle cx="7" cy="7" r="3" fill="#f0c14a"/>`;
  const cloud = `<path fill="${fill}" d="M8 16h8.2a3.2 3.2 0 0 0 .4-6.4 4.2 4.2 0 0 0-8-1 3 3 0 0 0-.6 7.4z"/>`;
  const drops = `<path stroke="#7eb6ff" stroke-width="1.4" stroke-linecap="round" d="M9 17.5v2M13 17.5v2M17 17.5v2"/>`;
  const bolt = `<path fill="#f0c14a" d="M13 15.5h3.2L12.2 22h.1l1.4-4H11l2-2.5z"/>`;
  const body = kind === "sun" ? `<circle cx="12" cy="12" r="4" fill="#f0c14a"/>` : kind === "part" ? sun + cloud : kind === "storm" ? cloud + bolt : kind === "rain" ? cloud + drops : cloud;
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${body}</svg>`;
}

function tipHtml(props: AreaProps, areas: AreaNow[], regions: Region[], stations: Station[], validText: string | null) {
  const forecast = matchForecast(props.name, props.lat, props.lon, areas);
  const region = nearest(props.lat, props.lon, regions);
  const station = nearest(props.lat, props.lon, stations, 0.0016);
  const lines = [`<p class="area-name">${esc(props.name)}</p>`];
  if (forecast) {
    lines.push(`<p class="area-wx">${esc(forecast.forecast)}</p>`);
    if (forecast.name.toLowerCase() !== props.name.toLowerCase()) lines.push(`<p>NEA area \u00b7 ${esc(forecast.name)}</p>`);
  } else {
    lines.push(`<p>No 2-hour forecast yet</p>`);
  }
  if (validText) lines.push(`<p>2-hour \u00b7 ${esc(validText)}</p>`);
  if (region) {
    const psi = region.psi == null ? "\u2014" : `${Math.round(region.psi)} ${psiLabel(region.psi)}`;
    const pm = region.pm25h == null ? "\u2014" : `${Math.round(region.pm25h)} ${pmLabel(region.pm25h)}`;
    const regionName = region.id.charAt(0).toUpperCase() + region.id.slice(1);
    lines.push(`<p>${esc(regionName)} PSI ${esc(psi)} \u00b7 PM2.5 ${esc(pm)}</p>`);
  }
  if (station) {
    const temp = station.tempC == null ? "\u2014" : `${round1(station.tempC)}\u00b0C`;
    const rain = station.rainMm == null ? "\u2014" : `${round1(station.rainMm)} mm`;
    lines.push(`<p>Nearest station ${esc(station.name)} \u00b7 ${esc(temp)} \u00b7 rain ${esc(rain)}</p>`);
  }
  return lines.join("");
}

function areaStyle(props: AreaProps, areas: AreaNow[], regions: Region[], layers: Layers) {
  const forecast = matchForecast(props.name, props.lat, props.lon, areas);
  const region = nearest(props.lat, props.lon, regions);
  const psi = region?.psi != null ? PSI_HEX[psiKey(region.psi)] : "#8ea0a8";
  let fill = "#8ea0a8";
  let fillOpacity = 0.04;
  if (layers.nowcast && forecast) {
    fill = wxFill(forecast.forecast);
    fillOpacity = forecastTone(forecast.forecast) === "calm" ? 0.16 : 0.34;
  } else if (layers.haze) {
    fill = psi;
    fillOpacity = 0.28;
  }
  return {
    color: layers.haze ? psi : "rgba(180, 220, 210, 0.85)",
    weight: 1.25,
    opacity: 0.9,
    fillColor: fill,
    fillOpacity,
  };
}

export function WireMap({ stations, regions, areas, theme, layers, focus, validText, onSelect }: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const tilesRef = useRef<TileLayer | null>(null);
  const areasRef = useRef<GeoLayer | null>(null);
  const marksRef = useRef<LayerGroup | null>(null);
  const nsRef = useRef<typeof import("leaflet") | null>(null);
  const nonceRef = useRef<number | null>(null);
  const dataRef = useRef({ stations, regions, areas, theme, layers, validText, onSelect });
  dataRef.current = { stations, regions, areas, theme, layers, validText, onSelect };

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let dead = false;
    let map: LeafletMap | null = null;
    let observer: ResizeObserver | null = null;
    void import("leaflet").then((L) => {
      if (dead || !host.current) return;
      nsRef.current = L;
      map = L.map(host.current, {
        zoomControl: false,
        minZoom: 10,
        maxZoom: 16,
        maxBounds: [
          [1.12, 103.45],
          [1.52, 104.15],
        ],
        maxBoundsViscosity: 0.7,
      });
      L.control.zoom({ position: "bottomright" }).addTo(map);
      tilesRef.current = L.tileLayer(OSM_TILES, {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);
      const geo = L.geoJSON(COLLECTION as GeoJsonObject, {
        style: (feature) => {
          const props = feature?.properties as AreaProps | undefined;
          if (!props) return {};
          const current = dataRef.current;
          return areaStyle(props, current.areas, current.regions, current.layers);
        },
        onEachFeature: (feature: Feature, layer) => {
          const props = feature.properties as AreaProps;
          layer.bindTooltip("", { sticky: true, direction: "top", opacity: 1, className: "area-tip" });
          layer.on("add", () => {
            (layer as Path).getElement()?.setAttribute("data-area", props.name);
          });
          layer.on("click", (event) => {
            const current = dataRef.current;
            const html = tipHtml(props, current.areas, current.regions, current.stations, current.validText);
            layer.getTooltip()?.setContent(html);
            layer.openTooltip(event.latlng);
          });
          layer.on("mouseover", (event) => {
            const current = dataRef.current;
            const path = layer as Path;
            path.setStyle({ weight: 2.4, fillOpacity: 0.48 });
            path.bringToFront();
            layer.getTooltip()?.setContent(tipHtml(props, current.areas, current.regions, current.stations, current.validText));
            layer.openTooltip(event.latlng);
          });
          layer.on("mouseout", () => {
            areasRef.current?.resetStyle(layer);
            layer.closeTooltip();
          });
        },
      }).addTo(map);
      areasRef.current = geo;
      marksRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      let fitted = false;
      const fit = () => {
        map?.invalidateSize();
        const height = host.current?.offsetHeight ?? 0;
        if (!fitted && height > 80) {
          map?.fitBounds(
            [
              [1.22, 103.6],
              [1.47, 104.09],
            ],
            { padding: [28, 36] },
          );
          fitted = true;
        }
      };
      observer = new ResizeObserver(fit);
      observer.observe(host.current);
      fit();
      paint();
    });
    return () => {
      dead = true;
      observer?.disconnect();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    paint();
  }, [theme, layers, stations, regions, areas, validText]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus || nonceRef.current === focus.nonce) return;
    nonceRef.current = focus.nonce;
    map.flyTo([focus.lat, focus.lon], Math.max(map.getZoom(), 13), { duration: 0.55 });
  }, [focus]);

  return (
    <div className={`absolute inset-0 z-0${theme === "cyber" ? " map-dark" : ""}`}>
      <div ref={host} className="absolute inset-0" role="application" aria-label="Singapore map. Hover a planning area for the 2-hour forecast." />
      <p className="pointer-events-none absolute bottom-3 left-3 z-[500] panel px-2 py-1 text-xs text-muted">
        Hover an area \u00b7 {areas.filter((area) => forecastTone(area.forecast) !== "calm").length} areas with rain in the nowcast
      </p>
    </div>
  );

  function paint() {
    const L = nsRef.current;
    const map = mapRef.current;
    const tiles = tilesRef.current;
    const geo = areasRef.current;
    const marks = marksRef.current;
    if (!L || !map || !tiles || !geo || !marks) return;
    const current = dataRef.current;
    geo.setStyle((feature) => {
      const props = feature?.properties as AreaProps | undefined;
      if (!props) return {};
      return areaStyle(props, current.areas, current.regions, current.layers);
    });
    marks.clearLayers();
    if (current.layers.rain) {
      for (const station of current.stations) {
        if ((station.rainMm ?? 0) <= 0) continue;
        L.circleMarker([station.lat, station.lon], {
          radius: 7 + Math.min(station.rainMm ?? 0, 10),
          color: "#7eb6ff",
          weight: 2,
          fillColor: "#7eb6ff",
          fillOpacity: 0.18,
          interactive: false,
        }).addTo(marks);
      }
    }
    if (current.layers.nowcast) {
      for (const area of current.areas) {
        const icon = L.divIcon({
          className: "wx-icon",
          html: `<span class="wx-glyph" title="${esc(area.name)}: ${esc(area.forecast)}">${glyph(area.forecast)}</span>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        L.marker([area.lat, area.lon], { icon, interactive: false, keyboard: false }).addTo(marks);
      }
    }
    if (current.layers.wind) {
      for (const station of current.stations) {
        if (station.windFromDeg == null) continue;
        const toward = (station.windFromDeg + 180) % 360;
        const icon = L.divIcon({
          className: "wx-icon",
          html: `<span class="wind-glyph" style="transform:rotate(${toward}deg)" title="${esc(station.name)}"></span>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        });
        L.marker([station.lat, station.lon], { icon, zIndexOffset: 400, title: station.name })
          .on("click", () => current.onSelect(station))
          .addTo(marks);
      }
    }
  }
}
