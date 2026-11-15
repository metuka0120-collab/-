'use strict';

/* =========================================================
   参加待ちのテロップ（OBSのブラウザソース用）
   - 記録画面の参加待ちリストを、リロードなしでそのまま映す
   - シャッフルしたときは、名前がくるくる回ってから止まる
   - URLパラメータ
       ?layout=band  横1行にする（画面の上や下に置く用）
       ?max=12       参加待ちに並べる人数の上限（越えたら「ほか○人」）
       ?width=340    パネルの幅（px）
       ?scale=1.3    全体の大きさ
       ?empty=hide   誰もいないときは隠す
       ?theme=pop    デザインを固定する
   ========================================================= */

const qParams = new URLSearchParams(location.search);
const BAND = qParams.get('layout') === 'band';
const MAX_CHIPS = Math.min(50, Math.max(1, Number(qParams.get('max')) || (BAND ? 8 : 12)));
const HIDE_EMPTY = qParams.get('empty') === 'hide';
const Q_SCALE = Math.min(3, Math.max(0.5, Number(qParams.get('scale')) || 1));
const Q_WIDTH = Number(qParams.get('width'));

const panel = document.getElementById('qpanel');
const elStatus = document.getElementById('q-status');
const elTotal = document.getElementById('q-total');
const elNext = document.getElementById('q-next');
const elPicks = document.getElementById('q-picks');
const elWait = document.getElementById('q-wait');
const elChips = document.getElementById('q-chips');
const elEmpty = document.getElementById('q-empty');

if (BAND) panel.classList.replace('qpanel', 'qband');
if (Q_SCALE !== 1) panel.style.zoom = String(Q_SCALE);
if (Q_WIDTH >= 200 && Q_WIDTH <= 1200) document.documentElement.style.setProperty('--qw', Q_WIDTH + 'px');

const STATUS_TEXT = { open: '参加受付中', paused: '受付ストップ中', closed: '受付終了' };

let lastShuffleId = null;   // 最後に見たシャッフル（最初の表示では演出しない）
let rolling = false;        // 名前を回している最中は、上書きしない
let pending = null;         // 回している最中に届いた最新の状態

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function render(state) {
  if (rolling) { pending = state; return; }

  const settings = state.settings || {};
  applyDesign(settings);

  const queue = state.queue || [];
  const meta = state.queueMeta || {};
  const config = settings.queue || {};
  const recruit = STATUS_TEXT[settings.recruit] ? settings.recruit : 'open';

  panel.classList.remove('is-open', 'is-paused', 'is-closed');
  panel.classList.add('is-' + recruit);
  elStatus.textContent = STATUS_TEXT[recruit];
  elTotal.textContent = queue.length;

  const picked = queue.filter((e) => e.pick > 0);
  const waiting = queue.filter((e) => !e.pick);

  // 次の対戦者
  elPicks.textContent = '';
  picked.forEach((e) => {
    const li = el('li');
    li.dataset.id = e.id;
    li.appendChild(el('span', 'q-num', String(e.pick)));
    li.appendChild(el('span', 'name', e.name));
    elPicks.appendChild(li);
  });
  elNext.hidden = !picked.length;

  // 参加待ち
  elChips.textContent = '';
  waiting.slice(0, MAX_CHIPS).forEach((e) => elChips.appendChild(el('span', 'q-chip', e.name)));
  if (waiting.length > MAX_CHIPS) elChips.appendChild(el('span', 'q-chip more', 'ほか ' + (waiting.length - MAX_CHIPS) + '人'));
  elWait.hidden = !waiting.length;

  // 誰もいないときの案内
  const joinWord = (config.joinWords || [])[0] || '参加希望';
  elEmpty.textContent = recruit === 'open'
    ? '「' + joinWord + '」とコメントで参加できます！'
    : (recruit === 'paused' ? '待機消化後に再募集します' : 'ご参加ありがとうございました！');
  elEmpty.hidden = queue.length > 0;

  panel.classList.toggle('is-hidden', HIDE_EMPTY && !queue.length);

  // 新しくシャッフルされたら、選ばれた人の名前を回す
  const fresh = (meta.lastPicked || []).filter((id) => picked.some((e) => e.id === id));
  if (lastShuffleId != null && meta.shuffleId !== lastShuffleId && fresh.length) {
    roll(fresh, queue.map((e) => e.name));
  }
  lastShuffleId = meta.shuffleId;
}

/**
 * ルーレットの演出。選ばれた人の名前の欄で、ほかの人の名前を次々に出し、
 * 上から順に止めていく。止まる名前はサーバーが選んだ本当の名前。
 */
function roll(ids, names) {
  const rows = ids
    .map((id) => elPicks.querySelector('li[data-id="' + id + '"]'))
    .filter(Boolean);
  if (!rows.length || names.length < 2) return;

  rolling = true;
  const finals = rows.map((row) => row.querySelector('.name').textContent);
  rows.forEach((row) => row.classList.add('rolling'));

  const started = Date.now();
  const timer = setInterval(() => {
    const elapsed = Date.now() - started;
    rows.forEach((row, i) => {
      if (!row.classList.contains('rolling')) return;
      const nameEl = row.querySelector('.name');
      if (elapsed >= 1100 + i * 600) {
        row.classList.remove('rolling');
        row.classList.add('landed');
        nameEl.textContent = finals[i];
      } else {
        nameEl.textContent = names[Math.floor(Math.random() * names.length)];
      }
    });
    if (rows.every((row) => !row.classList.contains('rolling'))) {
      clearInterval(timer);
      setTimeout(() => {
        rows.forEach((row) => row.classList.remove('landed'));
        rolling = false;
        if (pending) { const next = pending; pending = null; render(next); }
      }, 600);
    }
  }, 70);
}

// ---------------------------------------------------------
// WebSocket接続（切れても自動で再接続する）
// ---------------------------------------------------------
let reconnectDelay = 500;

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/ws`);

  socket.addEventListener('open', () => { reconnectDelay = 500; });
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch (err) { return; }
    if (message.type === 'state') render(message.payload);
  });
  socket.addEventListener('close', () => {
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 5000);
  });
  socket.addEventListener('error', () => socket.close());
}

connect();
