import type { Route } from "../types";
import RiskBadge from "./RiskBadge";

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

interface RouteCardProps {
  route: Route;
  safest: boolean;
  summary: DynamicRiskSummary;
  selectedHour: number;
}

function RouteCard({
  route,
  safest,
  summary,
  selectedHour,
}: RouteCardProps) {
  return (
    <article
      className={`route-card ${safest ? "recommended" : ""}`}
      aria-label={`${route.route_name}${safest ? ", safest route" : ""}`}
    >
      <div className="route-card-header">
        <div>
          <span className="route-card-eyebrow">ROUTE OPTION</span>
          <h3>{route.route_name}</h3>
        </div>

        {safest && (
          <span className="safest-route-label">
            <span aria-hidden="true">★</span> Safest Route
          </span>
        )}
      </div>

      <div className="route-card-stats">
        <div className="route-stat">
          <span className="route-stat-label">Distance</span>
          <strong>{route.distance_miles.toFixed(1)} mi</strong>
        </div>

        <div className="route-stat">
          <span className="route-stat-label">Travel time</span>
          <strong>{route.duration_hours.toFixed(1)} hrs</strong>
        </div>
      </div>

      <div className="route-card-risk-heading">
        <h4>Risk Breakdown</h4>
        <span>Hour {selectedHour}</span>
      </div>

      <div className="risk-summary">
        <div className="risk-summary-row">
          <span><RiskBadge level="Low" /></span>
          <strong>{summary.low_miles.toFixed(1)} mi</strong>
        </div>

        <div className="risk-summary-row">
          <span><RiskBadge level="Moderate" /></span>
          <strong>{summary.moderate_miles.toFixed(1)} mi</strong>
        </div>

        <div className="risk-summary-row">
          <span><RiskBadge level="High" /></span>
          <strong>{summary.high_miles.toFixed(1)} mi</strong>
        </div>

        <div className="risk-summary-row">
          <span><RiskBadge level="Severe" /></span>
          <strong>{summary.severe_miles.toFixed(1)} mi</strong>
        </div>

        <div className="risk-summary-row">
          <span><RiskBadge level="No Travel" /></span>
          <strong>{summary.no_travel_miles.toFixed(1)} mi</strong>
        </div>
      </div>

      <div className="route-card-footer">
        <div>
          <span className="route-stat-label">Average risk score</span>
          <strong>{summary.average_risk_score.toFixed(2)} / 4</strong>
        </div>

        {summary.unavailable_miles > 0 && (
          <div className="forecast-unavailable">
            <span className="route-stat-label">Forecast unavailable</span>
            <strong>{summary.unavailable_miles.toFixed(1)} mi</strong>
          </div>
        )}
      </div>

      {summary.unavailable_checkpoints > 0 && (
        <p className="route-card-note">
          Weather forecast unavailable at{" "}
          {summary.unavailable_checkpoints} checkpoint
          {summary.unavailable_checkpoints === 1 ? "" : "s"}.
        </p>
      )}
    </article>
  );
}

export default RouteCard;