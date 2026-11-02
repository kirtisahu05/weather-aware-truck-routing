import type { Route } from "../types";

const LABEL_CANDIDATE_FRACTIONS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];

function squaredDegrees(a: [number, number], b: [number, number]) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

function sampleEvery<T>(items: T[], count: number): T[] {
  const step = Math.max(1, Math.floor(items.length / count));

  return items.filter((_, index) => index % step === 0);
}

// Routes share roads, so each label goes on the stretch farthest from the other routes
// and from the labels already placed.
export function chooseLabelPositions(routes: Route[]): [number, number][] {
  const positions: [number, number][] = [];

  routes.forEach((route) => {
    const coordinates = route.geometry.coordinates;

    const others = [
      ...routes
        .filter((other) => other !== route)
        .flatMap((other) => sampleEvery(other.geometry.coordinates, 80)),
      ...positions,
    ];

    let best = coordinates[Math.floor((coordinates.length - 1) * 0.5)];
    let bestClearance = -1;

    LABEL_CANDIDATE_FRACTIONS.forEach((fraction) => {
      const candidate =
        coordinates[Math.floor((coordinates.length - 1) * fraction)];

      const clearance = Math.min(
        ...others.map((other) => squaredDegrees(candidate, other)),
        Infinity
      );

      if (clearance > bestClearance) {
        best = candidate;
        bestClearance = clearance;
      }
    });

    positions.push(best);
  });

  return positions;
}
