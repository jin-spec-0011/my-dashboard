"""
디지털 액자 끊김 감시 + Web Push 발송 (GitHub Actions 15분 크론)

- 대상: /frame/{fid}/devices 중 watch=true 기기
- 끊김: now - heartbeat.lastSeen > STALE_MIN(30분) 이고, 이번 끊김에 대해 아직 알리지 않았을 때 1회 발송
- 복구: 알린 뒤 다시 연결되면 "다시 연결됨" 1회 발송
- 발송 대상: /push_subscriptions/{uid}/{subId} 전체 (진세·지혜), 404/410 응답 구독은 삭제
- 공개 저장소: 로그에는 건수·기기 이름만 출력 (엔드포인트·키 미출력)
- TEST=true: 모든 구독에 테스트 알림 1회
"""
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

DB_URL = "https://gogo-manager-f0a68-default-rtdb.firebaseio.com"
PROJECT_ID = "gogo-manager-f0a68"
STALE_MIN = 30
VAPID_SUB = "https://jin-spec-0011.github.io/my-dashboard/"
KST = timezone(timedelta(hours=9))
CONFIG_JS = os.path.join(os.path.dirname(__file__), "..", "..", "js", "frame-config.js")


def fail(msg: str) -> None:
    print(f"::error::{msg}")
    sys.exit(1)


def read_family_id() -> str:
    try:
        with open(CONFIG_JS, encoding="utf-8") as f:
            m = re.search(r"familyId:\s*'(fam_[a-z0-9]{10})'", f.read())
    except OSError as e:
        fail(f"frame-config.js 읽기 실패: {e}")
    if not m:
        fail("frame-config.js 에서 familyId 를 찾지 못했습니다.")
    return m.group(1)


def kst_hm(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, KST).strftime("%H:%M")


def main() -> None:
    sa_raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
    if not sa_raw.strip():
        fail("FIREBASE_SERVICE_ACCOUNT 시크릿이 없습니다.")
    try:
        sa = json.loads(sa_raw)
    except json.JSONDecodeError:
        fail("서비스 계정 JSON 형식 오류")
    if sa.get("type") != "service_account" or sa.get("project_id") != PROJECT_ID:
        fail("서비스 계정 키가 이 프로젝트용이 아닙니다.")

    test_mode = os.environ.get("TEST", "false").lower() == "true"
    fid = read_family_id()

    try:
        import firebase_admin
        from firebase_admin import credentials, db
        from pywebpush import WebPushException, webpush
    except ImportError as e:
        fail(f"의존성 로드 실패: {e}")

    try:
        firebase_admin.initialize_app(credentials.Certificate(sa), {"databaseURL": DB_URL})
        vapid_private = db.reference("push_config_private/vapidPrivate").get()
        subs_tree = db.reference("push_subscriptions").get() or {}
    except Exception as e:  # noqa: BLE001
        fail(f"Firebase 읽기 실패: {type(e).__name__}")

    if not vapid_private:
        fail("VAPID 개인키가 없습니다. VAPID Setup 워크플로를 먼저 실행하세요.")

    subs = []
    for uid, items in (subs_tree.items() if isinstance(subs_tree, dict) else []):
        for sub_id, s in (items.items() if isinstance(items, dict) else []):
            if isinstance(s, dict) and s.get("endpoint") and s.get("p256dh") and s.get("auth"):
                subs.append((uid, sub_id, s))

    def send_all(title: str, body: str, tag: str) -> int:
        sent = 0
        payload = json.dumps({"title": title, "body": body, "tag": tag}, ensure_ascii=False)
        for uid, sub_id, s in subs:
            try:
                webpush(
                    subscription_info={"endpoint": s["endpoint"], "keys": {"p256dh": s["p256dh"], "auth": s["auth"]}},
                    data=payload,
                    vapid_private_key=vapid_private,
                    vapid_claims={"sub": VAPID_SUB},
                    ttl=3600,
                    headers={"Urgency": "high"},
                    timeout=10,
                )
                sent += 1
            except WebPushException as e:
                code = getattr(getattr(e, "response", None), "status_code", None)
                if code in (404, 410):
                    try:
                        db.reference(f"push_subscriptions/{uid}/{sub_id}").delete()
                        print("만료된 구독 1건 삭제")
                    except Exception:  # noqa: BLE001
                        pass
                else:
                    print(f"::warning::푸시 발송 실패 (HTTP {code})")
            except Exception as e:  # noqa: BLE001
                print(f"::warning::푸시 발송 오류: {type(e).__name__}")
        return sent

    print(f"구독 {len(subs)}건")

    if test_mode:
        n = send_all("🔔 GOGO 테스트 알림", "액자 끊김 알림이 정상적으로 연결되었습니다.", "gogo-test")
        print(f"테스트 알림 {n}/{len(subs)}건 발송")
        return

    try:
        base = db.reference(f"frame/{fid}")
        devices = base.child("devices").get() or {}
        beats = base.child("heartbeat").get() or {}
        alerts = base.child("alert").get() or {}
    except Exception as e:  # noqa: BLE001
        fail(f"액자 데이터 읽기 실패: {type(e).__name__}")

    now = int(time.time() * 1000)
    stale_ms = STALE_MIN * 60 * 1000
    for dev_id, d in (devices.items() if isinstance(devices, dict) else []):
        if not isinstance(d, dict) or not d.get("watch"):
            continue
        name = str(d.get("name") or dev_id)[:40]
        place = str(d.get("placement") or "미정")
        last = int((beats.get(dev_id) or {}).get("lastSeen") or 0) if isinstance(beats, dict) else 0
        alert = (alerts.get(dev_id) or {}) if isinstance(alerts, dict) else {}
        sent_at = int(alert.get("sentAt") or 0)
        recovered_at = int(alert.get("recoveredAt") or 0)

        if not last:
            print(f"[{name}] 하트비트 기록 없음 — 건너뜀")
            continue

        if now - last > stale_ms:
            if sent_at <= last:
                body = f"{name}({place}) 연결이 {STALE_MIN}분 이상 끊겼습니다 (마지막 {kst_hm(last)})"
                n = send_all("🖼️ 액자 연결 끊김", body, f"frame-{dev_id}")
                base.child(f"alert/{dev_id}").set({"sentAt": now, "recoveredAt": 0})
                print(f"[{name}] 끊김 알림 {n}건 발송")
            else:
                print(f"[{name}] 끊김 지속 (이미 알림)")
        else:
            if sent_at and last > sent_at and recovered_at < sent_at:
                n = send_all("✅ 액자 다시 연결됨", f"{name}({place}) 연결이 복구되었습니다 ({kst_hm(last)})", f"frame-{dev_id}")
                base.child(f"alert/{dev_id}").update({"recoveredAt": now})
                print(f"[{name}] 복구 알림 {n}건 발송")
            else:
                print(f"[{name}] 정상 ({round((now - last) / 60000)}분 전)")


if __name__ == "__main__":
    main()
