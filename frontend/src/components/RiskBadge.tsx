import type { RiskLevel } from "../types";

interface RiskBadgeProps {
  level: RiskLevel;
}

function RiskBadge({ level }: RiskBadgeProps) {
  const colors: Record<RiskLevel, string> = {
    Low: "#16a34a",
    Moderate: "#ca8a04",
    High: "#ea580c",
    Severe: "#dc2626",
    "No Travel": "#7f1d1d",
  };

  return (
    <span
      className="risk-badge"
      style={{ backgroundColor: colors[level] }}
    >
      {level}
    </span>
  );
}

export default RiskBadge;