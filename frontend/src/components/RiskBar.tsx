import type { RiskLevel, RiskSummary } from "../types";
import { riskColors, riskLevels } from "../utils/risk";

interface RiskBarProps {
  summary: RiskSummary;
}

const milesKey: Record<RiskLevel, keyof RiskSummary> = {
  Low: "low_miles",
  Moderate: "moderate_miles",
  High: "high_miles",
  Severe: "severe_miles",
  "No Travel": "no_travel_miles",
};

function RiskBar({ summary }: RiskBarProps) {
  const segments = riskLevels
    .map((level) => ({ level, miles: summary[milesKey[level]] }))
    .filter((segment) => segment.miles > 0);

  return (
    <div className="risk-bar-group">
      <div
        className="risk-bar"
        role="img"
        aria-label={segments
          .map((segment) => `${segment.level}: ${segment.miles.toFixed(0)} miles`)
          .join(", ")}
      >
        {segments.map((segment) => (
          <span
            key={segment.level}
            style={{
              // Short stretches of bad weather must stay visible on a long route.
              flexGrow: segment.miles,
              minWidth: "6px",
              backgroundColor: riskColors[segment.level],
            }}
          />
        ))}
      </div>

      <ul className="risk-bar-legend">
        {segments.map((segment) => (
          <li key={segment.level}>
            <span
              className="legend-dot"
              style={{ backgroundColor: riskColors[segment.level] }}
            />
            {segment.level} <strong>{segment.miles.toFixed(0)} mi</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default RiskBar;
