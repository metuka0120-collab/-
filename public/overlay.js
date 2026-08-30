'use strict';

/* =========================================================
   OBS表示画面
   - WebSocketで管理画面の変更を受け取り、リロードなしで即時反映する。
   - URLパラメータ
       ?stats=0    本日の成績（勝敗・勝率）を隠す
       ?idle=hide  対戦者がいないときカードごと隠す（既定は「待機中」を表示）
       ?idle=show  対戦者がいないとき「待機中」カードを表示（既定）
   ========================================================= */

const params = new URLSearchParams(location.search);
const SHOW_STATS = params.get('stats') !== '0';
const SHOW_ROOM = params.get('room') !== '0';
const HIDE_WHEN_IDLE = params.get('idle') === 'hide';

const overlay = document.getElementById('overlay');
const elName = document.getElementById('name');
const elDeck = document.getElementById('deck');
const elMatchNo = document.getElementById('match-no');
const elTag = document.getElementById('tag');
const elRecruitTag = document.getElementById('recruit-tag');
const elIcon = document.getElementById('ov-icon');
const elRoom = document.getElementById('room');
const elRoomId = document.getElementById('room-id');
const elRecWin = document.getElementById('rec-win');
const elRecLose = document.getElementById('rec-lose');
const elRecRate = document.getElementById('rec-rate');

if (!SHOW_STATS) overlay.classList.add('no-record');

let lastCurrentId = null;

/**
 * 対戦していないときの表示。管理画面の「募集ステータス」で切り替わる。
 */
const IDLE_TEXT = {
  open: {
    tag: '募集中',
    name: '次の対戦者募集中',
    sub: 'コメントで参加受付中！'
  },
  paused: {
    tag: 'ストップ中',
    name: '対戦者募集ストップ中',
    sub: '待機消化後に再募集します'
  },
  closed: {
    tag: '受付終了',
    name: '募集終了',
    sub: 'ご参加ありがとうございました！'
  }
};

function render(state) {
  const current = state.current;
  const stats = state.stats || { wins: 0, losses: 0, winRate: 0, total: 0 };
  const settings = state.settings || {};

  // ルームID（入っているときだけ出す）
  const roomId = SHOW_ROOM ? String(settings.roomId || '').trim() : '';
  if (roomId) {
    elRoomId.textContent = roomId;
    elRoom.hidden = false;
  } else {
    elRoom.hidden = true;
  }

  elRecWin.textContent = stats.wins;
  elRecLose.textContent = stats.losses;
  elRecRate.textContent = `${stats.winRate}%`;

  if (current) {
    // 対戦者が切り替わったらアニメーションを1回再生する
    if (current.id !== lastCurrentId) {
      overlay.classList.remove('is-swap');
      void overlay.offsetWidth; // アニメーションを確実に再スタートさせる
      overlay.classList.add('is-swap');
    }
    lastCurrentId = current.id;

    overlay.classList.remove('is-idle', 'is-open', 'is-paused', 'is-closed', 'is-hidden');
    elTag.textContent = '対戦中';

    // 対戦中も募集状況が分かるようにする
    const matchStatus = IDLE_TEXT[settings.recruit] ? settings.recruit : 'open';
    elRecruitTag.textContent = IDLE_TEXT[matchStatus].tag;
    elRecruitTag.className = 'tag tag-recruit rc-' + matchStatus;
    elRecruitTag.hidden = false;
    if (current.icon) {
      if (elIcon.getAttribute('src') !== current.icon) elIcon.src = current.icon;
      elIcon.hidden = false;
    } else {
      elIcon.hidden = true;
      elIcon.removeAttribute('src');
    }
    elName.textContent = current.name || '名前未設定';
    elDeck.textContent = current.deck || 'デッキ未登録';
    elMatchNo.textContent = `本日 ${current.matchNumber} 戦目`;
    return;
  }

  // 対戦者がいないとき
  lastCurrentId = null;
  elIcon.hidden = true;
  elIcon.removeAttribute('src');
  overlay.classList.add('is-idle');
  overlay.classList.remove('is-swap');

  const status = IDLE_TEXT[settings.recruit] ? settings.recruit : 'open';
  const text = IDLE_TEXT[status];

  overlay.classList.remove('is-open', 'is-paused', 'is-closed');
  overlay.classList.add('is-' + status);

  elRecruitTag.hidden = true;
  elTag.textContent = text.tag;
  elName.textContent = text.name;
  elDeck.textContent = text.sub;
  elMatchNo.textContent = `本日 ${stats.total} 戦終了`;

  if (HIDE_WHEN_IDLE) {
    overlay.classList.add('is-hidden');
  } else {
    overlay.classList.remove('is-hidden');
  }
}

// ---------------------------------------------------------
// WebSocket接続（切れても自動で再接続する）
// ---------------------------------------------------------
let reconnectDelay = 500;

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/ws`);

  socket.addEventListener('open', () => {
    reconnectDelay = 500;
  });

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (err) {
      return;
    }
    if (message.type === 'state') render(message.payload);
  });

  socket.addEventListener('close', () => {
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 5000);
  });

  socket.addEventListener('error', () => socket.close());
}

// WebSocketが繋がる前でも正しく表示されるように、最初の1回はHTTPで取得する
fetch('/api/state')
  .then((res) => res.json())
  .then((data) => {
    if (data && data.ok) render(data.state);
  })
  .catch(() => {
    /* サーバー起動直後などは無視してよい。WebSocket接続時に再取得される */
  });

connect();
