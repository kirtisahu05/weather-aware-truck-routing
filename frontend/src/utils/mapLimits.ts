// How far the user can zoom out from the view that fits the routes, in zoom levels.
const ZOOM_OUT_ALLOWANCE = 0.25;

// Share of the view that each side can extend by. At the zoom-out limit the view is about
// 1.19 times as wide, and the allowed area must stay larger than that or Mapbox forces the
// map to zoom in. This is just enough, so the routes can't be dragged out of sight.
const PAN_MARGIN = 0.12;

interface ViewBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function calculateMapLimits(view: ViewBounds, fittedZoom: number) {
  const width = view.east - view.west;
  const height = view.north - view.south;

  return {
    minZoom: Math.max(fittedZoom - ZOOM_OUT_ALLOWANCE, 0),
    maxBounds: [
      [
        Math.max(view.west - width * PAN_MARGIN, -180),
        Math.max(view.south - height * PAN_MARGIN, -85),
      ],
      [
        Math.min(view.east + width * PAN_MARGIN, 180),
        Math.min(view.north + height * PAN_MARGIN, 85),
      ],
    ] as [[number, number], [number, number]],
  };
}
