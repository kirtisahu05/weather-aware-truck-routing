
export type RiskLevel =
  | "Low"
  | "Moderate"
  | "High"
  | "Severe"
  | "No Travel";

export interface TripRequest {
  origin: string;
  destination: string;
  departure_datetime: string;
  load_weight: number;
  checkpoint_interval: 10 | 25 | 50;
}

export interface RiskSummary {
  total_miles: number;
  low_miles: number;
  moderate_miles: number;
  high_miles: number;
  severe_miles: number;
  no_travel_miles: number;
  average_risk_score: number;
}

export interface CheckpointRisk {
  wind_risk: RiskLevel;
  rain_risk: RiskLevel;
  snow_risk: RiskLevel;
  overall_risk: RiskLevel;
  load_weight: number;
  no_travel: boolean;
}

// export interface WeatherData {
//   forecast_time: string;
//   wind_mph: number;
//   rain_inches_per_hour: number;
//   snow_inches_per_hour: number;
// }

export interface WeatherData {
  forecast_time: string;
  wind_mph: number | null;
  rain_inches_per_hour: number | null;
  snow_inches_per_hour: number | null;
}

export interface RouteCheckpoint {
  checkpoint_id: string | number;
  distance_miles: number;
  longitude: number;
  latitude: number;
  estimated_arrival: string;
  route_id: string;
  weather: WeatherData;
  risk: CheckpointRisk;
  hourly_forecast: HourlyForecast[];
}

export interface RouteGeometry {
  type: "LineString";
  coordinates: [number, number][];
}

export interface Route {
  route_id: string;
  route_name: string;
  distance_miles: number;
  duration_hours: number;
  duration_seconds?: number;
  geometry: RouteGeometry;
  checkpoints: RouteCheckpoint[];
  risk_summary: RiskSummary;
}

export interface Recommendation {
  recommended_route_id: string | null;
  message: string;
}

export interface TripAnalysisResponse {
  status: string;
  message: string;
  trip: TripRequest;
  routes: Route[];
  recommendation: Recommendation;
}

export interface HourlyForecast extends WeatherData {
  hour_offset: number;
  risk: CheckpointRisk;
}
