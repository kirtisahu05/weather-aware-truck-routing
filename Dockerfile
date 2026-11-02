# Builds the React app, then serves it and the API from one Django service.
FROM node:24-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_MAPBOX_TOKEN
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN
RUN npx vite build

FROM python:3.11-slim
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=frontend /app/frontend/dist /app/frontend/dist
ENV DJANGO_DEBUG=false
CMD gunicorn config.wsgi --bind 0.0.0.0:${PORT:-8000} --workers 2 --threads 4 --timeout 120
