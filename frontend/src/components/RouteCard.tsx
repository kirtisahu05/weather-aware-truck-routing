import type { Route } from "../types";
import { formatDateTime, routeColors } from "../utils/risk";
import CheckpointTable from "./CheckpointTable";
import RiskBar from "./RiskBar";

interface RouteCardProps {
  route: Route;
  index: number;
  departure: string;
  recommended: boolean;
  selected: boolean;
  expanded: boolean;
  onToggleDetails: (routeId: string) => void;
}

function RouteCard({
  route,
  index,
  departure,
  recommended,
  selected,
  expanded,
  onToggleDetails,
}: RouteCardProps) {
  const summary = route.risk_summary;

  const arrival =
    new Date(departure).getTime() + route.duration_hours * 3600 * 1000;

  const classNames = [
    "route-card",
    recommended ? "recommended" : "",
    selected ? "selected" : "",
  ].join(" ");

  return (
    <article
      className={classNames}
      aria-label={`${route.route_name}${recommended ? ", recommended" : ""}`}
    >
      <div className="route-card-header">
        <div>
          <span className="route-card-eyebrow">
            <span
              className="route-color-swatch"
              style={{ backgroundColor: routeColors[index % routeColors.length] }}
            />
            ROUTE OPTION
          </span>
          <h3>{route.route_name}</h3>
          {route.via && <p className="route-card-via">via {route.via}</p>}
        </div>

        {recommended && (
          <span className="safest-route-label">
            <span aria-hidden="true">★</span> Recommended
          </span>
        )}
      </div>

      {summary.no_travel_miles > 0 && (
        <p className="route-card-warning">
          Not recommended: No Travel conditions on this route.
        </p>
      )}

      <div className="route-card-stats">
        <div className="route-stat">
          <span className="route-stat-label">Distance</span>
          <strong>{route.distance_miles.toFixed(1)} mi</strong>
        </div>

        <div className="route-stat">
          <span className="route-stat-label">Travel time</span>
          <strong>{route.duration_hours.toFixed(1)} hrs</strong>
        </div>

        <div className="route-stat">
          <span className="route-stat-label">Arrival</span>
          <strong>{formatDateTime(arrival)}</strong>
        </div>
      </div>

      <div className="route-card-risk-heading">
        <h4>Risk Breakdown</h4>
        <span>At arrival times</span>
      </div>

      <RiskBar summary={summary} />

      <div className="route-card-footer">
        <div>
          <span className="route-stat-label">Average risk score</span>
          <strong>{summary.average_risk_score.toFixed(2)} / 4</strong>
        </div>

        <button
          type="button"
          className="route-select-button"
          aria-expanded={expanded}
          onClick={() => onToggleDetails(route.route_id)}
        >
          {expanded ? "Hide details" : "View details"}
        </button>
      </div>

      {expanded && <CheckpointTable route={route} />}
    </article>
  );
}

export default RouteCard;
