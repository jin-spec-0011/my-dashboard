/**
 * Firebase Realtime Database 보안 규칙 테스트 (에뮬레이터 전용)
 * 실행: firebase emulators:exec --only database "node firebase-tests/rules.test.mjs"
 * - 2단계(잠금) 규칙: 등록된 가족 UID(members/{uid})만 읽기/쓰기 허용
 * - 예외: parking_logs/{새 id} 는 iOS 단축어용 '추가 전용' 공개 쓰기 (읽기·수정·삭제는 가족만)
 * - 사용자 인증: 에뮬레이터는 서명 없는(alg: none) ID 토큰을 ?auth= 로 받아 auth 변수로 사용
 * - 관리자 시드: Authorization: Bearer owner (규칙 우회)
 * - 하나라도 실패하면 exit 1 → 워크플로가 배포하지 않음
 */
const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
const NS = 'gogo-manager-f0a68-default-rtdb';
const PROJECT_ID = 'gogo-manager-f0a68';

const UID_JINSE = 'uidJinseTest0000000000000001';
const UID_JIHYE = 'uidJihyeTest0000000000000002';
const UID_STRANGER = 'uidStrangerTest00000000000003';

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64')
  .replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');

function mockIdToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'none', typ: 'JWT' };
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    auth_time: now,
    iat: now,
    exp: now + 3600,
    sub: uid,
    user_id: uid,
    uid,
    email: `${uid}@example.com`,
    email_verified: true,
    firebase: { identities: {}, sign_in_provider: 'google.com' }
  };
  return `${b64url(header)}.${b64url(payload)}.`;
}

const TOKENS = {
  anon: null,
  jinse: mockIdToken(UID_JINSE),
  jihye: mockIdToken(UID_JIHYE),
  stranger: mockIdToken(UID_STRANGER)
};

function url(path, token) {
  const clean = path.replace(/^\/+/, '');
  const q = new URLSearchParams({ ns: NS });
  if (token) q.set('auth', token);
  return `http://${HOST}/${clean}.json?${q.toString()}`;
}

async function req(method, path, body, { owner = false, as = 'anon' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (owner) headers.Authorization = 'Bearer owner';
  const res = await fetch(url(path, owner ? null : TOKENS[as]), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  await res.text();
  return res.status;
}

const results = [];
async function expect(name, as, method, path, body, allowed) {
  let status = 0;
  try {
    status = await req(method, path, body, { as });
  } catch (e) {
    status = -1;
  }
  const ok = allowed ? status === 200 : (status === 401 || status === 403);
  results.push({ ok, name: `[${as}] ${name}`, status, want: allowed ? 'ALLOW' : 'DENY' });
}

const parking = (id, extra = {}) => Object.assign({
  id, car: 'X1', floor: 'B1', slot: '18A', text: 'X1 - B1-18A', author: '진세', time: '10월 28일 21:00', type: '지하 주차장'
}, extra);

async function seed() {
  const status = await req('PUT', '/', {
    members: { [UID_JINSE]: 'jinse', [UID_JIHYE]: 'jihye' },
    parking_logs: { 0: parking(1761600000000), 20261028015500: parking(20261028015500) },
    family_todos: [{ id: 1, text: '우유', completed: false }],
    family_schedules: [{ id: 2, title: '휴가', date: '2026-11-07', author: '진세' }],
    private_schedules: {
      jinse: [{ id: 3, title: '비밀', date: '2026-10-30' }],
      jihye: [{ id: 4, title: '비밀2', date: '2026-10-31' }]
    },
    calendar_data: { 'calendar_goal_2026-10': '건강한 10월' },
    auth_pins: { jinse: 'a'.repeat(64) },
    legacy_unknown: { x: 1 }
  }, { owner: true });
  if (status !== 200) throw new Error(`시드 실패 HTTP ${status}`);
}

async function main() {
  await seed();

  /* ── 등록된 가족(진세) : 허용 ── */
  await expect('본인 members 읽기', 'jinse', 'GET', `/members/${UID_JINSE}`, undefined, true);
  await expect('주차 목록 읽기', 'jinse', 'GET', '/parking_logs', undefined, true);
  await expect('단축어 PUT /parking_logs/{14자리id}', 'jinse', 'PUT', '/parking_logs/20261028210000', parking(20261028210000), true);
  await expect('단축어 POST /parking_logs', 'jinse', 'POST', '/parking_logs', parking(20261028210500), true);
  await expect('앱 트랜잭션: 주차 키드 객체 저장', 'jinse', 'PUT', '/parking_logs', { 20261028211000: parking(20261028211000, { photoBase64: 'data:image/jpeg;base64,' + 'A'.repeat(120000) }) }, true);
  await expect('장보기 배열 저장', 'jinse', 'PUT', '/family_todos', [{ id: 10, text: '계란', completed: false }], true);
  await expect('메모 배열 저장', 'jinse', 'PUT', '/family_stickies', [{ id: 11, text: '메모', completed: false }], true);
  await expect('가계부 배열 저장', 'jinse', 'PUT', '/family_ledger', [{ id: 12, amount: 5500, date: '2026-10-28', desc: '마트' }], true);
  await expect('연속 일정 저장(endDate)', 'jinse', 'PUT', '/family_schedules', [{ id: 13, title: '여행', date: '2026-10-30', endDate: '2026-11-02', author: '가족' }], true);
  await expect('여행 배열 저장', 'jinse', 'PUT', '/family_trips', [{ id: 14, place: '강릉', date: '2026-10-28' }], true);
  await expect('본인 비공개 일정 읽기', 'jinse', 'GET', '/private_schedules/jinse', undefined, true);
  await expect('본인 비공개 일정 저장', 'jinse', 'PUT', '/private_schedules/jinse', [{ id: 15, title: '비밀', date: '2026-10-31' }], true);
  await expect('캘린더 읽기', 'jinse', 'GET', '/calendar_data', undefined, true);
  await expect('캘린더 목표 저장', 'jinse', 'PUT', '/calendar_data/calendar_goal_2026-11', '가족 여행', true);
  await expect('캘린더 메모 저장', 'jinse', 'PUT', '/calendar_data/calendar_memo_2026-11', '• 11-01 [가족] 여행', true);
  await expect('주차 개별 삭제', 'jinse', 'DELETE', '/parking_logs/20261028210000', undefined, true);

  /* ── 등록된 가족(지혜) : 허용 ── */
  await expect('본인 비공개 일정 읽기', 'jihye', 'GET', '/private_schedules/jihye', undefined, true);
  await expect('공용 일정 읽기', 'jihye', 'GET', '/family_schedules', undefined, true);

  /* ── 가족 간 비공개 분리 : 차단 ── */
  await expect('진세 → 지혜 비공개 일정 읽기', 'jinse', 'GET', '/private_schedules/jihye', undefined, false);
  await expect('지혜 → 진세 비공개 일정 쓰기', 'jihye', 'PUT', '/private_schedules/jinse', [{ id: 16 }], false);
  await expect('다른 사람 members 읽기', 'jinse', 'GET', `/members/${UID_JIHYE}`, undefined, false);
  await expect('members 자기 등록 변경', 'jinse', 'PUT', `/members/${UID_JINSE}`, 'jihye', false);

  /* ── 비로그인 : 전면 차단 ── */
  for (const p of ['/', '/parking_logs', '/family_todos', '/family_stickies', '/family_ledger', '/family_schedules', '/family_trips', '/private_schedules/jinse', '/calendar_data', '/members', `/members/${UID_JINSE}`, '/auth_pins']) {
    await expect(`읽기 ${p}`, 'anon', 'GET', p, undefined, false);
  }
  /* 주차: iOS 단축어용 '추가 전용' 공개 쓰기 (C안) */
  await expect('단축어(토큰 없음) 새 주차 PUT', 'anon', 'PUT', '/parking_logs/20261028213000', parking(20261028213000), true);
  await expect('단축어(토큰 없음) 새 주차 POST', 'anon', 'POST', '/parking_logs', parking(20261028213500), true);
  await expect('기존 주차 기록 덮어쓰기', 'anon', 'PUT', '/parking_logs/20261028213000', parking(20261028213000, { slot: '99Z' }), false);
  await expect('기존 주차 기록 삭제', 'anon', 'DELETE', '/parking_logs/20261028213000', undefined, false);
  await expect('주차 전체 덮어쓰기', 'anon', 'PUT', '/parking_logs', { 1: parking(1) }, false);
  await expect('주차 전체 삭제', 'anon', 'DELETE', '/parking_logs', undefined, false);
  await expect('새 주차: id 없는 데이터', 'anon', 'PUT', '/parking_logs/20261028214000', { car: 'X1' }, false);
  await expect('새 주차: 사진 500KB 초과', 'anon', 'PUT', '/parking_logs/20261028214500', parking(20261028214500, { photoBase64: 'A'.repeat(600000) }), false);
  await expect('가계부 덮어쓰기', 'anon', 'PUT', '/family_ledger', [{ id: 1 }], false);
  await expect('루트 삭제', 'anon', 'DELETE', '/', undefined, false);
  await expect('캘린더 세션키 주입', 'anon', 'PUT', '/calendar_data/gogo_auth_pass', 'true', false);

  /* ── 로그인했지만 미등록 계정 : 전면 차단 ── */
  await expect('주차 읽기', 'stranger', 'GET', '/parking_logs', undefined, false);
  await expect('가계부 읽기', 'stranger', 'GET', '/family_ledger', undefined, false);
  await expect('메모 쓰기', 'stranger', 'PUT', '/family_stickies', [{ id: 1, text: 'x' }], false);
  await expect('비공개 일정 읽기', 'stranger', 'GET', '/private_schedules/jinse', undefined, false);
  await expect('자기 members 등록', 'stranger', 'PUT', `/members/${UID_STRANGER}`, 'jinse', false);

  /* ── 가족이라도 차단되어야 하는 동작 ── */
  await expect('루트 전체 읽기', 'jinse', 'GET', '/', undefined, false);
  await expect('루트 전체 삭제', 'jinse', 'DELETE', '/', undefined, false);
  await expect('미등록 경로 쓰기', 'jinse', 'PUT', '/hack/test', { a: 1 }, false);
  await expect('폐기된 auth_pins 읽기', 'jinse', 'GET', '/auth_pins', undefined, false);
  await expect('주차: id 없는 데이터', 'jinse', 'PUT', '/parking_logs/abc', { car: 'X1', text: 'x' }, false);
  await expect('주차: 사진 500KB 초과', 'jinse', 'PUT', '/parking_logs/20261028212000', parking(20261028212000, { photoBase64: 'A'.repeat(600000) }), false);
  await expect('메모: 5000자 초과', 'jinse', 'PUT', '/family_stickies', [{ id: 17, text: 'x'.repeat(6000) }], false);
  await expect('비공개 일정 전체 목록 읽기', 'jinse', 'GET', '/private_schedules', undefined, false);
  await expect('캘린더: 잘못된 키', 'jinse', 'PUT', '/calendar_data/gogo_auth_pass', 'true', false);

  const failed = results.filter((r) => !r.ok);
  results.forEach((r) => console.log(`${r.ok ? 'PASS' : 'FAIL'}  [${r.want}] ${r.name}  (HTTP ${r.status})`));
  console.log(`\n총 ${results.length}건 / 실패 ${failed.length}건`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error('테스트 실행 오류:', e);
  process.exit(1);
});
