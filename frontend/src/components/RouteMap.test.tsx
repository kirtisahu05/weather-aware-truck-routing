import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import RouteMap from "./RouteMap";
import { chooseLabelPositions } from "../utils/routeLabels";
import type { CorridorHeatmap, RiskLevel, Route } from "../types";

const mocks = vi.hoisted(() => {
  const layers = new Set<string>();
  const handlers: Record<string, (...args: never[]) => void> = {};
  const state = { removed: false };
  const popups: Array<{ setDOMContent: { mock: { calls: HTMLElement[][] } } }> = [];
  const markerElements: HTMLElement[] = [];

  const map = {
    addControl: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn((layer: { id: string }) => {
      layers.add(layer.id);
    }),
    getLayer: vi.fn((id: string) => layers.has(id)),
    // Like the real map, these throw once the map has been destroyed.
    removeLayer: vi.fn((id: string) => {
      if (state.removed) throw new Error("map already removed");
      layers.delete(id);
    }),
    removeSource: vi.fn(() => {
      if (state.removed) throw new Error("map already removed");
    }),
    setPaintProperty: vi.fn(),
    setFilter: vi.fn(),
    moveLayer: vi.fn(),
    fitBounds: vi.fn(),
    getZoom: vi.fn(() => 6),
    unproject: vi.fn(([x]: [number, number]) =>
      x === 0 ? { lng: -100, lat: 50 } : { lng: 0, lat: 0 }
    ),
    setMinZoom: vi.fn(),
    setMaxBounds: vi.fn(),
    once: vi.fn((event: string, handler: () => void) => {
      handlers[`once:${event}`] = handler;
    }),
    loaded: vi.fn(() => true),
    getContainer: vi.fn(() => ({ clientWidth: 1200, clientHeight: 800 })),
    getCanvas: vi.fn(() => ({ style: {} })),
    queryRenderedFeatures: vi.fn(() => []),
    remove: vi.fn(() => {
      state.removed = true;
    }),
    off: vi.fn(),
    on: vi.fn((event: string, ...rest: unknown[]) => {
      if (rest.length === 1) {
        handlers[event] = rest[0] as () => void;
      } else {
        handlers[`${event}:${rest[0]}`] = rest[1] as () => void;
      }
    }),
  };

  const bounds = { extend: vi.fn(), isEmpty: vi.fn(() => false) };

  return { map, bounds, layers, handlers, state, popups, markerElements };
});

vi.mock("mapbox-gl", () => {
  const chainable = () => {
    const instance = {
      setLngLat: vi.fn(() => instance),
      setDOMContent: vi.fn(() => instance),
      addTo: vi.fn(() => instance),
      remove: vi.fn(),
    };

    return instance;
  };

  return {
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
        const popup = chainable();
        mocks.popups.push(popup);
        return popup;
      }),
      Marker: vi.fn(function (options?: { element?: HTMLElement }) {
        if (options?.element) mocks.markerElements.push(options.element);
        return chainable();
      }),
    },
  };
});

function makeCheckpoint(id: number, risk: RiskLevel) {
  return {
    checkpoint_id: id,
    distance_miles: id * 25,
    longitude: -90 + id,
    latitude: 40,
    estimated_arrival: "2026-11-02T09:00:00+00:00",
    route_id: "route_1",
    weather: {
      forecast_time: "2026-11-02T09:00:00+00:00",
      wind_mph: 10,
      rain_inches_per_hour: 0,
      snow_inches_per_hour: 0,
    },
    risk: {
      wind_risk: risk,
      rain_risk: "Low" as const,
      snow_risk: "Low" as const,
      overall_risk: risk,
      load_weight: 25000,
      no_travel: risk === "No Travel",
    },
  };
}

const route: Route = {
  route_id: "route_1",
  route_name: "Route 1",
  via: "I 80",
  distance_miles: 100,
  duration_hours: 2,
  geometry: {
    type: "LineString",
    coordinates: [
      [-90, 40],
      [-88, 40],
    ],
  },
  checkpoints: [makeCheckpoint(1, "Low"), makeCheckpoint(2, "Severe")],
  risk_summary: {
    total_miles: 100,
    low_miles: 50,
    moderate_miles: 0,
    high_miles: 0,
    severe_miles: 50,
    no_travel_miles: 0,
    average_risk_score: 1.5,
  },
};

const heatmap: CorridorHeatmap = {
  spacing_miles: 10,
  hours: 3,
  points: [{ longitude: -89, latitude: 40, risks: [0, 3, -1] }],
};

function renderMap(heatmapData: CorridorHeatmap | null = heatmap) {
  const onSelectRoute = vi.fn();

  const view = render(
    <RouteMap
      routes={[route]}
      heatmap={heatmapData}
      departure="2026-11-02T08:00:00+00:00"
      recommendedRouteId="route_1"
      selectedRouteId="route_1"
      onSelectRoute={onSelectRoute}
    />
  );

  return { ...view, onSelectRoute };
}

function finishLoadingMap() {
  act(() => (mocks.handlers.load as () => void)());
}

function lastPopupText() {
  const calls = mocks.popups[mocks.popups.length - 1].setDOMContent.mock.calls;

  return calls[calls.length - 1][0].textContent;
}

function fireMapEvent(name: string, event: unknown) {
  act(() => (mocks.handlers[name] as (event: unknown) => void)(event));
}

function sourceData(id: string) {
  const call = mocks.map.addSource.mock.calls.find(
    ([sourceId]) => sourceId === id
  ) as unknown as [
    string,
    { data: { features: Array<{ properties: Record<string, unknown> }> } },
  ];

  return call[1].data;
}

describe("RouteMap", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_MAPBOX_TOKEN", "test-token");
    mocks.layers.clear();
    mocks.state.removed = false;
    mocks.popups.length = 0;
    mocks.markerElements.length = 0;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("explains when the Mapbox token is missing", () => {
    vi.stubEnv("VITE_MAPBOX_TOKEN", "");

    renderMap();

    expect(screen.getByText(/Mapbox token is missing/)).toBeInTheDocument();
  });

  it("draws the heatmap, route, and checkpoints in order once loaded", () => {
    renderMap();
    finishLoadingMap();

    const layerIds = mocks.map.addLayer.mock.calls.map(([layer]) => layer.id);

    expect(layerIds).toEqual([
      "corridor-heatmap-layer",
      "route-line-0",
      "checkpoints-layer",
    ]);

    expect(mocks.map.fitBounds).toHaveBeenCalledOnce();
  });

  it("limits zoom and panning to the search result after fitting the routes", () => {
    renderMap();
    finishLoadingMap();

    expect(mocks.map.setMinZoom).not.toHaveBeenCalled();

    act(() => (mocks.handlers["once:moveend"] as () => void)());

    expect(mocks.map.setMinZoom).toHaveBeenCalledWith(5.75);
    expect(mocks.map.setMaxBounds).toHaveBeenCalledWith([
      [-112, -6],
      [12, 56],
    ]);
  });

  it("colors checkpoints by the risk at their arrival time", () => {
    renderMap();
    finishLoadingMap();

    const risks = sourceData("checkpoints").features.map(
      (feature) => feature.properties.risk
    );

    expect(risks).toEqual(["Low", "Severe"]);
  });

  it("precomputes a heat weight per hour, with no heat where there is no forecast", () => {
    renderMap();
    finishLoadingMap();

    const properties = sourceData("corridor-heatmap").features[0].properties;

    expect(properties).toEqual({ h0: 0.12, h1: 0.85, h2: 0 });
  });

  it("moves the slider by switching the heat property, not by redrawing data", () => {
    renderMap();
    finishLoadingMap();

    mocks.map.addSource.mockClear();

    fireEvent.change(screen.getByLabelText("Select forecast hour"), {
      target: { value: "1" },
    });

    expect(screen.getByText("Hour 01 / 48")).toBeInTheDocument();

    expect(mocks.map.setPaintProperty).toHaveBeenCalledWith(
      "corridor-heatmap-layer",
      "heatmap-weight",
      ["get", "h1"]
    );

    expect(mocks.map.addSource).not.toHaveBeenCalled();
  });

  it("resets the slider to departure", () => {
    renderMap();

    fireEvent.change(screen.getByLabelText("Select forecast hour"), {
      target: { value: "12" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset to Departure" }));

    expect(screen.getByText("Hour 00 / 48")).toBeInTheDocument();
  });

  it("plays through the hours, and pauses when the slider is moved", () => {
    vi.useFakeTimers();

    renderMap();

    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(screen.getByText("Hour 02 / 48")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Select forecast hour"), {
      target: { value: "10" },
    });

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(screen.getByText("Hour 10 / 48")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Play/ })).toBeInTheDocument();

    vi.useRealTimers();
  });

  it("stops playing at the last hour", () => {
    vi.useFakeTimers();

    renderMap();

    fireEvent.change(screen.getByLabelText("Select forecast hour"), {
      target: { value: "47" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByText("Hour 48 / 48")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Play/ })).toBeInTheDocument();

    vi.useRealTimers();
  });

  it("reports where the truck is at the selected hour", () => {
    renderMap();

    expect(
      screen.getByText(/🚚 Route 1: mile 25 of 100, arrives at hour 2.0/)
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Select forecast hour"), {
      target: { value: "5" },
    });

    expect(screen.getByText(/🚚 Route 1: arrived at hour 2.0/)).toBeInTheDocument();
  });

  it("marks the selected route's arrival on the timeline", () => {
    renderMap();

    expect(screen.getByTitle("Route 1 arrives at hour 2.0")).toHaveStyle({
      left: "calc(4.166666666666666% + 7.333333333333333px)",
    });
  });

  it("has no arrival marker when the trip outlasts the timeline", () => {
    render(
      <RouteMap
        routes={[{ ...route, duration_hours: 60 }]}
        heatmap={heatmap}
        departure="2026-11-02T08:00:00+00:00"
        recommendedRouteId="route_1"
        selectedRouteId="route_1"
        onSelectRoute={vi.fn()}
      />
    );

    expect(screen.queryByTitle(/arrives at hour/)).not.toBeInTheDocument();
  });

  it("disables the slider when the corridor forecast failed", () => {
    renderMap(null);

    expect(screen.getByLabelText("Select forecast hour")).toBeDisabled();
    expect(screen.getByText(/Corridor forecast is unavailable/)).toBeInTheDocument();
  });

  it("filters checkpoints by risk level and shows their counts", () => {
    renderMap();
    finishLoadingMap();

    const severe = screen.getByRole("checkbox", { name: /Severe/ });

    expect(severe.closest("label")).toHaveTextContent("1");

    fireEvent.click(severe);

    expect(mocks.map.setFilter).toHaveBeenLastCalledWith("checkpoints-layer", [
      "in",
      ["get", "risk"],
      ["literal", ["Low", "Moderate", "High", "No Travel"]],
    ]);
  });

  it("emphasizes the selected route", () => {
    renderMap();
    finishLoadingMap();

    expect(mocks.map.setPaintProperty).toHaveBeenCalledWith(
      "route-line-0",
      "line-width",
      6
    );
  });

  it("unmounts cleanly after drawing, as happens when a new search starts", () => {
    const { unmount } = renderMap();
    finishLoadingMap();

    expect(() => unmount()).not.toThrow();

    expect(mocks.map.remove).toHaveBeenCalled();
  });

  it("places route labels on the stretch that routes do not share", () => {
    const line = (latitudeAtMiddle: number): Route => ({
      ...route,
      geometry: {
        type: "LineString",
        coordinates: [
          [-90, 40],
          [-89, latitudeAtMiddle],
          [-88, 40],
        ],
      },
    });

    const [first, second] = chooseLabelPositions([line(41), line(39)]);

    expect(first).toEqual([-89, 41]);
    expect(second).toEqual([-89, 39]);
  });

  it("shows risk, ETA, and weather in the checkpoint popup", () => {
    renderMap();
    finishLoadingMap();

    fireMapEvent("mouseenter:checkpoints-layer", {
      lngLat: { lng: -88, lat: 40 },
      features: [{ properties: { routeIndex: 0, checkpointIndex: 1 } }],
    });

    const text = lastPopupText();

    expect(text).toContain("Route 1, mile 50");
    expect(text).toContain("Risk: Severe");
    expect(text).toContain("ETA:");
    expect(text).toContain("Wind: 10.0 mph (Severe)");
    expect(text).toContain("Rain: 0.00 in/hr (Low)");
    expect(text).toContain("Snow: 0.00 in/hr (Low)");
  });

  it("selects the route and shows its summary when the line is clicked", () => {
    const { onSelectRoute } = renderMap();
    finishLoadingMap();

    fireMapEvent("click:route-line-0", {
      point: { x: 1, y: 1 },
      lngLat: { lng: -89, lat: 40 },
    });

    expect(onSelectRoute).toHaveBeenCalledWith("route_1");

    const text = lastPopupText();

    expect(text).toContain("Route 1 (recommended)");
    expect(text).toContain("Distance: 100.0 mi");
    expect(text).toContain("Travel time: 2.0 hrs");
    expect(text).toContain("Severe: 50.0 mi");
    expect(text).toContain("Average risk: 1.50 / 4");
  });

  it("leaves a click on a checkpoint to the checkpoint popup", () => {
    const { onSelectRoute } = renderMap();
    finishLoadingMap();

    mocks.map.queryRenderedFeatures.mockReturnValueOnce([{}] as never[]);

    fireMapEvent("click:route-line-0", {
      point: { x: 1, y: 1 },
      lngLat: { lng: -89, lat: 40 },
    });

    expect(onSelectRoute).not.toHaveBeenCalled();
  });

  it("selects the route and shows its summary when the label is clicked", () => {
    const { onSelectRoute } = renderMap();
    finishLoadingMap();

    const label = mocks.markerElements.find((element) =>
      element.classList.contains("route-map-label")
    )!;

    expect(label.textContent).toBe("★ Route 1 · 2.0 h");

    fireEvent.click(label);

    expect(onSelectRoute).toHaveBeenCalledWith("route_1");
    expect(lastPopupText()).toContain("Severe: 50.0 mi");
  });

  it("refits and recalculates the limits when the window is resized", () => {
    renderMap();
    finishLoadingMap();

    act(() => (mocks.handlers["once:moveend"] as () => void)());

    mocks.map.fitBounds.mockClear();
    mocks.map.setMaxBounds.mockClear();

    act(() => (mocks.handlers.resize as () => void)());

    expect(mocks.map.fitBounds).toHaveBeenCalledOnce();
    expect(mocks.map.setMaxBounds).toHaveBeenCalledTimes(2);
    expect(mocks.map.setMaxBounds).toHaveBeenLastCalledWith([
      [-112, -6],
      [12, 56],
    ]);
  });

  it("returns to the fitted view with Reset Map View", () => {
    renderMap();
    finishLoadingMap();

    mocks.map.fitBounds.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Reset Map View" }));

    expect(mocks.map.fitBounds).toHaveBeenCalledOnce();
  });

  it("exports every checkpoint as a CSV file", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:test");

    vi.stubGlobal("URL", Object.assign(URL, {
      createObjectURL,
      revokeObjectURL: vi.fn(),
    }));

    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    renderMap();

    fireEvent.click(screen.getByRole("button", { name: "Export Data" }));

    expect(click).toHaveBeenCalledOnce();

    const csv = await createObjectURL.mock.calls[0][0].text();

    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).toContain('"Route 1","50"');
    expect(csv).toContain('"Severe"');

    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it("explains a map that fails to load, but ignores errors after it has loaded", () => {
    renderMap();

    mocks.map.loaded.mockReturnValueOnce(true);
    act(() => (mocks.handlers.error as () => void)());

    expect(screen.queryByText(/Unable to load the map/)).not.toBeInTheDocument();

    mocks.map.loaded.mockReturnValueOnce(false);
    act(() => (mocks.handlers.error as () => void)());

    expect(screen.getByText(/Unable to load the map/)).toBeInTheDocument();
  });

  it("removes old layers when the routes change on a live map", () => {
    const { rerender } = renderMap();
    finishLoadingMap();

    rerender(
      <RouteMap
        routes={[{ ...route }]}
        heatmap={heatmap}
        departure="2026-11-02T08:00:00+00:00"
        recommendedRouteId="route_1"
        selectedRouteId="route_1"
        onSelectRoute={vi.fn()}
      />
    );

    expect(mocks.map.removeLayer).toHaveBeenCalledWith("corridor-heatmap-layer");
    expect(mocks.layers.has("corridor-heatmap-layer")).toBe(true);
  });
});
