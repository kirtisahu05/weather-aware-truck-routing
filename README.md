# Weather-Aware Truck Routing

A React and Django app that helps a truck driver choose the safest route. Enter an origin, destination, departure time, and load weight. The app compares three routes using the forecast for the hour the truck reaches each checkpoint, then recommends one.

**Live app:** _add the URL after deploying_  
**Walkthrough:** _add the Loom link_

## How it works

1. **Routes.** Mapbox Directions supplies the routes. It often returns only one or two, so the backend requests more through a waypoint to the side of the fastest route. It discards any that mostly repeat a known route or take over 1.6 times as long as the fastest.
2. **Checkpoints.** Each route is sampled every 10, 25, or 50 miles, plus the origin and destination. ETAs assume steady progress over the route's duration.
3. **Weather.** Each checkpoint uses the Open-Meteo forecast for the hour nearest its ETA, not the departure hour.
4. **Risk.** Wind, rain, and snow are each classified, the worst one applies, and the load rules are applied on top.
5. **Recommendation.** Routes are ranked and the reason for the choice is shown.
6. **Heatmap.** An even grid of weather samples covers the corridor, with a risk level for each hour from 0 to 48.

## Risk rules

| Condition | Low | Moderate | High | Severe | No Travel |
|---|---|---|---|---|---|
| Wind (mph) | <25 | 25–34 | 35–44 | 45–54 | ≥55 |
| Rain (in/hr) | <0.10 | 0.10–0.25 | 0.25–0.50 | 0.50–1.00 | >1.00 |
| Snow (in/hr) | <0.5 | 0.5–1.0 | 1.0–2.0 | 2.0–3.0 | >3.0 |

Load rules:

- Wind of 55 mph or more is No Travel for any load.
- Wind of 45–54 mph with a load over 30,000 lb is No Travel.
- Wind of 35–44 mph with a load over 40,000 lb is at least Severe.

## Route recommendation

Routes are compared in this order:

1. Fewest Severe miles
2. Fewest High miles
3. Lowest average risk (Low = 0 through No Travel = 4, weighted by miles)
4. Shortest travel time

## Decisions where the assignment left room

- **Shared thresholds.** A value exactly on a boundary takes the higher level, so 0.25 in/hr of rain is High and 0.50 is Severe. At the top of the scale, the table's ">" is followed, so exactly 1.00 in/hr of rain is still Severe.
- **No Travel routes** are never recommended. If every route has No Travel conditions, the app says no safe route exists.
- **Risk miles.** Each checkpoint covers the road closest to it, halfway to each neighbor. This way No Travel at the origin or destination still counts.
- **Rain** is Open-Meteo's `rain` plus `showers`, because `rain` alone leaves out convective rain.
- **The slider only affects the heatmap and the truck marker.** Checkpoints and the recommendation always use ETA weather, so moving the slider never changes the recommendation. The truck marker shows where the selected route's truck would be at that hour, which links the heatmap to the ETAs.

## Performance

- The API returns all 49 hours of heatmap data at once. The slider only switches which hour the map layer reads, so it makes no network requests and sends no new data to the map.
- Checkpoints are drawn as one GPU layer rather than hundreds of DOM markers.
- The grid is limited to 120 points, and its spacing grows with trip length.
- Heatmap color follows risk rather than how many points overlap, because the grid is even and the radius stays fixed on the ground at every zoom level.
- Weather lookups are de-duplicated, sent in parallel batches, and cached for 30 minutes.

## Known limitations

- **Car travel times.** The Mapbox `driving` profile doesn't model truck speeds or truck road restrictions, so real ETAs will usually be later.
- **Steady-speed ETAs.** ETAs don't account for traffic or for slower and faster stretches of road.
- **Rate limits.** Open-Meteo's free tier allows 600 locations a minute. Each lookup is limited to 250 locations, so a very long trip at 10-mile intervals shares forecasts between nearby checkpoints, on a grid of up to 0.5°. Each checkpoint still uses its own ETA hour. If the limit is reached anyway, the app asks the user to retry.
- **Fewer than three routes.** Some trips, such as those with few roads nearby, have no reasonable third route. The app then shows what it found.
- **Departure window.** Departures can be at most 1 day in the past or 13 days ahead, to stay within the forecast range.
- **Sustained wind only.** Risk uses sustained wind at 10 m, not gusts.

## Running locally

Requires Python 3.9+, Node 24, and a [Mapbox token](https://account.mapbox.com/). Open-Meteo needs no key.

```bash
# Backend, on http://127.0.0.1:8000
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # then add your token
python manage.py runserver
```

```bash
# Frontend, on http://localhost:5173
cd frontend
npm install
cp .env.example .env    # then add your token
npm run dev
```

## Tests

```bash
cd backend && python manage.py test routing
cd frontend && npm run test:run && npm run typecheck && npm run lint
```

## Deployment

The `Dockerfile` builds the React app and serves it and the API from one Django service. To deploy on Render:

1. Create a new **Blueprint** from this repository, which uses `render.yaml`.
2. Set `MAPBOX_ACCESS_TOKEN` and `VITE_MAPBOX_TOKEN` when prompted.

On Render's free plan, the first request after a period of inactivity takes up to a minute while the service wakes up. On any other Docker host, also set `DJANGO_ALLOWED_HOSTS` and pass `VITE_MAPBOX_TOKEN` as a build argument.

## API

`POST /api/trips/checkpoints/` runs the full analysis:

```json
{
  "origin": "Chicago, IL",
  "destination": "Denver, CO",
  "departure_datetime": "2026-11-02T08:00:00Z",
  "load_weight": 35000,
  "checkpoint_interval": 25
}
```

It returns `routes` (each with `checkpoints` and `risk_summary`), `recommendation`, and `corridor_heatmap`. If the heatmap's weather lookup fails, `corridor_heatmap` is `null` and the route results are still returned.

The API also has `GET /api/health/`, `POST /api/trips/validate/`, and `POST /api/trips/routes/`.

## Code layout

```text
backend/routing/services/
  route_service.py       Geocoding and three distinct routes
  checkpoint_service.py  Checkpoints and ETAs
  weather_service.py     Open-Meteo lookups, batching, and caching
  risk_engine.py         Risk thresholds and load rules
  recommendation.py      Risk miles and route ranking
  corridor_service.py    Heatmap grid and hourly risk
  geo.py                 Distance and line helpers
frontend/src/
  App.tsx                Page state and results
  components/            TripForm, TripSummary, RouteCard, RiskBar, RouteMap, CheckpointTable, RiskBadge
  utils/                 Risk colors, truck position, and route label placement
```
