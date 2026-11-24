/**
 * GOGO 스마트 매니저 - 디지털 액자 공용 설정 (js/frame-config.js)
 * - GOGO 앱(업로드)과 frame.html(액자)이 함께 사용
 * - familyId: 액자 데이터 경로 /frame/{familyId}/ 의 키. Phase 1(가족별 데이터 분리)에서 같은 값을 가족 ID로 재사용
 * - familyId 는 비밀 값이 아님 (접근 통제는 Firebase 보안 규칙 + 사진 AES-GCM 암호화가 담당)
 * - database.rules.json 의 frame/$fid/pending 규칙에 같은 값이 고정되어 있으므로 변경 시 두 곳을 함께 수정
 */
(function () {
  'use strict';

  var config = {
    familyId: 'fam_t2hoijplai',

    /* 사진 처리 */
    longEdgePx: 1600,
    jpegQuality: 0.8,
    maxPhotos: 300,
    maxUploadBatch: 20,
    maxCipherChars: 1000000,

    /* 표시 */
    singleSlideSec: 30,
    pairSlideSec: 40,
    fadeMs: 1000,
    burnInShiftPx: 4,
    burnInShiftSec: 60,

    /* 감시 */
    heartbeatMin: 5,
    staleAlertMin: 30,

    /* 기본값 */
    defaultOfflineText: '연결이 끊겼어요. 전화 주세요',
    defaultNightStart: '00:00',
    defaultNightEnd: '06:00',

    /* 경로 헬퍼 */
    path: function (sub) {
      var s = String(sub || '').replace(/^\/+/, '');
      if (s.indexOf('..') !== -1) throw new Error('[FrameConfig] 잘못된 경로: ' + sub);
      return 'frame/' + config.familyId + (s ? '/' + s : '');
    }
  };

  if (!/^fam_[a-z0-9]{10}$/.test(config.familyId)) {
    throw new Error('[FrameConfig] familyId 형식 오류');
  }

  window.FRAME_CONFIG = Object.freeze(config);
})();
