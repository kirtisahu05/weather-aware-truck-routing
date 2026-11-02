import { describe, expect, it } from "vitest";

import { calculateMapLimits } from "./mapLimits";

describe("calculateMapLimits", () => {
  it("allows a little zoom out and panning around the fitted view", () => {
    const limits = calculateMapLimits(
      { west: -100, south: 0, east: 0, north: 50 },
      6
    );

    expect(limits.minZoom).toBe(5.75);
    expect(limits.maxBounds).toEqual([
      [-112, -6],
      [12, 56],
    ]);
  });

  it("stays within the map's valid range", () => {
    const limits = calculateMapLimits(
      { west: -170, south: -80, east: 170, north: 80 },
      0.2
    );

    expect(limits.minZoom).toBe(0);
    expect(limits.maxBounds).toEqual([
      [-180, -85],
      [180, 85],
    ]);
  });
});
