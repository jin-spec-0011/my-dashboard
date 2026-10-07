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
    print("[ERROR] GEMINI_API_KEY가 비어 있습니다.")
    sys.exit(1)

# API 키 앞뒤에 들어갔을 수 있는 공백/줄바꿈 자동 제거
API_KEY = API_KEY.strip()

# 1. 대상 파일 읽기
if not os.path.exists(TARGET_FILE):
    print(f"[ERROR] 대상 파일({TARGET_FILE})을 찾을 수 없습니다.")
    sys.exit(1)

with open(TARGET_FILE, "r", encoding="utf-8") as f:
    current_code = f.read()

# 2. 프롬프트 조립
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

# 3. 안정적인 공식 모델 순차 호출 (404 에러 방지)
models_to_try = [
    "gemini-1.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-pro"
]

generated_text = None

for model in models_to_try:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={API_KEY}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req) as res:
            response_body = json.loads(res.read().decode("utf-8"))
            generated_text = response_body["candidates"][0]["content"]["parts"][0]["text"]
            print(f"[SUCCESS] 구글 AI 모델({model}) 연결 및 코드 생성 성공!")
            break
    except urllib.error.HTTPError as e:
        error_msg = e.read().decode("utf-8", errors="ignore")
        print(f"[INFO] 모델 {model} 실패 (HTTP {e.code}). 다음 대체 모델 시도...")
        if model == models_to_try[-1]:
            print(f"[API ERROR] 모든 모델 호출 실패: {e}")
            print(f"상세 에러 내용: {error_msg}")
            sys.exit(1)
    except Exception as e:
        print(f"[API ERROR] 통신 실패: {e}")
        sys.exit(1)

if not generated_text:
    print("[ERROR] 생성된 코드가 비어 있습니다.")
    sys.exit(1)

# 4. 정규식을 사용한 코드 블록 추출
pattern = r"```(?:html)?\s*([\s\S]*?)\s*```"
match = re.search(pattern, generated_text)

if match:
    cleaned_code = match.group(1).strip()
else:
    cleaned_code = generated_text.strip()

# 5. 페일세이프 (파일 손상 방지)
if len(cleaned_code) < len(current_code) * 0.65:
    print("[ABORT] 생성된 코드가 너무 짧습니다. 덮어쓰기를 취소합니다.")
    sys.exit(1)

if TARGET_FILE.endswith(".html") and "</html>" not in cleaned_code:
    print("[ABORT] </html> 태그가 누락되어 있습니다. 덮어쓰기를 취소합니다.")
    sys.exit(1)

# 6. 파일 덮어쓰기
with open(TARGET_FILE, "w", encoding="utf-8") as f:
    f.write(cleaned_code)

print(f"[SUCCESS] {TARGET_FILE} 파일이 안전하게 갱신되었습니다.")
