import { useState } from "react";

import RouteCard from "./components/RouteCard";
import RouteMap from "./components/RouteMap";
import TripForm from "./components/TripForm";
import TripSummary from "./components/TripSummary";

import { generateTripAnalysis } from "./services/api";

import type { TripRequest, TripAnalysisResponse } from "./types";

import "./App.css";

function App() {
  const [analysis, setAnalysis] =
    useState<TripAnalysisResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [editingTrip, setEditingTrip] = useState(false);
  const [expandedRouteId, setExpandedRouteId] = useState<string | null>(null);

  const handleTripSubmit = async (tripData: TripRequest) => {
    setLoading(true);
    setError("");
    setAnalysis(null);
    setExpandedRouteId(null);
    setEditingTrip(false);

    try {
      const result = await generateTripAnalysis(tripData);
      setAnalysis(result);
      setSelectedRouteId(
        result.recommendation.recommended_route_id ??
          result.routes[0]?.route_id ??
          null
      );
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

  const recommendedRouteId =
    analysis?.recommendation.recommended_route_id ?? null;

  // One card opens at a time, and opening it also highlights that route on the map.
  const toggleRouteDetails = (routeId: string) => {
    setExpandedRouteId((current) => (current === routeId ? null : routeId));
    setSelectedRouteId(routeId);
  };

  return (
    <div className={`app-container ${analysis ? "results-view" : ""}`}>
      <header className="app-header">
        <h1>Weather-Aware Truck Routing</h1>
        <p>Smarter routes. Safer deliveries.</p>
      </header>

      <main className={`dashboard ${analysis ? "has-results" : ""}`}>
        <div className="side-panel">
        {analysis && (
          <>
            <button
              type="button"
              className="new-search-button"
              onClick={() => setAnalysis(null)}
            >
              <span aria-hidden="true">←</span> New search
            </button>

            <TripSummary
              trip={analysis.trip}
              editing={editingTrip}
              onToggleEdit={() => setEditingTrip((current) => !current)}
            />
          </>
        )}

        {/* Stays mounted while collapsed so the entered values are kept. */}
        <div hidden={Boolean(analysis) && !editingTrip}>
          <TripForm
            onSubmit={handleTripSubmit}
            loading={loading}
          />
        </div>

        {error && (
          <div className="error-message" role="alert">{error}</div>
        )}

        {analysis && (
          <>
            <div
              className={`recommendation-banner ${recommendedRouteId ? "" : "unsafe"}`}
              role="status"
            >
              <strong>
                {recommendedRouteId ? "Recommendation" : "No safe route"}
              </strong>
              <span>{analysis.recommendation.message}</span>
            </div>

            <div className="route-comparison-heading">
              <div>
                <h2>Available Routes</h2>
                <p>
                  Ranked by Severe miles, then High miles, average risk,
                  and travel time, using the forecast at each checkpoint's
                  arrival time.
                </p>
              </div>
            </div>

            <div className="route-cards">
              {analysis.routes.map((route, index) => (
                <RouteCard
                  key={route.route_id}
                  route={route}
                  index={index}
                  departure={analysis.trip.departure_datetime}
                  recommended={route.route_id === recommendedRouteId}
                  selected={route.route_id === selectedRouteId}
                  expanded={route.route_id === expandedRouteId}
                  onToggleDetails={toggleRouteDetails}
                />
              ))}
            </div>

          </>
        )}
        </div>

        {analysis && (
          <div className="map-panel">
            <RouteMap
              routes={analysis.routes}
              heatmap={analysis.corridor_heatmap}
              departure={analysis.trip.departure_datetime}
              recommendedRouteId={recommendedRouteId}
              selectedRouteId={selectedRouteId}
              onSelectRoute={setSelectedRouteId}
            />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
