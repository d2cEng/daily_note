// settings.js — 백업 / 가져오기 / 초기화 / 면책
import { exportJson, importJson, importTsv, importEntries, clearAll, getAll } from './store.js';
import { parseInbodyCsv } from './inbody.js';
import { ocrImage, parseOkokOcrText, okokReviewCard } from './okok-ocr.js';
import { el, clear, downloadFile, fmtDate } from './util.js';
import { toast, navigate } from './app.js';

export function renderSettings(host) {
  clear(host);

  const count = getAll().length;

  // 백업
  const backup = el('div', { class: 'card' }, [
    el('h2', { class: 'card__title' }, '데이터 백업'),
    el('div', { class: 'muted', style: { marginBottom: '12px' } },
      `현재 ${count}건의 기록이 이 기기에 저장되어 있습니다. 데이터는 브라우저(localStorage)에만 보관됩니다.`),
    el('div', { class: 'btn-row' }, [
      el('button', {
        class: 'btn btn--primary',
        onClick: () => {
          downloadFile(`vitalog-backup-${fmtDate(Date.now())}.json`, exportJson());
          toast('백업 파일을 내보냈습니다.');
        },
      }, '⬇ JSON 내보내기'),
      el('button', {
        class: 'btn',
        onClick: () => fileInput.click(),
      }, '⬆ JSON 가져오기'),
    ]),
  ]);

  // 메모앱 TSV / InBody CSV 가져오기
  backup.appendChild(el('div', { class: 'muted', style: { margin: '14px 0 8px', fontSize: '13px' } },
    '안드로이드 메모앱 TSV, 또는 InBody 앱이 내보낸 CSV를 직접 불러올 수 있습니다.'));
  backup.appendChild(el('button', {
    class: 'btn btn--block',
    onClick: () => tsvInput.click(),
  }, '📄 메모앱 TSV 가져오기'));
  backup.appendChild(el('button', {
    class: 'btn btn--block',
    style: { marginTop: '8px' },
    onClick: () => inbodyInput.click(),
  }, '🧬 InBody CSV 가져오기'));
  backup.appendChild(el('button', {
    class: 'btn btn--block',
    style: { marginTop: '8px' },
    onClick: () => okokInput.click(),
  }, '📷 OKOK 스크린샷 가져오기 (여러 장 가능)'));
  // OCR 진행/검토 영역
  const okokArea = el('div', { style: { marginTop: '12px' } });
  backup.appendChild(okokArea);

  const readFile = (f, importer, label) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const n = importer(reader.result, 'merge');
        toast(`${label} ${n}건을 가져왔습니다.`);
        navigate('settings');
      } catch (err) {
        toast('가져오기 실패: ' + err.message);
      }
    };
    reader.readAsText(f);
  };

  const fileInput = el('input', {
    type: 'file', accept: 'application/json,.json',
    style: { display: 'none' },
    onChange: (e) => { const f = e.target.files[0]; if (f) readFile(f, importJson, 'JSON'); },
  });
  const tsvInput = el('input', {
    type: 'file', accept: '.tsv,.txt,text/tab-separated-values,text/plain',
    style: { display: 'none' },
    onChange: (e) => { const f = e.target.files[0]; if (f) readFile(f, importTsv, '메모앱'); },
  });
  const inbodyInput = el('input', {
    type: 'file', accept: '.csv,text/csv,text/plain',
    style: { display: 'none' },
    onChange: (e) => {
      const f = e.target.files[0];
      if (f) readFile(f, (txt, mode) => importEntries(parseInbodyCsv(txt), mode), 'InBody');
    },
  });
  const okokInput = el('input', {
    type: 'file', accept: 'image/*', multiple: true,
    style: { display: 'none' },
    onChange: async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      clear(okokArea);
      const status = el('div', { class: 'note' }, `OCR 분석 준비 중… (0/${files.length})`);
      okokArea.appendChild(status);
      const cards = el('div');
      okokArea.appendChild(cards);
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const imageUrl = URL.createObjectURL(f);
        status.textContent = `OCR 분석 중… (${i + 1}/${files.length}) 0%`;
        try {
          const text = await ocrImage(f, (p) => {
            status.textContent = `OCR 분석 중… (${i + 1}/${files.length}) ${Math.round(p * 100)}%`;
          });
          const parsed = parseOkokOcrText(text);
          const card = okokReviewCard(parsed, {
            imageUrl, rawText: text,
            onSaved: () => { card.classList.add('is-saved'); },
          });
          cards.appendChild(card);
        } catch (err) {
          cards.appendChild(el('div', { class: 'note note--warn' }, `${f.name} OCR 실패: ${err.message}`));
        }
      }
      status.textContent = `${files.length}장 분석 완료 · 각 카드에서 확인 후 저장하세요.`;
      okokInput.value = '';
    },
  });
  backup.appendChild(fileInput);
  backup.appendChild(tsvInput);
  backup.appendChild(inbodyInput);
  backup.appendChild(okokInput);
  host.appendChild(backup);

  // 초기화
  host.appendChild(el('div', { class: 'card' }, [
    el('h2', { class: 'card__title' }, '데이터 초기화'),
    el('div', { class: 'muted', style: { marginBottom: '12px' } },
      '모든 운동·체중·보충제 기록을 삭제합니다. 되돌릴 수 없으니 먼저 백업하세요.'),
    el('button', {
      class: 'btn btn--danger btn--block',
      onClick: () => {
        if (confirm('정말 모든 기록을 삭제할까요? 되돌릴 수 없습니다.')) {
          clearAll();
          toast('모든 데이터를 삭제했습니다.');
          navigate('settings');
        }
      },
    }, '전체 삭제'),
  ]));

  // 정보 / 면책
  host.appendChild(el('div', { class: 'card' }, [
    el('h2', { class: 'card__title' }, 'VITALOG 정보'),
    el('div', { class: 'muted', style: { fontSize: '13px' } },
      'Technogym 기기 짐에서의 운동·체중·보충제를 가이드 세션으로 기록하는 오프라인 웹앱입니다. 휴대폰 홈 화면에 추가하면 앱처럼 사용할 수 있습니다.'),
    el('div', { class: 'disclaimer' },
      '※ 보충제·운동 안내는 일반적인 정보 제공용이며 의학적·전문적 조언이 아닙니다. ' +
      '카페인 민감도, 기저질환, 복용 약물에 따라 적합성이 달라질 수 있으니 필요 시 전문가와 상담하세요. ' +
      '데이터는 서버로 전송되지 않고 이 기기에만 저장됩니다.'),
  ]));
}
