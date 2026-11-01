
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { generateTripAnalysis } from "./services/api";
import type {
  CheckpointRisk,
  HourlyForecast,
  Route,
  RouteCheckpoint,
  TripAnalysisResponse,
  TripRequest,
} from "./types";

vi.mock("./services/api", () => ({
  generateTripAnalysis: vi.fn(),
}));

vi.mock("./components/TripForm", () => ({
  default: ({
    onSubmit,
    loading,
  }: {
    onSubmit: (data: TripRequest) => void;
    loading: boolean;
  }) => (
    <div data-testid="trip-form">
      <button
        type="button"
        onClick={() =>
          onSubmit({
            origin: "Bhopal",
            destination: "Indore",
            departure_datetime: "2026-11-02T09:00:00.000Z",
            load_weight: 20000,
            checkpoint_interval: 25,
          })
        }
      >
        Generate Routes
      </button>
      {loading && <span>Form loading</span>}
    </div>
  ),
}));

vi.mock("./components/RouteCard", () => ({
  default: ({
    route,
    safest,
    summary,
    selectedHour,
  }: {
    route: Route;
    safest: boolean;
    summary: { average_risk_score: number };
    selectedHour: number;
  }) => (
    <article data-testid="route-card">
      <h3>{route.route_name}</h3>
      {safest && <span>Safest Route</span>}
      <span>Hour {selectedHour}</span>
      <span>{summary.average_risk_score}</span>
    </article>
  ),
}));

vi.mock("./components/RouteMap", () => ({
  default: ({
    selectedHour,
    onSelectedHourChange,
  }: {
    selectedHour: number;
    onSelectedHourChange: (hour: number) => void;
  }) => (
    <div data-testid="route-map">
      <span>Map hour: {selectedHour}</span>
      <button onClick={() => onSelectedHourChange(12)}>
        Select Hour 12
      </button>
    </div>
  ),
}));

const createRisk = (level: CheckpointRisk["overall_risk"]): CheckpointRisk => ({
  wind_risk: level,
  rain_risk: level,
  snow_risk: level,
  overall_risk: level,
  load_weight: 20000,
  no_travel: level === "No Travel",
});

const createCheckpoint = (
  routeId: string,
  id: string,
  distance: number,
  riskLevel: CheckpointRisk["overall_risk"],
): RouteCheckpoint => {
  const risk = createRisk(riskLevel);

  const forecast: HourlyForecast[] = [
    {
      forecast_time: "2026-11-02T09:00:00Z",
      wind_mph: 10,
      rain_inches_per_hour: 0,
      snow_inches_per_hour: 0,
      hour_offset: 0,
      risk,
    },
    {
      forecast_time: "2026-11-02T21:00:00Z",
      wind_mph: 10,
      rain_inches_per_hour: 0,
      snow_inches_per_hour: 0,
      hour_offset: 12,
      risk,
    },
  ];

  return {
    checkpoint_id: id,
    distance_miles: distance,
    longitude: 77.4126 + distance * 0.01,
    latitude: 23.2599,
    estimated_arrival: "2026-11-02T09:00:00Z",
    route_id: routeId,
    weather: {
      forecast_time: "2026-11-02T09:00:00Z",
      wind_mph: 10,
      rain_inches_per_hour: 0,
      snow_inches_per_hour: 0,
    },
    risk,
    hourly_forecast: forecast,
  };
};

const createRoute = (
  id: string,
  name: string,
  distance: number,
  duration: number,
  riskLevel: CheckpointRisk["overall_risk"],
): Route => ({
  route_id: id,
  route_name: name,
  distance_miles: distance,
  duration_hours: duration,
  duration_seconds: duration * 3600,
  geometry: {
    type: "LineString",
    coordinates: [
      [77.4126, 23.2599],
      [77.5, 23.3],
      [77.6, 23.4],
    ],
  },
  checkpoints: [
    createCheckpoint(id, `${id}-1`, 0, riskLevel),
    createCheckpoint(id, `${id}-2`, distance / 2, riskLevel),
    createCheckpoint(id, `${id}-3`, distance, riskLevel),
  ],
  risk_summary: {
    total_miles: distance,
    low_miles: riskLevel === "Low" ? distance : 0,
    moderate_miles: riskLevel === "Moderate" ? distance : 0,
    high_miles: riskLevel === "High" ? distance : 0,
    severe_miles: riskLevel === "Severe" ? distance : 0,
    no_travel_miles: riskLevel === "No Travel" ? distance : 0,
    average_risk_score: riskLevel === "Low" ? 0 : 2,
  },
});

const mockAnalysis: TripAnalysisResponse = {
  status: "success",
  message: "Routes generated successfully",
  trip: {
    origin: "Bhopal",
    destination: "Indore",
    departure_datetime: "2026-11-02T09:00:00.000Z",
    load_weight: 20000,
    checkpoint_interval: 25,
  },
  routes: [
    createRoute("route-1", "Route One", 100, 2, "Low"),
    createRoute("route-2", "Route Two", 110, 2.2, "High"),
  ],
  recommendation: {
    recommended_route_id: "route-2",
    message: "Route Two was recommended by the backend.",
  },
};

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the trip form", () => {
    render(<App />);

    expect(screen.getByTestId("trip-form")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Generate Routes" }),
    ).toBeInTheDocument();
  });

  it("does not show route cards before a trip is submitted", () => {
    render(<App />);

    expect(screen.queryByTestId("route-card")).not.toBeInTheDocument();
  });

  it("calls the route analysis API when the form is submitted", async () => {
    vi.mocked(generateTripAnalysis).mockResolvedValue(mockAnalysis);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Generate Routes" }));

    await waitFor(() => {
      expect(generateTripAnalysis).toHaveBeenCalledTimes(1);
    });

    expect(generateTripAnalysis).toHaveBeenCalledWith(mockAnalysis.trip);
  });

  it("displays all routes returned by the API", async () => {
    vi.mocked(generateTripAnalysis).mockResolvedValue(mockAnalysis);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Generate Routes" }));

    expect(await screen.findByText("Route One")).toBeInTheDocument();
    expect(screen.getByText("Route Two")).toBeInTheDocument();
    expect(screen.getAllByTestId("route-card")).toHaveLength(2);
  });

  it("highlights the dynamically safest route", async () => {
    vi.mocked(generateTripAnalysis).mockResolvedValue(mockAnalysis);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Generate Routes" }));

    await screen.findByText("Route One");

    const routeCards = screen.getAllByTestId("route-card");

    expect(routeCards[0]).toHaveTextContent("Route One");
    expect(routeCards[0]).toHaveTextContent("Safest Route");
    expect(routeCards[1]).not.toHaveTextContent("Safest Route");
  });

  it("does not display the old separate recommendation banner", async () => {
    vi.mocked(generateTripAnalysis).mockResolvedValue(mockAnalysis);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Generate Routes" }));

    await screen.findByText("Route One");

    expect(
      screen.queryByText("Original Route Recommendation"),
    ).not.toBeInTheDocument();

    expect(
      screen.queryByText("Route Two was recommended by the backend."),
    ).not.toBeInTheDocument();
  });

  it("updates the selected forecast hour when the map slider changes", async () => {
    vi.mocked(generateTripAnalysis).mockResolvedValue(mockAnalysis);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Generate Routes" }));

    await screen.findByText("Route One");

    fireEvent.click(screen.getByRole("button", { name: "Select Hour 12" }));

    expect(screen.getByText("Map hour: 12")).toBeInTheDocument();

    const routeCards = screen.getAllByTestId("route-card");

    expect(routeCards[0]).toHaveTextContent("Hour 12");
  });

  it("displays an error when the backend request fails", async () => {
    vi.mocked(generateTripAnalysis).mockRejectedValue({
      response: {
        data: {
          error: "Unable to generate route analysis.",
        },
      },
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Generate Routes" }));

    expect(
      await screen.findByText("Unable to generate route analysis."),
    ).toBeInTheDocument();
  });

  it("displays a generic error when the backend is unreachable", async () => {
  vi.mocked(generateTripAnalysis).mockRejectedValue(
    new Error("Network Error"),
  );

  render(<App />);

  fireEvent.click(
    screen.getByRole("button", { name: "Generate Routes" }),
  );

  expect(
    await screen.findByText("Unable to connect to the backend."),
  ).toBeInTheDocument();
});
});
