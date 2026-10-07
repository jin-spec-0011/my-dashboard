import os
import sys
import json
import re
import urllib.request
import urllib.error

API_KEY = os.environ.get("GEMINI_API_KEY")
ISSUE_TITLE = os.environ.get("ISSUE_TITLE", "")
ISSUE_BODY = os.environ.get("ISSUE_BODY", "")
TARGET_FILE = os.environ.get("TARGET_FILE", "index.html")

if not API_KEY:
    print("[ERROR] GEMINI_API_KEY 환경변수가 비어 있습니다.")
    sys.exit(1)

API_KEY = API_KEY.strip()

# 1. 대상 원본 파일 읽기
if not os.path.exists(TARGET_FILE):
    print(f"[ERROR] 대상 파일({TARGET_FILE})을 찾을 수 없습니다.")
    sys.exit(1)

with open(TARGET_FILE, "r", encoding="utf-8") as f:
    current_code = f.read()

# 구글 공식 권장: ListModels API를 호출하여 내 API 키로 사용 가능한 모델 목록 실시간 조회
list_url = f"https://generativelanguage.googleapis.com/v1beta/models?key={API_KEY}"
print("[INFO] 구글 AI 서버에 사용 가능한 최신 모델 목록을 조회합니다...")

try:
    req = urllib.request.Request(list_url)
    with urllib.request.urlopen(req) as res:
        models_data = json.loads(res.read().decode("utf-8"))
        raw_models = models_data.get("models", [])
except urllib.error.HTTPError as e:
    err_body = e.read().decode("utf-8", errors="ignore")
    print(f"[API ERROR] API 키 검증 또는 모델 목록 조회 실패 (HTTP {e.code}):")
    print(err_body)
    sys.exit(1)
except Exception as e:
    print(f"[API ERROR] 모델 목록 통신 실패: {e}")
    sys.exit(1)

# generateContent 기능을 지원하는 활성 모델만 필터링
candidate_models = []
for m in raw_models:
    methods = m.get("supportedGenerationMethods", [])
    if "generateContent" in methods:
        candidate_models.append(m.get("name", ""))

print(f"[INFO] 현재 사용 가능한 유효 모델 수: {len(candidate_models)}개")

if not candidate_models:
    print("[ERROR] 현재 API 키에서 generateContent를 지원하는 모델이 없습니다.")
    sys.exit(1)

# 가장 빠르고 코딩 성능이 좋은 Flash 및 최신 모델 우선 정렬
def rank_model(name):
    lower = name.lower()
    score = 0
    if "flash" in lower:
        score += 50
    if "2.5" in lower or "3" in lower:
        score += 30
    elif "2.0" in lower or "2" in lower:
        score += 20
    elif "1.5" in lower:
        score += 10
    return score

sorted_models = sorted(candidate_models, key=rank_model, reverse=True)
print(f"[INFO] 최우선 선택 후보 모델: {sorted_models[0]}")

prompt_parts = [
    "You are an elite Senior Frontend Architect specializing in Vanilla JavaScript, HTML5, CSS3, and Firebase.",
    "Modify and expand the provided code strictly based on the request.",
    "",
    f"=== Current Code: {TARGET_FILE} ===",
    current_code,
    "=== End of Current Code ===",
    "",
    "=== User Request ===",
    f"Title: {ISSUE_TITLE}",
    f"Description: {ISSUE_BODY}",
    "=== End of Request ===",
    "",
    "[CRITICAL REQUIREMENTS]",
    "1. COMPLETE SINGLE FILE: Output the 100% complete HTML file from <!DOCTYPE html> to </html>.",
    "2. NO TRUNCATION: Absolutely NO comments like '// ... existing code ...'. Keep all working logic intact.",
    "3. SECURE CONFIGS: Do NOT alter or replace existing Firebase configurations, API keys, or endpoints.",
    "4. SAFE INTEGRATION: Add new CSS cleanly and register new JS event listeners safely.",
    "5. PURE OUTPUT: Return ONLY the code inside a single ```html ... ``` block. No notes, no markdown outside."
]
prompt = "\n".join(prompt_parts)

payload = {
    "contents": [{"parts": [{"text": prompt}]}],
    "generationConfig": {
        "temperature": 0.15,
        "maxOutputTokens": 8192
    }
}

generated_text = None

for model_resource in sorted_models:
    # model_resource는 "models/gemini-..." 형태이므로 그대로 연결
    if model_resource.startswith("models/"):
        call_url = f"https://generativelanguage.googleapis.com/v1beta/{model_resource}:generateContent?key={API_KEY}"
    else:
        call_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_resource}:generateContent?key={API_KEY}"

    print(f"[INFO] AI 모델 호출 시도: {model_resource}")
    call_req = urllib.request.Request(
        call_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(call_req) as res:
            response_body = json.loads(res.read().decode("utf-8"))
            generated_text = response_body["candidates"][0]["content"]["parts"][0]["text"]
            print(f"[SUCCESS] 구글 AI 모델({model_resource}) 호출 및 코드 생성 성공!")
            break
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="ignore")
        print(f"[WARN] {model_resource} 호출 실패 (HTTP {e.code}). 다음 후보 모델 시도...")
        continue
    except Exception as e:
        print(f"[WARN] {model_resource} 통신 실패: {e}")
        continue

if not generated_text:
    print("[API ERROR] 사용 가능한 모든 AI 모델 호출에 실패했습니다.")
    sys.exit(1)

pattern = r"```(?:html)?\s*([\s\S]*?)\s*```"
match = re.search(pattern, generated_text)

if match:
    cleaned_code = match.group(1).strip()
else:
    cleaned_code = generated_text.strip()

# 페일세이프 검증 (코드 축약 방지)
if len(cleaned_code) < len(current_code) * 0.65:
    print("[ABORT] 생성된 코드가 기존 대비 너무 짧습니다. 덮어쓰기를 취소합니다.")
    sys.exit(1)

if TARGET_FILE.endswith(".html") and "</html>" not in cleaned_code:
    print("[ABORT] </html> 태그가 누락되어 있습니다. 덮어쓰기를 취소합니다.")
    sys.exit(1)

with open(TARGET_FILE, "w", encoding="utf-8") as f:
    f.write(cleaned_code)

print(f"[SUCCESS] {TARGET_FILE} 파일이 안전하게 갱신되었습니다.")
