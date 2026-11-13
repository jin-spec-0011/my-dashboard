/**
 * Firebase Realtime Database 보안 규칙 테스트 (에뮬레이터 전용)
 * 실행: firebase emulators:exec --only database "node firebase-tests/rules.test.mjs"
 * - 인증 없는 REST 요청 = 실제 앱 / iOS 단축어와 동일 조건 → 규칙이 적용됨
 * - 하나라도 실패하면 exit 1 → 워크플로가 배포하지 않음
 */
const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
const NS = 'gogo-manager-f0a68-default-rtdb';

const url = (path) => `http://${HOST}/${path.replace(/^\/+/, '')}.json?ns=${NS}`;

async function req(method, path, body, owner = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (owner) headers.Authorization = 'Bearer owner';
  const res = await fetch(url(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  await res.text();
  return res.status;
}

const results = [];
async function expect(name, method, path, body, allowed) {
  let status = 0;
  try {
    status = await req(method, path, body);
  } catch (e) {
    status = -1;
  }
  const ok = allowed ? status === 200 : (status === 401 || status === 403);
  results.push({ ok, name, status, want: allowed ? 'ALLOW' : 'DENY' });
}

const parking = (id, extra = {}) => Object.assign({
  id, car: 'X1', floor: 'B1', slot: '18A', text: 'X1 - B1-18A', author: '진세', time: '10월 28일 21:00', type: '지하 주차장'
}, extra);

/* 🔧 차량 관리 페이로드 (js/mileage.js · iOS 단축어 규격) */
const trip = (id, extra = {}) => Object.assign({
  id, startId: id - 3000, car: 'X1', from: { lat: 36.63, lng: 127.43 }, to: { lat: 36.70, lng: 127.38 },
  distance_km: 18.4, route_min: 25, elapsed_min: 28, flag: 'ok', source: 'kakao_est', author: '진세', time: '11월 13일 10:00'
}, extra);
const odo = (id, car, km) => ({ id, car, odometer_km: km, author: '진세', time: '11월 13일 10:00' });
const rule = (extra = {}) => Object.assign({
  name: '타이어 위치 교환', interval_km: 10000, interval_months: 12, warn_km: 1000, warn_days: 30, enabled: true, base_km: 0, base_date: '', order: 2, custom: false
}, extra);
const mlog = (id, extra = {}) => Object.assign({
  id, car: 'X1', itemKey: 'tire_rotation', done_km: 12000, done_date: '2026-11-13', memo: '', author: '진세', time: '11월 13일 10:00'
}, extra);

async function main() {
  /* 기존 데이터 시드 (관리자 권한) */
  await req('PUT', '/', {
    parking_logs: { 0: parking(1761600000000), 20261028015500: parking(20261028015500) },
    family_todos: [{ id: 1, text: '우유', completed: false }],
    family_schedules: [{ id: 2, title: '휴가', date: '2026-11-07', author: '진세' }],
    private_schedules: { jinse: [{ id: 3, title: '비밀', date: '2026-10-30' }] },
    calendar_data: { 'calendar_goal_2026-10': '건강한 10월' },
    auth_pins: { jinse: 'a'.repeat(64) },
    legacy_unknown: { x: 1 }
  }, true);

  /* ── 허용되어야 하는 동작 (앱 / 단축어) ── */
  await expect('주차 목록 읽기', 'GET', '/parking_logs', undefined, true);
  await expect('단축어 PUT /parking_logs/{14자리id}', 'PUT', '/parking_logs/20261028210000', parking(20261028210000), true);
  await expect('단축어 POST /parking_logs', 'POST', '/parking_logs', parking(20261028210500), true);
  await expect('앱 트랜잭션: 주차 전체 키드 객체 저장', 'PUT', '/parking_logs', { 20261028211000: parking(20261028211000, { photoBase64: 'data:image/jpeg;base64,' + 'A'.repeat(120000) }) }, true);
  await expect('장보기 배열 저장', 'PUT', '/family_todos', [{ id: 10, text: '계란', completed: false }], true);
  await expect('메모 배열 저장', 'PUT', '/family_stickies', [{ id: 11, text: '와이파이 비번', completed: false }], true);
  await expect('가계부 배열 저장', 'PUT', '/family_ledger', [{ id: 12, amount: 5500, date: '2026-10-28', desc: '마트' }], true);
  await expect('연속 일정 저장(endDate)', 'PUT', '/family_schedules', [{ id: 13, title: '여행', date: '2026-10-30', endDate: '2026-11-02', author: '가족' }], true);
  await expect('여행 배열 저장', 'PUT', '/family_trips', [{ id: 14, place: '강릉', date: '2026-10-28' }], true);
  await expect('비공개 일정(진세) 읽기', 'GET', '/private_schedules/jinse', undefined, true);
  await expect('비공개 일정(지혜) 저장', 'PUT', '/private_schedules/jihye', [{ id: 15, title: '비밀', date: '2026-10-31' }], true);
  await expect('PIN 해시 읽기', 'GET', '/auth_pins', undefined, true);
  await expect('PIN 해시 저장(64자 hex)', 'PUT', '/auth_pins/jinse', 'b'.repeat(64), true);
  await expect('PIN 초기화(삭제)', 'DELETE', '/auth_pins/jihye', undefined, true);
  await expect('캘린더 목표/메모 읽기', 'GET', '/calendar_data', undefined, true);
  await expect('캘린더 목표 저장', 'PUT', '/calendar_data/calendar_goal_2026-11', '가족 여행', true);
  await expect('캘린더 메모 저장', 'PUT', '/calendar_data/calendar_memo_2026-11', '• 11-01 [가족] 여행', true);
  await expect('주차 개별 삭제', 'DELETE', '/parking_logs/20261028210000', undefined, true);
  await expect('주차 전체 삭제(clearAll)', 'DELETE', '/parking_logs', undefined, true);

  /* ── 🔧 차량 관리: 허용 ── */
  await expect('단축어A PUT /trip_pending/x1', 'PUT', '/trip_pending/x1', { startId: 20261113090000, startIso: '2026-11-13T09:00:00+09:00', lat: 36.63, lng: 127.43 }, true);
  await expect('출발 기록 읽기', 'GET', '/trip_pending', undefined, true);
  await expect('단축어B PUT /trip_logs/{14자리id}', 'PUT', '/trip_logs/20261113100000', trip(20261113100000), true);
  await expect('왕복 의심 운행 저장', 'PUT', '/trip_logs/20261113110000', trip(20261113110000, { distance_km: 0.4, elapsed_min: 45, flag: 'roundtrip_suspect' }), true);
  await expect('앱: 왕복 거리 수동 보정', 'PUT', '/trip_logs/20261113110000/manual_km', 12.5, true);
  await expect('운행 기록 읽기', 'GET', '/trip_logs', undefined, true);
  await expect('단축어B DELETE /trip_pending/x1', 'DELETE', '/trip_pending/x1', undefined, true);
  await expect('계기판 X1 저장', 'PUT', '/odometer_logs/20261113120000', odo(20261113120000, 'X1', 12345), true);
  await expect('계기판 엑센트 저장', 'PUT', '/odometer_logs/20261113120100', odo(20261113120100, '엑센트', 150800), true);
  await expect('계기판 기록 읽기', 'GET', '/odometer_logs', undefined, true);
  await expect('정비 기준표 시드(차량 단위 객체)', 'PUT', '/maintenance_rules/x1', { engine_oil: rule({ name: '엔진오일 · 필터', interval_km: 16000, order: 1 }), tire_rotation: rule() }, true);
  await expect('정비 사용자 항목 추가', 'PUT', '/maintenance_rules/accent/custom_20261113130000', rule({ name: '타이어 위치 교환', interval_km: 4000, interval_months: 0, custom: true }), true);
  await expect('정비 기준표 읽기', 'GET', '/maintenance_rules', undefined, true);
  await expect('정비 사용자 항목 삭제', 'DELETE', '/maintenance_rules/accent/custom_20261113130000', undefined, true);
  await expect('정비 완료 기록', 'PUT', '/maintenance_logs/20261113140000', mlog(20261113140000), true);
  await expect('정비 이력 읽기', 'GET', '/maintenance_logs', undefined, true);
  await expect('정비 이력 삭제', 'DELETE', '/maintenance_logs/20261113140000', undefined, true);
  await expect('운행 기록 삭제', 'DELETE', '/trip_logs/20261113100000', undefined, true);
  await expect('계기판 기록 삭제', 'DELETE', '/odometer_logs/20261113120000', undefined, true);

  /* ── 차단되어야 하는 동작 ── */
  await expect('루트 전체 읽기', 'GET', '/', undefined, false);
  await expect('루트 전체 덮어쓰기', 'PUT', '/', { hacked: true }, false);
  await expect('루트 전체 삭제', 'DELETE', '/', undefined, false);
  await expect('미등록 경로 쓰기', 'PUT', '/hack/test', { a: 1 }, false);
  await expect('미등록 경로 읽기', 'GET', '/legacy_unknown', undefined, false);
  await expect('주차: id 없는 데이터', 'PUT', '/parking_logs/abc', { car: 'X1', text: 'x' }, false);
  await expect('주차: 사진 500KB 초과', 'PUT', '/parking_logs/20261028212000', parking(20261028212000, { photoBase64: 'A'.repeat(600000) }), false);
  await expect('메모: 5000자 초과', 'PUT', '/family_stickies', [{ id: 16, text: 'x'.repeat(6000) }], false);
  await expect('비공개 일정 전체 목록 읽기', 'GET', '/private_schedules', undefined, false);
  await expect('비공개 일정: 다른 사용자 경로', 'PUT', '/private_schedules/evil', [{ id: 17 }], false);
  await expect('PIN: 평문 저장', 'PUT', '/auth_pins/jinse', '1234', false);
  await expect('PIN: 다른 사용자 경로', 'PUT', '/auth_pins/evil', 'c'.repeat(64), false);
  await expect('캘린더: 잘못된 키', 'PUT', '/calendar_data/evil', 'x', false);
  await expect('가족 명단(members) 전체 읽기', 'GET', '/members', undefined, false);
  await expect('가족 명단: 비로그인 개별 읽기', 'GET', '/members/someuid', undefined, false);
  await expect('가족 명단: 클라이언트 쓰기', 'PUT', '/members/someuid', 'jinse', false);
  await expect('출발 기록: 엑센트 등 다른 키', 'PUT', '/trip_pending/accent', { startId: 20261113090000, lat: 36.6, lng: 127.4 }, false);
  await expect('출발 기록: 좌표 문자열', 'PUT', '/trip_pending/x1', { startId: 20261113090000, lat: '36.6', lng: 127.4 }, false);
  await expect('출발 기록: 좌표 범위 밖', 'PUT', '/trip_pending/x1', { startId: 20261113090000, lat: 136.6, lng: 127.4 }, false);
  await expect('운행: 엑센트 차량', 'PUT', '/trip_logs/20261113150000', trip(20261113150000, { car: '엑센트' }), false);
  await expect('운행: 거리 1000km 초과', 'PUT', '/trip_logs/20261113150100', trip(20261113150100, { distance_km: 5000 }), false);
  await expect('운행: 14자리 아닌 키(POST 자동키)', 'POST', '/trip_logs', trip(20261113150200), false);
  await expect('운행: 잘못된 flag', 'PUT', '/trip_logs/20261113150300', trip(20261113150300, { flag: 'hack' }), false);
  await expect('계기판: 음수', 'PUT', '/odometer_logs/20261113150400', odo(20261113150400, 'X1', -5), false);
  await expect('계기판: 미등록 차량', 'PUT', '/odometer_logs/20261113150500', odo(20261113150500, 'K5', 1000), false);
  await expect('정비 기준: 미등록 차량 경로', 'PUT', '/maintenance_rules/evil', { a: rule() }, false);
  await expect('정비 기준: 잘못된 항목 키', 'PUT', '/maintenance_rules/x1/Bad-Key', rule(), false);
  await expect('정비 기준: 이름 없음', 'PUT', '/maintenance_rules/x1/no_name', rule({ name: '' }), false);
  await expect('정비 이력: 메모 100자 초과', 'PUT', '/maintenance_logs/20261113150600', mlog(20261113150600, { memo: 'x'.repeat(150) }), false);
  await expect('정비 이력: 날짜 형식 오류', 'PUT', '/maintenance_logs/20261113150700', mlog(20261113150700, { done_date: '11/13' }), false);

  const failed = results.filter((r) => !r.ok);
  results.forEach((r) => console.log(`${r.ok ? 'PASS' : 'FAIL'}  [${r.want}] ${r.name}  (HTTP ${r.status})`));
  console.log(`\n총 ${results.length}건 / 실패 ${failed.length}건`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error('테스트 실행 오류:', e);
  process.exit(1);
});
