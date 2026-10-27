/**
 * GOGO 매니저 - 주차 위치 관리 모듈
 * - 14자리 KST 정수 규격 및 13자리 Epoch ms 통합 파서 탑재
 * - 기둥 번호, 구역/열, 위치 사진 Base64 저장 및 최신 2개 유지
 */

const ParkingModule = (() => {
  let parkingLogs = [];
  let currentFilter = 'ALL';
  let selectedType = '지하 주차장';
  let selectedCar = 'X1';
  let selectedFloor = 'B1';
  let attachedPhotoBase64 = null;

  function normalizeParkingTimestamp(item) {
    if (!item) return 0;
    if (item.id) {
      const idStr = String(item.id).trim();
      if (idStr.length === 14 && idStr.startsWith('20')) {
        const y = parseInt(idStr.substring(0, 4), 10);
        const m = parseInt(idStr.substring(4, 6), 10) - 1;
        const d = parseInt(idStr.substring(6, 8), 10);
        const h = parseInt(idStr.substring(8, 10), 10);
        const min = parseInt(idStr.substring(10, 12), 10);
        const s = parseInt(idStr.substring(12, 14), 10);
        return new Date(y, m, d, h, min, s).getTime();
      }
      if (idStr.length === 13 && !isNaN(Number(idStr))) {
        return Number(idStr);
      }
    }
    if (item.time) {
      const match = item.time.match(/(\d+)월\s*(\d+)일\s*(\d+):(\d+)/);
      if (match) {
        const now = new Date();
        return new Date(now.getFullYear(), parseInt(match[1], 10) - 1, parseInt(match[2], 10), parseInt(match[3], 10), parseInt(match[4], 10), 0).getTime();
      }
    }
    return Number(item.id) || 0;
  }

  function generate14DigitKstId() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const kst = new Date(utc + (9 * 60 * 60000));
    const yyyy = kst.getFullYear();
    const MM = String(kst.getMonth() + 1).padStart(2, '0');
    const dd = String(kst.getDate()).padStart(2, '0');
    const HH = String(kst.getHours()).padStart(2, '0');
    const mm = String(kst.getMinutes()).padStart(2, '0');
    const ss = String(kst.getSeconds()).padStart(2, '0');
    return Number(`${yyyy}${MM}${dd}${HH}${mm}${ss}`);
  }

  function formatKoreanTime() {
    const now = new Date();
    const m = now.getMonth() + 1;
    const d = now.getDate();
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return `${m}월 ${d}일 ${h}:${min}`;
  }

  function init() {
    bindEvents();
    subscribeData();
  }

  function subscribeData() {
    try {
      if (typeof firebase === 'undefined' || !firebase.apps.length) return;
      firebase.database().ref('parking_logs').on('value', (snapshot) => {
        const data = snapshot.val();
        if (!data) {
          parkingLogs = [];
          renderList();
          return;
        }

        const list = Object.keys(data).map((k) => ({
          ...data[k],
          firebaseKey: k
        }));

        list.sort((a, b) => normalizeParkingTimestamp(b) - normalizeParkingTimestamp(a));
        parkingLogs = list;
        pruneOldRecords(list);
        renderList();
      });
    } catch (err) {
      console.warn('주차 리스너 초기화 대기:', err);
    }
  }

  function pruneOldRecords(sortedList) {
    ['X1', '엑센트'].forEach((carName) => {
      const items = sortedList.filter((item) => item.car === carName);
      if (items.length > 2) {
        for (let i = 2; i < items.length; i++) {
          if (items[i].firebaseKey) {
            firebase.database().ref(`parking_logs/${items[i].firebaseKey}`).remove().catch(() => {});
          }
        }
      }
    });
  }

  function renderList() {
    const container = document.getElementById('parking-record-list');
    if (!container) return;

    let filtered = parkingLogs;
    if (currentFilter === 'X1') filtered = parkingLogs.filter((item) => item.car === 'X1');
    if (currentFilter === 'ACCENT') filtered = parkingLogs.filter((item) => item.car === '엑센트');

    if (filtered.length === 0) {
      container.innerHTML = '<div style="text-align:center; padding:24px; color:#94a3b8; font-size:13px;">기록된 주차 정보가 없습니다.</div>';
      return;
    }

    const latestX1 = parkingLogs.find((item) => item.car === 'X1');
    const latestAccent = parkingLogs.find((item) => item.car === '엑센트');

    let html = '';
    filtered.forEach((item) => {
      const isX1 = item.car === 'X1';
      const bullet = isX1 ? '⚪' : '⚫';
      const isLatest = (isX1 && latestX1 && item.firebaseKey === latestX1.firebaseKey) ||
                       (!isX1 && latestAccent && item.firebaseKey === latestAccent.firebaseKey);

      html += `
        <div class="record-item">
          <div class="record-info">
            <div class="record-main-text">
              <span>${bullet} ${escapeHtml(item.text)}</span>
              ${isLatest ? '<span class="badge-latest">⭐ 최신 주차</span>' : ''}
            </div>
            <div class="record-sub-text">
              🕒 ${escapeHtml(item.time)} · 등록: ${escapeHtml(item.author || '진세')}
            </div>
            ${item.photo ? `<div style="margin-top:6px;"><img src="${item.photo}" style="max-height:80px; border-radius:6px;" alt="주차 사진"/></div>` : ''}
          </div>
          <button class="btn-item-delete" onclick="ParkingModule.deleteRecord('${item.firebaseKey}')" title="삭제">✕</button>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  function saveParking() {
    const pillarInput = document.getElementById('input-parking-pillar');
    const sectionInput = document.getElementById('input-parking-section');
    const pillar = pillarInput ? pillarInput.value.trim() : '';
    const section = sectionInput ? sectionInput.value.trim().toUpperCase() : '';

    if (!pillar && !section) {
      alert('기둥 번호 또는 구역을 입력해 주세요.');
      return;
    }

    const slotCombined = `${pillar ? pillar + (pillar.endsWith('번') ? '' : '번') : ''}${section ? ' ' + section : ''}`.trim();
    const locationText = selectedType === '야외' 
      ? `${selectedCar} - 야외 ${slotCombined}` 
      : `${selectedCar} - ${selectedFloor}-${slotCombined}`;

    const newId = generate14DigitKstId();
    const author = localStorage.getItem('GOGO_CURRENT_USER') || '진세';

    const payload = {
      id: newId,
      car: selectedCar,
      type: selectedType,
      floor: selectedType === '야외' ? '야외' : selectedFloor,
      slot: slotCombined,
      text: locationText,
      author: author,
      time: formatKoreanTime(),
      photo: attachedPhotoBase64 || null
    };

    firebase.database().ref(`parking_logs/${newId}`).set(payload).then(() => {
      if (pillarInput) pillarInput.value = '';
      if (sectionInput) sectionInput.value = '';
      resetPhoto();
      alert(`${locationText} 등록 완료`);
    }).catch((err) => {
      console.error('주차 저장 에러:', err);
      alert('저장 중 오류가 발생했습니다.');
    });
  }

  function deleteRecord(key) {
    if (!confirm('해당 주차 기록을 삭제하시겠습니까?')) return;
    firebase.database().ref(`parking_logs/${key}`).remove().catch((e) => console.error(e));
  }

  function deleteAllRecords() {
    if (!confirm('차량별 모든 주차 기록을 영구 삭제하시겠습니까?')) return;
    firebase.database().ref('parking_logs').remove().then(() => {
      alert('모든 주차 기록이 삭제되었습니다.');
    });
  }

  function resetPhoto() {
    attachedPhotoBase64 = null;
    const previewWrap = document.getElementById('photo-preview-wrap');
    const photoInput = document.getElementById('input-parking-photo');
    if (previewWrap) previewWrap.style.display = 'none';
    if (photoInput) photoInput.value = '';
  }

  function bindEvents() {
    document.querySelectorAll('.parking-type-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.parking-type-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        selectedType = e.currentTarget.getAttribute('data-type');
        const floorGroup = document.getElementById('group-parking-floor');
        if (floorGroup) floorGroup.style.display = selectedType === '야외' ? 'none' : 'block';
      });
    });

    document.querySelectorAll('.car-select-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.car-select-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        selectedCar = e.currentTarget.getAttribute('data-car');
      });
    });

    document.querySelectorAll('.floor-select-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.floor-select-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        selectedFloor = e.currentTarget.getAttribute('data-floor');
      });
    });

    document.querySelectorAll('.parking-filter-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.parking-filter-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        currentFilter = e.currentTarget.getAttribute('data-filter');
        renderList();
      });
    });

    const photoInput = document.getElementById('input-parking-photo');
    if (photoInput) {
      photoInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
          attachedPhotoBase64 = evt.target.result;
          const previewImg = document.getElementById('photo-preview-img');
          const previewWrap = document.getElementById('photo-preview-wrap');
          if (previewImg && previewWrap) {
            previewImg.src = attachedPhotoBase64;
            previewWrap.style.display = 'block';
          }
        };
        reader.readAsDataURL(file);
      });
    }

    const removePhotoBtn = document.getElementById('btn-photo-remove');
    if (removePhotoBtn) removePhotoBtn.addEventListener('click', resetPhoto);

    const saveBtn = document.getElementById('btn-save-parking');
    if (saveBtn) saveBtn.addEventListener('click', saveParking);

    const deleteAllBtn = document.getElementById('btn-delete-all-parking');
    if (deleteAllBtn) deleteAllBtn.addEventListener('click', deleteAllRecords);
  }

  function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { init, deleteRecord, normalizeParkingTimestamp };
})();

document.addEventListener('DOMContentLoaded', () => ParkingModule.init());
