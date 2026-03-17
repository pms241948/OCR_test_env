# OCR Compare App 현재 작업 현황

## 기준 시각

- 날짜: 2026-03-17
- 마지막 상태 확인:
  - 프론트엔드 `http://localhost:8080` 응답 확인 완료 (`HTTP 200`)
  - 백엔드 `http://localhost:3001/api/health` 응답 확인 완료

## 프로젝트 개요

- 업로드한 PDF 또는 이미지 1건에 대해 다음 3단계를 실험할 수 있는 웹 기반 OCR 비교 도구입니다.
  - Upstage Document Parse OCR
  - Vision LLM OCR
  - 후처리 LLM 정제
- 프런트엔드는 React, Vite, Tailwind CSS, Zustand 기반입니다.
- 백엔드는 Node.js, Express, Multer, Axios, better-sqlite3 기반입니다.
- 배포는 Docker Compose 기준으로 동작합니다.

## 현재까지 구현 완료된 범위

### 1. 기본 파이프라인

- 단일 파일 업로드 지원
  - PDF
  - PNG
  - JPG
  - JPEG
- 파일 메타정보 표시
  - 파일명
  - 크기
  - MIME 타입
  - 페이지 수
- Upstage DP 프록시 호출
- Vision LLM OCR 호출
- 후처리 LLM 호출
- 전체 파이프라인 일괄 실행

### 2. Upstage DP 관련

- DP URL 입력 UI
- 엔드포인트 확인 URL 입력 UI
- 라이선스 등록 URL/키 입력 UI
- OCR 모드 선택
- coordinates 포함 여부 설정
- output format 다중 선택
- model 입력
- timeout / retry 설정
- 원본 JSON 결과 표시

### 3. Vision LLM 관련

- OpenAI 호환 엔드포인트 입력 UI
- model / api key / temperature / max tokens / top_p 설정
- system prompt / user prompt / extraction rules 수정 UI
- 모범답안 텍스트 직접 입력
- 모범답안 파일 업로드
- 모범답안 사용 여부 토글
- 범위 지정 지원
  - full document
  - page range
  - roi
  - page + roi
- ROI 입력 지원
  - 드래그 선택
  - 숫자 좌표 입력
- Vision 결과 텍스트 / JSON / 사용 프롬프트 / 사용 모범답안 표시

### 4. 후처리 LLM 관련

- 후처리 URL 입력 UI
- model / api key / temperature / max tokens / top_p 설정
- system prompt / user prompt 수정 UI
- 모범답안 직접 입력
- 모범답안 파일 업로드
- 모범답안 사용 여부 토글
- Upstage 결과 + Vision 결과를 조합한 후처리 호출
- 최종 텍스트 / JSON / 사용 프롬프트 / 사용 모범답안 표시

### 5. 결과 비교 / 운영 기능

- Upstage OCR / Vision OCR / Postprocess 결과 3열 비교 UI
- 텍스트 복사 버튼
- 텍스트 다운로드 버튼
- JSON 접기/펼치기
- 프리셋 저장 / 불러오기 / 덮어쓰기 / 삭제
- 실행 이력 저장 / 불러오기
- 로컬 스토리지 기반 최근 설정 유지
- SQLite 기반 프리셋 / 이력 저장

## 이번 최신 작업에서 반영된 내용

### 다국어 전환 추가

- 웹 UI에 영어 / 한글 전환 기능을 추가했습니다.
- 헤더 우측에서 즉시 언어를 바꿀 수 있습니다.
- 언어 설정은 Zustand persist로 저장되어 새로고침 후에도 유지됩니다.
- 주요 섹션, 버튼, 상태 라벨, 결과 패널, ROI UI까지 번역이 연결된 상태입니다.

### 관련 주요 파일

- `frontend/src/pages/DashboardPage.tsx`
- `frontend/src/utils/i18n.ts`
- `frontend/src/stores/useAppStore.ts`
- `frontend/src/components/ResultPane.tsx`
- `frontend/src/components/RoiSelector.tsx`

## Docker / 실행 상태

- `docker compose up -d --build` 기준으로 프런트엔드와 백엔드 빌드 및 실행 확인 완료
- 현재 접속 주소
  - 프런트엔드: `http://localhost:8080`
  - 백엔드: `http://localhost:3001`
  - 헬스체크: `http://localhost:3001/api/health`

## 최근 검증 결과

- 프런트엔드 빌드 성공
- Docker 프런트엔드 이미지 재빌드 성공
- 백엔드 헬스체크 정상 응답
- 브라우저에서 직접 화면 확인 가능한 상태
- 영어 / 한글 토글 UI 반영 완료

## 아직 남아 있는 실제 검증 항목

- 실제 Upstage DP 서버와의 실문서 OCR 검증
- 실제 Vision LLM 엔드포인트 연결 검증
- 실제 후처리 LLM 엔드포인트 연결 검증
- ROI가 실제 OCR 품질에 미치는 영향 확인
- 프롬프트 튜닝 결과 비교 데이터 축적
- 프런트 번들 크기 최적화

## 저장소 상태

- 원격 저장소: `https://github.com/pms241948/OCR_test_env.git`
- 현재 브랜치: `master`

### 최근 커밋

- `8d3f29d` Add English and Korean UI language toggle
- `5c12137` Add current project status report
- `e1a1c64` OCR 비교 및 후처리 LLM 웹 구현

## 다음 권장 작업

1. 실제 Upstage DP URL과 LLM URL을 넣고 문서 1건으로 end-to-end 검증
2. 한글/영문 전환 시 남아 있는 비번역 문구가 없는지 UI 점검
3. 실험용 프리셋 2~3개를 저장해서 프롬프트 비교 흐름 고정
4. 필요하면 diff 비교 또는 bbox 시각화 기능 확장
