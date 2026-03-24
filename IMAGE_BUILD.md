# Docker Image Build Guide

This document explains how to build, tag, export, and run the Docker images for this project.

Project root:

```powershell
C:\Users\pms24\Desktop\OCR_test_env
```

## Images Produced

- `ocr_test_env-backend`
- `ocr_test_env-frontend`

For release delivery, tag them as:

- `ocr-compare-backend:<version>`
- `ocr-compare-frontend:<version>`

## 1. Build And Run With Docker Compose

Build both services and start them:

```powershell
docker compose up -d --build
```

Check the running services:

```powershell
docker compose ps
```

Check the app:

- Frontend: `http://localhost:8080`
- Backend health: `http://localhost:3001/api/health`

## 2. Build Images Only

Build without starting containers:

```powershell
docker compose build
```

Or build each image separately:

```powershell
docker build -t ocr_test_env-backend ./backend
docker build -t ocr_test_env-frontend ./frontend
```

Check the local images:

```powershell
docker images
```

## 3. Tag Release Images

Example release tag:

```powershell
docker image tag ocr_test_env-backend ocr-compare-backend:1.3.0
docker image tag ocr_test_env-frontend ocr-compare-frontend:1.3.0
```

Generic form:

```powershell
docker image tag ocr_test_env-backend ocr-compare-backend:<version>
docker image tag ocr_test_env-frontend ocr-compare-frontend:<version>
```

Check the tags:

```powershell
docker images | findstr ocr
```

## 4. Export Images To A Tar File

Save the tagged release images:

```powershell
docker save -o ocr-compare-images-v1.3.0.tar ocr-compare-backend:1.3.0 ocr-compare-frontend:1.3.0
```

Generic form:

```powershell
docker save -o ocr-compare-images-v<version>.tar ocr-compare-backend:<version> ocr-compare-frontend:<version>
```

If you want to save the compose-built image names directly:

```powershell
docker save -o ocr-test-env-images.tar ocr_test_env-backend ocr_test_env-frontend
```

## 5. Load Images On Another Machine

Load the archive:

```powershell
docker load -i ocr-compare-images-v1.3.0.tar
```

Check loaded images:

```powershell
docker images | findstr ocr
```

## 6. Run Loaded Images Without Compose

Backend:

```powershell
docker run -d --name ocr-backend -p 3001:3001 --env-file .env -v ocr_backend_data:/app/data -v ocr_backend_uploads:/app/uploads ocr-compare-backend:1.3.0
```

Frontend:

```powershell
docker run -d --name ocr-frontend -p 8080:80 ocr-compare-frontend:1.3.0
```

## 7. Release Notes For The Current Backend Image

The current backend image includes:

- OpenDataLoader PDF support
- Java runtime required by OpenDataLoader
- existing Upstage, Vision OCR, and Postprocess APIs

That means:

- you do not need to install Java on the host when using the Docker image
- OpenDataLoader works inside the backend container
- closed-network upgrades still work by replacing only the Docker images and recreating containers

## 8. Recommended Release Flow

1. Build and verify locally.

```powershell
docker compose up -d --build
docker compose ps
```

2. Tag the release images.

```powershell
docker image tag ocr_test_env-backend ocr-compare-backend:<version>
docker image tag ocr_test_env-frontend ocr-compare-frontend:<version>
```

3. Save the tagged images.

```powershell
docker save -o ocr-compare-images-v<version>.tar ocr-compare-backend:<version> ocr-compare-frontend:<version>
```

4. Transfer the tar file to the target environment.

5. Load and run the images on the target machine.

## 9. Useful Cleanup Commands

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
