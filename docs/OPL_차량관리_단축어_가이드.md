# OPL — 차량 관리 iOS 단축어 설정 (X1 자동 적산)

- 대상: X1 운행 자동 기록 (단축어 A · B) / 계기판 입력 바로가기 (단축어 C)
- 엑센트: 단축어 없음 — 앱 "차량 관리" 화면에서 수기 입력
- 준비물: 카카오 REST API 키, 앱 "🔑 단축어 토큰" (refresh token)

> ⚠️ 카카오 REST 키 · refresh token은 **단축어 안에만** 넣습니다. 저장소 · 메모 · 카톡에 붙여넣지 않습니다.

---

## 0. 공통 값

| 이름 | 값 |
|---|---|
| FIREBASE_WEB_API_KEY | `AIzaSyBGYhPPlYfPnnEnqa--Sl_OYDw8VmX1fus` (app.js의 공개 웹 키) |
| DB_URL | `https://gogo-manager-f0a68-default-rtdb.firebaseio.com` |
| REFRESH_TOKEN | 앱 홈 → 🔑 단축어 토큰 → 복사한 값 |
| KAKAO_REST_KEY | 카카오 디벨로퍼스 → 내 애플리케이션 → 앱 키 → **REST API 키** |

### 0-1. 토큰 교환 블록 (단축어 A · B 맨 앞에 동일하게 넣기)

1. **텍스트** → REFRESH_TOKEN 붙여넣기
2. **URL 내용 가져오기**
   - URL: `https://securetoken.googleapis.com/v1/token?key=FIREBASE_WEB_API_KEY`
   - 방법: `POST`
   - 요청 본문: `양식(Form)`
     - `grant_type` = `refresh_token`
     - `refresh_token` = (1번 텍스트)
3. **사전 값 가져오기** → 키 `id_token` → 변수 이름 **IDTOKEN**

---

## 1. 단축어 A — X1 출발 (블루투스 연결)

**자동화 설정:** 단축어 앱 → 자동화 → 새로운 자동화 → **블루투스** → 기기: X1 차량 블루투스 이름 → **연결됨** → **즉시 실행** · **실행 시 알림 끔**

| 순서 | 동작 | 설정 |
|---|---|---|
| 1 | 토큰 교환 블록 (0-1) | → IDTOKEN |
| 2 | 현재 위치 가져오기 | → 변수 **START** |
| 3 | 현재 날짜 | |
| 4 | 날짜 형식 지정 | 사용자 지정 `yyyyMMddHHmmss` → 변수 **SID** |
| 5 | 날짜 형식 지정 (3번 날짜) | ISO 8601, 시간 포함 → 변수 **SISO** |
| 6 | 사전 | `startId`(숫자) = SID · `startIso`(텍스트) = SISO · `lat`(숫자) = START의 위도 · `lng`(숫자) = START의 경도 |
| 7 | URL 내용 가져오기 | URL `DB_URL/trip_pending/x1.json?auth=IDTOKEN` · 방법 `PUT` · 요청 본문 `JSON` = 6번 사전 |

---

## 2. 단축어 B — X1 도착 (블루투스 해제)

**자동화 설정:** 블루투스 → X1 → **연결 해제됨** → 즉시 실행 · 알림 끔

| 순서 | 동작 | 설정 |
|---|---|---|
| 1 | 토큰 교환 블록 (0-1) | → IDTOKEN |
| 2 | URL 내용 가져오기 | `DB_URL/trip_pending/x1.json?auth=IDTOKEN` · `GET` → 변수 **PEND** |
| 3 | 만약 | PEND의 `startId` 값이 **없음** → **단축어 중단** |
| 4 | 현재 위치 가져오기 | → 변수 **END** |
| 5 | URL 내용 가져오기 (카카오) | URL `https://apis-navi.kakaomobility.com/v1/directions?origin=〔PEND.lng〕,〔PEND.lat〕&destination=〔END 경도〕,〔END 위도〕&priority=RECOMMEND` · `GET` · 헤더 `Authorization` = `KakaoAK KAKAO_REST_KEY` → **ROUTE** |
| 6 | 사전 값 가져오기 | ROUTE → `routes` → 첫 번째 항목 → **R** |
| 7 | 만약 | R의 `result_code` ≠ 0 → 13번(DELETE) 실행 후 중단 |
| 8 | 계산 | R.`summary.distance` ÷ 1000 → 소수 1자리 반올림 → **KM** |
| 9 | 계산 | R.`summary.duration` ÷ 60 → 정수 반올림 → **RMIN** |
| 10 | 날짜 사이의 시간 | 시작: PEND.`startIso` (날짜로 변환) · 끝: 현재 날짜 · 단위 **분** → **EMIN** |
| 11 | 만약 | KM < 1 **그리고** EMIN < 10 → 13번 실행 후 중단 (블루투스 잠깐 끊김) |
| 12 | 텍스트 | KM < 1 이면 `roundtrip_suspect`, 아니면 `ok` → **FLAG** |
| 12-1 | 현재 날짜 → 형식 `yyyyMMddHHmmss` | → **TID** |
| 12-2 | 현재 날짜 → 형식 `M월 d일 HH:mm` | → **TTXT** |
| 12-3 | 사전 | `id`(숫자) TID · `startId`(숫자) PEND.startId · `car` `X1` · `from`(사전) {lat, lng = PEND 값} · `to`(사전) {lat, lng = END 값} · `distance_km`(숫자) KM · `route_min`(숫자) RMIN · `elapsed_min`(숫자) EMIN · `flag` FLAG · `source` `kakao_est` · `author` `진세` · `time` TTXT |
| 12-4 | URL 내용 가져오기 | `DB_URL/trip_logs/〔TID〕.json?auth=IDTOKEN` · **`PUT`** · JSON = 12-3 사전 |
| 13 | URL 내용 가져오기 | `DB_URL/trip_pending/x1.json?auth=IDTOKEN` · **`DELETE`** |

> `trip_logs`는 반드시 **PUT + 키=TID** 로 저장합니다. POST를 쓰면 키가 자동 생성되어 앱에서 삭제 · 거리 보정이 동작하지 않습니다.

---

## 3. 단축어 C — 계기판 입력 바로가기 (X1 · 엑센트 공통)

| 순서 | 동작 | 설정 |
|---|---|---|
| 1 | URL | `https://jin-spec-0011.github.io/my-dashboard/#vehicle` |
| 2 | URL 열기 | |

앱 화면에서 입력하면 **직전 값보다 작은 값 거부 · 20,000km 이상 급증 확인**이 자동 적용됩니다. (단축어에서 직접 POST하면 이 검증을 건너뜀)

권장: 엑센트는 **주유 직후**, X1은 **매월 1일 전후** 실행.

---

## 4. 처음 1회 설정 순서

1. 카카오 디벨로퍼스 → 앱 생성 → REST API 키 확인 → 카카오모빌리티 길찾기 사용 설정
2. Firebase 콘솔 → 계획서 7장 보안 규칙 추가분 적용
3. 앱 업데이트 반영 확인 (홈에 🔧 차량 관리 카드 표시)
4. 앱 → 차량 관리 → X1 · 엑센트 각각 **현재 계기판 값 1회 입력**
5. 앱 → 정비 현황 → 항목별 **설정** → 마지막 정비 km · 날짜 입력 (모르면 비워두기 = 알림 제외)
6. 단축어 A · B 작성 → 자동화 연결
7. X1 시동 → 앱에서 "🟢 운행 중" 표시 확인 → 도착 후 "최근 운행"에 1건 생성 확인

---

## 5. 트러블슈팅

| 증상 | 원인 | 조치 |
|---|---|---|
| 401 / `Permission denied` | IDTOKEN 미전달 · refresh token 만료 · 보안 규칙 미적용 | 토큰 재발급(앱 🔑) → 단축어 텍스트 교체 · 규칙 확인 |
| 카카오 401 | REST 키 대신 JS/네이티브 키 사용 | 앱 키 → **REST API 키**로 교체 |
| 카카오 403 | 길찾기 API 미활성 | 카카오 디벨로퍼스 → 카카오모빌리티 사용 설정 |
| result_code 104 등 | 출발·도착이 너무 가까움 · 좌표 순서 오류 | 좌표는 **경도,위도** 순서인지 확인 |
| "종료되지 않은 운행" 경고 | 단축어 B 미실행 (휴대폰 꺼짐 · 자동화 확인 대기) | 앱에서 **정리** · 자동화 "즉시 실행" 확인 |
| 운행 기록 중복 | 블루투스 짧은 재연결 | 1km 미만 · 10분 미만은 자동 폐기 — 그 외는 합계에 영향 없음(구간 분할) |
