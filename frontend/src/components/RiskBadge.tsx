import type { RiskLevel } from "../types";
import { riskColors } from "../utils/risk";

interface RiskBadgeProps {
  level: RiskLevel;
}

function RiskBadge({ level }: RiskBadgeProps) {
  return (
    <span
      className={`risk-badge risk-badge-${level === "Moderate" ? "dark-text" : "light-text"}`}
      style={{ backgroundColor: riskColors[level] }}
    >
      {level}
    </span>
  );
}

export default RiskBadge;
