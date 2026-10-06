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

# 2. 시스템 프롬프트 조립 (설정값 보존 및 완전성 강조)
prompt = [User Request]:
Title: {ISSUE_TITLE}
Description: {ISSUE_BODY}

[CRITICAL REQUIREMENTS]:

COMPLETE SINGLE FILE: Output the 100% complete HTML file from <!DOCTYPE html> to </html>.

NO TRUNCATION: Absolutely NO comments like '// ... existing code ...' or '// Rest remains unchanged'. Every single line of existing working logic must remain intact.

SECURE CONFIGS: Do NOT alter, mock, or replace existing Firebase configurations, API endpoints, or database collection references.

SAFE INTEGRATION: Add new CSS variables/classes cleanly, and register new JS event listeners safely without breaking existing listeners.

PURE OUTPUT: Return ONLY the code inside a markdown block: html ... . No chat, no notes, no markdown outside the block.
"""

payload = {
"contents": [{"parts": [{"text": prompt}]}],
"generationConfig": {
"temperature": 0.15,
"maxOutputTokens": 8192  # 긴 코드 생성 시 중간 끊김 방지
}
}

3. Gemini 2.5 Flash 호출
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

4. 정규식을 사용한 엄격한 코드 블록 추출
pattern = r"(?:html)?\s*([\s\S]*?)\s*"
match = re.search(pattern, generated_text)

if match:
cleaned_code = match.group(1).strip()
else:
# 백틱 없이 순수 코드로만 왔을 경우 대비
cleaned_code = generated_text.strip()

5. 페일세이프 (파일 손상 방지 브레이크)
조건 1: 이전 대비 용량이 65% 미만인 경우 중단
if len(cleaned_code) < len(current_code) * 0.65:
print("[ABORT] 생성된 코드 길이가 비정상적으로 짧습니다. 덮어쓰기를 취소합니다.")
sys.exit(1)

조건 2: HTML 파일인데 닫는 태그가 없으면(중간 끊김) 중단
if TARGET_FILE.endswith(".html") and "" not in cleaned_code:
print("[ABORT] 생성된 코드에  태그가 누락되어 있습니다 (출력 도중 끊김). 덮어쓰기를 취소합니다.")
sys.exit(1)

6. 파일 덮어쓰기
with open(TARGET_FILE, "w", encoding="utf-8") as f:
f.write(cleaned_code)

print(f"[SUCCESS] {TARGET_FILE} 파일이 안전하게 갱신되었습니다.")

[Current Code: {TARGET_FILE}]:
```html
{current_code}
