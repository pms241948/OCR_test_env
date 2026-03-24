# Docker Image Build Guide

This document explains the release image flow for this project:

1. Build and verify the current code.
2. Tag release images.
3. Save the images to a tar file.
4. Transfer the tar file to another environment.
5. Load the tar file and replace the running containers.

Project root:

```powershell
C:\Users\pms24\Desktop\OCR_test_env
```

## Images Produced

When built with Docker Compose, this project creates:

- `ocr_test_env-backend`
- `ocr_test_env-frontend`

For release delivery, tag them as:

- `ocr-compare-backend:<version>`
- `ocr-compare-frontend:<version>`

## 1. Build And Verify Locally

Build both services and start them:

```powershell
docker compose up -d --build
```

Check the running services:

```powershell
docker compose ps
```

Verify the app:

- Frontend: `http://localhost:8080`
- Backend health: `http://localhost:3001/api/health`

Optional checks:

```powershell
curl http://localhost:3001/api/health
curl -I http://localhost:8080
```

## 2. Build Images Only

If you only want to produce images without starting containers:

```powershell
docker compose build
```

You can also build each image directly:

```powershell
docker build -t ocr_test_env-backend ./backend
docker build -t ocr_test_env-frontend ./frontend
```

Check the local images:

```powershell
docker images | findstr ocr
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
docker images | findstr ocr-compare
```

## 4. Save Release Images

Save the tagged release images into one archive:

```powershell
docker save -o ocr-compare-images-v1.3.0.tar ocr-compare-backend:1.3.0 ocr-compare-frontend:1.3.0
```

Generic form:

```powershell
docker save -o ocr-compare-images-v<version>.tar ocr-compare-backend:<version> ocr-compare-frontend:<version>
```

If needed, you can save the compose-built image names directly:

```powershell
docker save -o ocr-test-env-images.tar ocr_test_env-backend ocr_test_env-frontend
```

## 5. Transfer Files

Transfer these files to the target environment:

- `ocr-compare-images-v<version>.tar`
- updated `.env` file if your release changed environment variables

For the current release:

- no new environment variables are required
- OpenDataLoader and its Java runtime are already inside the backend image

## 6. Load Images On Another Machine

Load the archive:

```powershell
docker load -i ocr-compare-images-v1.3.0.tar
```

Check loaded images:

```powershell
docker images | findstr ocr-compare
```

Important:

- `docker load` only imports the images
- it does not replace already running containers
- after loading the new images, you must recreate the containers

## 7. Replace Running Containers

If the target machine uses standalone containers, stop and recreate them with the new image tags.

Example:

```powershell
docker stop ocr-frontend ocr-backend
docker rm ocr-frontend ocr-backend

docker run -d --name ocr-backend --restart=always --env-file .env -p 3001:3001 -v ocr_backend_data:/app/data -v ocr_backend_uploads:/app/uploads ocr-compare-backend:1.3.0
docker run -d --name ocr-frontend --restart=always -p 8080:80 ocr-compare-frontend:1.3.0
```

If the target machine uses host bind mounts or a custom Docker network, keep using the same mount paths and network settings from the existing deployment.

## 8. Notes For The Current Backend Image

The current backend image includes:

- OpenDataLoader PDF support
- Java runtime required by OpenDataLoader
- existing Upstage, Vision OCR, and Postprocess APIs

That means:

- no host-level Java installation is needed when using the Docker image
- OpenDataLoader runs entirely inside the backend container
- closed-network upgrades still work by replacing the Docker images and recreating containers

## 9. Recommended Release Flow

```powershell
docker compose up -d --build
docker compose ps

docker image tag ocr_test_env-backend ocr-compare-backend:<version>
docker image tag ocr_test_env-frontend ocr-compare-frontend:<version>

docker save -o ocr-compare-images-v<version>.tar ocr-compare-backend:<version> ocr-compare-frontend:<version>
```

Then transfer the tar file and follow [DEPLOY_UPGRADE_CLOSED_NET.md](/C:/Users/pms24/Desktop/OCR_test_env/DEPLOY_UPGRADE_CLOSED_NET.md).

If the target environment needs to call OpenDataLoader directly, see [OPENDATALOADER_API.md](/C:/Users/pms24/Desktop/OCR_test_env/OPENDATALOADER_API.md).

## 10. Useful Cleanup Commands

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
