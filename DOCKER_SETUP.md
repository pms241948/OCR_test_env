# Docker Setup Guide

## Overview

This project runs as two Docker services.

- `frontend`: web UI served by Nginx on port `8080`
- `backend`: Express API on port `3001`

Persistent data is stored in Docker volumes.

- `backend_data`: SQLite DB and app data
- `backend_uploads`: temporary uploaded files

## Prerequisites

- Docker Desktop installed
- Docker Compose available
- Port `8080` and `3001` not in use

Verify Docker is available:

```powershell
docker --version
docker compose version
```

## 1. Prepare Environment File

At the project root, create `.env` from `.env.example`.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

The default `.env.example` already works for local Docker execution.

Main values:

- `PORT=3001`
- `DATABASE_PATH=/app/data/app.db`
- `UPLOAD_DIR=/app/uploads`
- `CORS_ORIGIN=*`

## 2. Build And Start

Run from the project root:

```powershell
docker compose up -d --build
```

This will:

1. Build the frontend image
2. Build the backend image
3. Create containers
4. Create persistent Docker volumes automatically

## 3. Open The App

After startup:

- Web UI: [http://localhost:8080](http://localhost:8080)
- Backend health check: [http://localhost:3001/api/health](http://localhost:3001/api/health)

Expected health response:

```json
{"success":true,"data":{"status":"ok"}}
```

## 4. Check Running Containers

```powershell
docker compose ps
```

You should see:

- `frontend` mapped to `8080`
- `backend` mapped to `3001`

## 5. Useful Commands

Start existing containers:

```powershell
docker compose up -d
```

Stop containers:

```powershell
docker compose down
```

Stop containers and remove volumes:

```powershell
docker compose down -v
```

Rebuild after code changes:

```powershell
docker compose up -d --build
```

View backend logs:

```powershell
docker compose logs -f backend
```

View frontend logs:

```powershell
docker compose logs -f frontend
```

## 6. Data Persistence

The following data remains after container restart:

- presets
- history
- SQLite DB

These stay in Docker volumes until you remove them with `docker compose down -v`.

Note:

- uploaded file library shown in the browser is also stored locally in the browser `IndexedDB`
- browser-local files are separate from Docker volumes

## 7. Troubleshooting

If the web page does not open:

```powershell
docker compose ps
docker compose logs --tail 100 frontend
docker compose logs --tail 100 backend
```

If API calls fail:

- open browser DevTools
- check `Network` for `/api/...` requests
- check backend logs

If ports are already in use:

- stop the conflicting process
- or change the port mapping in [docker-compose.yml](C:\Users\user\Desktop\OCR_test_env\docker-compose.yml)

If you need a clean reset:

```powershell
docker compose down -v
docker compose up -d --build
```
