import { describe, expect, it } from "vitest";

import type { Route } from "../types";
import { truckPositionAt } from "./truck";

const route = {
  checkpoints: [
    {
      longitude: -90,
      latitude: 40,
      distance_miles: 0,
      estimated_arrival: "2026-11-02T08:00:00+00:00",
    },
    {
      longitude: -88,
      latitude: 42,
      distance_miles: 100,
      estimated_arrival: "2026-11-02T10:00:00+00:00",
    },
  ],
} as unknown as Route;

const at = (time: string) => new Date(time).getTime();

describe("truckPositionAt", () => {
  it("starts at the origin", () => {
    expect(truckPositionAt(route, at("2026-11-02T08:00:00Z"))).toEqual({
      coordinates: [-90, 40],
      miles: 0,
      arrived: false,
    });
  });

  it("moves between checkpoints in proportion to time", () => {
    expect(truckPositionAt(route, at("2026-11-02T09:00:00Z"))).toEqual({
      coordinates: [-89, 41],
      miles: 50,
      arrived: false,
    });
  });

  it("stays at the destination after arrival", () => {
    expect(truckPositionAt(route, at("2026-11-02T20:00:00Z"))).toEqual({
      coordinates: [-88, 42],
      miles: 100,
      arrived: true,
    });
  });

  it("has no position without checkpoints", () => {
    expect(
      truckPositionAt({ checkpoints: [] } as unknown as Route, 0)
    ).toBeNull();
  });
});
