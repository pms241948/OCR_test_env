# Image Build Guide

## Overview

This project builds two Docker images.

- `ocr_test_env-backend`
- `ocr_test_env-frontend`

The commands below should be run from the project root:

```powershell
C:\Users\pms24\Desktop\OCR_test_env
```

## 1. Build And Run With Docker Compose

Build both images and start the containers:

```powershell
docker compose up -d --build
```

Check running containers:

```powershell
docker compose ps
```

Check the app:

- Frontend: `http://localhost:8080`
- Backend health: `http://localhost:3001/api/health`

## 2. Build Images Only

If you only want the images without starting containers:

```powershell
docker compose build
```

Or build each image separately:

```powershell
docker build -t ocr_test_env-backend ./backend
docker build -t ocr_test_env-frontend ./frontend
```

Check built images:

```powershell
docker images
```

## 3. Add Version Tags

If you want versioned image names for delivery or release:

```powershell
docker image tag ocr_test_env-backend ocr-compare-backend:1.2.0
docker image tag ocr_test_env-frontend ocr-compare-frontend:1.2.0
```

Check the tags:

```powershell
docker images | findstr ocr
```

## 4. Export Images To A Tar File

Save both images into one archive:

```powershell
docker save -o ocr-compare-images-v1.2.0.tar ocr-compare-backend:1.2.0 ocr-compare-frontend:1.2.0
```

If you are not using version tags, you can save the compose-built images directly:

```powershell
docker save -o ocr-test-env-images.tar ocr_test_env-backend ocr_test_env-frontend
```

## 5. Load Images On Another Machine

Load the tar file:

```powershell
docker load -i ocr-compare-images-v1.2.0.tar
```

Check loaded images:

```powershell
docker images | findstr ocr
```

## 6. Run Loaded Images Without Compose

Backend:

```powershell
docker run -d --name ocr-backend -p 3001:3001 --env-file .env -v ocr_backend_data:/app/data -v ocr_backend_uploads:/app/uploads ocr-compare-backend:1.2.0
```

Frontend:

```powershell
docker run -d --name ocr-frontend -p 8080:80 ocr-compare-frontend:1.2.0
```

## 7. Useful Cleanup Commands

Stop compose services:

```powershell
docker compose down
```

Stop compose services and remove volumes:

```powershell
docker compose down -v
```

Remove standalone containers:

```powershell
docker rm -f ocr-backend ocr-frontend
```

## 8. Recommended Release Flow

1. Build and verify locally.

```powershell
docker compose up -d --build
docker compose ps
```

2. Tag release images.

```powershell
docker image tag ocr_test_env-backend ocr-compare-backend:1.2.0
docker image tag ocr_test_env-frontend ocr-compare-frontend:1.2.0
```

3. Save the tagged images.

```powershell
docker save -o ocr-compare-images-v1.2.0.tar ocr-compare-backend:1.2.0 ocr-compare-frontend:1.2.0
```

4. Transfer the tar file and load it on the target machine.

5. Run with `docker compose` or `docker run`.

