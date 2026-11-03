// Why: 실제 한글 조합의 이벤트 순서와 복구 쓰기 시간을 본문 없이 비교한다.
export function installImeProbe(label) {
  let recording = false;
  let started = 0;
  let events = [];
  let dropped = 0;
  const add = (row) => {
    if (!recording) return;
    if (events.length >= 2000) { dropped++; return; }
    events.push(Object.assign(row, { at: performance.now() - started }));
  };
  for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'keydown', 'beforeinput', 'input', 'focusin', 'focusout']) {
    document.addEventListener(type, event => {
      if (!(event.target instanceof Element) || !event.target.closest('.bn-editor')) return;
      if (type === 'keydown' && event.key !== 'Enter') return;
      const row = { type, trusted: event.isTrusted, composing: Boolean(event.isComposing), inputType: event.inputType ?? null, prevented: event.defaultPrevented, keyCode: event.keyCode ?? null, viewComposing: window.ProseMirror?.view?.composing === true };
      add(row);
      queueMicrotask(() => { row.prevented = event.defaultPrevented; row.viewComposingAfter = window.ProseMirror?.view?.composing === true; });
    }, true);
  }
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    const watch = recording && this === window.localStorage && key.startsWith('ticksidian.note-recovery.v1.active.');
    const before = performance.now();
    try { return original.call(this, key, value); }
    finally { if (watch) add({ type: 'recovery-setItem', duration: performance.now() - before, bytes: value.length * 2 }); }
  };
  const panel = document.createElement('section');
  panel.setAttribute('aria-label', '한글 조합 비교');
  panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:10000;max-width:360px;padding:12px;background:#242424;color:white;border:1px solid #777;border-radius:8px;font:14px system-ui;word-break:keep-all;overflow-wrap:break-word';
  const name = document.createElement('strong');
  name.textContent = label;
  const instructions = document.createElement('p');
  instructions.textContent = '측정 시작 → 감마 노트 본문에 같은 문장 직접 입력 → 조합 중 Enter 1회 → 잠시 뒤 Enter 1회 → 측정 종료.';
  const start = document.createElement('button');
  start.textContent = '측정 시작';
  const stop = document.createElement('button');
  stop.textContent = '측정 종료';
  const manual = document.createElement('input');
  manual.type = 'checkbox';
  const manualLabel = document.createElement('label');
  manualLabel.append(manual, ' 사람이 한글 입력기로 직접 입력했음');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  for (const button of [start, stop]) button.style.cssText = 'min-height:44px;margin-right:8px;padding:8px;background:#444;color:white;border:1px solid #999;border-radius:4px';
  start.onclick = () => { events = []; dropped = 0; started = performance.now(); recording = true; status.textContent = '측정 중'; };
  stop.onclick = async () => {
    recording = false;
    const report = { label, manualInputConfirmed: manual.checked, dropped, events };
    try {
      const response = await fetch('/__ime-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
      if (!response.ok) throw Error('Report failed');
      status.textContent = `기록 ${events.length}건 저장됨 · 직접 입력 확인: ${manual.checked ? '예' : '아니요'}`;
    } catch { status.textContent = '기록 저장 실패. 화면을 닫지 말고 다시 측정 종료를 눌러 주세요.'; }
  };
  const versions = document.createElement('p');
  for (const [port, title] of [[5186, '이전 버전'], [5187, '현재 버전']]) {
    const link = document.createElement('a');
    link.href = `http://127.0.0.1:${port}`;
    link.textContent = title;
    link.style.cssText = 'color:#a8cdff;margin-right:16px';
    versions.append(link);
  }
  panel.append(name, versions, instructions, start, stop, manualLabel, status);
  document.body.append(panel);
}
