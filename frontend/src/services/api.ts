import axios from "axios";
import type {
  TripRequest,
  TripAnalysisResponse,
} from "../types";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api",
  headers: {
    "Content-Type": "application/json",
  },
});

export const generateTripAnalysis = async (
  tripData: TripRequest
): Promise<TripAnalysisResponse> => {
  const response = await api.post<TripAnalysisResponse>(
    "/trips/checkpoints/",
    tripData
  );

  return response.data;
};

export default api;