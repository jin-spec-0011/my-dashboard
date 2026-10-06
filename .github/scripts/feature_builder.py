import os
import sys
import json
import re
import urllib.request

API_KEY = os.environ.get("GEMINI_API_KEY")
ISSUE_TITLE = os.environ.get("ISSUE_TITLE", "")
ISSUE_BODY = os.environ.get("ISSUE_BODY", "")
TARGET_FILE = os.environ.get("TARGET_FILE", "index.html")

if not API_KEY:
    print("[ERROR] GEMINI_API_KEY가 설정되지 않았습니다.")
    sys.exit(1)

# 1. 대상 원본 파일 읽기
if not os.path.exists(TARGET_FILE):
    print(f"[ERROR] 대상 파일({TARGET_FILE})을 찾을 수 없습니다.")
    sys.exit(1)

with open(TARGET_FILE, "r", encoding="utf-8") as f:
    current_code = f.read()

# 2. 시스템 프롬프트 조립 (따옴표 충돌 방지 구조)
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
    "2. NO TRUNCATION: Absolutely NO comments like '// ... existing code ...'. Keep every single working logic intact.",
    "3. SECURE CONFIGS: Do NOT alter, mock, or replace existing Firebase configurations, API keys, or endpoints.",
    "4. SAFE INTEGRATION: Add new CSS cleanly and register new JS event listeners without breaking existing ones.",
    "5. PURE OUTPUT: Return ONLY the code inside a single ```html ... ``` block. No notes, no chat."
]
prompt = "\n".join(prompt_parts)

payload = {
    "contents": [{"parts": [{"text": prompt}]}],
    "generationConfig": {
        "temperature": 0.15,
        "maxOutputTokens": 8192
    }
}

# 3. Gemini 2.5 Flash 호출
url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={API_KEY}"
req = urllib.request.Request(
    url,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)

try:
    with urllib.request.urlopen(req) as res:
        response_body = json.loads(res.read().decode("utf-8"))
        generated_text = response_body["candidates"][0]["content"]["parts"][0]["text"]
except Exception as e:
    print(f"[API ERROR] Gemini API 호출 실패: {e}")
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
