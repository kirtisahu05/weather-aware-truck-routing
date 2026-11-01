
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPost } = vi.hoisted(() => ({
  mockPost: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    create: vi.fn(() => ({
      post: mockPost,
    })),
  },
}));

import { generateTripAnalysis } from "./api";
import type { TripRequest } from "../types";

describe("generateTripAnalysis API service", () => {
  const tripData: TripRequest = {
    origin: "Bhopal",
    destination: "Indore",
    departure_datetime: "2026-11-02T09:00:00.000Z",
    load_weight: 20000,
    checkpoint_interval: 25,
  };

  beforeEach(() => {
    mockPost.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends a POST request to the correct endpoint", async () => {
    mockPost.mockResolvedValue({ data: { status: "success" } });

    await generateTripAnalysis(tripData);

    expect(mockPost).toHaveBeenCalledWith(
      "/trips/checkpoints/",
      tripData,
    );
  });

  it("returns the backend response data", async () => {
    const responseData = {
      status: "success",
      message: "Routes generated successfully",
      routes: [],
      recommendation: {
        recommended_route_id: null,
        message: "No route recommendation",
      },
    };

    mockPost.mockResolvedValue({ data: responseData });

    const result = await generateTripAnalysis(tripData);

    expect(result).toEqual(responseData);
  });

  it("sends the correct origin and destination", async () => {
    mockPost.mockResolvedValue({ data: {} });

    await generateTripAnalysis(tripData);

    const sentData = mockPost.mock.calls[0][1];

    expect(sentData.origin).toBe("Bhopal");
    expect(sentData.destination).toBe("Indore");
  });

  it("sends the correct departure date and load weight", async () => {
    mockPost.mockResolvedValue({ data: {} });

    await generateTripAnalysis(tripData);

    const sentData = mockPost.mock.calls[0][1];

    expect(sentData.departure_datetime).toBe(
      "2026-11-02T09:00:00.000Z",
    );
    expect(sentData.load_weight).toBe(20000);
  });

  it("sends the selected checkpoint interval", async () => {
    mockPost.mockResolvedValue({ data: {} });

    await generateTripAnalysis({
      ...tripData,
      checkpoint_interval: 10,
    });

    expect(mockPost).toHaveBeenCalledWith(
      "/trips/checkpoints/",
      expect.objectContaining({
        checkpoint_interval: 10,
      }),
    );
  });

  it("propagates API errors to the caller", async () => {
    const apiError = new Error("Network Error");

    mockPost.mockRejectedValue(apiError);

    await expect(
      generateTripAnalysis(tripData),
    ).rejects.toThrow("Network Error");
  });
});
