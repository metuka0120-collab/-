'use strict';

/* =========================================================
   実況テロップ（配信画面の下のラインに流す）

   本日の対戦を、右から左へ順番に流し続ける。
   管理画面で対戦を記録すると、リロードなしでその場に加わる。

   URLパラメータ
     ?speed=70      流れる速さ（1秒あたりのピクセル数・既定70）
     ?bg=none       帯の下地を消して完全に透明にする
     ?head=0        左の「本日 5WIN 3LOSE」を消す
     ?only=comment  感想を書いた対戦だけ流す
     ?scale=1.2     文字とアイコンの大きさ（既定1）
   ========================================================= */

var params = new URLSearchParams(location.search);
var SPEED = Math.min(400, Math.max(10, Number(params.get('speed')) || 70));
var SHOW_HEAD = params.get('head') !== '0';
var ONLY_COMMENT = params.get('only') === 'comment';
var SCALE = Math.min(3, Math.max(0.5, Number(params.get('scale')) || 1));
var NO_BG = params.get('bg') === 'none';

document.documentElement.style.setProperty('--scale', String(SCALE));

var bar = document.getElementById('bar');
var track = document.getElementById('track');
var win = document.getElementById('window');
var elHWin = document.getElementById('h-win');
var elHLose = document.getElementById('h-lose');

bar.classList.toggle('has-bg', !NO_BG);
bar.classList.toggle('no-head', !SHOW_HEAD);

var state = { history: [], stats: {}, stamps: [] };
var setWidth = 0;   // 1周ぶんの幅
var lastKey = '';   // 中身が変わったかどうかの判定用

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function todayKey() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** IDから登録されているスタンプを引く */
function findStamp(id) {
  var list = state.stamps || [];
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  if (String(id).indexOf('emoji:') === 0) return { type: 'emoji', char: String(id).slice(6) };
  return null;
}

/** 流す対象（本日ぶん・古い順） */
function targets() {
  var key = todayKey();
  var rows = (state.history || []).filter(function (h) { return h.date === key; });
  if (ONLY_COMMENT) rows = rows.filter(function (h) { return h.comment; });
  return rows.sort(function (a, b) {
    return (a.matchNumber - b.matchNumber) || String(a.finishedAt).localeCompare(String(b.finishedAt));
  });
}

function itemHtml(h) {
  var stamps = (h.stamps || []).map(function (id) {
    var stamp = findStamp(id);
    if (!stamp) return '';
    return stamp.type === 'emoji'
      ? '<span>' + esc(stamp.char) + '</span>'
      : '<img src="' + esc(stamp.url) + '" alt="">';
  }).join('');

  return '<div class="item">' +
    '<span class="no">' + (h.matchNumber || '-') + '戦目</span>' +
    '<span class="badge ' + h.result + '">' + (h.result === 'win' ? 'WIN' : 'LOSE') + '</span>' +
    (h.icon ? '<img class="icon" src="' + esc(h.icon) + '" alt="">' : '') +
    '<span class="name">' + esc(h.name) + '</span>' +
    (h.deck ? '<span class="deck">' + esc(h.deck) + '</span>' : '') +
    (h.comment ? '<span class="comment">「' + esc(h.comment) + '」</span>' : '') +
    (stamps ? '<span class="stamps">' + stamps + '</span>' : '') +
  '</div>' +
  '<span class="sep"></span>';
}

/**
 * 流す中身を組み立てる。
 * 途切れずにループさせるため、画面幅を超えるまで同じ並びを繰り返し入れる。
 */
function build() {
  var rows = targets();
  var progress = currentProgress();

  elHWin.textContent = (state.stats && state.stats.wins) || 0;
  elHLose.textContent = (state.stats && state.stats.losses) || 0;

  if (!rows.length) {
    bar.classList.add('is-empty');
    track.innerHTML = '';
    setWidth = 0;
    return;
  }
  bar.classList.remove('is-empty');

  var one = rows.map(itemHtml).join('');
  track.innerHTML = one;
  setWidth = track.scrollWidth;

  if (setWidth <= 0) return;

  // 画面の右端が空かないように、必要な回数だけ繰り返す
  var need = Math.ceil((win.clientWidth + setWidth) / setWidth) + 1;
  var html = '';
  for (var i = 0; i < need; i++) html += one;
  track.innerHTML = html;

  startScroll(progress);
}

/** いま何割まで流れているか（0〜1）。組み立て直しても位置を引き継ぐために使う */
function currentProgress() {
  if (!track.getAnimations) return 0;
  var list = track.getAnimations();
  if (!list.length) return 0;

  var anim = list[0];
  var duration = anim.effect && anim.effect.getTiming ? anim.effect.getTiming().duration : 0;
  var at = anim.currentTime;
  if (!duration || typeof at !== 'number') return 0;
  return (((at % duration) + duration) % duration) / duration;
}

/** 流れる動きを開始する。1周ぶんの幅を SPEED で割った時間をかけて1周する */
function startScroll(fromProgress) {
  if (setWidth <= 0) {
    track.style.animation = 'none';
    return;
  }
  var duration = setWidth / SPEED;
  track.style.setProperty('--shift', setWidth + 'px');

  // いったん止めてから掛け直さないと、同じ設定では再生し直されない
  track.style.animation = 'none';
  void track.offsetWidth;
  track.style.animation = 'ticker-scroll ' + duration.toFixed(3) + 's linear infinite';
  track.style.animationDelay = (-(fromProgress || 0) * duration).toFixed(3) + 's';
}

/** 中身が変わったときだけ組み立て直す */
function refresh() {
  var rows = targets();
  var key = rows.map(function (h) {
    return [h.id, h.result, h.name, h.deck, h.comment, h.icon, (h.stamps || []).join('/')].join('|');
  }).join('#') + '@' + win.clientWidth;

  if (key === lastKey) {
    elHWin.textContent = (state.stats && state.stats.wins) || 0;
    elHLose.textContent = (state.stats && state.stats.losses) || 0;
    return;
  }
  lastKey = key;
  build();
}

// 画像の読み込みで幅が変わることがあるので、読み終わったら測り直す
window.addEventListener('load', function () { lastKey = ''; refresh(); });
window.addEventListener('resize', refresh);

// ---------------------------------------------------------
// サーバーとつなぐ（管理画面の記録が即座に流れる）
// ---------------------------------------------------------
var reconnectDelay = 500;

function connect() {
  var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var socket = new WebSocket(protocol + '//' + location.host + '/ws');

  socket.addEventListener('open', function () { reconnectDelay = 500; });
  socket.addEventListener('message', function (event) {
    var message;
    try { message = JSON.parse(event.data); } catch (e) { return; }
    if (message.type === 'state') { state = message.payload; refresh(); }
  });
  socket.addEventListener('close', function () {
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 5000);
  });
  socket.addEventListener('error', function () { socket.close(); });
}

fetch('/api/state').then(function (r) { return r.json(); }).then(function (data) {
  if (data && data.ok) { state = data.state; refresh(); }
}).catch(function () { /* WebSocket接続時に届く */ });

connect();
