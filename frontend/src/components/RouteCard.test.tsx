import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import RouteCard from "./RouteCard";
import type { Route, RiskSummary } from "../types";

const summary: RiskSummary = {
  total_miles: 100,
  low_miles: 80,
  moderate_miles: 0,
  high_miles: 15,
  severe_miles: 5,
  no_travel_miles: 0,
  average_risk_score: 0.45,
};

const route: Route = {
  route_id: "route_1",
  route_name: "Route 1",
  via: "I 80",
  distance_miles: 100,
  duration_hours: 2,
  geometry: { type: "LineString", coordinates: [] },
  checkpoints: [],
  risk_summary: summary,
};

function renderCard(overrides: Partial<Route> = {}, expanded = false) {
  const onToggleDetails = vi.fn();

  render(
    <RouteCard
      route={{ ...route, ...overrides }}
      index={0}
      departure="2026-11-02T08:00:00+00:00"
      recommended={false}
      selected={false}
      expanded={expanded}
      onToggleDetails={onToggleDetails}
    />
  );

  return onToggleDetails;
}

describe("RouteCard", () => {
  afterEach(cleanup);

  it("shows the route summary", () => {
    renderCard();

    expect(screen.getByText("via I 80")).toBeInTheDocument();
    expect(screen.getByText("100.0 mi")).toBeInTheDocument();
    expect(screen.getByText("2.0 hrs")).toBeInTheDocument();
    expect(screen.getByText("0.45 / 4")).toBeInTheDocument();
  });

  it("lists only the risk levels this route has", () => {
    renderCard();

    expect(screen.getByText("80 mi")).toBeInTheDocument();
    expect(screen.getByText("15 mi")).toBeInTheDocument();
    expect(screen.getByText("5 mi")).toBeInTheDocument();

    expect(screen.queryByText(/Moderate/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No Travel/)).not.toBeInTheDocument();

    expect(
      screen.getByRole("img", {
        name: "Low: 80 miles, High: 15 miles, Severe: 5 miles",
      })
    ).toBeInTheDocument();
  });

  it("warns about a route with No Travel conditions", () => {
    renderCard({ risk_summary: { ...summary, no_travel_miles: 10 } });

    expect(screen.getByText(/Not recommended: No Travel/)).toBeInTheDocument();
  });

  it("asks to toggle its own details", () => {
    const onToggleDetails = renderCard();

    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View details" }));

    expect(onToggleDetails).toHaveBeenCalledWith("route_1");
  });

  it("shows checkpoints with their ETA and risk when expanded", () => {
    renderCard(
      {
        checkpoints: [
          {
            checkpoint_id: 1,
            distance_miles: 25,
            longitude: -89,
            latitude: 40,
            estimated_arrival: "2026-11-02T09:00:00+00:00",
            route_id: "route_1",
            weather: {
              forecast_time: "2026-11-02T09:00:00+00:00",
              wind_mph: 47.25,
              rain_inches_per_hour: 0.3,
              snow_inches_per_hour: 0,
            },
            risk: {
              wind_risk: "Severe",
              rain_risk: "High",
              snow_risk: "Low",
              overall_risk: "Severe",
              load_weight: 25000,
              no_travel: false,
            },
          },
        ],
      },
      true
    );

    expect(screen.getByText("Checkpoints (1)")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("Severe")).toHaveClass("risk-badge");
    expect(screen.getByText("47.3")).toBeInTheDocument();
    expect(screen.getByText("0.30")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide details" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });
});
