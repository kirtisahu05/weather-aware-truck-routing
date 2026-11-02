import type { Route } from "../types";

export interface TruckPosition {
  coordinates: [number, number];
  miles: number;
  arrived: boolean;
}

// Where the truck is a given number of hours after departure, using the checkpoint ETAs.
export function truckPositionAt(route: Route, time: number): TruckPosition | null {
  const checkpoints = route.checkpoints;

  if (!checkpoints.length) return null;

  const arrivals = checkpoints.map((checkpoint) =>
    new Date(checkpoint.estimated_arrival).getTime()
  );

  const last = checkpoints[checkpoints.length - 1];

  if (time >= arrivals[arrivals.length - 1]) {
    return {
      coordinates: [last.longitude, last.latitude],
      miles: last.distance_miles,
      arrived: true,
    };
  }

  const nextIndex = Math.max(
    arrivals.findIndex((arrival) => arrival > time),
    1
  );

  const previous = checkpoints[nextIndex - 1];
  const next = checkpoints[nextIndex];

  const span = arrivals[nextIndex] - arrivals[nextIndex - 1];

  const progress =
    span > 0
      ? Math.max(0, (time - arrivals[nextIndex - 1]) / span)
      : 0;

  const between = (from: number, to: number) => from + (to - from) * progress;

  return {
    coordinates: [
      between(previous.longitude, next.longitude),
      between(previous.latitude, next.latitude),
    ],
    miles: between(previous.distance_miles, next.distance_miles),
    arrived: false,
  };
}
