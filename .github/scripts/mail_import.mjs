/**
 * GOGO 스마트 매니저 - 네이버 메일 자동 적재기 (.github/scripts/mail_import.mjs)
 *
 * 네이버 IMAP(읽기 전용) → 광고/취소/명세서 제외 → 분류
 *   - 결제 메일 → family_ledger (가계부, confirmed:false 로 등록 → 앱에서 확인)
 *   - 예약 메일 → family_schedules 또는 private_schedules/<user> (일정)
 * 한국어 / 일본어 / 영어 메일 지원 (NFKC 정규화 후 공통 규칙 적용)
 *
 * 실행:
 *   node mail_import.mjs --self-test      ← 의존성 없이 파서 검증 (CI 선행 단계)
 *   node mail_import.mjs                  ← 실제 실행 (환경변수 필요)
 *
 * 환경변수:
 *   NAVER_IMAP_USER, NAVER_IMAP_PASS     (필수) 네이버 ID / 애플리케이션 비밀번호
 *   FIREBASE_SERVICE_ACCOUNT             (필수) 서비스 계정 JSON
 *   DRY_RUN=true|false                   true면 앱 데이터는 건드리지 않고 미리보기만 저장
 *   SINCE_DAYS=3                         조회 기간(일)
 *   REPROCESS=true|false                 처리 이력 무시하고 재분석 (중복 방지는 유지)
 *   AUTHOR=진세                          등록자 표기
 *   SCHEDULE_TARGET=family|private:jinse|private:jihye
 *   RESERVATION_TO_LEDGER=false          예약 메일의 결제 금액도 가계부에 넣을지
 *   DEFAULT_METHOD=삼성카드              결제수단 감지 실패 시 기본값
 *   NAVER_FOLDERS=INBOX                  쉼표 구분 메일함 목록
 *
 * ⚠️ 저장소가 Public 이므로 로그에는 건수만 출력한다. 제목/금액/가맹점은 절대 로그에 남기지 않는다.
 *    상세 결과는 관리자 전용 노드 mail_import_state/last_run 에 저장 (Firebase 콘솔에서 확인).
 */

import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/* ══════════════════════════════════════════════════
   1. 설정 (ledger.js 와 동기화 필요 항목 포함)
   ══════════════════════════════════════════════════ */
const DB_URL = 'https://gogo-manager-f0a68-default-rtdb.firebaseio.com';
const PROJECT_ID = 'gogo-manager-f0a68';
const LEDGER_PATH = 'family_ledger';
const LEDGER_MAX = 2000;      // app.js createDataStore maxItems 와 동일
const SCHEDULE_MAX = 1000;
const STATE_PATH = 'mail_import_state';
const PROCESSED_TTL_DAYS = 120;
const MAX_HEADERS = 500;
const MAX_DOWNLOADS = 150;
const KST_MS = 9 * 3600 * 1000;

// ledger.js CONFIG 와 동일하게 유지
const FIXED_KEYWORDS = ['이자', '차량', '관리비', '유류', '보험', '교육', '운동', '통신', '곗돈'];
const LIVING_EXCLUSIONS = ['교육', '운동', '고정', '이자', '보험', '차량', '통신'];

// 가맹점/제목 → 세부분류(가계부 키워드). 위에서부터 첫 매칭 적용
const CATEGORY_RULES = [
  [/배달의민족|배민|요기요|쿠팡이츠|땡겨요/, '배달'],
  [/스타벅스|투썸|이디야|메가커피|메가MGC|빽다방|폴바셋|블루보틀|컴포즈|starbucks|ドトール|タリーズ/i, '카페'],
  [/이마트|홈플러스|롯데마트|코스트코|컬리|노브랜드|트레이더스|GS더프레시|하나로마트|오아시스마켓|イオン|スーパー/i, '마트'],
  [/올리브영|다이소|ダイソー|ドラッグストア|マツモトキヨシ/, '생필품'],
  [/약국|병원|의원|치과|한의원|薬局|クリニック|pharmacy/i, '병원'],
  [/교보문고|예스24|yes24|알라딘|리디|밀리의서재|kindle/i, '도서'],
  [/무신사|29cm|지그재그|에이블리|유니클로|uniqlo|자라|zara|ユニクロ/i, '의류'],
  [/SK에너지|GS칼텍스|S-?OIL|현대오일뱅크|알뜰주유|주유소/i, '유류'],
  [/SK텔레콤|LG유플러스|LGU\+|통신요금/i, '통신'],
  [/넷플릭스|netflix|유튜브|youtube|디즈니|disney|티빙|웨이브|쿠팡플레이|spotify|멜론|icloud|apple\s*music/i, '취미']
];

/* ══════════════════════════════════════════════════
   2. 분류 규칙 (제목 기준, NFKC 정규화 후)
   ══════════════════════════════════════════════════ */
const AD_RE = /\(\s*광고\s*\)|\[\s*광고\s*\]|^\s*광고\s*[:\]]|【\s*(PR|広告)\s*】|\[\s*(AD|PR|広告)\s*\]|\(\s*(AD|PR|広告)\s*\)|뉴스레터|newsletter|メルマガ|メールマガジン/i;
const CANCEL_RE = /취소|환불|キャンセル|払い戻し|返金|cancel|refund/i;
const STATEMENT_RE = /명세서|청구서|이용\s*대금|결제\s*예정|결제\s*실패|결제\s*오류|결제\s*수단|미결제|ご請求予定|お支払い予定|支払い失敗|statement|payment (failed|due|reminder|method)|upcoming payment/i;
const SHIPPING_RE = /배송\s*(시작|완료|중|출발|안내)|발송\s*(완료|안내)|発送|お届け予定|shipped|out for delivery|delivered/i;
const PROMO_RE = /특가|할인|쿠폰|이벤트|혜택\s*안내|예약하세요|예매하세요|セール|クーポン|キャンペーン|今すぐ予約|\bsale\b|% ?off|\bdeal|book now|reserve now/i;
const RES_RE = /예약\s*(이\s*)?(확정|완료|확인|접수|내역|안내)|예약번호|예매\s*(가\s*)?(완료|확인|확정|내역)|탑승권|항공권|e-?티켓|이티켓|여정\s*안내|체크인\s*안내|ご予約|予約(確認|完了|確定|内容|受付)|搭乗|eチケット|旅程|booking (confirm|confirmation|details|is confirmed)|reservation (confirm|confirmed|confirmation|details)|your (booking|reservation|trip|itinerary|flight)|itinerary|e-?ticket|check-?in (info|reminder|details)/i;
const PAY_RE = /결제\s*(가\s*)?(완료|내역|안내)|결제되었습니다|승인\s*(내역|안내|완료)|구매\s*(가\s*)?완료|주문\s*(이\s*)?(완료|확인|내역)|영수증|입금\s*확인|자동\s*결제|정기\s*결제|ご購入|ご注文|注文(確認|完了)|決済(完了|のお知らせ)|お支払い(の)?(完了|確認)|領収書|ご利用(明細|のお知らせ)|receipt|payment (confirmation|received|successful|complete)|order (confirmation|confirmed|receipt)|your order|thanks? (you )?for your (order|purchase)|purchase confirmation/i;

/* 일정 라벨 (우선순위 순서) */
const START_LABELS = [
  /체크인|입실|チェックイン|check-?in(?!\s*(online|now|opens?))/i,
  /이용\s*일(시|자)?|방문\s*일(시|자)?|관람\s*일(시)?|공연\s*일(시)?|ご利用日(時)?|来店日(時)?|ご来店|公演日(時)?|date of (stay|visit|event)|event date|visit date/i,
  /출발|가는\s*편|탑승\s*일(시)?|出発|往路|搭乗日|departure|depart|outbound|flight date/i,
  /예약\s*일(시|자)|ご予約日(時)?|予約日(時)?|reservation date|date\s*(&|and)\s*time/i
];
const END_LABELS = [
  /체크아웃|퇴실|チェックアウト|check-?out/i,
  /귀국|오는\s*편|復路|帰り|\breturn\b|inbound/i
];

const SCHEDULE_ICONS = [
  [/항공|비행기|flight|airline|airport|航空|フライト|\b(ICN|GMP|NRT|HND|KIX|FUK|CJU|PUS)\b/i, '✈️'],
  [/호텔|숙소|숙박|펜션|리조트|에어비앤비|airbnb|hotel|ホテル|宿泊|旅館|booking\.com|agoda|아고다|야놀자|여기어때|expedia|楽天トラベル|じゃらん/i, '🏨'],
  [/KTX|SRT|코레일|新幹線|\bJR\b|列車|train|rail/i, '🚄'],
  [/공연|콘서트|티켓|예매|인터파크|멜론티켓|에버랜드|롯데월드|놀이공원|테마파크|입장권|ticket|チケット|公演|映画|CGV|메가박스|롯데시네마|ディズニー|USJ/i, '🎫'],
  [/캐치테이블|레스토랑|식당|restaurant|レストラン|一休|食べログ|tablecheck|opentable|dining/i, '🍽️'],
  [/병원|진료|검진|クリニック|clinic|hospital/i, '🏥']
];

/* ══════════════════════════════════════════════════
   3. 공용 유틸
   ══════════════════════════════════════════════════ */
const norm = (s) => String(s || '')
  .normalize('NFKC')
  .replace(/[​-‍﻿]/g, '')
  .replace(/\r/g, '')
  .replace(/[ \t 　]+/g, ' ');

function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&yen;/gi, '¥')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

const pad2 = (n) => String(n).padStart(2, '0');
const kstYmd = (date) => new Date(date.getTime() + KST_MS).toISOString().slice(0, 10);

function toYmd(y, m, d) {
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

const ymdToMs = (ymd) => Date.parse(`${ymd}T00:00:00Z`);
const daysDiff = (a, b) => Math.round((ymdToMs(b) - ymdToMs(a)) / 86400000);
const addDays = (ymd, n) => new Date(ymdToMs(ymd) + n * 86400000).toISOString().slice(0, 10);

function inferYear(m, d, refYmd) {
  const refY = Number(refYmd.slice(0, 4));
  const cand = toYmd(refY, m, d);
  if (!cand) return null;
  return daysDiff(refYmd, cand) < -30 ? toYmd(refY + 1, m, d) : cand;
}

const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const shortHash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 20);

/* ══════════════════════════════════════════════════
   4. 날짜 / 시간 / 금액 추출
   ══════════════════════════════════════════════════ */
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MON = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[a-z]*\\.?';

const DATE_PATTERNS = [
  { re: /(20\d{2})\s*[.\-\/년年]\s*(\d{1,2})\s*[.\-\/월月]\s*(\d{1,2})(?!\d)\s*[일日]?/g, f: (m) => [+m[1], +m[2], +m[3]] },
  { re: /(?<![\d.\/\-])(\d{1,2})\s*[월月]\s*(\d{1,2})\s*[일日]/g, f: (m) => [null, +m[1], +m[2]] },
  { re: new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b,?(?:\\s*(20\\d{2}))?`, 'g'), f: (m) => [m[3] ? +m[3] : null, MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]] },
  { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}(?:,?\\s*(20\\d{2}))?`, 'g'), f: (m) => [m[3] ? +m[3] : null, MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]] }
];

function extractTime(after) {
  // 같은 줄 우선, 같은 줄이 비어 있으면 다음 줄까지
  const lines = after.split('\n');
  let win = lines[0] || '';
  if (win.replace(/[\s()（）~〜\-–,]/g, '').length < 3 && lines.length > 1) win += ` ${lines[1]}`;
  win = win.slice(0, 40);
  let m = win.match(/(오전|오후|午前|午後)?\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?/);
  if (m) {
    let h = Number(m[2]);
    const mi = Number(m[3]);
    const pm = /오후|午後|pm/i.test(`${m[1] || ''}${m[4] || ''}`);
    const am = /오전|午前|am/i.test(`${m[1] || ''}${m[4] || ''}`);
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;
    if (h <= 23 && mi <= 59) return `${pad2(h)}:${pad2(mi)}`;
  }
  m = win.match(/(오전|오후|午前|午後)\s*(\d{1,2})\s*[시時](?:\s*(\d{1,2})\s*[분分])?/);
  if (m) {
    let h = Number(m[2]);
    if (/오후|午後/.test(m[1]) && h < 12) h += 12;
    if (/오전|午前/.test(m[1]) && h === 12) h = 0;
    const mi = Number(m[3] || 0);
    if (h <= 23 && mi <= 59) return `${pad2(h)}:${pad2(mi)}`;
  }
  return null;
}

function findDates(text, refYmd) {
  const used = [];
  const out = [];
  for (const p of DATE_PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text)) !== null) {
      const s = m.index;
      const e = s + m[0].length;
      if (used.some(([a, b]) => s < b && e > a)) continue;
      const [y, mo, d] = p.f(m);
      const ymd = y ? toYmd(y, mo, d) : inferYear(mo, d, refYmd);
      if (!ymd) continue;
      used.push([s, e]);
      out.push({ ymd, index: s, time: extractTime(text.slice(e, e + 120)) });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

function findLabeledDate(text, labels, refYmd, minYmd) {
  for (const label of labels) {
    const re = new RegExp(label.source, `${label.flags.replace('g', '')}g`);
    let m;
    while ((m = re.exec(text)) !== null) {
      const seg = text.slice(m.index + m[0].length, m.index + m[0].length + 150);
      const hit = findDates(seg, refYmd).find((d) => !minYmd || d.ymd >= minYmd);
      if (hit) return hit;
    }
  }
  return null;
}

const CUR_MAP = { '₩': 'KRW', KRW: 'KRW', '원': 'KRW', '¥': 'JPY', JPY: 'JPY', '円': 'JPY', '엔': 'JPY', '$': 'USD', 'US$': 'USD', USD: 'USD', '달러': 'USD', '€': 'EUR', EUR: 'EUR' };
const MONEY_RE = /(?:(₩|KRW|¥|JPY|US\$|\$|USD|€|EUR)\s?(-?[0-9][0-9,]*(?:\.[0-9]{1,2})?))|(?:(-?[0-9][0-9,]*(?:\.[0-9]{1,2})?)\s?(원|円|KRW|JPY|USD|EUR|달러|엔))/g;

function parseMoneyAll(text) {
  const out = [];
  MONEY_RE.lastIndex = 0;
  let m;
  while ((m = MONEY_RE.exec(text)) !== null) {
    const sym = m[1] || m[4];
    const raw = m[2] || m[3];
    const value = Number(String(raw).replace(/,/g, ''));
    const cur = CUR_MAP[sym];
    if (!cur || !Number.isFinite(value) || value <= 0) continue;
    out.push({ cur, value, raw: `${sym === '원' || sym === '円' || sym === '엔' || sym === '달러' ? '' : sym}${raw}${sym === '원' || sym === '円' || sym === '엔' || sym === '달러' ? sym : ''}`, index: m.index });
  }
  return out;
}

const AMOUNT_LABELS = [
  /(총|최종|실)\s*결제\s*금액|결제하신\s*금액|お支払い?(総)?金額|お支払合計|ご請求金額|grand total|total charged|amount charged|total paid|amount paid|order total|payment total/i,
  /결제\s*금액|승인\s*금액|이용\s*금액|청구\s*금액|주문\s*금액|決済金額|ご利用金額|お支払い|payment amount|\bamount\b/i,
  /합계|총\s*금액|총액|合計|総額|(?<![a-z])total/i
];

function findAmount(text) {
  for (const label of AMOUNT_LABELS) {
    const re = new RegExp(label.source, `${label.flags.replace('g', '')}g`);
    let m;
    while ((m = re.exec(text)) !== null) {
      const seg = text.slice(m.index + m[0].length, m.index + m[0].length + 80);
      const hit = parseMoneyAll(seg)[0];
      if (hit) return { ...hit, labeled: true };
    }
  }
  const all = parseMoneyAll(text);
  if (!all.length) return null;
  const cur = all[0].cur;
  const best = all.filter((a) => a.cur === cur).sort((a, b) => b.value - a.value)[0];
  return { ...best, labeled: false };
}

function detectMethod(text, fromStr, fallback) {
  const t = `${fromStr}\n${text}`;
  if (/삼성\s*카드/.test(t)) return '삼성카드';
  if (/계좌\s*이체|무통장|실시간\s*이체|銀行振込|bank transfer/i.test(t)) return '계좌이체';
  if (/(신한|현대|KB\s*국민|국민|롯데|우리|하나|BC|비씨|NH|농협|씨티|카카오뱅크|토스뱅크)\s*카드|신용\s*카드|체크\s*카드|VISA|Master\s*Card|MasterCard|JCB|AMEX|American Express|네이버\s*페이|카카오\s*페이|토스\s*페이|페이코|PAYCO|Apple\s*Pay|PayPal|クレジットカード/i.test(t)) return '신용카드';
  return fallback;
}

function detectPlace(text, fromName, fromAddr) {
  const m = text.match(/(?:가맹점\s*명?|이용\s*가맹점|사용처|판매처|판매자|상호\s*명?|상점\s*명|ショップ名|店舗名|販売(?:者|元)|加盟店|merchant|sold by|seller)\s*[:：]?\s*([^\n]{2,40})/i);
  if (m && m[1].trim().replace(/[:：\s]/g, '').length >= 2) return clip(m[1].replace(/^[:：\s]+/, ''), 30);
  const name = String(fromName || '').replace(/["'<>]/g, '').replace(/no-?reply|noreply|notification|info|알림|お知らせ/gi, '').trim();
  if (name.length >= 2) return clip(name, 30);
  const dom = String(fromAddr || '').split('@')[1] || '';
  return clip(dom.split('.').slice(-3, -1).filter((x) => !/^(co|com|ne|or|mail|email)$/.test(x)).pop() || dom, 30);
}

function detectCategory(hay) {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(hay)) return cat;
  return '기타';
}

const evalFixedStatus = (t) => (!t ? '-' : (FIXED_KEYWORDS.some((k) => t.includes(k)) ? 'O' : 'X'));
const evalLivingStatus = (t) => (!t ? '-' : (LIVING_EXCLUSIONS.some((k) => t.includes(k)) ? 'X' : 'O'));

function cleanSubject(subject) {
  return clip(String(subject || '')
    .replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '')
    .replace(/(이|가)?\s*(확정|완료)\s*(되었습니다|됐습니다|되었어요)\.?|안내\s*(드립니다|입니다)\.?|のお知らせ|が(確定|完了)しました|has been confirmed|is confirmed/gi, '')
    .replace(/\s{2,}/g, ' '), 40);
}

/* ══════════════════════════════════════════════════
   5. 분류 + 파싱 (순수 함수 → 셀프테스트 대상)
   ══════════════════════════════════════════════════ */
function classify(subject) {
  const s = norm(subject);
  if (AD_RE.test(s)) return 'ad';
  if (CANCEL_RE.test(s)) return 'cancel';
  if (STATEMENT_RE.test(s)) return 'statement';
  if (SHIPPING_RE.test(s)) return 'shipping';
  if (PROMO_RE.test(s)) return 'promo';
  if (RES_RE.test(s)) return 'reservation';
  if (PAY_RE.test(s)) return 'payment';
  return 'none';
}

/**
 * @param {{subject:string, fromName:string, fromAddr:string, date:Date, text:string, messageId:string}} mail
 * @param {{author:string, defaultMethod:string, fx:Object, isPrivate:boolean, reservationToLedger:boolean}} opt
 * @returns {{kind:string, srcId:string, ledger?:Object, schedule?:Object, reason?:string}}
 */
function parseMail(mail, opt) {
  const subject = norm(mail.subject);
  const text = norm(mail.text);
  const fromStr = `${mail.fromName || ''} <${mail.fromAddr || ''}>`;
  const date = mail.date instanceof Date && !Number.isNaN(mail.date.getTime()) ? mail.date : new Date();
  const mailYmd = kstYmd(date);
  const srcId = mail.srcId || shortHash(mail.messageId || `${fromStr}|${subject}|${date.toISOString()}`);
  const kind = classify(subject);
  const baseId = date.getTime();
  const result = { kind, srcId, mailYmd };

  if (kind === 'payment' || (kind === 'reservation' && opt.reservationToLedger)) {
    const amt = findAmount(text);
    if (amt) {
      let krw = amt.value;
      let orig = '';
      if (amt.cur !== 'KRW') {
        const rate = opt.fx[amt.cur];
        krw = rate ? Math.round(amt.value * rate) : 0;
        orig = amt.raw;
      }
      if (krw >= 1 && krw <= 50000000) {
        const place = detectPlace(text, mail.fromName, mail.fromAddr);
        let category = detectCategory(`${place}\n${subject}\n${fromStr}`);
        if (category === '기타') category = detectCategory(text.slice(0, 500));
        const needsReview = !amt.labeled || amt.cur !== 'KRW';
        const desc = clip(`📧${needsReview ? '❓' : ''} ${cleanSubject(subject)}${orig ? ` (${orig})` : ''}`, 60);
        result.ledger = {
          id: baseId,
          date: mailYmd,
          month: mailYmd.slice(0, 7),
          amount: Math.round(krw),
          desc,
          category,
          place,
          method: detectMethod(text, fromStr, opt.defaultMethod),
          author: opt.author,
          confirmed: false,
          statusFixed: evalFixedStatus(category),
          statusLiving: evalLivingStatus(category),
          source: 'naver-mail',
          srcId,
          needsReview
        };
      } else {
        result.reason = 'amount_out_of_range';
      }
    } else if (kind === 'payment') {
      result.reason = 'amount_not_found';
    }
  }

  if (kind === 'reservation') {
    const minYmd = addDays(mailYmd, -1);
    let start = findLabeledDate(text, START_LABELS, mailYmd, minYmd);
    let needsReview = false;
    if (!start) {
      const maxYmd = addDays(mailYmd, 400);
      start = findDates(`${subject}\n${text}`, mailYmd).find((d) => d.ymd >= mailYmd && d.ymd <= maxYmd) || null;
      needsReview = true;
    }
    if (start) {
      const end = findLabeledDate(text, END_LABELS, mailYmd, start.ymd);
      const endYmd = end && end.ymd > start.ymd && daysDiff(start.ymd, end.ymd) <= 60 ? end.ymd : null;
      // 제목·발신자 우선 판정 → 없을 때만 본문 (본문의 부수 단어로 오분류 방지)
      const head = `${subject}\n${fromStr}`;
      const icon = (SCHEDULE_ICONS.find(([re]) => re.test(head))
        || SCHEDULE_ICONS.find(([re]) => re.test(text.slice(0, 3000)))
        || [null, '📌'])[1];
      const title = clip(`${icon} ${start.time ? `${start.time} ` : ''}${cleanSubject(subject)}${needsReview ? ' ❓' : ''}`, 50);
      result.schedule = {
        id: baseId,
        title,
        date: start.ymd,
        endDate: endYmd,
        author: opt.author,
        isPrivate: !!opt.isPrivate,
        source: 'naver-mail',
        srcId,
        needsReview
      };
    } else {
      result.reason = 'date_not_found';
    }
  }
  return result;
}

/**
 * Firebase 배열 노드에 병합 (app.js toRemote 와 동일하게 배열로 저장)
 * - srcId 중복 / (가계부) 같은 날짜+같은 금액 / (일정) 같은 날짜+같은 제목 → 건너뜀
 */
function mergeItems(current, newItems, max, kind) {
  const arr = current
    ? (Array.isArray(current) ? current : Object.values(current)).filter((x) => x && typeof x === 'object')
    : [];
  const srcIds = new Set(arr.map((x) => x.srcId).filter(Boolean));
  const ids = new Set(arr.map((x) => String(x.id)));
  const dupKeys = new Set(arr.map((x) => (kind === 'ledger' ? `${x.date}|${Number(x.amount)}` : `${x.date}|${x.title}`)));
  const stats = { added: 0, dupSrc: 0, dupContent: 0 };
  for (const it of newItems) {
    if (srcIds.has(it.srcId)) { stats.dupSrc++; continue; }
    const k = kind === 'ledger' ? `${it.date}|${Number(it.amount)}` : `${it.date}|${it.title}`;
    if (dupKeys.has(k)) { stats.dupContent++; continue; }
    let id = Number(it.id) || Date.now();
    while (ids.has(String(id))) id++;
    ids.add(String(id));
    srcIds.add(it.srcId);
    dupKeys.add(k);
    arr.push({ ...it, id });
    stats.added++;
  }
  arr.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
  return { list: arr.slice(0, max), stats };
}

/* ══════════════════════════════════════════════════
   6. 실행부 (IMAP → 파싱 → Firebase)
   ══════════════════════════════════════════════════ */
function envBool(name, def = false) {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  if (!v) return def;
  return v === 'true' || v === '1' || v === 'yes';
}

/** auto 조회 기간: 마지막 실적재 시각 기준 경과일 + 1일 여유 (3~90일로 제한, 중복은 처리 이력으로 차단) */
const AUTO_FIRST_DAYS = 30;
function resolveAutoSinceDays(lastAt, now) {
  const elapsed = Math.ceil(Math.max(0, now - lastAt) / 86400000);
  return Math.min(Math.max(elapsed + 1, 3), 90);
}

async function loadFx() {
  const fx = { USD: 1400, JPY: 9.3, EUR: 1500 };
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/KRW', { signal: AbortSignal.timeout(8000) });
    const j = await res.json();
    if (j && j.result === 'success' && j.rates) {
      for (const c of Object.keys(fx)) {
        const r = Number(j.rates[c]);
        if (r > 0) fx[c] = Math.round((1 / r) * 1000) / 1000;
      }
      console.log('환율 조회 완료 (실시간)');
    }
  } catch (e) {
    console.log('::warning::환율 조회 실패 → 기본 환율 사용');
  }
  return fx;
}

async function main() {
  const user = String(process.env.NAVER_IMAP_USER || '').trim().replace(/@naver\.com$/i, '');
  const pass = String(process.env.NAVER_IMAP_PASS || '').trim();
  const saRaw = String(process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!user || !pass) throw new Error('NAVER_IMAP_USER / NAVER_IMAP_PASS 시크릿이 비어 있습니다.');
  if (!saRaw) throw new Error('FIREBASE_SERVICE_ACCOUNT 시크릿이 비어 있습니다.');
  let sa;
  try { sa = JSON.parse(saRaw); } catch (e) { throw new Error('FIREBASE_SERVICE_ACCOUNT JSON 형식 오류'); }
  if (sa.type !== 'service_account' || sa.project_id !== PROJECT_ID) throw new Error('서비스 계정 키의 프로젝트가 다릅니다.');

  const runStartedAt = Date.now();
  const dryRun = envBool('DRY_RUN', false);
  const reprocess = envBool('REPROCESS', false);
  const sinceRaw = String(process.env.SINCE_DAYS || 'auto').trim().toLowerCase();
  const author = String(process.env.AUTHOR || '진세').trim() || '진세';
  const target = String(process.env.SCHEDULE_TARGET || 'family').trim();
  const pm = target.match(/^private:(jinse|jihye)$/);
  if (target !== 'family' && !pm) throw new Error(`SCHEDULE_TARGET 값 오류: family | private:jinse | private:jihye`);
  const schedulePath = pm ? `private_schedules/${pm[1]}` : 'family_schedules';
  const folders = String(process.env.NAVER_FOLDERS || 'INBOX').split(',').map((s) => s.trim()).filter(Boolean);
  const opt = {
    author,
    defaultMethod: String(process.env.DEFAULT_METHOD || '삼성카드').trim(),
    fx: await loadFx(),
    isPrivate: !!pm,
    reservationToLedger: envBool('RESERVATION_TO_LEDGER', false)
  };

  const { default: admin } = await import('firebase-admin');
  const { ImapFlow } = await import('imapflow');
  const { simpleParser } = await import('mailparser');

  admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: DB_URL });
  const db = admin.database();

  const processedSnap = await db.ref(`${STATE_PATH}/processed`).once('value');
  const processed = processedSnap.val() || {};

  // 조회 기간: 숫자 지정 또는 auto(마지막 실적재 이후 + 1일 여유, 최초 30일)
  let sinceDays;
  if (sinceRaw === 'auto' || sinceRaw === '') {
    const lastSnap = await db.ref(`${STATE_PATH}/last_real_run_at`).once('value');
    const lastAt = Number(lastSnap.val()) || 0;
    sinceDays = lastAt > 0 ? resolveAutoSinceDays(lastAt, Date.now()) : AUTO_FIRST_DAYS;
  } else {
    sinceDays = Math.min(Math.max(parseInt(sinceRaw, 10) || 3, 1), 90);
  }

  const counts = { scanned: 0, ad: 0, cancel: 0, statement: 0, shipping: 0, promo: 0, none: 0, skippedProcessed: 0, payment: 0, reservation: 0, parsedLedger: 0, parsedSchedule: 0, failed: 0 };
  const preview = [];
  const ledgerNew = [];
  const scheduleNew = [];
  const processedUpdates = {};

  const client = new ImapFlow({
    host: 'imap.naver.com',
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
    socketTimeout: 60000
  });
  client.on('error', (err) => console.log(`::warning::IMAP 소켓 오류: ${err.code || err.message}`));

  try {
    await client.connect();
  } catch (e) {
    throw new Error(`네이버 IMAP 로그인 실패 (IMAP 사용 설정 / 애플리케이션 비밀번호 확인): ${e.responseText || e.code || e.message}`);
  }

  try {
    for (const folder of folders) {
      let lock;
      try {
        lock = await client.getMailboxLock(folder, { readOnly: true });
      } catch (e) {
        console.log(`::warning::메일함 열기 실패: ${folder}`);
        continue;
      }
      try {
        const since = new Date(Date.now() - sinceDays * 86400000);
        const found = await client.search({ since }, { uid: true });
        const uids = (Array.isArray(found) ? found : []).slice(-MAX_HEADERS);
        if (!uids.length) continue;

        const candidates = [];
        for await (const msg of client.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
          counts.scanned++;
          const env = msg.envelope || {};
          const subject = env.subject || '';
          const from = (env.from && env.from[0]) || {};
          const kind = classify(subject);
          const srcId = shortHash(env.messageId || `${from.name || ''} <${from.address || ''}>|${norm(subject)}|${env.date ? new Date(env.date).toISOString() : ''}`);
          if (kind !== 'payment' && kind !== 'reservation') {
            counts[kind] = (counts[kind] || 0) + 1;
            continue;
          }
          if (!reprocess && processed[srcId]) { counts.skippedProcessed++; continue; }
          counts[kind]++;
          candidates.push({ uid: msg.uid, kind, srcId });
        }

        // fetch 반복 중 추가 명령 금지 → 후보만 모은 뒤 본문 다운로드
        for (const c of candidates.slice(0, MAX_DOWNLOADS)) {
          try {
            const full = await client.fetchOne(String(c.uid), { uid: true, source: true }, { uid: true });
            if (!full || !full.source) { counts.failed++; continue; }
            const parsed = await simpleParser(full.source, { skipImageLinks: true, skipTextToHtml: true });
            const fromV = (parsed.from && parsed.from.value && parsed.from.value[0]) || {};
            const text = (parsed.text && parsed.text.trim()) ? parsed.text : htmlToText(parsed.html || '');
            const r = parseMail({
              subject: parsed.subject || '',
              fromName: fromV.name || '',
              fromAddr: fromV.address || '',
              date: parsed.date || new Date(),
              text,
              messageId: parsed.messageId || '',
              srcId: c.srcId
            }, opt);
            if (r.ledger) { ledgerNew.push(r.ledger); counts.parsedLedger++; }
            if (r.schedule) { scheduleNew.push(r.schedule); counts.parsedSchedule++; }
            if (r.reason) counts.failed++;
            processedUpdates[r.srcId] = { t: Date.now(), k: r.ledger ? 'ledger' : (r.schedule ? 'schedule' : `fail:${r.reason || 'unknown'}`) };
            if (preview.length < 100) {
              preview.push({
                kind: r.kind,
                from: clip(fromV.address || '', 60),
                subject: clip(parsed.subject || '', 80),
                mailDate: r.mailYmd,
                ledger: r.ledger ? { amount: r.ledger.amount, place: r.ledger.place, category: r.ledger.category, method: r.ledger.method, needsReview: r.ledger.needsReview } : null,
                schedule: r.schedule ? { title: r.schedule.title, date: r.schedule.date, endDate: r.schedule.endDate, needsReview: r.schedule.needsReview } : null,
                reason: r.reason || null
              });
            }
          } catch (e) {
            counts.failed++;
            console.log(`::warning::메일 1건 파싱 실패 (${e.code || e.name})`);
          }
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }

  const writeStats = { ledger: null, schedule: null };
  if (!dryRun) {
    if (ledgerNew.length) {
      let stats = null;
      await db.ref(LEDGER_PATH).transaction((cur) => {
        const r = mergeItems(cur, ledgerNew, LEDGER_MAX, 'ledger');
        stats = r.stats;
        return r.list.length ? r.list : null;
      });
      writeStats.ledger = stats;
    }
    if (scheduleNew.length) {
      let stats = null;
      await db.ref(schedulePath).transaction((cur) => {
        const r = mergeItems(cur, scheduleNew, SCHEDULE_MAX, 'schedule');
        stats = r.stats;
        return r.list.length ? r.list : null;
      });
      writeStats.schedule = stats;
    }
    // 처리 이력 기록 + 오래된 이력 정리
    const cutoff = Date.now() - PROCESSED_TTL_DAYS * 86400000;
    for (const [k, v] of Object.entries(processed)) {
      if (!v || !v.t || v.t < cutoff) processedUpdates[k] = null;
    }
    if (Object.keys(processedUpdates).length) await db.ref(`${STATE_PATH}/processed`).update(processedUpdates);
    await db.ref(`${STATE_PATH}/last_real_run_at`).set(runStartedAt);
  }

  await db.ref(`${STATE_PATH}/last_run`).set({
    at: new Date().toISOString(),
    dryRun,
    sinceDays,
    schedulePath,
    counts,
    writeStats,
    preview
  });

  // Public 저장소: 건수만 출력
  console.log(`모드: ${dryRun ? 'DRY-RUN (앱 데이터 미변경)' : '실적재'} / 조회기간: ${sinceDays}일`);
  console.log(`스캔 ${counts.scanned} | 광고 ${counts.ad} · 프로모션 ${counts.promo} · 취소 ${counts.cancel} · 명세서 ${counts.statement} · 배송 ${counts.shipping} · 무관 ${counts.none}`);
  console.log(`결제 후보 ${counts.payment} → 가계부 파싱 ${counts.parsedLedger} | 예약 후보 ${counts.reservation} → 일정 파싱 ${counts.parsedSchedule} | 실패 ${counts.failed} | 기처리 ${counts.skippedProcessed}`);
  if (writeStats.ledger) console.log(`가계부 반영 ${writeStats.ledger.added} (중복 ${writeStats.ledger.dupSrc + writeStats.ledger.dupContent})`);
  if (writeStats.schedule) console.log(`일정 반영 ${writeStats.schedule.added} (중복 ${writeStats.schedule.dupSrc + writeStats.schedule.dupContent})`);
  console.log(`상세 결과: Firebase 콘솔 → ${STATE_PATH}/last_run`);

  await admin.app().delete();
}

/* ══════════════════════════════════════════════════
   7. 셀프 테스트 (의존성 없음, CI 선행 실행)
   ══════════════════════════════════════════════════ */
function selfTest() {
  const opt = { author: '진세', defaultMethod: '삼성카드', fx: { USD: 1400, JPY: 9.3, EUR: 1500 }, isPrivate: false, reservationToLedger: false };
  const d = new Date('2026-10-28T03:00:00Z');
  const cases = [
    { name: 'KO 쿠팡 결제', mail: { subject: '[쿠팡] 결제가 완료되었습니다', fromName: '쿠팡', fromAddr: 'no-reply@coupang.com', text: '주문번호 1234\n상품금액 35,000원\n할인 -3,000원\n배송비 0원\n총 결제금액 32,000원\n결제수단 삼성카드(1234)' },
      check: (r) => r.kind === 'payment' && r.ledger.amount === 32000 && r.ledger.method === '삼성카드' && r.ledger.place === '쿠팡' && r.ledger.date === '2026-10-28' && !r.ledger.needsReview },
    { name: 'KO 배민 결제(HTML)', mail: { subject: '[배달의민족] 주문이 완료되었습니다', fromName: '배달의민족', fromAddr: 'noreply@baemin.com', text: htmlToText('<table><tr><td>결제금액</td><td>18,500원</td></tr><tr><td>결제수단</td><td>카카오페이</td></tr></table>') },
      check: (r) => r.ledger && r.ledger.amount === 18500 && r.ledger.category === '배달' && r.ledger.method === '신용카드' && r.ledger.statusLiving === 'O' },
    { name: 'KO 광고 제외', mail: { subject: '(광고) 쿠팡 결제 완료 시 추가 혜택', text: '결제금액 1,000원' }, check: (r) => r.kind === 'ad' && !r.ledger },
    { name: 'KO 명세서 제외', mail: { subject: '[삼성카드] 10월 이용대금 명세서', text: '청구금액 1,234,000원' }, check: (r) => r.kind === 'statement' && !r.ledger },
    { name: 'KO 취소 제외', mail: { subject: '[아고다] 예약이 취소되었습니다', text: '체크인 2026년 11월 20일' }, check: (r) => r.kind === 'cancel' && !r.schedule },
    { name: 'KO 프로모션 제외', mail: { subject: '지금 예약하면 30% 할인! 예약 확인하세요', text: '' }, check: (r) => r.kind === 'promo' },
    { name: 'JA Amazon 결제(엔)', mail: { subject: '【Amazon.co.jp】ご注文の確認', fromName: 'Amazon.co.jp', fromAddr: 'auto-confirm@amazon.co.jp', text: '注文番号: 250-123\n商品の小計: ￥3,000\n配送料: ￥280\n注文合計： ￥3,280\nお支払い方法: クレジットカード' },
      check: (r) => r.ledger && r.ledger.amount === Math.round(3280 * 9.3) && r.ledger.needsReview && /¥3,280/.test(r.ledger.desc) && r.ledger.method === '신용카드' },
    { name: 'EN Apple 영수증(달러)', mail: { subject: 'Your receipt from Apple.', fromName: 'Apple', fromAddr: 'no_reply@email.apple.com', text: 'iCloud+ 50GB Monthly\nSubtotal $0.90\nTax $0.09\nTOTAL $0.99' },
      check: (r) => r.ledger && r.ledger.amount === Math.round(0.99 * 1400) && r.ledger.category === '취미' },
    { name: 'KO 호텔 예약', mail: { subject: '[아고다] 예약이 확정되었습니다', fromName: 'Agoda', fromAddr: 'no-reply@agoda.com', text: '예약번호 98765\n체크인: 2026년 11월 20일 (금) 15:00 이후\n체크아웃: 2026년 11월 22일 (일) 11:00 이전\n총 결제금액 ₩320,000' },
      check: (r) => r.kind === 'reservation' && r.schedule.date === '2026-11-20' && r.schedule.endDate === '2026-11-22' && /^🏨 15:00/.test(r.schedule.title) && !r.ledger && !r.schedule.needsReview },
    { name: 'JA 레스토랑 예약(연도 없음)', mail: { subject: 'ご予約確認のお知らせ', fromName: '一休.com レストラン', fromAddr: 'info@ikyu.com', text: 'ご予約日時：11月7日(土) 19:00\n人数：2名' },
      check: (r) => r.schedule && r.schedule.date === '2026-11-07' && r.schedule.endDate === null && /^🍽️ 19:00/.test(r.schedule.title) },
    { name: 'EN 항공 왕복', mail: { subject: 'Booking confirmation - Flight to Tokyo', fromName: 'Korean Air', fromAddr: 'noreply@koreanair.com', text: 'Departure: Sat, 7 Nov 2026\n09:35 ICN → NRT\nReturn: Wed, 11 Nov 2026 18:20 NRT → ICN' },
      check: (r) => r.schedule && r.schedule.date === '2026-11-07' && r.schedule.endDate === '2026-11-11' && /^✈️ 09:35/.test(r.schedule.title) },
    { name: 'KO 공연 예매(오후 표기)', mail: { subject: '[인터파크] 예매가 완료되었습니다', fromName: '인터파크티켓', fromAddr: 'ticket@interpark.com', text: '관람일시: 2026.12.24 오후 7시 30분\n좌석: R석' },
      check: (r) => r.schedule && r.schedule.date === '2026-12-24' && /^🎫 19:30/.test(r.schedule.title) },
    { name: '연말 연도 넘김 추론', mail: { subject: 'ご予約確認', text: 'ご来店日 1月3日 12:00', date: new Date('2026-12-20T03:00:00Z') },
      check: (r) => r.schedule && r.schedule.date === '2027-01-03' },
    { name: '테마파크 예약 아이콘(본문 탑승 단어 무시)', mail: { subject: '[에버랜드] 스마트예약 완료 안내', fromName: '에버랜드', fromAddr: 'noreply@everland.com', text: '이용일: 2026-11-15\n어트랙션 탑승 시간을 확인하세요' },
      check: (r) => r.schedule && r.schedule.date === '2026-11-15' && /^🎫/.test(r.schedule.title) },
    { name: '배송 안내 제외', mail: { subject: 'Your order has shipped', text: 'Order total $10' }, check: (r) => r.kind === 'shipping' && !r.ledger }
  ];

  let fail = 0;
  for (const c of cases) {
    const r = parseMail({ date: d, messageId: c.name, fromName: '', fromAddr: '', ...c.mail }, opt);
    let ok = false;
    try { ok = !!c.check(r); } catch (e) { ok = false; }
    if (!ok) {
      fail++;
      console.log(`❌ ${c.name}\n   ${JSON.stringify({ kind: r.kind, ledger: r.ledger, schedule: r.schedule, reason: r.reason })}`);
    } else {
      console.log(`✅ ${c.name}`);
    }
  }

  // 병합 로직
  const cur = [{ id: 1761600000000, date: '2026-10-28', amount: 32000, desc: '수기 입력' }];
  const m1 = mergeItems(cur, [
    { id: 1761600000000, date: '2026-10-28', amount: 32000, srcId: 'a' },
    { id: 1761600000000, date: '2026-10-28', amount: 18500, srcId: 'b' },
    { id: 1761600000500, date: '2026-10-28', amount: 18500, srcId: 'b' }
  ], 2000, 'ledger');
  const m1ok = m1.stats.added === 1 && m1.stats.dupContent === 1 && m1.stats.dupSrc === 1
    && m1.list.length === 2 && new Set(m1.list.map((x) => x.id)).size === 2 && Array.isArray(m1.list);
  console.log(`${m1ok ? '✅' : '❌'} 병합: 내용중복/ID충돌/srcId중복 처리`);
  if (!m1ok) fail++;

  // auto 조회 기간
  const D = 86400000;
  const n0 = Date.UTC(2026, 9, 29);
  const aok = resolveAutoSinceDays(n0 - 3600000, n0) === 3
    && resolveAutoSinceDays(n0 - 10 * D, n0) === 11
    && resolveAutoSinceDays(n0 - 400 * D, n0) === 90
    && resolveAutoSinceDays(n0 + D, n0) === 3;
  console.log(`${aok ? '✅' : '❌'} auto 조회 기간 계산`);
  if (!aok) fail++;
  const m2 = mergeItems({ k1: { id: 5, date: '2026-11-01', title: 'A' } }, [{ id: 9, date: '2026-11-01', title: 'B', srcId: 'z' }], 1, 'schedule');
  const m2ok = m2.list.length === 1 && m2.list[0].id === 9;
  console.log(`${m2ok ? '✅' : '❌'} 병합: 객체형 원본 정규화 + 최대 건수 제한`);
  if (!m2ok) fail++;

  console.log(fail ? `\n셀프테스트 실패 ${fail}건` : '\n셀프테스트 전체 통과');
  return fail === 0;
}

export { classify, parseMail, mergeItems, findDates, findAmount, htmlToText };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--self-test')) {
    process.exit(selfTest() ? 0 : 1);
  } else {
    main().then(() => process.exit(0)).catch((e) => {
      console.log(`::error::${e.message}`);
      process.exit(1);
    });
  }
}
