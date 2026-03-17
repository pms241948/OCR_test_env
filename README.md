# OCR Compare App

## 프로젝트 개요

이 프로젝트는 하나의 PDF 또는 이미지 파일에 대해 다음 3단계를 반복 실험할 수 있는 웹 기반 OCR 비교 도구입니다.

1. Upstage Document Parse 프록시 OCR
2. Vision LLM 기반 OCR
3. 두 결과를 합치는 후처리 LLM

프롬프트, 모범답안, ROI, 페이지 범위, Upstage 옵션을 웹에서 조정하고 결과를 비교할 수 있습니다. 프리셋과 실행 이력은 SQLite에 저장됩니다.

## 아키텍처 설계

- `frontend`
  - React + Vite + Tailwind CSS + Zustand
  - 단일 대시보드에서 업로드, 설정, ROI 선택, 실행, 비교, 프리셋/이력 관리
  - PDF는 브라우저에서 `pdfjs-dist`로 페이지 수 계산 및 ROI 미리보기
- `backend`
  - Express + Multer + Axios + Sharp + better-sqlite3
  - Upstage DP 프록시 호출
  - Vision/Postprocess LLM 오케스트레이션
  - PDF는 `pdftoppm`으로 렌더링 후 ROI crop
  - SQLite 기반 프리셋/이력 저장
- `frontend/nginx`
  - 정적 파일 서빙
  - `/api` 요청을 backend로 프록시

## 디렉터리 구조

```text
ocr-compare-app/
  frontend/
    src/
      components/
      pages/
      hooks/
      stores/
      utils/
    public/
    Dockerfile
    nginx.conf
    package.json
  backend/
    src/
      routes/
      services/
      controllers/
      middleware/
      utils/
      db/
      jobs/
    uploads/
    data/
    Dockerfile
    package.json
  docker-compose.yml
  .env.example
  README.md
```

## 화면 설계

- 파일 업로드 패널
  - 파일 선택
  - 파일명, 크기, MIME, 페이지 수 표시
- Upstage DP 설정 패널
  - DP URL, endpoints URL, license URL, OCR 옵션, output formats, timeout, retry
  - 엔드포인트 확인 및 라이선스 등록
- Vision LLM 설정 패널
  - URL, 모델, system/user prompt, extraction rules, sampling 파라미터
  - 모범답안 업로드 및 직접 편집
- Vision 범위 지정 패널
  - full document, page range, ROI, page + ROI
  - PDF/image 미리보기
  - 드래그 기반 ROI 선택 + 숫자 입력
- 후처리 LLM 설정 패널
  - URL, 모델, prompt, sampling 파라미터
  - 모범답안 업로드 및 직접 편집
- 실행 제어 패널
  - Upstage 단독 실행
  - Vision 단독 실행
  - 후처리 단독 실행
  - 전체 파이프라인 실행
- 결과 비교 패널
  - Upstage / Vision / Postprocess 결과 3열 비교
  - 복사, 다운로드, JSON 펼침
- 프리셋 / 실행 이력 패널
  - 설정 저장, 복원, 최근 실행 결과 로딩

## 백엔드 API 명세

### 상태/운영

- `GET /api/health`

### Upstage DP

- `POST /api/ocr/upstage`
  - multipart/form-data
  - `file`: 업로드 파일
  - `config`: JSON string
- `POST /api/upstage/check-endpoints`
- `POST /api/upstage/register-license`

### Vision / Postprocess

- `POST /api/ocr/vision-llm`
  - multipart/form-data
  - `file`: 업로드 파일
  - `config`: JSON string
- `POST /api/postprocess`
  - JSON body
  - `file`, `upstageResult`, `visionResult`, `config`
- `POST /api/run-all`
  - multipart/form-data
  - `file`
  - `config`

### 저장소

- `GET /api/history`
- `POST /api/history`
- `GET /api/presets`
- `POST /api/presets`
- `PUT /api/presets/:id`
- `DELETE /api/presets/:id`

## DB/저장 구조

SQLite 테이블:

- `presets`
  - `id`
  - `name`
  - `description`
  - `config_json`
  - `created_at`
  - `updated_at`
- `history`
  - `id`
  - `run_type`
  - `file_name`
  - `file_hash`
  - `mime_type`
  - `file_size`
  - `file_pages`
  - `config_json`
  - `roi_json`
  - `result_json`
  - `created_at`

업로드 파일은 `/app/uploads`에 임시 저장 후 요청 완료 시 삭제됩니다. 이력과 프리셋은 `/app/data/app.db`에 유지됩니다.

## 핵심 구현 코드

- Upstage 프록시: `backend/src/services/upstageService.js`
- Vision OCR 오케스트레이션: `backend/src/services/visionLlmService.js`
- 후처리 LLM: `backend/src/services/postprocessService.js`
- 전체 파이프라인: `backend/src/services/pipelineService.js`
- SQLite 저장: `backend/src/db/database.js`
- 메인 대시보드: `frontend/src/pages/DashboardPage.tsx`
- ROI 선택기: `frontend/src/components/RoiSelector.tsx`

## Dockerfile

- `frontend/Dockerfile`
  - Vite build 후 Nginx 정적 서빙
- `backend/Dockerfile`
  - Node 20 + `poppler-utils`
  - Express API 실행

## docker-compose.yml

루트 `docker-compose.yml`은 다음 구성을 제공합니다.

- `frontend`
  - 포트 `8080`
- `backend`
  - 포트 `3001`
  - 볼륨
    - `backend_data`
    - `backend_uploads`

## 실행 방법

1. 환경 파일 준비

```bash
cp .env.example .env
```

2. 빌드 및 실행

```bash
docker compose up -d --build
```

3. 접속

- 웹 UI: `http://localhost:8080`
- 백엔드 헬스체크: `http://localhost:3001/api/health`

## 폐쇄망 배포 방법

연결 가능한 환경에서 이미지를 먼저 빌드하고 저장한 뒤, 폐쇄망으로 반입해 로드합니다.

1. 연결 가능한 환경에서 빌드

```bash
docker compose build
```

2. 이미지 저장

```bash
docker compose images
docker save -o ocr-compare-images.tar <frontend-image-name> <backend-image-name>
```

3. 폐쇄망 환경으로 `ocr-compare-images.tar`, 프로젝트 소스, `.env` 전달

4. 폐쇄망에서 이미지 로드

```bash
docker load -i ocr-compare-images.tar
```

5. 컨테이너 실행

```bash
docker compose up -d
```

## 보안/운영 메모

- 외부 CDN 미사용
- 업로드 파일 형식 제한
- 요청 타임아웃/재시도 지원
- URL은 `http/https`만 허용
- `.env`에서 `ALLOW_PRIVATE_URLS=false`로 두면 사설망 URL 차단
- 폐쇄망 내부 Upstage/LLM 엔드포인트 사용 시 `ALLOW_PRIVATE_URLS=true` 권장
- 업로드 파일은 요청 완료 후 정리

## 향후 개선 포인트

- 결과 diff 시각화
- Upstage elements bbox 오버레이
- 문서별 품질 평가 리포트
- 사용자/팀 단위 preset 분리
- 결과 export 형식 확장
