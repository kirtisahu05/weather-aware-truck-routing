import type { TripRequest } from "../types";
import { formatDateTime } from "../utils/risk";

interface TripSummaryProps {
  trip: TripRequest;
  editing: boolean;
  onToggleEdit: () => void;
}

function TripSummary({ trip, editing, onToggleEdit }: TripSummaryProps) {
  return (
    <div className="trip-summary">
      <div>
        <strong>
          {trip.origin} → {trip.destination}
        </strong>
        <span>
          {formatDateTime(trip.departure_datetime)} ·{" "}
          {trip.load_weight.toLocaleString()} lb · every{" "}
          {trip.checkpoint_interval} mi
        </span>
      </div>

      <button
        type="button"
        aria-expanded={editing}
        onClick={onToggleEdit}
      >
        {editing ? "Hide" : "Edit"}
      </button>
    </div>
  );
}

export default TripSummary;
