# Weather-Aware Truck Routing System

A full-stack web application that helps truck drivers plan safer routes by combining route optimization, weather forecasts, vehicle load information, and real-time risk assessment.

The application generates route options, evaluates weather conditions along each route, calculates risk levels at checkpoints, and recommends the safest route based on weather severity and estimated travel time.

## Features

- **Route Planning:** Generate alternative routes between an origin and destination using the Mapbox Directions API.
- **Location Autocomplete:** Search and select locations using Mapbox geocoding.
- **Weather Forecasting:** Retrieve hourly weather forecasts using the Open-Meteo API.
- **Weather Checkpoints:** Evaluate weather conditions at configurable intervals of 10, 25, or 50 miles.
- **Estimated Arrival Times:** Estimate when the truck will reach each checkpoint.
- **Risk Assessment:** Calculate weather-related driving risks based on wind, rain, snowfall, and truck load weight.
- **Route Recommendations:** Recommend the safest available route while considering risk levels and travel duration.
- **Interactive Map:** Display route options, checkpoint locations, and weather risk information.
- **Weather Forecast Slider:** Explore forecast conditions across a 0–48-hour period.

## Technology Stack

### Frontend
- React
- TypeScript
- Vite
- Mapbox GL JS
- Axios
- React Router
- Recharts
- Lucide React
- Vitest
- React Testing Library

### Backend
- Python
- Django
- Django REST Framework
- Mapbox Directions API
- Open-Meteo Weather API

## Project Structure

```text
truck-route-safety/
│
├── backend/
│   ├── routing/
│   │   ├── services/
│   │   │   ├── route_service.py
│   │   │   ├── checkpoint_service.py
│   │   │   ├── weather_service.py
│   │   │   └── risk_engine.py
│   │   ├── tests/
│   │   ├── serializers.py
│   │   ├── views.py
│   │   └── urls.py
│   │
│   ├── manage.py
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── services/
│   │   ├── types/
│   │   ├── test/
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts
│
└── README.md
```

## How It Works

1. The user enters an origin, destination, departure date and time, and truck load weight.
2. The backend requests available route alternatives from Mapbox.
3. Each route is divided into weather checkpoints at the selected distance interval.
4. The application estimates the truck's arrival time at each checkpoint.
5. Weather information is retrieved from Open-Meteo for the estimated arrival time.
6. The risk engine evaluates wind, rain, snowfall, and load-related restrictions.
7. Each route receives a risk summary based on the distances associated with different risk levels.
8. The recommendation engine ranks the available routes.
9. The frontend displays route options, weather information, risk levels, and the recommended route.

## Weather Risk Assessment

The application evaluates weather conditions using the following thresholds.

| Risk Level | Wind Speed (mph) | Rain (in/hr) | Snow (in/hr) |
|---|---:|---:|---:|
| Low | Below 25 | Below 0.10 | Below 0.5 |
| Moderate | 25–34 | 0.10–0.25 | 0.5–1.0 |
| High | 35–44 | 0.25–0.50 | 1.0–2.0 |
| Severe | 45–54 | 0.50–1.00 | 2.0–3.0 |
| No Travel | 55 or above | Above 1.00 | Above 3.0 |

### Load-Based Risk Rules

Additional restrictions are applied based on truck load weight:

- Wind speed of 55 mph or higher results in No Travel for any load.
- Wind speed between 45 and 54 mph results in No Travel when the load exceeds 30,000 lbs.
- Wind speed between 35 and 44 mph results in Severe risk when the load exceeds 40,000 lbs.

## Route Recommendation Logic

Routes are evaluated using the following priorities:

1. Fewest miles classified as Severe.
2. Fewest miles classified as High.
3. Lowest average risk score.
4. Shortest estimated travel time.

Routes containing No Travel conditions are excluded from recommendation when safer eligible alternatives are available.

## API Endpoints

The Django backend exposes the following endpoints:

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health/` | Check backend health |
| POST | `/api/trips/validate/` | Validate trip information |
| POST | `/api/trips/routes/` | Generate route options |
| POST | `/api/trips/checkpoints/` | Generate checkpoints, weather data, risk analysis, and recommendation |

*The exact API prefix depends on the project's Django URL configuration.*

### Example Trip Request

```json
{
  "origin": "Chicago, IL",
  "destination": "Denver, CO",
  "departure_datetime": "2026-11-02T08:00:00Z",
  "load_weight": 25000,
  "checkpoint_interval": 25
}
```

## Getting Started

### Prerequisites

Install the following before running the project:

- Python 3.9 or compatible version
- Node.js and npm
- Git
- Mapbox access token

### 1. Clone the Repository

```bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd truck-route-safety
```

### 2. Set Up the Backend

Navigate to the backend directory:

```bash
cd backend
```

Create a virtual environment:

```bash
python -m venv venv
```

Activate it on macOS/Linux:

```bash
source venv/bin/activate
```

On Windows:

```bash
venv\Scripts\activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Configure the backend environment variables according to the names used in the Django settings and Mapbox routing service.

Apply database migrations:

```bash
python manage.py migrate
```

Start the backend:

```bash
python manage.py runserver
```

The backend will normally be available at:

```text
http://127.0.0.1:8000/
```

### 3. Set Up the Frontend

Open another terminal and navigate to the frontend directory:

```bash
cd frontend
```

Install dependencies:

```bash
npm install
```

Create a `.env` file in the frontend directory:

```env
VITE_MAPBOX_TOKEN=your_mapbox_access_token
VITE_API_BASE_URL=http://127.0.0.1:8000/api
```

Replace the placeholder Mapbox token with your own valid token.

Start the frontend:

```bash
npm run dev
```

The frontend will normally be available at:

```text
http://localhost:5173/
```

## Running Tests

### Backend Tests

From the backend directory:

```bash
python manage.py test routing
```

### Frontend Tests

From the frontend directory:

Run all tests:

```bash
npm run test:run
```

Run tests in watch mode:

```bash
npm run test
```

### Production Build

Build the frontend:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Environment Variables

| Variable | Purpose |
|---|---|
| `VITE_MAPBOX_TOKEN` | Mapbox token for frontend maps and location autocomplete |
| `VITE_API_BASE_URL` | Backend API base URL |
| Backend Mapbox credential | Used by the Django routing service |

Configure backend credentials using the actual variable names expected by the backend code.

**Important:** Never commit API tokens, passwords, Django secret keys, or other sensitive credentials to GitHub. Add `.env` files and virtual environment folders to `.gitignore`.

## External Services

- **Mapbox:** Routing, maps, and location autocomplete.  
  https://www.mapbox.com/

- **Open-Meteo:** Weather forecast data.  
  https://open-meteo.com/

## Current Limitations

- Mapbox Directions API may return fewer than three routes for some origin and destination combinations.
- Checkpoint arrival times are estimated using route progress and average travel duration.
- Weather risk assessments depend on forecast availability and accuracy.
- Weather forecasts are limited by the availability of the external weather provider.

## Future Improvements

- Add additional routing providers to increase route alternatives.
- Improve checkpoint arrival-time estimates using traffic-aware travel times.
- Add historical weather analysis.
- Introduce user accounts and saved trips.
- Improve production performance through frontend code splitting.
- Deploy the application with a production database and monitoring.

## Author

Developed as a Full Stack Developer assignment demonstrating weather-aware truck route planning, API integration, risk analysis, and interactive data visualization.

## License

This project was developed for educational and demonstration purposes. Add an appropriate license before distributing it publicly.