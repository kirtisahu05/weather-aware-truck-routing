import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import App from "./App";
import { generateTripAnalysis } from "./services/api";
import type { Route, TripAnalysisResponse } from "./types";

vi.mock("./services/api", () => ({
  generateTripAnalysis: vi.fn(),
}));

vi.mock("./components/RouteMap", () => ({
  default: ({
    recommendedRouteId,
    selectedRouteId,
  }: {
    recommendedRouteId: string | null;
    selectedRouteId: string | null;
  }) => (
    <div data-testid="route-map">
      {recommendedRouteId}/{selectedRouteId}
    </div>
  ),
}));

function makeRoute(id: string, name: string, severeMiles: number): Route {
  const risk = {
    wind_risk: "Low" as const,
    rain_risk: "Low" as const,
    snow_risk: "Low" as const,
    overall_risk: "Low" as const,
    load_weight: 25000,
    no_travel: false,
  };

  return {
    route_id: id,
    route_name: name,
    via: "I 80",
    distance_miles: 100,
    duration_hours: 2,
    geometry: {
      type: "LineString",
      coordinates: [
        [-90, 40],
        [-89, 40],
      ],
    },
    checkpoints: [
      {
        checkpoint_id: 1,
        distance_miles: 50,
        longitude: -89.5,
        latitude: 40,
        estimated_arrival: "2026-11-02T09:00:00+00:00",
        route_id: id,
        weather: {
          forecast_time: "2026-11-02T09:00:00+00:00",
          wind_mph: 12.34,
          rain_inches_per_hour: 0,
          snow_inches_per_hour: 0,
        },
        risk,
      },
    ],
    risk_summary: {
      total_miles: 100,
      low_miles: 100 - severeMiles,
      moderate_miles: 0,
      high_miles: 0,
      severe_miles: severeMiles,
      no_travel_miles: 0,
      average_risk_score: 0,
    },
  };
}

const analysis: TripAnalysisResponse = {
  status: "success",
  message: "ok",
  trip: {
    origin: "A",
    destination: "B",
    departure_datetime: "2026-11-02T08:00:00+00:00",
    load_weight: 25000,
    checkpoint_interval: 25,
  },
  routes: [makeRoute("route_1", "Route 1", 10), makeRoute("route_2", "Route 2", 0)],
  recommendation: {
    recommended_route_id: "route_2",
    message: "Route 2 is recommended: 0 Severe miles versus 10 on Route 1.",
  },
  corridor_heatmap: null,
};

function submitForm() {
  fireEvent.change(screen.getByLabelText("Origin"), {
    target: { value: "Chicago" },
  });
  fireEvent.change(screen.getByLabelText("Destination"), {
    target: { value: "Denver" },
  });
  fireEvent.change(screen.getByLabelText("Truck Load Weight (lbs)"), {
    target: { value: "25000" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Find Safest Routes" }));
}

describe("App", () => {
  beforeEach(() => {
    vi.mocked(generateTripAnalysis).mockResolvedValue(analysis);
  });

  afterEach(cleanup);

  it("shows no results before a trip is submitted", () => {
    render(<App />);

    expect(screen.getByText("Plan Your Journey")).toBeInTheDocument();
    expect(screen.queryByText("Available Routes")).not.toBeInTheDocument();
  });

  it("shows one loader, in the button, and locks the form until the search finishes", async () => {
    let finish: (result: TripAnalysisResponse) => void = () => {};

    vi.mocked(generateTripAnalysis).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );

    const { container } = render(<App />);
    submitForm();

    expect(container.querySelectorAll(".spinner")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Analyzing Routes..." })
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Origin")).toBeDisabled();

    await act(async () => finish(analysis));

    expect(container.querySelectorAll(".spinner")).toHaveLength(0);
    expect(screen.getByLabelText("Origin")).toBeEnabled();
  });

  it("shows the recommendation decided by the backend", async () => {
    render(<App />);
    submitForm();

    expect(
      await screen.findByText(
        "Route 2 is recommended: 0 Severe miles versus 10 on Route 1."
      )
    ).toBeInTheDocument();

    const card = screen.getByRole("article", { name: "Route 2, recommended" });

    expect(within(card).getByText("Recommended")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Route 1" })).toBeInTheDocument();
  });

  it("starts with the recommended route selected and every card collapsed", async () => {
    render(<App />);
    submitForm();

    await screen.findByText("Available Routes");

    expect(screen.getByTestId("route-map")).toHaveTextContent("route_2/route_2");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows checkpoints inside the card whose details were opened", async () => {
    render(<App />);
    submitForm();

    const card = await screen.findByRole("article", { name: "Route 1" });

    fireEvent.click(within(card).getByRole("button", { name: "View details" }));

    expect(within(card).getByRole("table")).toBeInTheDocument();
    expect(within(card).getByText("12.3")).toBeInTheDocument();
    expect(screen.getByTestId("route-map")).toHaveTextContent("route_2/route_1");
  });

  it("opens one card at a time and can close it again", async () => {
    render(<App />);
    submitForm();

    const first = await screen.findByRole("article", { name: "Route 1" });
    const second = screen.getByRole("article", { name: "Route 2, recommended" });

    fireEvent.click(within(first).getByRole("button", { name: "View details" }));
    fireEvent.click(within(second).getByRole("button", { name: "View details" }));

    expect(within(first).queryByRole("table")).not.toBeInTheDocument();
    expect(within(second).getByRole("table")).toBeInTheDocument();

    fireEvent.click(within(second).getByRole("button", { name: "Hide details" }));

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("returns to the form with its values from New search", async () => {
    render(<App />);
    submitForm();

    const newSearch = await screen.findByRole("button", { name: /New search/ });

    expect(screen.getByLabelText("Origin").closest("[hidden]")).not.toBeNull();

    fireEvent.click(newSearch);

    expect(screen.getByLabelText("Origin").closest("[hidden]")).toBeNull();
    expect(screen.getByLabelText("Origin")).toHaveValue("Chicago");
    expect(screen.queryByText("Available Routes")).not.toBeInTheDocument();
    expect(screen.queryByTestId("route-map")).not.toBeInTheDocument();
  });

  it("expands the form in place from Edit and collapses it again", async () => {
    render(<App />);
    submitForm();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(screen.getByLabelText("Origin").closest("[hidden]")).toBeNull();
    expect(screen.getByLabelText("Origin")).toHaveValue("Chicago");
    expect(screen.getByText("Available Routes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));

    expect(screen.getByLabelText("Origin").closest("[hidden]")).not.toBeNull();
  });

  it("warns when no route is safe", async () => {
    vi.mocked(generateTripAnalysis).mockResolvedValue({
      ...analysis,
      recommendation: {
        recommended_route_id: null,
        message: "No safe route is available.",
      },
    });

    render(<App />);
    submitForm();

    expect(await screen.findByText("No safe route")).toBeInTheDocument();
    expect(screen.queryByText("Recommended")).not.toBeInTheDocument();
  });

  it("displays the error message from the backend", async () => {
    vi.mocked(generateTripAnalysis).mockRejectedValue({
      response: { data: { message: "Could not find location: Nowhere" } },
    });

    render(<App />);
    submitForm();

    expect(
      await screen.findByText("Could not find location: Nowhere")
    ).toBeInTheDocument();
  });

  it("displays a generic error when the backend is unreachable", async () => {
    vi.mocked(generateTripAnalysis).mockRejectedValue(new Error("offline"));

    render(<App />);
    submitForm();

    await waitFor(() =>
      expect(
        screen.getByText("Unable to connect to the backend.")
      ).toBeInTheDocument()
    );
  });
});
