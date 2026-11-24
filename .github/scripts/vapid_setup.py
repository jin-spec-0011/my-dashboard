"""
Web Push VAPID 키 1회 생성 (GitHub Actions 수동 실행 전용)

- 공개키  → /push_config/vapidPublic        (가족 계정 읽기 가능, 앱 구독에 사용)
- 개인키  → /push_config_private/vapidPrivate (보안 규칙상 클라이언트 접근 불가, 서비스 계정만)
- 공개 저장소이므로 개인키는 절대 출력하지 않음
- 키가 이미 있으면 FORCE=true 가 아닌 한 중단 (기존 구독이 모두 무효가 되는 사고 방지)
"""
import base64
import json
import os
import sys
import time

DB_URL = "https://gogo-manager-f0a68-default-rtdb.firebaseio.com"
PROJECT_ID = "gogo-manager-f0a68"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def fail(msg: str) -> None:
    print(f"::error::{msg}")
    sys.exit(1)


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

    force = os.environ.get("FORCE", "false").lower() == "true"

    try:
        import firebase_admin
        from firebase_admin import credentials, db
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec
    except ImportError as e:
        fail(f"의존성 로드 실패: {e}")

    try:
        firebase_admin.initialize_app(credentials.Certificate(sa), {"databaseURL": DB_URL})
    except Exception as e:  # noqa: BLE001
        fail(f"Firebase 초기화 실패: {type(e).__name__}")

    try:
        existing = db.reference("push_config/vapidPublic").get()
    except Exception as e:  # noqa: BLE001
        fail(f"기존 키 조회 실패: {type(e).__name__}")

    if existing and not force:
        print("::warning::VAPID 키가 이미 있습니다. 교체하려면 force=true 로 다시 실행하세요 (기존 알림 구독은 모두 다시 해야 함).")
        print(f"현재 공개키: {existing}")
        return

    private_key = ec.generate_private_key(ec.SECP256R1())
    private_der = private_key.private_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_raw = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    if len(public_raw) != 65:
        fail("공개키 길이 오류")

    public_b64 = b64url(public_raw)
    now_ms = int(time.time() * 1000)

    try:
        db.reference("push_config_private").set({
            "vapidPrivate": b64url(private_der),
            "createdAt": now_ms,
        })
        db.reference("push_config").set({
            "vapidPublic": public_b64,
            "createdAt": now_ms,
        })
    except Exception as e:  # noqa: BLE001
        fail(f"키 저장 실패: {type(e).__name__}")

    print("✅ VAPID 키 생성·저장 완료 (개인키는 DB 비공개 경로에만 저장)")
    print(f"공개키: {public_b64}")
    if existing:
        print("::warning::키를 교체했습니다. 진세·지혜 폰에서 [끊김 알림 받기]를 다시 눌러야 합니다.")


if __name__ == "__main__":
    main()
