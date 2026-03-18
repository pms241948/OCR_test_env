# 폐쇄망 서버 Docker 교체 가이드

이 문서는 기존 `ocr-backend`, `ocr-frontend` 컨테이너를 새 버전 이미지로 교체하는 절차를 정리합니다.

기준 운영 명령:

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

## 전제

- 기존 데이터는 호스트 경로에 유지됩니다.
  - `/app/ocrlab/data`
  - `/app/ocrlab/uploads`
- 새 버전 이미지는 예시로 아래 태그를 사용합니다.
  - `ocr-compare-backend:1.1`
  - `ocr-compare-frontend:1.1`
- 운영 중단 시간을 줄이려면 새 이미지를 먼저 `docker load`까지 완료한 뒤 교체합니다.

## 1. 외부망 빌드 서버에서 새 이미지 준비

프로젝트 루트에서 실행:

```bash
docker build -t ocr-compare-backend:1.1 ./backend
docker build -t ocr-compare-frontend:1.1 ./frontend
```

이미지 확인:

```bash
docker images | grep ocr-compare
```

반입용 tar 생성:

```bash
docker save -o ocr-compare-1.1.tar \
  ocr-compare-backend:1.1 \
  ocr-compare-frontend:1.1
```

폐쇄망 서버로 아래 파일을 전달합니다.

- `ocr-compare-1.1.tar`
- 필요 시 최신 `.env`

## 2. 폐쇄망 서버에서 사전 확인

네트워크 확인:

```bash
docker network inspect ocr-net >/dev/null 2>&1 || docker network create ocr-net
```

현재 컨테이너 상태 확인:

```bash
docker ps -a --filter name=ocr-backend --filter name=ocr-frontend
```

현재 이미지 확인:

```bash
docker image inspect ocr-compare-backend:1.0 >/dev/null
docker image inspect ocr-compare-frontend:1.0 >/dev/null
```

## 3. 새 이미지 반입

```bash
docker load -i ocr-compare-1.1.tar
```

반입 확인:

```bash
docker images | grep ocr-compare
```

## 4. 운영 중 교체 절차

기존 컨테이너 중지:

```bash
docker stop ocr-frontend ocr-backend
```

기존 컨테이너 삭제:

```bash
docker rm ocr-frontend ocr-backend
```

백엔드 새 버전 실행:

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
  ocr-compare-backend:1.1
```

프론트엔드 새 버전 실행:

```bash
docker run -d \
  --name ocr-frontend \
  --restart=always \
  --network ocr-net \
  -p 8082:80 \
  ocr-compare-frontend:1.1
```

## 5. 기동 확인

컨테이너 상태:

```bash
docker ps --filter name=ocr-backend --filter name=ocr-frontend
```

백엔드 헬스체크:

```bash
curl http://localhost:8081/api/health
```

프론트엔드 응답 확인:

```bash
curl -I http://localhost:8082
```

로그 확인:

```bash
docker logs --tail 100 ocr-backend
docker logs --tail 100 ocr-frontend
```

## 6. 애플리케이션 기능 확인

브라우저에서 `http://<서버IP>:8082` 접속 후 아래를 확인합니다.

1. 메인 페이지 로드
2. `Vision OCR` 단독 호출
3. `Upstage DP` 단독 호출
4. 필요 시 `Postprocess` 호출

이번 버전에서 특히 확인할 항목:

- Vision LLM 장시간 응답 시 60초 전에 끊기지 않는지
- Upstage DP 호출 시 `model=document-parse`가 포함되어 정상 응답하는지
- Upstage DP 호출 시 `output_formats`가 JSON 문자열 형식으로 전달되어 400이 사라졌는지

## 7. 롤백 방법

새 버전 장애 시:

```bash
docker stop ocr-frontend ocr-backend
docker rm ocr-frontend ocr-backend
```

기존 버전으로 재기동:

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

## 8. 운영 팁

- 가능하면 기존 `1.0` 이미지는 바로 삭제하지 말고 롤백 확인 전까지 유지합니다.
- 태그를 덮어쓰기보다 `1.1`, `1.2`처럼 새 태그를 쓰는 것이 안전합니다.
- 데이터는 볼륨이 아니라 호스트 경로 마운트이므로 컨테이너 재생성으로 사라지지 않습니다.
- `.env`를 변경했다면 백엔드 컨테이너는 반드시 재생성해야 반영됩니다.

## 9. 빠른 교체 명령 요약

```bash
docker load -i ocr-compare-1.1.tar

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
  ocr-compare-backend:1.1

docker run -d \
  --name ocr-frontend \
  --restart=always \
  --network ocr-net \
  -p 8082:80 \
  ocr-compare-frontend:1.1

curl http://localhost:8081/api/health
curl -I http://localhost:8082
docker logs --tail 100 ocr-backend
docker logs --tail 100 ocr-frontend
```
