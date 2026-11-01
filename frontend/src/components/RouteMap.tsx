
import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";

import type { Route, RiskLevel, HourlyForecast } from "../types";
import "mapbox-gl/dist/mapbox-gl.css";

interface RouteMapProps {
  routes: Route[];
  selectedHour: number;
  onSelectedHourChange: (hour: number) => void;
}

type RiskFilter = RiskLevel | "Unavailable";

const routeColors = ["#2563eb", "#16a34a", "#ea580c"];

const riskColors: Record<RiskLevel, string> = {
  Low: "#16a34a",
  Moderate: "#eab308",
  High: "#f97316",
  Severe: "#dc2626",
  "No Travel": "#7f1d1d",
};

const unavailableColor = "#64748b";

const riskOrder: RiskFilter[] = [
  "Low",
  "Moderate",
  "High",
  "Severe",
  "No Travel",
  "Unavailable",
];

const HEATMAP_SOURCE = "checkpoint-risk-heatmap";
const HEATMAP_LAYER = "checkpoint-risk-heatmap-layer";

const ROUTE_BOUNDS_PADDING = 150000; // 150 km
const INITIAL_MIN_ZOOM = 2;
const MAX_ZOOM = 13;

function getForecast(
  checkpoint: Route["checkpoints"][number],
  selectedHour: number
): HourlyForecast | undefined {
  return checkpoint.hourly_forecast?.find(
    (forecast) => forecast.hour_offset === selectedHour
  );
}

function getCheckpointRisk(
  checkpoint: Route["checkpoints"][number],
  selectedHour: number
): RiskFilter {
  const risk = getForecast(checkpoint, selectedHour)?.risk?.overall_risk;

  if (risk && risk in riskColors) {
    return risk as RiskLevel;
  }

  return "Unavailable";
}

function getRiskWeight(risk: RiskLevel): number {
  const weights: Record<RiskLevel, number> = {
    Low: 0.15,
    Moderate: 0.35,
    High: 0.6,
    Severe: 0.85,
    "No Travel": 1,
  };

  return weights[risk];
}

function getRiskColor(risk: RiskFilter): string {
  return risk === "Unavailable"
    ? unavailableColor
    : riskColors[risk];
}

/**
 * Creates a new bounds object with a geographic margin around the routes.
 * This avoids using bounds.clone(), which is not available on Mapbox bounds.
 */
function createPaddedBounds(
  bounds: mapboxgl.LngLatBounds
): mapboxgl.LngLatBounds {
  const centerLatitude = (bounds.getSouth() + bounds.getNorth()) / 2;

  const latitudePadding =
    ROUTE_BOUNDS_PADDING / 111320;

  const longitudePadding =
    ROUTE_BOUNDS_PADDING /
    (111320 * Math.max(Math.cos((centerLatitude * Math.PI) / 180), 0.15));

  const west = Math.max(-180, bounds.getWest() - longitudePadding);
  const east = Math.min(180, bounds.getEast() + longitudePadding);
  const south = Math.max(-85, bounds.getSouth() - latitudePadding);
  const north = Math.min(85, bounds.getNorth() + latitudePadding);

  return new mapboxgl.LngLatBounds(
    [west, south],
    [east, north]
  );
}

function createPopupContent(
  checkpoint: Route["checkpoints"][number],
  selectedHour: number,
  routeName: string
): HTMLDivElement {
  const container = document.createElement("div");

  container.style.minWidth = "230px";
  container.style.fontFamily = "Arial, sans-serif";
  container.style.color = "#1f2937";

  const title = document.createElement("h3");
  title.textContent = `Checkpoint ${checkpoint.checkpoint_id}`;
  title.style.margin = "0 0 8px";
  container.appendChild(title);

  const routeLabel = document.createElement("p");
  routeLabel.textContent = routeName;
  routeLabel.style.margin = "0 0 8px";
  routeLabel.style.fontWeight = "600";
  container.appendChild(routeLabel);

  const addRow = (label: string, value: string) => {
    const row = document.createElement("p");
    row.style.margin = "5px 0";
    row.textContent = `${label}: ${value}`;
    container.appendChild(row);
  };

  const forecast = getForecast(checkpoint, selectedHour);
  const risk = forecast?.risk?.overall_risk;

  const riskLabel = document.createElement("p");
  riskLabel.style.fontWeight = "bold";
  riskLabel.style.margin = "8px 0";

  if (risk && risk in riskColors) {
    riskLabel.textContent = `Risk at Hour ${selectedHour}: ${risk}`;
    riskLabel.style.color = riskColors[risk as RiskLevel];
  } else {
    riskLabel.textContent =
      `Risk at Hour ${selectedHour}: Forecast unavailable`;
    riskLabel.style.color = unavailableColor;
  }

  container.appendChild(riskLabel);

  addRow("Distance", `${checkpoint.distance_miles.toFixed(2)} miles`);

  addRow(
    "Estimated arrival",
    checkpoint.estimated_arrival
      ? new Date(checkpoint.estimated_arrival).toLocaleString()
      : "Unavailable"
  );

  addRow("Forecast hour", `${selectedHour} hours after departure`);

  if (forecast) {
    addRow(
      "Forecast time",
      forecast.forecast_time
        ? new Date(forecast.forecast_time).toLocaleString()
        : "Unavailable"
    );

    addRow("Wind", `${forecast.wind_mph} mph`);
    addRow("Rain", `${forecast.rain_inches_per_hour} in/hr`);
    addRow("Snow", `${forecast.snow_inches_per_hour} in/hr`);

    if (forecast.risk) {
      addRow("Wind risk", forecast.risk.wind_risk);
      addRow("Rain risk", forecast.risk.rain_risk);
      addRow("Snow risk", forecast.risk.snow_risk);

      addRow(
        "Load restriction",
        forecast.risk.no_travel ? "No Travel" : "No restriction"
      );
    }
  } else {
    addRow("Weather", "No hourly forecast available");
  }

  return container;
}

function RouteMap({
  routes,
  selectedHour,
  onSelectedHourChange,
}: RouteMapProps) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);
  const routeBounds = useRef<mapboxgl.LngLatBounds | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");

  const mapToken = import.meta.env.VITE_MAPBOX_TOKEN;

  const displayedMapError = !mapToken
    ? "Mapbox token is missing. Check your frontend .env file."
    : mapError;

  const [visibleRisks, setVisibleRisks] = useState<
    Record<RiskFilter, boolean>
  >({
    Low: true,
    Moderate: true,
    High: true,
    Severe: true,
    "No Travel": true,
    Unavailable: true,
  });

  const riskSummary = useMemo(() => {
    const summary: Record<RiskFilter, number> = {
      Low: 0,
      Moderate: 0,
      High: 0,
      Severe: 0,
      "No Travel": 0,
      Unavailable: 0,
    };

    routes.forEach((route) => {
      route.checkpoints.forEach((checkpoint) => {
        const risk = getCheckpointRisk(checkpoint, selectedHour);
        summary[risk]++;
      });
    });

    return summary;
  }, [routes, selectedHour]);

  const toggleRisk = (risk: RiskFilter) => {
    setVisibleRisks((current) => ({
      ...current,
      [risk]: !current[risk],
    }));
  };

  // Fit the map to all available routes.
  const resetMapView = () => {
    const map = mapInstance.current;
    const bounds = routeBounds.current;

    if (!map || !bounds || bounds.isEmpty()) {
      return;
    }

    map.fitBounds(bounds, {
      padding: {
        top: 90,
        bottom: 90,
        left: 300,
        right: 90,
      },
      maxZoom: 10,
      duration: 800,
    });
  };

  const exportCheckpointData = () => {
    const rows: string[][] = [
      [
        "Route",
        "Checkpoint",
        "Distance (miles)",
        "Estimated Arrival",
        "Forecast Hour",
        "Risk",
        "Wind (mph)",
        "Rain (in/hr)",
        "Snow (in/hr)",
      ],
    ];

    routes.forEach((route) => {
      route.checkpoints.forEach((checkpoint) => {
        const forecast = getForecast(checkpoint, selectedHour);

        rows.push([
          route.route_name,
          String(checkpoint.checkpoint_id),
          String(checkpoint.distance_miles),
          checkpoint.estimated_arrival ?? "",
          String(selectedHour),
          getCheckpointRisk(checkpoint, selectedHour),
          String(forecast?.wind_mph ?? ""),
          String(forecast?.rain_inches_per_hour ?? ""),
          String(forecast?.snow_inches_per_hour ?? ""),
        ]);
      });
    });

    const csv = rows
      .map((row) =>
        row
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `route-checkpoints-hour-${selectedHour}.csv`;
    link.click();

    URL.revokeObjectURL(url);
  };

  // Initialize Mapbox.
  useEffect(() => {
    if (!mapContainer.current || mapInstance.current) return;

    if (!mapToken) {
      return;
    }

    mapboxgl.accessToken = mapToken;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [-98.5795, 39.8283],
      zoom: INITIAL_MIN_ZOOM,
      minZoom: INITIAL_MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });

    // Keep navigation controls away from the reset button.
    map.addControl(
      new mapboxgl.NavigationControl(),
      "bottom-right"
    );

    mapInstance.current = map;

    const handleLoad = () => {
      setMapReady(true);
      setMapError("");
    };

    const handleError = () => {
      setMapError(
        "Unable to load the map. Check your Mapbox token and network connection."
      );
    };

    map.on("load", handleLoad);
    map.on("error", handleError);

    return () => {
      markers.current.forEach((marker) => marker.remove());
      markers.current = [];

      map.remove();
      mapInstance.current = null;
      routeBounds.current = null;
    };
  }, [mapToken]);

  // Draw routes, update the route bounds, and refit on every new search.
  useEffect(() => {
    const map = mapInstance.current;

    if (!map || !mapReady || !map.isStyleLoaded()) return;

    if (!routes.length) {
      routeBounds.current = null;
      // map.setMaxBounds();
      return;
    }

    const bounds = new mapboxgl.LngLatBounds();

    routes.forEach((route, index) => {
      const sourceId = `route-${index}`;
      const layerId = `route-line-${index}`;

      const feature = {
        type: "Feature" as const,
        properties: {},
        geometry: route.geometry,
      };

      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: "geojson",
          data: feature,
        });

        map.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": routeColors[index % routeColors.length],
            "line-width": 5,
            "line-opacity": 0.85,
          },
        });
      } else {
        const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource;
        source.setData(feature);
      }

      route.geometry.coordinates.forEach((coordinate) => {
        bounds.extend(coordinate as [number, number]);
      });

      route.checkpoints.forEach((checkpoint) => {
        bounds.extend([checkpoint.longitude, checkpoint.latitude]);
      });
    });

    // Remove route layers and sources left over from a previous search.
    for (let index = routes.length; index < 3; index++) {
      const layerId = `route-line-${index}`;
      const sourceId = `route-${index}`;

      if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
      }

      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }
    }

    if (!bounds.isEmpty()) {
      routeBounds.current = bounds;

      // Restrict map movement to the route corridor plus a 150 km margin.
      // Construct a new bounds object; Mapbox LngLatBounds has no clone().
      const restrictedBounds = createPaddedBounds(bounds);

      map.setMaxBounds(restrictedBounds);

      // Refit whenever a new route search returns.
      map.fitBounds(bounds, {
        padding: {
          top: 90,
          bottom: 90,
          left: 300,
          right: 90,
        },
        maxZoom: 10,
        duration: 800,
      });

      // Once fitted, prevent zooming out too far from the route.
      const updateMinimumZoom = () => {
        const fittedZoom = map.getZoom();
        map.setMinZoom(Math.max(1, fittedZoom - 1.5));
      };

      map.once("moveend", updateMinimumZoom);
    }
  }, [routes, mapReady]);

  // Update heatmap when forecast hour or risk filters change.
  useEffect(() => {
    const map = mapInstance.current;

    if (!map || !mapReady || !map.isStyleLoaded()) return;

    const features = routes.flatMap((route) =>
      route.checkpoints.flatMap((checkpoint) => {
        const risk = getCheckpointRisk(checkpoint, selectedHour);

        if (risk === "Unavailable" || !visibleRisks[risk]) {
          return [];
        }

        const forecast = getForecast(checkpoint, selectedHour);

        if (!forecast?.risk?.overall_risk) return [];

        return [
          {
            type: "Feature" as const,
            properties: {
              risk,
              weight: getRiskWeight(risk),
              route_id: route.route_id,
            },
            geometry: {
              type: "Point" as const,
              coordinates: [
                checkpoint.longitude,
                checkpoint.latitude,
              ],
            },
          },
        ];
      })
    );

    const geojson = {
      type: "FeatureCollection" as const,
      features,
    };

    if (!map.getSource(HEATMAP_SOURCE)) {
      map.addSource(HEATMAP_SOURCE, {
        type: "geojson",
        data: geojson,
      });

      map.addLayer({
        id: HEATMAP_LAYER,
        type: "heatmap",
        source: HEATMAP_SOURCE,
        maxzoom: 16,
        paint: {
          "heatmap-weight": [
            "interpolate",
            ["linear"],
            ["get", "weight"],
            0, 0.2,
            1, 1,
          ],
          "heatmap-intensity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0, 1,
            9, 2,
            12, 3,
            16, 4,
          ],
          "heatmap-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0, 20,
            9, 35,
            12, 50,
            16, 65,
          ],
          "heatmap-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5, 0.75,
            12, 0.85,
            16, 0.9,
          ],
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0, "rgba(0,0,255,0)",
            0.1, "#16a34a",
            0.3, "#eab308",
            0.5, "#f97316",
            0.7, "#dc2626",
            1, "#7f1d1d",
          ],
        },
      });

      // Keep the heatmap above the base map and below route lines.
      if (map.getLayer("route-line-0")) {
        map.moveLayer(HEATMAP_LAYER, "route-line-0");
      }
    } else {
      const source = map.getSource(
        HEATMAP_SOURCE
      ) as mapboxgl.GeoJSONSource;

      source.setData(geojson);
    }
  }, [routes, selectedHour, visibleRisks, mapReady]);

  // Rebuild checkpoint markers for the selected hour and active filters.
  useEffect(() => {
    const map = mapInstance.current;

    if (!map || !mapReady) return;

    markers.current.forEach((marker) => marker.remove());
    markers.current = [];

    routes.forEach((route) => {
      route.checkpoints.forEach((checkpoint) => {
        const risk = getCheckpointRisk(checkpoint, selectedHour);

        if (!visibleRisks[risk]) return;

        const markerElement = document.createElement("div");

        markerElement.style.width = "18px";
        markerElement.style.height = "18px";
        markerElement.style.borderRadius = "50%";
        markerElement.style.backgroundColor = getRiskColor(risk);
        markerElement.style.border = "2px solid white";
        markerElement.style.boxShadow = "0 2px 6px rgba(0,0,0,0.4)";
        markerElement.style.cursor = "pointer";

        markerElement.title =
          `${route.route_name}: ${risk} at hour ${selectedHour}`;

        const popup = new mapboxgl.Popup({
          offset: 15,
          closeButton: true,
          maxWidth: "300px",
        }).setDOMContent(
          createPopupContent(checkpoint, selectedHour, route.route_name)
        );

        markerElement.addEventListener("mouseenter", () => {
          popup.addTo(map);
        });

        markerElement.addEventListener("mouseleave", () => {
          popup.remove();
        });

        const marker = new mapboxgl.Marker({
          element: markerElement,
          anchor: "center",
        })
          .setLngLat([checkpoint.longitude, checkpoint.latitude])
          .setPopup(popup)
          .addTo(map);

        markers.current.push(marker);
      });
    });

    return () => {
      markers.current.forEach((marker) => marker.remove());
      markers.current = [];
    };
  }, [routes, selectedHour, visibleRisks, mapReady]);

  return (
    <div className="route-map-wrapper">
      <div className="route-map-toolbar">
        <div>
          <h2>Route Map</h2>
          <p>Weather-aware checkpoint and route visualization</p>
        </div>

        <button
          type="button"
          className="export-data-button"
          onClick={exportCheckpointData}
          disabled={!routes.length}
        >
          Export Data
        </button>
      </div>

      <section className="forecast-timeline">
        <div className="forecast-timeline-heading">
          <div>
            <strong>Weather Forecast Timeline</strong>
            <span>Explore weather conditions along your route</span>
          </div>

          <div className="forecast-timeline-actions">
            <strong className="selected-hour">
              Hour {String(selectedHour).padStart(2, "0")} / 48
            </strong>

            <button
              type="button"
              className="reset-slider"
              onClick={() => onSelectedHourChange(0)}
              disabled={selectedHour === 0}
            >
              Reset to Departure
            </button>
          </div>
        </div>

        <input
          type="range"
          min="0"
          max="48"
          step="1"
          value={selectedHour}
          onChange={(event) =>
            onSelectedHourChange(Number(event.target.value))
          }
          aria-label="Select forecast hour"
        />

        <div className="slider-labels">
          <span>Departure (0h)</span>
          <span>24 hours</span>
          <span>48 hours</span>
        </div>
      </section>

      <section className="map-workspace">
        <div className="route-map-canvas">
          <div
            ref={mapContainer}
            className="route-map"
          />

          {!mapReady && !displayedMapError && (
            <div className="map-loading-message">
              Loading route map...
            </div>
          )}

          {displayedMapError && (
            <div className="map-loading-message">
              {displayedMapError}
            </div>
          )}

          <button
            type="button"
            className="reset-map-view-button"
            onClick={resetMapView}
            disabled={!mapReady || !routes.length}
            title="Zoom out to show all routes"
          >
            Reset Map View
          </button>

          <aside className="map-filter-overlay">
            <div className="filter-panel-heading">
              <div>
                <h3>Checkpoint Filters</h3>
                <p>Show or hide risk categories</p>
              </div>
            </div>

            <div className="checkpoint-filter-list">
              {riskOrder.map((risk) => (
                <label
                  className="checkpoint-filter-option"
                  key={risk}
                >
                  <input
                    type="checkbox"
                    checked={visibleRisks[risk]}
                    onChange={() => toggleRisk(risk)}
                  />

                  <span
                    className="legend-dot"
                    style={{
                      backgroundColor: getRiskColor(risk),
                    }}
                  />

                  <span className="filter-risk-name">
                    {risk}
                  </span>

                  <strong>{riskSummary[risk]}</strong>
                </label>
              ))}
            </div>
          </aside>

          <div className="map-legend">
            <strong>Map Legend</strong>

            {riskOrder.map((risk) => (
              <div className="legend-item" key={risk}>
                <span
                  className="legend-dot"
                  style={{
                    backgroundColor: getRiskColor(risk),
                  }}
                />
                {risk}
              </div>
            ))}

            <p className="heatmap-legend-note">
              Heatmap intensity represents checkpoint risk intensity.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

export default RouteMap;
