# OPL — 주차 단축어 인증 추가 (규칙 잠금 대응)

- 대상: iOS 단축어 **"주차"** (`parking_logs.json` 기록)
- 이유: 보안 규칙 잠금 후 토큰 없는 요청은 `401 Permission denied`로 거부됨
- 소요: 약 5분 / 단축어 1개
- 준비물: 앱 홈 → **🔑 단축어 토큰** 버튼으로 복사한 값 (refresh token)

> ⚠️ refresh token은 **단축어 안에만** 넣습니다. 메모·카톡·저장소에 붙여넣지 않습니다.
> 이미 차량 관리 단축어(A·B)에 쓰는 토큰과 같은 값을 써도 됩니다.

---

## 0. 공통 값

| 이름 | 값 |
|---|---|
| FIREBASE_WEB_API_KEY | `AIzaSyBGYhPPlYfPnnEnqa--Sl_OYDw8VmX1fus` (app.js의 공개 웹 키) |
| DB_URL | `https://gogo-manager-f0a68-default-rtdb.firebaseio.com` |
| REFRESH_TOKEN | 앱 홈 → 🔑 단축어 토큰 → 복사한 값 |

---

## 1. 수정 순서

1. 단축어 앱 → **주차** 단축어 편집
2. **맨 위**(차종·층수·구역 입력보다 앞)에 아래 3개 동작 추가 — 차량 관리 OPL의 토큰 교환 블록과 동일

   | 순서 | 동작 | 설정 |
   |---|---|---|
   | 1 | 텍스트 | REFRESH_TOKEN 붙여넣기 |
   | 2 | URL 내용 가져오기 | URL `https://securetoken.googleapis.com/v1/token?key=FIREBASE_WEB_API_KEY` · 방법 `POST` · 요청 본문 `양식` · `grant_type` = `refresh_token` · `refresh_token` = (1번 텍스트) |
   | 3 | 사전 값 가져오기 | 키 `id_token` → 변수 이름 **IDTOKEN** |

3. 아래쪽 **URL 내용 가져오기**(parking_logs) 동작의 URL 끝에 `?auth=` + **IDTOKEN** 변수를 붙임

   ```
   변경 전: DB_URL/parking_logs.json
   변경 후: DB_URL/parking_logs.json?auth=〔IDTOKEN〕
   ```

   - 방법(POST/PUT)과 요청 본문(사전)은 **그대로** 둡니다.

4. 단축어 맨 끝에 **결과 확인** 추가 (실패를 바로 알기 위함)

   | 순서 | 동작 | 설정 |
   |---|---|---|
   | 5 | 만약 | 3번 URL 결과에 `error` 포함 → **알림 보기** "주차 저장 실패: 토큰 확인" |

---

## 2. 확인 (규칙 병합 **전**에 실행)

1. 수정한 단축어를 수동 실행 → 앱 주차 화면에 새 기록 표시 확인
2. 같은 기록이 앱 "최근 주차"에 1건만 생겼는지 확인 (중복 없음)
3. 지혜 님 폰에도 주차 단축어가 있으면 **지혜 님 계정으로 로그인한 앱에서 받은 토큰**으로 같은 수정
4. 위 확인이 끝나면 규칙 잠금 PR 병합 → 병합 후 단축어 1회 더 실행해 정상 기록 확인

---

## 3. 문제 해결

| 증상 | 원인 | 조치 |
|---|---|---|
| `{"error":"Permission denied"}` | `?auth=` 누락 또는 IDTOKEN 비어 있음 | 3번 URL 끝 확인, 2번 토큰 교환 결과에 `id_token` 있는지 확인 |
| 토큰 교환 결과에 `TOKEN_EXPIRED` / `INVALID_REFRESH_TOKEN` | Google 비밀번호 변경, 계정 보안 조치 등으로 토큰 폐기 | 앱 재로그인 → 🔑 단축어 토큰 다시 복사 → 1번 텍스트 교체 |
| 토큰 교환 결과에 `API key not valid` | 웹 API 키 오타 | 0장 값 다시 붙여넣기 |

---

## 실패 방지 체크리스트

1. **병합 순서**: 단축어 수정 → 수동 실행 확인 → 규칙 PR 병합. 순서가 바뀌면 그 사이 주차 기록이 저장되지 않습니다.
2. **토큰 보관 위치**: refresh token은 그 Google 계정의 DB 권한과 같습니다. 단축어 외에는 붙여넣지 않습니다.
3. **토큰 폐기 시 일괄 교체**: Google 비밀번호를 바꾸면 기존 토큰이 폐기됩니다. 그때는 모든 단축어(주차, 차량 A·B)의 토큰을 함께 교체합니다.
