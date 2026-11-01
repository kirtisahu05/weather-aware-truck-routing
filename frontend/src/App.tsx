import { useState } from "react";

import TripForm from "./components/TripForm";
import RouteCard from "./components/RouteCard";
import RouteMap from "./components/RouteMap";

import { generateTripAnalysis } from "./services/api";

import type {
  TripRequest,
  TripAnalysisResponse,
  Route,
  RiskLevel,
  HourlyForecast,
} from "./types";

import "./App.css";

interface DynamicRiskSummary {
  low_miles: number;
  moderate_miles: number;
  high_miles: number;
  severe_miles: number;
  no_travel_miles: number;
  unavailable_miles: number;
  unavailable_checkpoints: number;
  average_risk_score: number;
}

const riskScores: Record<RiskLevel, number> = {
  Low: 0,
  Moderate: 1,
  High: 2,
  Severe: 3,
  "No Travel": 4,
};

function getForecast(
  checkpoint: Route["checkpoints"][number],
  selectedHour: number
): HourlyForecast | undefined {
  return checkpoint.hourly_forecast?.find(
    (forecast) => forecast.hour_offset === selectedHour
  );
}

function calculateDynamicSummary(
  route: Route,
  selectedHour: number
): DynamicRiskSummary {
  const summary: DynamicRiskSummary = {
    low_miles: 0,
    moderate_miles: 0,
    high_miles: 0,
    severe_miles: 0,
    no_travel_miles: 0,
    unavailable_miles: 0,
    unavailable_checkpoints: 0,
    average_risk_score: 0,
  };

  const checkpoints = [...route.checkpoints].sort(
    (a, b) => a.distance_miles - b.distance_miles
  );

  if (checkpoints.length === 0) {
    summary.unavailable_miles = route.distance_miles;
    return summary;
  }

  const lastDistance =
    checkpoints[checkpoints.length - 1].distance_miles;

  const scale =
    lastDistance > 0 ? route.distance_miles / lastDistance : 0;

  let totalRiskScore = 0;
  let scoredMiles = 0;

  const riskKey: Record<RiskLevel, keyof DynamicRiskSummary> = {
    Low: "low_miles",
    Moderate: "moderate_miles",
    High: "high_miles",
    Severe: "severe_miles",
    "No Travel": "no_travel_miles",
  };

  checkpoints.forEach((checkpoint, index) => {
    const forecast = getForecast(checkpoint, selectedHour);
    const risk = forecast?.risk?.overall_risk;

    if (!risk || !(risk in riskScores)) {
      summary.unavailable_checkpoints++;
    }

    if (index === 0) return;

    const previousDistance = checkpoints[index - 1].distance_miles;
    const segmentMiles =
      Math.max(0, checkpoint.distance_miles - previousDistance) *
      scale;

    if (!risk || !(risk in riskScores)) {
      summary.unavailable_miles += segmentMiles;
      return;
    }

    summary[riskKey[risk]] += segmentMiles;
    totalRiskScore += riskScores[risk] * segmentMiles;
    scoredMiles += segmentMiles;
  });

  summary.average_risk_score =
    scoredMiles > 0
      ? Number((totalRiskScore / scoredMiles).toFixed(2))
      : 0;

  return summary;
}

function App() {
  const [analysis, setAnalysis] =
    useState<TripAnalysisResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedHour, setSelectedHour] = useState(0);

  const handleTripSubmit = async (tripData: TripRequest) => {
    setLoading(true);
    setError("");
    setAnalysis(null);
    setSelectedHour(0);

    try {
      const result = await generateTripAnalysis(tripData);
      setAnalysis(result);
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        "response" in err
      ) {
        const apiError = err as {
          response?: {
            data?: {
              message?: string;
            };
          };
        };

        setError(
          apiError.response?.data?.message ||
            "Unable to generate route analysis."
        );
      } else {
        setError("Unable to connect to the backend.");
      }
    } finally {
      setLoading(false);
    }
  };

  const dynamicSummaries = analysis
    ? analysis.routes.map((route) => ({
        route,
        summary: calculateDynamicSummary(route, selectedHour),
      }))
    : [];

    const rankedRoutes = [...dynamicSummaries].sort((a, b) => {
    const x = a.summary;
    const y = b.summary;

    return (
      x.no_travel_miles - y.no_travel_miles ||
      x.severe_miles - y.severe_miles ||
      x.high_miles - y.high_miles ||
      x.unavailable_miles - y.unavailable_miles ||
      x.average_risk_score - y.average_risk_score ||
      a.route.duration_hours - b.route.duration_hours
    );
  });

  // const rankedRoutes = [...dynamicSummaries].sort((a, b) => {
  //   const x = a.summary;
  //   const y = b.summary;

  //   return (
  //     x.no_travel_miles - y.no_travel_miles ||
  //     x.severe_miles - y.severe_miles ||
  //     x.high_miles - y.high_miles ||
  //     x.average_risk_score - y.average_risk_score ||
  //     x.unavailable_miles - y.unavailable_miles ||
  //     a.route.duration_hours - b.route.duration_hours
  //   );
  // });

  const lowestRiskRoute = rankedRoutes[0];

  const hasUsableForecast =
    lowestRiskRoute &&
    lowestRiskRoute.summary.unavailable_miles <
      lowestRiskRoute.route.distance_miles;

  const safestRouteId = hasUsableForecast
    ? lowestRiskRoute.route.route_id
    : null;

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Truck Route Safety</h1>
        <p>Smarter routes. Safer deliveries.</p>
      </header>

      <main className="dashboard">
        <TripForm
          onSubmit={handleTripSubmit}
          loading={loading}
        />

        {error && (
          <div className="error-message">{error}</div>
        )}

        {loading && (
          <p className="loading-message">
            Calculating routes and weather conditions...
          </p>
        )}

        {analysis && (
          <section className="results-section">
            <div className="route-comparison-heading">
              <div>
                <h2>Available Routes</h2>
                <p>
                  Comparing {analysis.routes.length}{" "}
                  {analysis.routes.length === 1 ? "route" : "routes"}{" "}
                  using forecast conditions for Hour {selectedHour}.
                </p>
              </div>
            </div>

            {safestRouteId ? (
              <p className="safest-route-hint">
                The <strong>Safest Route</strong> tag identifies the
                lowest-risk available route for the selected forecast
                hour.
              </p>
            ) : (
              <p className="safest-route-hint">
                There is not enough forecast data to identify a
                safest route for this hour.
              </p>
            )}

            <div className="route-cards">
              {dynamicSummaries.map(({ route, summary }) => (
                <RouteCard
                  key={route.route_id}
                  route={route}
                  safest={route.route_id === safestRouteId}
                  summary={summary}
                  selectedHour={selectedHour}
                />
              ))}
            </div>

            <RouteMap
              routes={analysis.routes}
              selectedHour={selectedHour}
              onSelectedHourChange={setSelectedHour}
            />
          </section>
        )}
      </main>
    </div>
  );
}

export default App;