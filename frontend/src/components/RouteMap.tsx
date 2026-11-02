import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";

import type { CorridorHeatmap, RiskLevel, Route } from "../types";
import {
  formatDateTime,
  riskColors,
  riskLevels,
  routeColors,
} from "../utils/risk";
import { calculateMapLimits } from "../utils/mapLimits";
import { chooseLabelPositions } from "../utils/routeLabels";
import { truckPositionAt } from "../utils/truck";
import "mapbox-gl/dist/mapbox-gl.css";

interface RouteMapProps {
  routes: Route[];
  heatmap: CorridorHeatmap | null;
  departure: string;
  recommendedRouteId: string | null;
  selectedRouteId: string | null;
  onSelectRoute: (routeId: string) => void;
}

const HEATMAP_SOURCE = "corridor-heatmap";
const HEATMAP_LAYER = "corridor-heatmap-layer";
const CHECKPOINT_SOURCE = "checkpoints";
const CHECKPOINT_LAYER = "checkpoints-layer";

const INITIAL_ZOOM = 3;
const MAX_ZOOM = 13;
const MAX_HOUR = 48;
const PLAY_MILLISECONDS_PER_HOUR = 300;

// Heat strength per risk rank (Low through No Travel).
const HEAT_WEIGHTS = [0.12, 0.35, 0.6, 0.85, 1];

// Calibrated by rendering uniform risk on a real corridor, which is 2-3 grid cells wide, so
// that the center of the corridor matches the legend color for each risk level.
const HEAT_RADIUS_TO_SPACING = 1.5;
const HEAT_INTENSITY = 1.5;

const ROUTE_LABEL_SPACING_PIXELS = 32;

const METERS_PER_MILE = 1609.34;
const METERS_PER_PIXEL_AT_ZOOM_0 = 78271.5;

function routeLayerId(index: number): string {
  return `route-line-${index}`;
}

function heatProperty(hour: number): string {
  return `h${hour}`;
}

function heatWeightExpression(hour: number): mapboxgl.ExpressionSpecification {
  return ["get", heatProperty(hour)];
}

function buildHeatmapGeojson(heatmap: CorridorHeatmap | null) {
  return {
    type: "FeatureCollection" as const,
    features: (heatmap?.points ?? []).map((point) => ({
      type: "Feature" as const,
      properties: Object.fromEntries(
        point.risks.map((rank, hour) => [
          heatProperty(hour),
          HEAT_WEIGHTS[rank] ?? 0,
        ])
      ),
      geometry: {
        type: "Point" as const,
        coordinates: [point.longitude, point.latitude],
      },
    })),
  };
}

function buildCheckpointGeojson(routes: Route[]) {
  return {
    type: "FeatureCollection" as const,
    features: routes.flatMap((route, routeIndex) =>
      route.checkpoints.map((checkpoint, checkpointIndex) => ({
        type: "Feature" as const,
        properties: {
          routeIndex,
          checkpointIndex,
          risk: checkpoint.risk.overall_risk,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [checkpoint.longitude, checkpoint.latitude],
        },
      }))
    ),
  };
}

// Heatmap radius is in pixels, so it doubles per zoom level to stay fixed on the ground.
function heatRadiusAtZoomZero(heatmap: CorridorHeatmap | null): number {
  const points = heatmap?.points ?? [];

  const latitude =
    points.reduce((total, point) => total + point.latitude, 0) /
    Math.max(points.length, 1);

  const metersPerPixel =
    METERS_PER_PIXEL_AT_ZOOM_0 *
    Math.max(Math.cos((latitude * Math.PI) / 180), 0.1);

  const spacingMeters = (heatmap?.spacing_miles ?? 10) * METERS_PER_MILE;

  return (HEAT_RADIUS_TO_SPACING * spacingMeters) / metersPerPixel;
}

function clearViewLimits(map: mapboxgl.Map) {
  // Mapbox documents null as removing the bounds, but its types leave that out.
  map.setMaxBounds(null as unknown as mapboxgl.LngLatBoundsLike);
  map.setMinZoom(0);
}

function fitPadding(map: mapboxgl.Map) {
  const isWide = map.getContainer().clientWidth > 800;

  return isWide
    ? { top: 70, bottom: 190, left: 270, right: 90 }
    : { top: 40, bottom: 40, left: 40, right: 40 };
}

function appendRow(container: HTMLElement, label: string, value: string) {
  const row = document.createElement("p");
  row.className = "map-popup-row";
  row.textContent = `${label}: ${value}`;
  container.appendChild(row);
}

function createCheckpointPopup(route: Route, checkpointIndex: number) {
  const checkpoint = route.checkpoints[checkpointIndex];
  const container = document.createElement("div");

  const title = document.createElement("h3");
  title.className = "map-popup-title";
  title.textContent = `${route.route_name}, mile ${checkpoint.distance_miles.toFixed(0)}`;
  container.appendChild(title);

  const risk = document.createElement("p");
  risk.className = "map-popup-risk";
  risk.style.color = riskColors[checkpoint.risk.overall_risk];
  risk.textContent = `Risk: ${checkpoint.risk.overall_risk}`;
  container.appendChild(risk);

  appendRow(container, "ETA", formatDateTime(checkpoint.estimated_arrival));
  appendRow(
    container,
    "Wind",
    `${checkpoint.weather.wind_mph.toFixed(1)} mph (${checkpoint.risk.wind_risk})`
  );
  appendRow(
    container,
    "Rain",
    `${checkpoint.weather.rain_inches_per_hour.toFixed(2)} in/hr (${checkpoint.risk.rain_risk})`
  );
  appendRow(
    container,
    "Snow",
    `${checkpoint.weather.snow_inches_per_hour.toFixed(2)} in/hr (${checkpoint.risk.snow_risk})`
  );

  return container;
}

function createRoutePopup(route: Route, recommended: boolean) {
  const summary = route.risk_summary;
  const container = document.createElement("div");

  const title = document.createElement("h3");
  title.className = "map-popup-title";
  title.textContent = `${route.route_name}${recommended ? " (recommended)" : ""}`;
  container.appendChild(title);

  appendRow(container, "Distance", `${route.distance_miles.toFixed(1)} mi`);
  appendRow(container, "Travel time", `${route.duration_hours.toFixed(1)} hrs`);
  appendRow(container, "No Travel", `${summary.no_travel_miles.toFixed(1)} mi`);
  appendRow(container, "Severe", `${summary.severe_miles.toFixed(1)} mi`);
  appendRow(container, "High", `${summary.high_miles.toFixed(1)} mi`);
  appendRow(container, "Average risk", `${summary.average_risk_score.toFixed(2)} / 4`);

  return container;
}

function createRouteLabel(route: Route, recommended: boolean, color: string) {
  const label = document.createElement("button");

  label.type = "button";
  label.className = "route-map-label";
  label.style.borderColor = color;
  label.setAttribute("aria-label", `Show summary for ${route.route_name}`);

  label.textContent =
    `${recommended ? "★ " : ""}${route.route_name} · ` +
    `${route.duration_hours.toFixed(1)} h`;

  return label;
}

function downloadCheckpointCsv(routes: Route[]) {
  const rows: string[][] = [
    [
      "Route",
      "Mile",
      "Estimated Arrival",
      "Risk",
      "Wind (mph)",
      "Rain (in/hr)",
      "Snow (in/hr)",
    ],
  ];

  routes.forEach((route) => {
    route.checkpoints.forEach((checkpoint) => {
      rows.push([
        route.route_name,
        String(checkpoint.distance_miles),
        checkpoint.estimated_arrival,
        checkpoint.risk.overall_risk,
        String(checkpoint.weather.wind_mph),
        String(checkpoint.weather.rain_inches_per_hour),
        String(checkpoint.weather.snow_inches_per_hour),
      ]);
    });
  });

  const csv = rows
    .map((row) =>
      row.map((value) => `"${value.replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");

  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8;" })
  );

  const link = document.createElement("a");

  link.href = url;
  link.download = "route-checkpoints.csv";
  link.click();

  URL.revokeObjectURL(url);
}

function RouteMap({
  routes,
  heatmap,
  departure,
  recommendedRouteId,
  selectedRouteId,
  onSelectRoute,
}: RouteMapProps) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<mapboxgl.Map | null>(null);
  const routeBounds = useRef<mapboxgl.LngLatBounds | null>(null);
  const truckMarker = useRef<mapboxgl.Marker | null>(null);

  // The layer effects read these without redrawing the map when they change.
  const initialHour = useRef(0);
  const selectRoute = useRef(onSelectRoute);

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [selectedHour, setSelectedHour] = useState(0);
  const [playing, setPlaying] = useState(false);

  const [visibleRisks, setVisibleRisks] = useState<
    Record<RiskLevel, boolean>
  >({
    Low: true,
    Moderate: true,
    High: true,
    Severe: true,
    "No Travel": true,
  });

  const mapToken = import.meta.env.VITE_MAPBOX_TOKEN;

  const displayedMapError = !mapToken
    ? "Mapbox token is missing. Check your frontend .env file."
    : mapError;

  const riskCounts = useMemo(() => {
    const counts: Record<RiskLevel, number> = {
      Low: 0,
      Moderate: 0,
      High: 0,
      Severe: 0,
      "No Travel": 0,
    };

    routes.forEach((route) => {
      route.checkpoints.forEach((checkpoint) => {
        counts[checkpoint.risk.overall_risk]++;
      });
    });

    return counts;
  }, [routes]);

  useEffect(() => {
    selectRoute.current = onSelectRoute;
    initialHour.current = selectedHour;
  });

  const resetMapView = () => {
    const map = mapInstance.current;
    const bounds = routeBounds.current;

    if (!map || !bounds) return;

    map.fitBounds(bounds, {
      padding: fitPadding(map),
      maxZoom: 10,
      duration: 800,
    });
  };

  // Initialize Mapbox.
  useEffect(() => {
    if (!mapContainer.current || !mapToken) return;

    mapboxgl.accessToken = mapToken;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/light-v11",
      // This style defaults to a globe, where a search result can't be held in view.
      projection: "mercator",
      center: [-98.5795, 39.8283],
      zoom: INITIAL_ZOOM,
      maxZoom: MAX_ZOOM,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      renderWorldCopies: false,
    });

    map.addControl(new mapboxgl.NavigationControl(), "bottom-right");

    mapInstance.current = map;

    map.on("load", () => {
      setMapReady(true);
      setMapError("");
    });

    // Later errors, such as one failed tile, leave a working map on screen.
    map.on("error", () => {
      if (!map.loaded()) {
        setMapError(
          "Unable to load the map. Check your Mapbox token and network connection."
        );
      }
    });

    return () => {
      truckMarker.current?.remove();
      truckMarker.current = null;

      map.remove();
      mapInstance.current = null;
      setMapReady(false);
    };
  }, [mapToken]);

  // Draw the heatmap, routes, and checkpoints, from the bottom layer up.
  useEffect(() => {
    const map = mapInstance.current;

    if (!map || !mapReady || !routes.length) return;

    const radius = heatRadiusAtZoomZero(heatmap);

    map.addSource(HEATMAP_SOURCE, {
      type: "geojson",
      data: buildHeatmapGeojson(heatmap),
      // A low source zoom keeps each point's wide radius from being cut at tile edges.
      maxzoom: 5,
      buffer: 512,
    });

    map.addLayer({
      id: HEATMAP_LAYER,
      type: "heatmap",
      source: HEATMAP_SOURCE,
      paint: {
        "heatmap-weight": heatWeightExpression(initialHour.current),
        "heatmap-intensity": HEAT_INTENSITY,
        "heatmap-radius": [
          "interpolate",
          ["exponential", 2],
          ["zoom"],
          0,
          radius,
          10,
          radius * 2 ** 10,
        ],
        "heatmap-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8,
          0.7,
          12,
          0.3,
        ],
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(22,163,74,0)",
          0.1,
          "rgba(22,163,74,0.45)",
          0.25,
          riskColors.Low,
          0.4,
          riskColors.Moderate,
          0.62,
          riskColors.High,
          0.85,
          riskColors.Severe,
          1,
          riskColors["No Travel"],
        ],
      },
    });

    const bounds = new mapboxgl.LngLatBounds();
    const overlays: Array<mapboxgl.Marker> = [];
    const popup = new mapboxgl.Popup({ offset: 12, maxWidth: "280px" });
    const labelPositions = chooseLabelPositions(routes);

    routes.forEach((route, index) => {
      const color = routeColors[index % routeColors.length];
      const recommended = route.route_id === recommendedRouteId;
      const sourceId = `route-${index}`;

      map.addSource(sourceId, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: route.geometry,
        },
      });

      map.addLayer({
        id: routeLayerId(index),
        type: "line",
        source: sourceId,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": color },
      });

      route.geometry.coordinates.forEach((coordinate) => {
        bounds.extend(coordinate);
      });

      const label = createRouteLabel(route, recommended, color);
      label.addEventListener("click", (event) => {
        // A click reaching the map would close the popup it just opened.
        event.stopPropagation();

        selectRoute.current(route.route_id);

        popup
          .setLngLat(labelPositions[index])
          .setDOMContent(createRoutePopup(route, recommended))
          .addTo(map);
      });

      overlays.push(
        // On short trips the routes nearly coincide, so labels are also spaced by pixels.
        new mapboxgl.Marker({
          element: label,
          offset: [0, (index - 1) * ROUTE_LABEL_SPACING_PIXELS],
        })
          .setLngLat(labelPositions[index])
          .addTo(map)
      );

      map.on("click", routeLayerId(index), (event) => {
        // A checkpoint drawn on top of the line opens its own popup.
        const onCheckpoint = map.queryRenderedFeatures(event.point, {
          layers: [CHECKPOINT_LAYER],
        }).length;

        if (onCheckpoint) return;

        selectRoute.current(route.route_id);

        popup
          .setLngLat(event.lngLat)
          .setDOMContent(createRoutePopup(route, recommended))
          .addTo(map);
      });
    });

    const firstCheckpoints = routes[0].checkpoints;

    [firstCheckpoints[0], firstCheckpoints[firstCheckpoints.length - 1]].forEach(
      (checkpoint, index) => {
        overlays.push(
          new mapboxgl.Marker({ color: index === 0 ? "#0f172a" : "#be123c" })
            .setLngLat([checkpoint.longitude, checkpoint.latitude])
            .addTo(map)
        );
      }
    );

    map.addSource(CHECKPOINT_SOURCE, {
      type: "geojson",
      data: buildCheckpointGeojson(routes),
    });

    map.addLayer({
      id: CHECKPOINT_LAYER,
      type: "circle",
      source: CHECKPOINT_SOURCE,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3, 8, 6, 12, 9],
        "circle-color": [
          "match",
          ["get", "risk"],
          ...riskLevels.flatMap((risk) => [risk, riskColors[risk]]),
          riskColors.Low,
        ],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
      } as mapboxgl.CirclePaint,
    });

    const showCheckpointPopup = (event: mapboxgl.MapMouseEvent) => {
      const properties = (
        event.features?.[0] as { properties?: Record<string, number> } | undefined
      )?.properties;

      if (!properties) return;

      map.getCanvas().style.cursor = "pointer";

      popup
        .setLngLat(event.lngLat)
        .setDOMContent(
          createCheckpointPopup(
            routes[properties.routeIndex],
            properties.checkpointIndex
          )
        )
        .addTo(map);
    };

    const hideCheckpointPopup = () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    };

    map.on("mouseenter", CHECKPOINT_LAYER, showCheckpointPopup);
    map.on("click", CHECKPOINT_LAYER, showCheckpointPopup);
    map.on("mouseleave", CHECKPOINT_LAYER, hideCheckpointPopup);

    routeBounds.current = bounds;

    // Keep the map on this search result, using the view that fits the routes.
    const applyViewLimits = () => {
      // getBounds() leaves out the fit padding, but the limits need the whole visible map.
      const container = map.getContainer();
      const northWest = map.unproject([0, 0]);
      const southEast = map.unproject([container.clientWidth, container.clientHeight]);

      const limits = calculateMapLimits(
        {
          west: northWest.lng,
          south: southEast.lat,
          east: southEast.lng,
          north: northWest.lat,
        },
        map.getZoom()
      );

      map.setMinZoom(limits.minZoom);
      map.setMaxBounds(limits.maxBounds);
    };

    // A new window size needs a new fit, and old limits would prevent it.
    const refitAfterResize = () => {
      clearViewLimits(map);

      map.fitBounds(bounds, {
        padding: fitPadding(map),
        maxZoom: 10,
        duration: 0,
      });

      applyViewLimits();
    };

    map.once("moveend", () => {
      if (mapInstance.current !== map) return;

      applyViewLimits();
      map.on("resize", refitAfterResize);
    });

    map.fitBounds(bounds, {
      padding: fitPadding(map),
      maxZoom: 10,
      duration: 800,
    });

    return () => {
      popup.remove();
      overlays.forEach((overlay) => overlay.remove());
      routeBounds.current = null;

      // On unmount the map is already destroyed, along with its layers and sources.
      if (mapInstance.current !== map) return;

      map.off("resize", refitAfterResize);
      clearViewLimits(map);

      map.off("mouseenter", CHECKPOINT_LAYER, showCheckpointPopup);
      map.off("click", CHECKPOINT_LAYER, showCheckpointPopup);
      map.off("mouseleave", CHECKPOINT_LAYER, hideCheckpointPopup);

      map.removeLayer(CHECKPOINT_LAYER);
      map.removeSource(CHECKPOINT_SOURCE);

      routes.forEach((_, index) => {
        map.removeLayer(routeLayerId(index));
        map.removeSource(`route-${index}`);
      });

      map.removeLayer(HEATMAP_LAYER);
      map.removeSource(HEATMAP_SOURCE);
    };
  }, [routes, heatmap, recommendedRouteId, mapReady]);

  // The slider only swaps which precomputed hour the heatmap reads, with no new data or requests.
  useEffect(() => {
    const map = mapInstance.current;

    if (!map || !mapReady || !map.getLayer(HEATMAP_LAYER)) return;

    map.setPaintProperty(
      HEATMAP_LAYER,
      "heatmap-weight",
      heatWeightExpression(selectedHour)
    );
  }, [selectedHour, mapReady]);

  const selectedTime = new Date(departure).getTime() + selectedHour * 3600 * 1000;

  const selectedRoute = routes.find((route) => route.route_id === selectedRouteId);

  const truck = selectedRoute ? truckPositionAt(selectedRoute, selectedTime) : null;

  const truckLongitude = truck?.coordinates[0];
  const truckLatitude = truck?.coordinates[1];

  // Show where the truck on the selected route would be at the slider's hour.
  useEffect(() => {
    const map = mapInstance.current;

    if (
      !map ||
      !mapReady ||
      truckLongitude === undefined ||
      truckLatitude === undefined
    ) {
      return;
    }

    const truckCoordinates: [number, number] = [truckLongitude, truckLatitude];

    if (!truckMarker.current) {
      const element = document.createElement("div");
      element.className = "truck-marker";
      element.textContent = "🚚";

      truckMarker.current = new mapboxgl.Marker({ element })
        .setLngLat(truckCoordinates)
        .addTo(map);
    } else {
      truckMarker.current.setLngLat(truckCoordinates);
    }
  }, [truckLongitude, truckLatitude, mapReady]);

  // Playback ends by itself at the last hour.
  const isPlaying = playing && selectedHour < MAX_HOUR;

  // Step through the forecast hours while playing.
  useEffect(() => {
    if (!isPlaying) return;

    const timer = window.setInterval(() => {
      setSelectedHour((hour) => Math.min(hour + 1, MAX_HOUR));
    }, PLAY_MILLISECONDS_PER_HOUR);

    return () => window.clearInterval(timer);
  }, [isPlaying]);

  const togglePlaying = () => {
    if (!isPlaying && selectedHour === MAX_HOUR) setSelectedHour(0);

    setPlaying(!isPlaying);
  };

  // Apply the checkpoint risk filters.
  useEffect(() => {
    const map = mapInstance.current;

    if (!map || !mapReady || !map.getLayer(CHECKPOINT_LAYER)) return;

    map.setFilter(CHECKPOINT_LAYER, [
      "in",
      ["get", "risk"],
      ["literal", riskLevels.filter((risk) => visibleRisks[risk])],
    ]);
  }, [visibleRisks, routes, mapReady]);

  // Emphasize the selected route.
  useEffect(() => {
    const map = mapInstance.current;

    if (!map || !mapReady) return;

    routes.forEach((route, index) => {
      const layerId = routeLayerId(index);

      if (!map.getLayer(layerId)) return;

      const selected = route.route_id === selectedRouteId;

      map.setPaintProperty(layerId, "line-width", selected ? 6 : 3.5);
      map.setPaintProperty(layerId, "line-opacity", selected ? 0.95 : 0.55);

      if (selected) {
        map.moveLayer(layerId, CHECKPOINT_LAYER);
      }
    });
  }, [routes, selectedRouteId, mapReady]);

  return (
    <div className="route-map-wrapper">
      <section className="map-workspace">
        <div className="route-map-canvas">
          <div ref={mapContainer} className="route-map" />

          {!mapReady && !displayedMapError && (
            <div className="map-loading-message">Loading route map...</div>
          )}

          {displayedMapError && (
            <div className="map-loading-message">{displayedMapError}</div>
          )}

          <div className="map-actions">
            <button
              type="button"
              onClick={resetMapView}
              disabled={!mapReady || !routes.length}
              title="Zoom out to show all routes"
            >
              Reset Map View
            </button>

            <button
              type="button"
              onClick={() => downloadCheckpointCsv(routes)}
              disabled={!routes.length}
            >
              Export Data
            </button>
          </div>

          <aside className="map-filter-overlay">
            <div className="filter-panel-heading">
              <h3>Checkpoint Risk</h3>
              <p>Show or hide risk levels</p>
            </div>

            <div className="checkpoint-filter-list">
              {riskLevels.map((risk) => (
                <label className="checkpoint-filter-option" key={risk}>
                  <input
                    type="checkbox"
                    checked={visibleRisks[risk]}
                    onChange={() =>
                      setVisibleRisks((current) => ({
                        ...current,
                        [risk]: !current[risk],
                      }))
                    }
                  />

                  <span
                    className="legend-dot"
                    style={{ backgroundColor: riskColors[risk] }}
                  />

                  <span className="filter-risk-name">{risk}</span>

                  <strong>{riskCounts[risk]}</strong>
                </label>
              ))}
            </div>

            <div className="heatmap-scale">
              <strong>Heatmap</strong>
              <span className="heatmap-scale-bar" />
              <span className="heatmap-scale-labels">
                <span>Low</span>
                <span>No Travel</span>
              </span>
            </div>
          </aside>

          <section className="forecast-timeline">
            <div className="forecast-timeline-heading">
              <div>
                <button
                  type="button"
                  className="play-button"
                  onClick={togglePlaying}
                  disabled={!heatmap}
                >
                  {isPlaying ? "❚❚ Pause" : "▶ Play"}
                </button>

                <strong className="selected-hour">
                  Hour {String(selectedHour).padStart(2, "0")} / {MAX_HOUR}
                </strong>
                <span>
                  {heatmap
                    ? formatDateTime(selectedTime)
                    : "Corridor forecast is unavailable. Route results are not affected."}
                </span>
              </div>

              <div className="forecast-timeline-actions">
                <button
                  type="button"
                  className="reset-slider"
                  onClick={() => {
                    setPlaying(false);
                    setSelectedHour(0);
                  }}
                  disabled={selectedHour === 0}
                >
                  Reset to Departure
                </button>
              </div>
            </div>

            <div className="slider-track">
              <input
                type="range"
                min="0"
                max={MAX_HOUR}
                step="1"
                value={selectedHour}
                disabled={!heatmap}
                onChange={(event) => {
                  setPlaying(false);
                  setSelectedHour(Number(event.target.value));
                }}
                aria-label="Select forecast hour"
              />

              {selectedRoute && selectedRoute.duration_hours <= MAX_HOUR && (
                <span
                  className="arrival-marker"
                  title={`${selectedRoute.route_name} arrives at hour ${selectedRoute.duration_hours.toFixed(1)}`}
                  style={{
                    // The slider thumb's center travels 16px less than the track's width.
                    left: `calc(${(selectedRoute.duration_hours / MAX_HOUR) * 100}% + ${
                      8 - (selectedRoute.duration_hours / MAX_HOUR) * 16
                    }px)`,
                  }}
                >
                  <span aria-hidden="true">🏁</span>
                </span>
              )}
            </div>

            <div className="slider-labels">
              <span>Departure</span>
              <span>
                {truck && selectedRoute
                  ? `🚚 ${selectedRoute.route_name}: ${
                      truck.arrived
                        ? `arrived at hour ${selectedRoute.duration_hours.toFixed(1)}`
                        : `mile ${truck.miles.toFixed(0)} of ${selectedRoute.distance_miles.toFixed(0)}, arrives at hour ${selectedRoute.duration_hours.toFixed(1)}`
                    }. `
                  : ""}
                Heatmap: weather at this hour. Checkpoints: risk on arrival.
              </span>
              <span>48 h</span>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

export default RouteMap;
