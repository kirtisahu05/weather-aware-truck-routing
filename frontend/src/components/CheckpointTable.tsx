import type { Route } from "../types";
import { formatShortDateTime } from "../utils/risk";
import RiskBadge from "./RiskBadge";

interface CheckpointTableProps {
  route: Route;
}

function CheckpointTable({ route }: CheckpointTableProps) {
  return (
    <section className="checkpoint-table-section">
      <h4>Checkpoints ({route.checkpoints.length})</h4>
      <p>Forecast for the hour the truck reaches each checkpoint.</p>

      <div className="checkpoint-table-scroll">
        <table className="checkpoint-table">
          <thead>
            <tr>
              <th scope="col">Mile</th>
              <th scope="col">ETA</th>
              <th scope="col">Risk</th>
              <th scope="col">Wind<br />mph</th>
              <th scope="col">Rain<br />in/hr</th>
              <th scope="col">Snow<br />in/hr</th>
            </tr>
          </thead>

          <tbody>
            {route.checkpoints.map((checkpoint) => (
              <tr key={checkpoint.checkpoint_id}>
                <td>{checkpoint.distance_miles.toFixed(0)}</td>
                <td>{formatShortDateTime(checkpoint.estimated_arrival)}</td>
                <td><RiskBadge level={checkpoint.risk.overall_risk} /></td>
                <td>{checkpoint.weather.wind_mph.toFixed(1)}</td>
                <td>{checkpoint.weather.rain_inches_per_hour.toFixed(2)}</td>
                <td>{checkpoint.weather.snow_inches_per_hour.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default CheckpointTable;
