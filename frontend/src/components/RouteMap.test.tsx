
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import RouteMap from "./RouteMap";
import type {
  Route,
  RouteCheckpoint,
  HourlyForecast,
  RiskLevel,
} from "../types";

const mocks = vi.hoisted(() => {
  const map = {
    addControl: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getSource: vi.fn(() => undefined),
    getLayer: vi.fn(() => undefined),
    isStyleLoaded: vi.fn(() => true),
    fitBounds: vi.fn(),
    setMaxBounds: vi.fn(),
    setMinZoom: vi.fn(),
    getZoom: vi.fn(() => 7),
    moveLayer: vi.fn(),
    removeLayer: vi.fn(),
    removeSource: vi.fn(),
    remove: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
  };

  const bounds = {
    extend: vi.fn(function () {
      return bounds;
    }),
    isEmpty: vi.fn(() => false),
    getSouth: vi.fn(() => 20),
    getNorth: vi.fn(() => 25),
    getWest: vi.fn(() => 75),
    getEast: vi.fn(() => 80),
  };

  const markers: Array<{ remove: ReturnType<typeof vi.fn> }> = [];
  const popups: Array<{
    setDOMContent: ReturnType<typeof vi.fn>;
    addTo: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  }> = [];

  const eventHandlers: Record<string, (...args: unknown[]) => void> = {};

  return { map, bounds, markers, popups, eventHandlers };
});

vi.mock("mapbox-gl", () => ({
  default: {
    accessToken: "",
    Map: vi.fn(function () {
      return mocks.map;
    }),
    NavigationControl: vi.fn(function () {
      return {};
    }),
    LngLatBounds: vi.fn(function () {
      return mocks.bounds;
    }),
    Popup: vi.fn(function () {
      const popup = {
        setDOMContent: vi.fn(function () {
          return popup;
        }),
        addTo: vi.fn(function () {
          return popup;
        }),
        remove: vi.fn(),
      };

      mocks.popups.push(popup);
      return popup;
    }),
    Marker: vi.fn(function () {
      const marker = {
        remove: vi.fn(),
        setLngLat: vi.fn(function () {
          return marker;
        }),
        setPopup: vi.fn(function () {
          return marker;
        }),
        addTo: vi.fn(function () {
          return marker;
        }),
      };

      mocks.markers.push(marker);
      return marker;
    }),
  },
}));

const makeForecast = (
  hourOffset: number,
  risk: RiskLevel = "Low"
): HourlyForecast => ({
  hour_offset: hourOffset,
  forecast_time: `2026-11-01T${String(hourOffset % 24).padStart(2, "0")}:00:00Z`,
  wind_mph: 12,
  rain_inches_per_hour: 0,
  snow_inches_per_hour: 0,
  risk: {
    wind_risk: risk,
    rain_risk: "Low",
    snow_risk: "Low",
    overall_risk: risk,
    load_weight: 20000,
    no_travel: risk === "No Travel",
  },
});

const makeCheckpoint = (
  id: number,
  longitude: number,
  latitude: number,
  forecasts: HourlyForecast[] = [
    makeForecast(0, "Low"),
    makeForecast(12, "High"),
  ]
): RouteCheckpoint => ({
  checkpoint_id: id,
  distance_miles: id * 10,
  longitude,
  latitude,
  estimated_arrival: "2026-11-01T12:00:00Z",
  route_id: "route-1",
  weather: {
    forecast_time: "2026-11-01T12:00:00Z",
    wind_mph: 12,
    rain_inches_per_hour: 0,
    snow_inches_per_hour: 0,
  },
  risk: {
    wind_risk: "Low",
    rain_risk: "Low",
    snow_risk: "Low",
    overall_risk: "Low",
    load_weight: 20000,
    no_travel: false,
  },
  hourly_forecast: forecasts,
});

const createRoute = (
  checkpoints = [
    makeCheckpoint(1, 77.4, 23.2),
    makeCheckpoint(2, 78.1, 23.8),
  ]
): Route => ({
  route_id: "route-1",
  route_name: "Route 1",
  distance_miles: 100,
  duration_hours: 2,
  duration_seconds: 7200,
  geometry: {
    type: "LineString",
    coordinates: [
      [77.4, 23.2],
      [78.1, 23.8],
    ],
  },
  checkpoints,
  risk_summary: {
    total_miles: 100,
    low_miles: 100,
    moderate_miles: 0,
    high_miles: 0,
    severe_miles: 0,
    no_travel_miles: 0,
    average_risk_score: 0,
  },
});

const renderRouteMap = (
  routes: Route[] = [createRoute()],
  selectedHour = 0,
  onSelectedHourChange = vi.fn()
) =>
  render(
    <RouteMap
      routes={routes}
      selectedHour={selectedHour}
      onSelectedHourChange={onSelectedHourChange}
    />
  );

const triggerMapLoad = () => {
  act(() => {
    const handler = mocks.eventHandlers.load;
    handler?.();
  });
};

describe("RouteMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.markers.length = 0;
    mocks.popups.length = 0;

    Object.keys(mocks.eventHandlers).forEach((key) => {
      delete mocks.eventHandlers[key];
    });

    mocks.map.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      mocks.eventHandlers[event] = handler;
      return mocks.map;
    });

    mocks.map.once.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      mocks.eventHandlers[event] = handler;
      return mocks.map;
    });

    mocks.map.getSource.mockReturnValue(undefined);
    mocks.map.getLayer.mockReturnValue(undefined);
    mocks.map.isStyleLoaded.mockReturnValue(true);

    vi.stubEnv("VITE_MAPBOX_TOKEN", "test-mapbox-token");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("renders the map and forecast controls", () => {
    renderRouteMap();

    expect(screen.getByRole("heading", { name: "Route Map" })).toBeInTheDocument();
    expect(
      screen.getByText("Weather Forecast Timeline")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("slider", { name: "Select forecast hour" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export Data" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Checkpoint Filters" })
    ).toBeInTheDocument();
  });

  it("initializes the Mapbox map", () => {
    renderRouteMap();

    expect(mocks.map.addControl).toHaveBeenCalled();
    expect(mocks.map.on).toHaveBeenCalledWith(
      "load",
      expect.any(Function)
    );
    expect(mocks.map.on).toHaveBeenCalledWith(
      "error",
      expect.any(Function)
    );
  });

  it("draws route lines after the map loads", async () => {
    renderRouteMap();

    triggerMapLoad();

    await waitFor(() => {
      expect(mocks.map.addSource).toHaveBeenCalledWith(
        "route-0",
        expect.objectContaining({
          type: "geojson",
        })
      );
    });

    expect(mocks.map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "route-line-0",
        type: "line",
      })
    );

    expect(mocks.map.fitBounds).toHaveBeenCalled();
    expect(mocks.map.setMaxBounds).toHaveBeenCalled();
  });

  it("creates checkpoint markers and popup content after map load", async () => {
    renderRouteMap();

    triggerMapLoad();

    await waitFor(() => {
      expect(mocks.markers).toHaveLength(2);
    });

    expect(mocks.popups).toHaveLength(2);
    expect(mocks.markers[0].remove).not.toHaveBeenCalled();
  });

  it("passes the selected forecast hour to the parent callback", () => {
    const onSelectedHourChange = vi.fn();

    renderRouteMap([createRoute()], 0, onSelectedHourChange);

    fireEvent.change(
      screen.getByRole("slider", { name: "Select forecast hour" }),
      { target: { value: "12" } }
    );

    expect(onSelectedHourChange).toHaveBeenCalledWith(12);
  });

  it("displays the selected forecast hour", () => {
    renderRouteMap([createRoute()], 12);

    expect(screen.getByText("Hour 12 / 48")).toBeInTheDocument();
  });

  it("resets the forecast slider to departure", () => {
    const onSelectedHourChange = vi.fn();

    renderRouteMap([createRoute()], 12, onSelectedHourChange);

    fireEvent.click(
      screen.getByRole("button", { name: "Reset to Departure" })
    );

    expect(onSelectedHourChange).toHaveBeenCalledWith(0);
  });

  it("shows unavailable when a checkpoint has no hourly forecast", () => {
    const route = createRoute([
      makeCheckpoint(1, 77.4, 23.2, []),
    ]);

    renderRouteMap([route]);

    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
  });

  it("shows the correct risk counts for the selected hour", () => {
    renderRouteMap([createRoute()], 12);

    const highFilter = screen.getByRole("checkbox", { name: /High/ });

    expect(highFilter).toBeInTheDocument();

    const highFilterLabel = highFilter.closest("label");

    expect(highFilterLabel).toHaveTextContent("High");
    expect(highFilterLabel).toHaveTextContent("2");

    expect(
      screen.getByText(
        "Heatmap intensity represents checkpoint risk intensity."
      )
    ).toBeInTheDocument();
  });

  it("toggles a risk filter", () => {
    renderRouteMap();

    const lowFilter = screen.getByLabelText("Low2") as HTMLInputElement;

    expect(lowFilter.checked).toBe(true);

    fireEvent.click(lowFilter);

    expect(lowFilter.checked).toBe(false);
  });

  it("removes the map and markers when unmounted", async () => {
    const { unmount } = renderRouteMap();

    triggerMapLoad();

    await waitFor(() => {
      expect(mocks.markers).toHaveLength(2);
    });

    unmount();

    expect(mocks.markers[0].remove).toHaveBeenCalled();
    expect(mocks.markers[1].remove).toHaveBeenCalled();
    expect(mocks.map.remove).toHaveBeenCalled();
  });
});
