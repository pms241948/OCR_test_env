# Closed-Net Docker Upgrade Guide

This document describes how to upgrade an existing closed-network deployment by replacing Docker images and recreating the containers.

Important:

- `docker load` only imports the new images
- it does not switch an already running container to the new image
- the upgrade is complete only after the old containers are stopped, removed, and started again with the new image tags

The current application keeps user data outside the containers:

- `/app/ocrlab/data`
- `/app/ocrlab/uploads`

As long as you keep mounting those same host paths, you can upgrade by replacing the images and recreating the containers.

## What Changes In This Release

- Backend image now includes the OpenDataLoader PDF parser.
- Backend image now includes a Java runtime required by OpenDataLoader.
- No new environment variables are required for this release.
- No manual database migration is required for this release.

That means the upgrade is still image-based:

1. Build and export new images on a connected machine.
2. Transfer the tar file to the closed network.
3. Load the new images.
4. Stop and remove the old containers.
5. Start new containers with the same mounts and env file.

## Existing Runtime Example

```bash
docker run -d \
  --name ocr-backend \
  --restart=always \
  --network ocr-net \
  --network-alias backend \
  --env-file /app/ocrlab/deploy/.env \
  -v /app/ocrlab/data:/app/data \
  -v /app/ocrlab/uploads:/app/uploads \
  -p 8081:3001 \
  ocr-compare-backend:1.0

docker run -d \
  --name ocr-frontend \
  --restart=always \
  --network ocr-net \
  -p 8082:80 \
  ocr-compare-frontend:1.0
```

## 1. Build New Images On A Connected Machine

Run from the project root.

Recommended flow:

```bash
docker compose up -d --build
docker compose ps
```

This verifies the current code before exporting the release images.

Then tag the compose-built images:

```bash
docker image tag ocr_test_env-backend ocr-compare-backend:<version>
docker image tag ocr_test_env-frontend ocr-compare-frontend:<version>
```

Example:

```bash
docker image tag ocr_test_env-backend ocr-compare-backend:1.3.0
docker image tag ocr_test_env-frontend ocr-compare-frontend:1.3.0
```

If you prefer building without compose, the following also works:

```bash
docker build -t ocr_test_env-backend ./backend
docker build -t ocr_test_env-frontend ./frontend
docker image tag ocr_test_env-backend ocr-compare-backend:<version>
docker image tag ocr_test_env-frontend ocr-compare-frontend:<version>
```

Check the built images:

```bash
docker images | grep ocr-compare
```

## 2. Export The Images

```bash
docker save -o ocr-compare-images-v<version>.tar \
  ocr-compare-backend:<version> \
  ocr-compare-frontend:<version>
```

Example:

```bash
docker save -o ocr-compare-images-v1.3.0.tar \
  ocr-compare-backend:1.3.0 \
  ocr-compare-frontend:1.3.0
```

Transfer these files to the closed-network server:

- `ocr-compare-images-v<version>.tar`
- updated `.env` if you changed it

## 3. Pre-Check On The Closed-Network Server

Make sure the Docker network exists:

```bash
docker network inspect ocr-net >/dev/null 2>&1 || docker network create ocr-net
```

Check current containers:

```bash
docker ps -a --filter name=ocr-backend --filter name=ocr-frontend
```

Check current images if needed:

```bash
docker images | grep ocr-compare
```

## 4. Load The New Images

```bash
docker load -i ocr-compare-images-v<version>.tar
```

Example:

```bash
docker load -i ocr-compare-images-v1.3.0.tar
```

Confirm the new tags:

```bash
docker images | grep ocr-compare
```

## 5. Replace The Running Containers

This is the actual upgrade step.

Stop the old containers:

```bash
docker stop ocr-frontend ocr-backend
```

Remove the old containers:

```bash
docker rm ocr-frontend ocr-backend
```

Start the new backend container:

```bash
docker run -d \
  --name ocr-backend \
  --restart=always \
  --network ocr-net \
  --network-alias backend \
  --env-file /app/ocrlab/deploy/.env \
  -v /app/ocrlab/data:/app/data \
  -v /app/ocrlab/uploads:/app/uploads \
  -p 8081:3001 \
  ocr-compare-backend:<version>
```

Start the new frontend container:

```bash
docker run -d \
  --name ocr-frontend \
  --restart=always \
  --network ocr-net \
  -p 8082:80 \
  ocr-compare-frontend:<version>
```

Example:

```bash
docker run -d \
  --name ocr-backend \
  --restart=always \
  --network ocr-net \
  --network-alias backend \
  --env-file /app/ocrlab/deploy/.env \
  -v /app/ocrlab/data:/app/data \
  -v /app/ocrlab/uploads:/app/uploads \
  -p 8081:3001 \
  ocr-compare-backend:1.3.0

docker run -d \
  --name ocr-frontend \
  --restart=always \
  --network ocr-net \
  -p 8082:80 \
  ocr-compare-frontend:1.3.0
```

If you skip the `stop` and `rm` steps, the old containers keep running with the old image layers even though the new image was loaded successfully.

## 6. Validate The Upgrade

Check container status:

```bash
docker ps --filter name=ocr-backend --filter name=ocr-frontend
```

Check backend health:

```bash
curl http://localhost:8081/api/health
```

Check frontend response:

```bash
curl -I http://localhost:8082
```

Check logs:

```bash
docker logs --tail 100 ocr-backend
docker logs --tail 100 ocr-frontend
```

## 7. Functional Checks For This Release

After opening `http://<server-ip>:8082`, verify these flows:

1. Main page loads normally.
2. `Upstage DP` still runs successfully.
3. `Vision OCR` still runs successfully.
4. `Postprocess LLM` still runs successfully.
5. `OpenDataLoader PDF` tab is visible.
6. Upload a PDF and run `OpenDataLoader`.
7. Confirm the OpenDataLoader result is visible in the results workspace.
8. Confirm the OpenDataLoader result can be viewed as:
   - structured text
   - plain text
   - rendered HTML
   - markdown
9. Confirm result download buttons work for Markdown, HTML, Text, or JSON.
10. Confirm `Postprocess LLM` can be configured to include or exclude:
    - OpenDataLoader
    - Upstage
    - Vision

Notes for this release:

- OpenDataLoader runs inside the backend container.
- No host-level Java installation is needed if you use the updated backend image.
- OpenDataLoader currently supports PDF uploads only in this app.
- The OpenDataLoader API endpoint is `POST /api/ocr/opendataloader`.
- OpenDataLoader runtime execution does not require external internet access.
- API request and response examples are documented in [OPENDATALOADER_API.md](/C:/Users/pms24/Desktop/OCR_test_env/OPENDATALOADER_API.md).

## 8. Rollback

If the new version must be rolled back:

```bash
docker stop ocr-frontend ocr-backend
docker rm ocr-frontend ocr-backend
```

Then start the previous version again:

```bash
docker run -d \
  --name ocr-backend \
  --restart=always \
  --network ocr-net \
  --network-alias backend \
  --env-file /app/ocrlab/deploy/.env \
  -v /app/ocrlab/data:/app/data \
  -v /app/ocrlab/uploads:/app/uploads \
  -p 8081:3001 \
  ocr-compare-backend:<previous-version>

docker run -d \
  --name ocr-frontend \
  --restart=always \
  --network ocr-net \
  -p 8082:80 \
  ocr-compare-frontend:<previous-version>
```

## 9. Quick Upgrade Summary

```bash
docker load -i ocr-compare-images-v<version>.tar

docker stop ocr-frontend ocr-backend
docker rm ocr-frontend ocr-backend

docker run -d \
  --name ocr-backend \
  --restart=always \
  --network ocr-net \
  --network-alias backend \
  --env-file /app/ocrlab/deploy/.env \
  -v /app/ocrlab/data:/app/data \
  -v /app/ocrlab/uploads:/app/uploads \
  -p 8081:3001 \
  ocr-compare-backend:<version>

docker run -d \
  --name ocr-frontend \
  --restart=always \
  --network ocr-net \
  -p 8082:80 \
  ocr-compare-frontend:<version>

curl http://localhost:8081/api/health
curl -I http://localhost:8082
docker logs --tail 100 ocr-backend
docker logs --tail 100 ocr-frontend
```
