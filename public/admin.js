'use strict';

/* =========================================================
   対戦記録画面
   - 状態はサーバーが持つ。この画面は WebSocket で受け取って描画するだけ。
   - 参加者の受付・整列はワンコメなど別ツールに任せ、ここは対戦履歴に専念する。
   ========================================================= */

var state = {
  settings: { streamTitle: '', myName: '', myDeck: '' },
  current: null,
  history: [],
  stats: { wins: 0, losses: 0, total: 0, winRate: 0, date: '' },
  totalStats: { wins: 0, losses: 0, total: 0, winRate: 0, days: 0 },
  opponents: [],
  myDecks: [],
  stamps: [],
  onecomme: { enabled: false, url: '', connected: false, lastError: '', count: 0 },
  commenters: []
};

/** 入力途中の内容が再描画で消えないように保持する */
var ui = {
  tab: 'live',
  currentId: null,
  result: null,       // 対戦中モードの勝敗
  comment: '',        // 対戦中モードの感想
  quickResult: null,  // あとから記録モードの勝敗
  editId: null,       // 編集中の履歴
  filterText: '',
  filterDay: 'today',
  filterResult: 'all',
  settingsDirty: false,
  liveStamps: [],   // 対戦中モードで選んだスタンプ
  quickStamps: [],  // あとから記録モードで選んだスタンプ
  editStamps: null, // 履歴編集中のスタンプ
  picked: null,     // わんコメから選んだリスナー { name, icon, listenerId }
  ocOpen: false,    // わんコメの設定欄を開いているか
  qOpen: false,     // 参加受付の設定欄を開いているか
  qDirty: false,    // 参加受付の設定を書きかけ中か
  qShuffleId: null, // 最後に見たシャッフルの番号（選ばれた人を光らせるため）
  ocDirty: false,   // わんコメの設定を入力中か
  roomDirty: false  // ルームIDを入力中か
};

function $(id) { return document.getElementById(id); }

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function hhmm(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function jpDate(key) {
  if (!key) return '';
  var p = String(key).split('-');
  if (p.length < 3) return key;
  var week = ['日', '月', '火', '水', '木', '金', '土'];
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return Number(p[0]) + '年' + Number(p[1]) + '月' + Number(p[2]) + '日（' + week[d.getDay()] + '）';
}

function normName(name) {
  return String(name == null ? '' : name).trim().toLowerCase().replace(/\s+/g, '');
}

/** そのリスナーとの通算成績を数える */
function h2h(name) {
  var key = normName(name);
  var wins = 0, losses = 0;
  if (!key) return { wins: 0, losses: 0, total: 0 };
  state.history.forEach(function (h) {
    if (normName(h.name) !== key) return;
    if (h.result === 'win') wins++; else losses++;
  });
  return { wins: wins, losses: losses, total: wins + losses };
}




// ---------------------------------------------------------
// 募集ステータス（OBS表示画面に出る）
// ---------------------------------------------------------
var RECRUIT_HINT = {
  open:   'OBSに「次の対戦者募集中」と出ます。',
  paused: 'OBSに「対戦者募集ストップ中」と出ます。待機を消化したら「次の対戦者募集中」に戻してください。',
  closed: 'OBSに「募集終了」と出ます。'
};

function renderRoom() {
  var roomId = (state.settings && state.settings.roomId) || '';
  if (!ui.roomDirty) $('room-input').value = roomId;

  $('room-hint').innerHTML = roomId
    ? '<span class="room-live"><span class="room-dot"></span>OBSに表示中： <b>' + esc(roomId) + '</b></span>'
    : 'ルームIDを入れて「反映」を押すと、OBS表示画面に出ます。';
}

function renderRecruit() {
  var now = (state.settings && state.settings.recruit) || 'open';
  Array.prototype.forEach.call(document.querySelectorAll('[data-recruit]'), function (b) {
    var on = b.dataset.recruit === now;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('recruit-hint').textContent = RECRUIT_HINT[now] || '';
}

// ---------------------------------------------------------
// アイコン
// ---------------------------------------------------------

/** アイコン画像。無いときは名前の1文字を出す */
function avatar(icon, name, extraClass) {
  var cls = 'avatar' + (extraClass ? ' ' + extraClass : '');
  if (icon) return '<img class="' + cls + '" src="' + esc(icon) + '" alt="">';
  var initial = String(name || '?').trim().charAt(0) || '?';
  return '<span class="' + cls + ' avatar-fallback">' + esc(initial) + '</span>';
}

// ---------------------------------------------------------
// ワンコメ連携
// ---------------------------------------------------------

function renderOneComme() {
  var oc = state.onecomme || {};
  var badge = $('oc-state');

  if (!oc.enabled) {
    badge.textContent = 'オフ';
    badge.className = 'oc-state';
  } else if (oc.connected) {
    badge.textContent = '● 接続中';
    badge.className = 'oc-state on';
  } else {
    badge.textContent = '× つながっていません';
    badge.className = 'oc-state err';
  }

  $('oc-settings').hidden = !ui.ocOpen;
  if (!ui.ocDirty) {
    $('oc-enabled').checked = !!oc.enabled;
    $('oc-url').value = oc.url || '';
  }

  $('oc-hint').textContent = !oc.enabled
    ? 'わんコメを起動した状態で「わんコメと連携する」をONにしてください。'
    : (oc.connected
        ? 'つながっています。コメントした順に下へ足していきます。一度出た人の場所は動きません。'
        : 'つながりません。わんコメが起動しているか、接続先が合っているか確認してください。'
          + (oc.lastError ? '（' + oc.lastError + '）' : ''));

  // 選択中のリスナー
  var pickedBox = $('oc-picked');
  if (ui.picked) {
    pickedBox.hidden = false;
    pickedBox.innerHTML =
      '<div class="picked">' +
        avatar(ui.picked.icon, ui.picked.name) +
        '<span class="picked-name"><span class="picked-label">取り込み中のリスナー</span>' + esc(ui.picked.name) + '</span>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="picked-clear">やめる</button>' +
      '</div>';
    $('picked-clear').addEventListener('click', function () {
      ui.picked = null;
      renderOneComme();
    });
  } else {
    pickedBox.hidden = true;
    pickedBox.innerHTML = '';
  }

  // コメントした人の一覧
  var list = state.commenters || [];
  var box = $('oc-list');

  if (!oc.enabled) {
    setOcList(box, '<div class="empty">連携をONにすると、コメントした人がここに出ます。<br>名前とアイコンをそのまま取り込めます。</div>');
    return;
  }
  if (!list.length) {
    setOcList(box, '<div class="empty">' +
      (oc.connected ? 'コメントを待っています…' : 'わんコメに接続できていません。') + '</div>');
    return;
  }

  var html = '<div class="oc-list">' + list.map(function (person, i) {
    return '<button type="button" class="oc-row" data-i="' + i + '">' +
      avatar(person.profileImage, person.name) +
      '<span class="oc-name">' + esc(person.name) +
        (person.comment ? '<span class="oc-comment">' + esc(person.comment) + '</span>' : '') +
      '</span>' +
      '<span class="oc-take">取り込む</span>' +
    '</button>';
  }).join('') + '</div>';

  // 中身が同じなら作り直さない（押そうとしたボタンが消えないように）
  if (!setOcList(box, html)) return;

  Array.prototype.forEach.call(box.querySelectorAll('.oc-row'), function (row) {
    row.addEventListener('click', function () {
      var person = (state.commenters || [])[Number(row.dataset.i)];
      if (!person) return;
      ui.picked = { name: person.name, icon: person.profileImage, listenerId: person.userId };
      // 見えている入力欄に名前を入れる
      if ($('st-name')) $('st-name').value = person.name;
      if ($('q-name')) $('q-name').value = person.name;
      renderOneComme();
    });
  });
}

/*
  コメント一覧を書き換える。
  中身が同じときは何もしない。書き換えるときもスクロール位置を保つので、
  下の方の人を取り込もうとしている最中に新しいコメントが来ても、見ている場所は動かない。
  書き換えたときだけ true を返す（ボタンの処理を付け直す必要があるため）。
*/
var lastOcHtml = null;
function setOcList(box, html) {
  if (lastOcHtml === html) return false;
  var scroller = box.querySelector('.oc-list');
  var keep = scroller ? scroller.scrollTop : 0;
  box.innerHTML = html;
  lastOcHtml = html;
  var next = box.querySelector('.oc-list');
  if (next && keep) next.scrollTop = keep;
  return true;
}

/** 記録するときに、取り込んだアイコンを一緒に送る */
function pickedFor(name) {
  if (!ui.picked) return {};
  if (normName(ui.picked.name) !== normName(name)) return {};
  return { icon: ui.picked.icon, listenerId: ui.picked.listenerId };
}

// ---------------------------------------------------------
// スタンプ
// ---------------------------------------------------------

/** IDから登録されているスタンプを引く */
function findStamp(id) {
  var list = state.stamps || [];
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  // 画像を消した / 名前を変えた場合でも記録は残っているので、それらしく出す
  if (String(id).indexOf('emoji:') === 0) {
    return { id: id, type: 'emoji', char: String(id).slice(6), label: '' };
  }
  return null;
}

/** 表示だけのスタンプ（履歴カード用） */
function stampsView(ids) {
  if (!ids || !ids.length) return '';
  var html = ids.map(function (id) {
    var stamp = findStamp(id);
    if (!stamp) return '';
    return stamp.type === 'emoji'
      ? '<span class="stamp-view" title="' + esc(stamp.label) + '">' + esc(stamp.char) + '</span>'
      : '<span class="stamp-view"><img src="' + esc(stamp.url) + '" alt="' + esc(stamp.label) + '"></span>';
  }).join('');
  return html ? '<div class="m-stamps">' + html + '</div>' : '';
}

/**
 * スタンプを選ぶUIを作る。
 * selected は配列そのものを書き換える（最大3つ）。
 */
function mountStampPicker(container, selected, onChange) {
  if (!container) return;
  var list = state.stamps || [];

  container.innerHTML = list.map(function (stamp) {
    var on = selected.indexOf(stamp.id) !== -1;
    var inner = stamp.type === 'emoji'
      ? esc(stamp.char)
      : '<img src="' + esc(stamp.url) + '" alt="' + esc(stamp.label) + '">';
    return '<button type="button" class="stamp' + (on ? ' on' : '') + '" data-stamp="' + esc(stamp.id) + '" ' +
      'title="' + esc(stamp.label) + '" aria-pressed="' + on + '">' + inner + '</button>';
  }).join('') +
  '<button type="button" class="stamp stamp-reload" id="stamp-reload-' + container.id + '" title="stampsフォルダを読み直す">↻</button>';

  Array.prototype.forEach.call(container.querySelectorAll('button[data-stamp]'), function (b) {
    b.addEventListener('click', function () {
      var id = b.dataset.stamp;
      var at = selected.indexOf(id);
      if (at !== -1) selected.splice(at, 1);
      else if (selected.length >= 3) { window.alert('スタンプは3つまでです。'); return; }
      else selected.push(id);
      mountStampPicker(container, selected, onChange);
      if (onChange) onChange(selected);
    });
  });

  var reload = container.querySelector('.stamp-reload');
  if (reload) reload.addEventListener('click', function () { api('POST', '/api/stamps/reload'); });
}

// ---------------------------------------------------------
// 通信
// ---------------------------------------------------------
function api(method, url, body) {
  return fetch(url, {
    method: method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok || data.ok === false) throw new Error(data.error || ('通信に失敗しました (' + res.status + ')'));
      if (data.state) applyState(data.state);
      return data;
    });
  }).catch(function (err) {
    window.alert(err.message || '通信に失敗しました。サーバーが起動しているか確認してください。');
    throw err;
  });
}

var reconnectDelay = 500;
// 終了ボタンを押したあとは、再接続も「未接続」の表示もしない
var quitting = false;

function connect() {
  var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var socket = new WebSocket(protocol + '//' + location.host + '/ws');

  socket.addEventListener('open', function () { reconnectDelay = 500; setConnected(true); });
  socket.addEventListener('message', function (event) {
    var message;
    try { message = JSON.parse(event.data); } catch (e) { return; }
    if (message.type === 'state') applyState(message.payload);
  });
  socket.addEventListener('close', function () {
    if (quitting) return;
    setConnected(false);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 5000);
  });
  socket.addEventListener('error', function () { socket.close(); });
}

function setConnected(on) {
  $('conn').textContent = on ? '● 同期中' : '× 未接続（再接続します）';
  $('conn').className = 'conn ' + (on ? 'conn-on' : 'conn-off');
}

function applyState(next) {
  state = next;
  var currentId = state.current ? state.current.id : null;
  if (currentId !== ui.currentId) {
    ui.currentId = currentId;
    ui.result = null;
    ui.comment = '';
    ui.liveStamps = [];
  }
  render();
}

// ---------------------------------------------------------
// 描画
// ---------------------------------------------------------
function render() {
  renderVersion();
  renderOverlayDesign();
  renderTicker();
  renderQueue();
  mountStampPicker($('q-stamps'), ui.quickStamps);
  renderRecruit();
  renderRoom();
  renderOneComme();
  renderCurrent();
  renderStats();
  renderSettings();
  renderHistory();
  renderRankings();
  renderDatalists();
}

// --- バージョン表記（更新したファイルで動いているかの確認用） ---
function renderVersion() {
  var el = $('app-ver');
  if (el) el.textContent = state.appVersion ? 'v' + state.appVersion : '';
}

// --- 参加待ちリスト ---
function hhmmOf(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}

function renderQueue() {
  var queue = state.queue || [];
  var config = (state.settings && state.settings.queue) || {};
  var oc = state.onecomme || {};
  var meta = state.queueMeta || {};

  $('q-count').textContent = queue.length + '人';

  // 自動受付の状態
  var badge = $('q-auto');
  if (!config.autoJoin) { badge.textContent = '自動受付 オフ'; badge.className = 'oc-state'; }
  else if (!oc.enabled || !oc.connected) { badge.textContent = '自動受付（わんコメ未接続）'; badge.className = 'oc-state err'; }
  else if (config.onlyWhenOpen && state.settings.recruit !== 'open') { badge.textContent = '自動受付 お休み中'; badge.className = 'oc-state wait'; }
  else { badge.textContent = '● 自動受付中'; badge.className = 'oc-state on'; }

  // 設定欄
  $('q-settings').hidden = !ui.qOpen;
  if (!ui.qDirty) {
    $('q-autojoin').checked = config.autoJoin !== false;
    $('q-joinwords').value = (config.joinWords || []).join(', ');
    $('q-cancelwords').value = (config.cancelWords || []).join(', ');
    $('q-onlyopen').checked = config.onlyWhenOpen !== false;
    $('q-pickcount').value = String(config.pickCount || 3);
  }
  // 流れる速さ（動かしている最中は上書きしない）
  var speed = Number(config.speed) || 100;
  if (document.activeElement !== $('q-speed')) {
    $('q-speed').value = speed;
    $('q-speed-label').textContent = speedLabel(speed);
  }

  var count = config.pickCount || 3;
  var pickedCount = queue.filter(function (e) { return e.pick > 0; }).length;
  var full = queue.length > 0 && pickedCount >= Math.min(count, queue.length);
  // 選び終わっているときは押せないことが分かるようにする
  $('q-shuffle').textContent = full ? '✓ ' + pickedCount + '人 選ばれています'
    : (pickedCount ? '🎲 あと' + (count - pickedCount) + '人を選ぶ' : '🎲 ' + count + '人を選ぶ');
  $('q-shuffle').disabled = !queue.length || full;
  $('q-reshuffle').disabled = !queue.length;

  var joinWord = (config.joinWords || ['参加希望'])[0] || '参加希望';
  var cancelWord = (config.cancelWords || ['辞退'])[0] || '辞退';
  $('q-hint').textContent = config.autoJoin
    ? '「' + joinWord + '」とコメントした人が自動で入り、「' + cancelWord + '」で外れます。対戦を始めた人はリストから消えます。'
    : '自動受付はオフです。名前を入れて手で追加できます。';

  // 一覧
  var box = $('q-list');
  if (!queue.length) {
    var empty = '<div class="empty">まだ参加希望の人はいません。' +
      (config.autoJoin ? '<br>「' + esc(joinWord) + '」とコメントすると、ここに並びます。' : '') + '</div>';
    if (box.__html !== empty) { box.__html = empty; box.innerHTML = empty; }
    return;
  }

  var fresh = {};
  // 新しくシャッフルされたら、選ばれた人を光らせる
  if (ui.qShuffleId != null && meta.shuffleId !== ui.qShuffleId) {
    (meta.lastPicked || []).forEach(function (id) { fresh[id] = true; });
  }
  ui.qShuffleId = meta.shuffleId;

  var picked = queue.filter(function (e) { return e.pick > 0; });
  var waiting = queue.filter(function (e) { return !e.pick; });
  var busy = !!state.current;

  function row(e, i) {
    var lead = e.pick
      ? '<span class="q-pick">' + e.pick + '</span>'
      : '<span class="q-no">' + (i + 1) + '</span>';
    var sub = hhmmOf(e.joinedAt) + (e.source === 'onecomme' ? '　わんコメ' : '　手で追加') +
      (e.comment ? '　「' + e.comment + '」' : '');
    return '<div class="q-row' + (e.pick ? ' picked' : '') + (fresh[e.id] ? ' flash' : '') + '" data-qid="' + esc(e.id) + '">' +
      lead + avatar(e.icon, e.name) +
      '<div class="q-main" data-qtake title="クリックで名前を入力欄に入れる">' +
        '<div class="q-name">' + esc(e.name) + '</div>' +
        '<div class="q-sub">' + esc(sub) + '</div>' +
      '</div>' +
      '<div class="q-btns">' +
        '<button type="button" class="btn btn-primary btn-sm" data-qstart' + (busy ? ' disabled title="対戦中です"' : '') + '>対戦開始</button>' +
        (e.pick ? '<button type="button" class="btn btn-ghost btn-sm" data-qunpick>戻す</button>' : '') +
        '<button type="button" class="btn btn-ghost btn-sm" data-qremove title="リストから外す">×</button>' +
      '</div>' +
    '</div>';
  }

  var html = '';
  if (picked.length) html += '<div class="q-group">選ばれた人</div>' + picked.map(row).join('');
  if (waiting.length) html += '<div class="q-group">参加待ち（来た順）</div>' + waiting.map(row).join('');
  html = '<div class="q-list">' + html + '</div>';

  if (box.__html === html) return;
  var scroller = box.querySelector('.q-list');
  var keep = scroller ? scroller.scrollTop : 0;
  box.__html = html;
  box.innerHTML = html;
  var next = box.querySelector('.q-list');
  if (next && keep) next.scrollTop = keep;
}

// --- 実況テロップ（画面下の帯） ---
function renderTicker() {
  var config = (state.settings && state.settings.ticker) || {};
  $('tk-results').checked = config.results !== false;
  $('tk-queue').checked = config.queue !== false;
  $('tk-head').checked = config.head !== false;
  var speed = Number(config.speed) || 100;
  if (document.activeElement !== $('tk-speed')) {
    $('tk-speed').value = speed;
    $('tk-speed-label').textContent = speedLabel(speed);
  }
}

function speedLabel(value) {
  var v = Number(value);
  if (v === 100) return '100%（標準）';
  return v + '%（' + (v < 100 ? 'ゆっくり' : '速め') + '）';
}

function queueEntry(id) {
  var list = state.queue || [];
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

// --- OBS表示のデザイン ---
var OVERLAY_THEMES = [
  { id: 'pop',     label: 'ポップ',       sw: ['#FFF7E8', '#FFE27A', '#FF9DB4', '#2B2340'] },
  { id: 'yume',    label: 'ゆめかわ',     sw: ['#F3E3FF', '#FFE3F1', '#DDF6F3', '#C9A0FF'] },
  { id: 'note',    label: 'ノート',       sw: ['#FBF8F0', '#D6E6F2', '#FFD666', '#E2483D'] },
  { id: 'retro',   label: 'レトロゲーム', sw: ['#1E1840', '#FFFFFF', '#FFD93D', '#45F07F'] },
  { id: 'chic',    label: 'シック',       sw: ['#F4EFE6', '#26231F', '#94703F', '#A84B36'] },
  { id: 'classic', label: 'クラシック',   sw: ['#12141F', '#45B6FF', '#A45CFF', '#4FE39B'] }
];

/** フォントの選択肢（おまかせ → 同梱 → Windows → 自分で入れたもの） */
function fontOptions(current) {
  var list = window.FONT_LIST || [];
  var group = function (name, items) {
    return '<optgroup label="' + name + '">' + items.map(function (f) {
      return '<option value="' + esc(f.id) + '">' + esc(f.label) + '</option>';
    }).join('') + '</optgroup>';
  };
  var html = '<option value="">おまかせ（テーマのおすすめ）</option>';
  html += group('アプリに入っているフォント', list.filter(function (f) { return f.group === 'bundled'; }));
  html += group('Windows のフォント', list.filter(function (f) { return f.group === 'windows'; }));
  if (current && current.indexOf('custom:') === 0) {
    html += '<optgroup label="PCのフォント"><option value="' + esc(current) + '">' + esc(current.slice(7)) + '</option></optgroup>';
  }
  return html;
}

function renderOverlayDesign() {
  var design = (state.settings && state.settings.overlay) || {};
  var theme = design.theme || 'pop';
  var fonts = design.fonts || {};
  var sizes = design.sizes || {};

  var themesHtml = OVERLAY_THEMES.map(function (t) {
    return '<button type="button" class="ovd-theme' + (t.id === theme ? ' on' : '') + '" data-ovtheme="' + t.id + '">' +
      '<span class="ovd-sw">' + t.sw.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') + '</span>' +
      esc(t.label) + '</button>';
  }).join('');
  var box = $('ovd-themes');
  if (box.__html !== themesHtml) { box.__html = themesHtml; box.innerHTML = themesHtml; }

  ['name', 'label'].forEach(function (part) {
    var select = $('ovd-font-' + part);
    if (document.activeElement === select) return;
    var html = fontOptions(fonts[part]);
    if (select.__html !== html) { select.__html = html; select.innerHTML = html; }
    select.value = fonts[part] || '';

    var range = $('ovd-size-' + part);
    var size = Number(sizes[part]) || 100;
    if (document.activeElement !== range) range.value = size;
    $('ovd-size-' + part + '-label').textContent = range.value;
  });
}

/** OBS表示のデザインを保存する（つまみを動かしている間は少し待ってから） */
var overlaySaveTimer = null;
var pendingOverlay = {};
function saveOverlayDesign(patch, wait) {
  // 続けて変えても取りこぼさないよう、送る前の変更をまとめておく
  ['fonts', 'sizes'].forEach(function (key) {
    if (patch[key]) pendingOverlay[key] = Object.assign({}, pendingOverlay[key], patch[key]);
  });
  if (patch.theme) pendingOverlay.theme = patch.theme;
  clearTimeout(overlaySaveTimer);
  overlaySaveTimer = setTimeout(function () {
    var body = pendingOverlay;
    pendingOverlay = {};
    api('PUT', '/api/settings', { overlay: body });
  }, wait || 0);
}

// --- 対戦中 ---
function renderCurrent() {
  var box = $('current-area');
  var c = state.current;

  if (!c) {
    box.innerHTML =
      '<form id="start-form" class="form" autocomplete="off">' +
        '<div class="two">' +
          '<label class="field"><span>リスナー名</span>' +
          '<input type="text" id="st-name" list="name-list" placeholder="例）でゅえまくん" maxlength="40" required></label>' +
          '<label class="field"><span>相手のデッキ</span>' +
          '<input type="text" id="st-deck" list="deck-list" placeholder="例）青黒魔導具" maxlength="40"></label>' +
        '</div>' +
        '<button type="submit" class="btn btn-primary">対戦開始（OBSに表示）</button>' +
        '<p class="hint">開始するとOBSのオーバーレイに出ます。終わったら勝敗と感想を入れて履歴に保存します。</p>' +
      '</form>';

    $('start-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('st-name').value.trim();
      if (!name) { window.alert('リスナー名を入力してください。'); return; }
      api('POST', '/api/match/start', Object.assign(
        { name: name, deck: $('st-deck').value.trim() }, pickedFor(name)
      )).then(function () { ui.picked = null; renderOneComme(); });
    });
    return;
  }

  var rec = h2h(c.name);
  box.innerHTML =
    '<div class="cur-box">' +
      '<div class="cur-head">' +
        avatar(c.icon, c.name, 'avatar-lg') +
        '<div class="cur-body">' +
          '<div class="cur-no">本日 ' + c.matchNumber + ' 戦目 ／ 開始 ' + hhmm(c.startedAt) + '</div>' +
          '<div class="cur-name">' + esc(c.name) + '</div>' +
          '<div class="cur-deck">' + (c.deck ? esc(c.deck) : 'デッキ未入力') +
            (c.myDeck ? ' <span class="vs">VS</span> 自分: ' + esc(c.myDeck) : '') + '</div>' +
        '</div>' +
      '</div>' +
      (rec.total ? '<div class="cur-h2h">このリスナーとは通算 ' + rec.total + '戦 ' + rec.wins + 'WIN ' + rec.losses + 'LOSE</div>' : '') +
    '</div>' +
    '<div class="form" style="margin-top:12px">' +
      '<div class="results">' +
        '<button type="button" class="btn btn-win ' + (ui.result === 'win' ? 'on' : '') + '" data-result="win">WIN</button>' +
        '<button type="button" class="btn btn-lose ' + (ui.result === 'lose' ? 'on' : '') + '" data-result="lose">LOSE</button>' +
      '</div>' +
      '<label class="field"><span>試合の感想</span>' +
      '<textarea id="cmt" maxlength="200" placeholder="例）最後のシールドトリガーが決まった">' + esc(ui.comment) + '</textarea></label>' +
      '<div class="field"><span>スタンプ<em>（最大3つ）</em></span><div class="stamp-picker" id="live-stamps"></div></div>' +
      '<div class="cur-actions">' +
        '<button type="button" class="btn btn-primary" id="fin">対戦終了して保存</button>' +
        '<button type="button" class="btn btn-ghost" id="cancel">取り消す</button>' +
      '</div>' +
    '</div>';

  Array.prototype.forEach.call(box.querySelectorAll('[data-result]'), function (b) {
    b.addEventListener('click', function () { ui.result = b.dataset.result; renderCurrent(); });
  });
  $('cmt').addEventListener('input', function (e) { ui.comment = e.target.value; });
  mountStampPicker($('live-stamps'), ui.liveStamps);
  $('fin').addEventListener('click', function () {
    if (!ui.result) { window.alert('「WIN」か「LOSE」を選んでください。'); return; }
    api('POST', '/api/match/finish', { result: ui.result, comment: ui.comment, stamps: ui.liveStamps });
  });
  $('cancel').addEventListener('click', function () {
    if (!window.confirm('この対戦を記録せずに取り消しますか？')) return;
    api('POST', '/api/match/cancel');
  });
}

// --- 成績 ---
function renderStats() {
  var s = state.stats || {};
  var t = state.totalStats || {};
  $('s-win').textContent = s.wins || 0;
  $('s-lose').textContent = s.losses || 0;
  $('s-total').textContent = s.total || 0;
  $('s-rate').textContent = (s.winRate || 0) + '%';
  var cutoff = (state.settings && state.settings.dayCutoffHour) || 0;
  $('s-date').textContent = '集計日：' + jpDate(s.date) +
    (cutoff ? '（深夜 ' + cutoff + ':00 までを同じ日として数えています）' : '（0:00 で次の日に切り替わります）');
  $('t-line').textContent = (t.total || 0) + '戦 ' + (t.wins || 0) + 'WIN ' + (t.losses || 0) + 'LOSE　勝率 ' + (t.winRate || 0) + '%';
  $('t-days').textContent = t.days ? '（' + t.days + '日ぶん）' : '';
}

// --- 設定 ---
function renderSettings() {
  if (ui.settingsDirty) return; // 入力中は上書きしない
  var s = state.settings || {};
  $('set-title').value = s.streamTitle || '';
  $('set-myname').value = s.myName || '';
  $('set-mydeck').value = s.myDeck || '';
  $('set-cutoff').value = String(s.dayCutoffHour || 0);
}

// --- 入力補助（過去に使った名前・デッキ名を候補に出す） ---
function renderDatalists() {
  function fill(id, values) {
    $(id).innerHTML = values.slice(0, 60).map(function (v) { return '<option value="' + esc(v) + '"></option>'; }).join('');
  }
  var names = [], decks = [], myDecks = [];
  state.history.forEach(function (h) {
    if (h.name && names.indexOf(h.name) === -1) names.push(h.name);
    if (h.deck && decks.indexOf(h.deck) === -1) decks.push(h.deck);
    if (h.myDeck && myDecks.indexOf(h.myDeck) === -1) myDecks.push(h.myDeck);
  });
  fill('name-list', names);
  fill('deck-list', decks);
  fill('mydeck-list', myDecks);
}

// --- 履歴 ---
function filtered() {
  var today = state.stats ? state.stats.date : '';
  var text = ui.filterText.trim().toLowerCase();

  return state.history.filter(function (h) {
    if (ui.filterDay === 'today' && h.date !== today) return false;
    if (ui.filterResult !== 'all' && h.result !== ui.filterResult) return false;
    if (!text) return true;
    return [h.name, h.deck, h.myDeck, h.comment].join(' ').toLowerCase().indexOf(text) !== -1;
  });
}

/** 一度に描く枚数の上限。何年も貯めた履歴を「すべての日」で開いても固まらないように */
var MAX_RENDER = 200;

function renderHistory() {
  var rows = filtered();
  var area = $('history-area');
  $('h-count').textContent = rows.length;

  var hidden = 0;
  if (rows.length > MAX_RENDER) {
    hidden = rows.length - MAX_RENDER;
    rows = rows.slice(0, MAX_RENDER);
  }

  if (!rows.length) {
    area.innerHTML = '<div class="empty">' +
      (state.history.length ? '条件に合う対戦がありません。' : 'まだ対戦履歴はありません。左の画面から記録できます。') +
      '</div>';
    return;
  }

  // 日付ごとにまとめる（新しい日が上）
  var days = [];
  var byDay = {};
  rows.forEach(function (h) {
    if (!byDay[h.date]) { byDay[h.date] = []; days.push(h.date); }
    byDay[h.date].push(h);
  });

  area.innerHTML = days.map(function (day) {
    var list = byDay[day];
    var wins = list.filter(function (h) { return h.result === 'win'; }).length;
    var losses = list.length - wins;
    return '<div class="day-head"><b>' + jpDate(day) + '</b>' +
      '<span class="day-rec">' + list.length + '戦 ' + wins + 'WIN ' + losses + 'LOSE</span></div>' +
      list.map(matchCard).join('');
  }).join('') +
  (hidden ? '<div class="empty">新しい方から ' + MAX_RENDER + '件を表示しています（ほか ' + hidden +
    '件）。上の検索や絞り込みで探せます。</div>' : '');

  bindHistory();
}

function matchCard(h) {
  if (h.id === ui.editId) return matchEditCard(h);

  var rec = h2h(h.name);
  return '<div class="match ' + h.result + '" data-id="' + h.id + '">' +
    '<div class="m-top">' +
      '<span class="m-no">' + (h.matchNumber || '-') + '戦目</span>' +
      '<span class="m-badge ' + h.result + '">' + (h.result === 'win' ? 'WIN' : 'LOSE') + '</span>' +
      avatar(h.icon, h.name, 'avatar-sm') +
      '<span class="m-name">' + esc(h.name) + '</span>' +
      '<span class="m-time">' + hhmm(h.finishedAt) + '</span>' +
      '<span class="m-acts">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-a="edit">編集</button>' +
        '<button type="button" class="btn btn-danger btn-sm" data-a="del">削除</button>' +
      '</span>' +
    '</div>' +
    '<div class="m-decks">' +
      '<span class="deck-chip"><b>相手</b>' + (h.deck ? esc(h.deck) : '未入力') + '</span>' +
      (h.myDeck ? '<span class="vs">VS</span><span class="deck-chip mine"><b>自分</b>' + esc(h.myDeck) + '</span>' : '') +
    '</div>' +
    stampsView(h.stamps) +
    (h.comment ? '<div class="m-comment">' + esc(h.comment) + '</div>' : '') +
    (rec.total > 1 ? '<div class="m-h2h">このリスナーとは通算 <b>' + rec.total + '戦 ' + rec.wins + 'WIN ' + rec.losses + 'LOSE</b></div>' : '') +
  '</div>';
}

function matchEditCard(h) {
  return '<div class="match ' + h.result + '" data-id="' + h.id + '"><form class="m-edit">' +
    '<div class="two">' +
      '<label class="field"><span>リスナー名</span><input type="text" name="name" value="' + esc(h.name) + '" maxlength="40" required></label>' +
      '<label class="field"><span>相手のデッキ</span><input type="text" name="deck" value="' + esc(h.deck) + '" maxlength="40"></label>' +
    '</div>' +
    '<div class="two">' +
      '<label class="field"><span>自分のデッキ</span><input type="text" name="myDeck" value="' + esc(h.myDeck) + '" maxlength="40"></label>' +
      '<label class="field"><span>勝敗</span><select name="result">' +
        '<option value="win"' + (h.result === 'win' ? ' selected' : '') + '>WIN</option>' +
        '<option value="lose"' + (h.result === 'lose' ? ' selected' : '') + '>LOSE</option>' +
      '</select></label>' +
    '</div>' +
    '<label class="field"><span>試合の感想</span><textarea name="comment" maxlength="200">' + esc(h.comment) + '</textarea></label>' +
    '<div class="field"><span>スタンプ<em>（最大3つ）</em></span><div class="stamp-picker" id="edit-stamps"></div></div>' +
    '<div class="edit-acts">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-a="cancel-edit">キャンセル</button>' +
      '<button type="submit" class="btn btn-primary btn-sm">保存</button>' +
    '</div>' +
  '</form></div>';
}

function bindHistory() {
  Array.prototype.forEach.call($('history-area').querySelectorAll('.match'), function (card) {
    var id = card.dataset.id;

    Array.prototype.forEach.call(card.querySelectorAll('button[data-a]'), function (b) {
      b.addEventListener('click', function () {
        var action = b.dataset.a;
        if (action === 'edit') { ui.editId = id; ui.editStamps = null; renderHistory(); }
        else if (action === 'cancel-edit') { ui.editId = null; ui.editStamps = null; renderHistory(); }
        else if (action === 'del') {
          if (!window.confirm('この対戦記録を削除しますか？成績も再集計されます。')) return;
          api('DELETE', '/api/history/' + id);
        }
      });
    });

    var picker = card.querySelector('#edit-stamps');
    if (picker) {
      if (!ui.editStamps) {
        var target = state.history.filter(function (x) { return x.id === id; })[0];
        ui.editStamps = target && target.stamps ? target.stamps.slice() : [];
      }
      mountStampPicker(picker, ui.editStamps);
    }

    var form = card.querySelector('form.m-edit');
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.elements.name.value.trim();
      if (!name) { window.alert('リスナー名を入力してください。'); return; }
      var stamps = ui.editStamps || [];
      ui.editId = null;
      ui.editStamps = null;
      api('PUT', '/api/history/' + id, {
        name: name,
        deck: form.elements.deck.value.trim(),
        myDeck: form.elements.myDeck.value.trim(),
        result: form.elements.result.value,
        comment: form.elements.comment.value,
        stamps: stamps
      });
    });
  });
}

// --- ランキング ---
function rankRow(label, sub, rec, icon) {
  var pct = rec.total ? (rec.wins / rec.total) * 100 : 0;
  return '<div class="rank-row">' +
    (icon !== undefined ? avatar(icon, label, 'avatar-sm') : '') +
    '<span class="rank-name">' + esc(label) + (sub ? '<span class="rank-sub">' + esc(sub) + '</span>' : '') + '</span>' +
    '<span class="rank-rec"><span class="w">' + rec.wins + '</span>WIN <span class="l">' + rec.losses + '</span>LOSE</span>' +
    '<span class="rank-bar"><i style="width:' + pct.toFixed(1) + '%"></i></span>' +
    '<span class="rank-rate">' + rec.winRate + '%</span>' +
  '</div>';
}

function renderRankings() {
  var opponents = state.opponents || [];
  $('o-count').textContent = opponents.length;
  $('opponents-area').innerHTML = opponents.length
    ? '<div class="rank">' + opponents.slice(0, 50).map(function (o) {
        return rankRow(o.name, o.decks.join(' / '), o, o.icon || '');
      }).join('') + '</div>'
    : '<div class="empty">対戦を記録すると、リスナーごとの通算成績が出ます。</div>';

  var myDecks = state.myDecks || [];
  $('mydecks-area').innerHTML = myDecks.length
    ? '<div class="rank">' + myDecks.map(function (d) { return rankRow(d.deck, '', d); }).join('') + '</div>'
    : '<div class="empty">自分のデッキを記録すると、デッキごとの成績が出ます。</div>';
}

// ---------------------------------------------------------
// 画面固定の操作
// ---------------------------------------------------------

// タブ切り替え
Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
  tab.addEventListener('click', function () {
    ui.tab = tab.dataset.tab;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      var on = t.dataset.tab === ui.tab;
      t.classList.toggle('is-on', on);
      t.setAttribute('aria-selected', String(on));
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab-panel'), function (p) {
      p.hidden = p.dataset.panel !== ui.tab;
    });
  });
});

// あとから記録
Array.prototype.forEach.call(document.querySelectorAll('[data-q-result]'), function (b) {
  b.addEventListener('click', function () {
    ui.quickResult = b.dataset.qResult;
    Array.prototype.forEach.call(document.querySelectorAll('[data-q-result]'), function (x) {
      x.classList.toggle('on', x.dataset.qResult === ui.quickResult);
    });
  });
});

$('quick-form').addEventListener('submit', function (e) {
  e.preventDefault();
  var name = $('q-name').value.trim();
  if (!name) { window.alert('リスナー名を入力してください。'); return; }
  if (!ui.quickResult) { window.alert('「WIN」か「LOSE」を選んでください。'); return; }

  api('POST', '/api/history', Object.assign({
    name: name,
    deck: $('q-deck').value.trim(),
    myDeck: $('q-mydeck').value.trim(),
    result: ui.quickResult,
    comment: $('q-comment').value,
    stamps: ui.quickStamps
  }, pickedFor(name))).then(function () {
    ui.picked = null;
    renderOneComme();
    $('q-name').value = ''; $('q-deck').value = ''; $('q-comment').value = '';
    ui.quickResult = null;
    ui.quickStamps = [];
    mountStampPicker($('q-stamps'), ui.quickStamps);
    Array.prototype.forEach.call(document.querySelectorAll('[data-q-result]'), function (x) { x.classList.remove('on'); });
    $('q-name').focus();
  });
});

// 設定
['set-title', 'set-myname', 'set-mydeck', 'set-cutoff'].forEach(function (id) {
  $(id).addEventListener('input', function () { ui.settingsDirty = true; });
});

$('settings-form').addEventListener('submit', function (e) {
  e.preventDefault();
  ui.settingsDirty = false;
  api('PUT', '/api/settings', {
    streamTitle: $('set-title').value.trim(),
    myName: $('set-myname').value.trim(),
    myDeck: $('set-mydeck').value.trim(),
    dayCutoffHour: Number($('set-cutoff').value)
  });
});

// 募集ステータス（押した瞬間にOBSへ反映される）
Array.prototype.forEach.call(document.querySelectorAll('[data-recruit]'), function (b) {
  b.addEventListener('click', function () {
    if (state.settings && state.settings.recruit === b.dataset.recruit) return;
    api('PUT', '/api/settings', { recruit: b.dataset.recruit });
  });
});

// ルームID（反映を押した瞬間にOBSへ出る）
$('room-input').addEventListener('input', function () { ui.roomDirty = true; });

$('room-form').addEventListener('submit', function (e) {
  e.preventDefault();
  ui.roomDirty = false;
  api('PUT', '/api/settings', { roomId: $('room-input').value.trim() });
});

$('room-clear').addEventListener('click', function () {
  ui.roomDirty = false;
  $('room-input').value = '';
  api('PUT', '/api/settings', { roomId: '' });
});

// ワンコメ連携
$('oc-toggle').addEventListener('click', function () {
  ui.ocOpen = !ui.ocOpen;
  renderOneComme();
});

['oc-enabled', 'oc-url'].forEach(function (id) {
  $(id).addEventListener('input', function () { ui.ocDirty = true; });
  $(id).addEventListener('change', function () { ui.ocDirty = true; });
});

$('oc-save').addEventListener('click', function () {
  ui.ocDirty = false;
  api('PUT', '/api/settings', {
    onecomme: { enabled: $('oc-enabled').checked, url: $('oc-url').value.trim() }
  });
});

$('oc-clear').addEventListener('click', function () {
  api('POST', '/api/onecomme/clear');
});

// 絞り込み
$('f-text').addEventListener('input', function (e) { ui.filterText = e.target.value; renderHistory(); });
$('f-day').addEventListener('change', function (e) { ui.filterDay = e.target.value; renderHistory(); });
$('f-result').addEventListener('change', function (e) { ui.filterResult = e.target.value; renderHistory(); });

$('clear-today').addEventListener('click', function () {
  if (!window.confirm('本日の対戦履歴をすべて削除します。よろしいですか？（元に戻せません）')) return;
  api('POST', '/api/history/clear-today');
});

// 参加待ちリスト
$('q-list').addEventListener('click', function (e) {
  var row = e.target.closest('[data-qid]');
  if (!row) return;
  var entry = queueEntry(row.dataset.qid);
  if (!entry) return;

  if (e.target.closest('[data-qstart]')) {
    api('POST', '/api/queue/' + encodeURIComponent(entry.id) + '/start').then(function () {
      // 対戦中の記録ができるよう「対戦中に記録」のタブを開く
      var liveTab = document.querySelector('.tab[data-tab="live"]');
      if (liveTab) liveTab.click();
    });
  } else if (e.target.closest('[data-qunpick]')) {
    api('POST', '/api/queue/' + encodeURIComponent(entry.id) + '/unpick');
  } else if (e.target.closest('[data-qremove]')) {
    if (!window.confirm(entry.name + ' さんをリストから外しますか？')) return;
    api('DELETE', '/api/queue/' + encodeURIComponent(entry.id));
  } else if (e.target.closest('[data-qtake]')) {
    // わんコメの「取り込む」と同じく、名前とアイコンを入力欄に入れる
    ui.picked = { name: entry.name, icon: entry.icon, listenerId: entry.listenerId };
    if ($('st-name')) $('st-name').value = entry.name;
    if ($('q-name')) $('q-name').value = entry.name;
    renderOneComme();
  }
});

$('q-shuffle').addEventListener('click', function () {
  api('POST', '/api/queue/shuffle', { mode: 'fill' });
});

$('q-reshuffle').addEventListener('click', function () {
  var picked = (state.queue || []).filter(function (e) { return e.pick > 0; }).length;
  if (picked && !window.confirm('選ばれている人も含めて、全員の中から選び直しますか？')) return;
  api('POST', '/api/queue/shuffle', { mode: 'all' });
});

$('q-add').addEventListener('submit', function (e) {
  e.preventDefault();
  var name = $('q-add-name').value.trim();
  if (!name) return;
  api('POST', '/api/queue', { name: name }).then(function () { $('q-add-name').value = ''; });
});

$('q-clear').addEventListener('click', function () {
  if (!(state.queue || []).length) return;
  if (!window.confirm('参加待ちリストを空にします。よろしいですか？')) return;
  api('POST', '/api/queue/clear');
});

$('q-toggle').addEventListener('click', function () {
  ui.qOpen = !ui.qOpen;
  ui.qDirty = false;
  renderQueue();
});

['q-autojoin', 'q-joinwords', 'q-cancelwords', 'q-onlyopen', 'q-pickcount'].forEach(function (id) {
  $(id).addEventListener('input', function () { ui.qDirty = true; });
  $(id).addEventListener('change', function () { ui.qDirty = true; });
});

// 実況テロップの設定は、どれも「保存」を待たずにすぐ反映する
[['tk-results', 'results'], ['tk-queue', 'queue'], ['tk-head', 'head']].forEach(function (pair) {
  $(pair[0]).addEventListener('change', function (e) {
    var patch = {};
    patch[pair[1]] = e.target.checked;
    api('PUT', '/api/settings', { ticker: patch });
  });
});

var tickerSpeedTimer = null;
$('tk-speed').addEventListener('input', function (e) {
  $('tk-speed-label').textContent = speedLabel(e.target.value);
  clearTimeout(tickerSpeedTimer);
  tickerSpeedTimer = setTimeout(function () {
    api('PUT', '/api/settings', { ticker: { speed: Number(e.target.value) } });
  }, 250);
});

// 流れる速さは「保存」を待たずにすぐ反映する
var speedTimer = null;
$('q-speed').addEventListener('input', function (e) {
  $('q-speed-label').textContent = speedLabel(e.target.value);
  clearTimeout(speedTimer);
  speedTimer = setTimeout(function () {
    api('PUT', '/api/settings', { queue: { speed: Number(e.target.value) } });
  }, 250);
});

$('q-save').addEventListener('click', function () {
  var split = function (text) {
    return text.split(/[,、，]/).map(function (w) { return w.trim(); }).filter(Boolean);
  };
  var joinWords = split($('q-joinwords').value);
  var cancelWords = split($('q-cancelwords').value);
  if (!joinWords.length) { window.alert('参加の言葉を1つ以上入れてください。'); return; }
  if (!cancelWords.length) { window.alert('辞退の言葉を1つ以上入れてください。'); return; }
  api('PUT', '/api/settings', {
    queue: {
      autoJoin: $('q-autojoin').checked,
      joinWords: joinWords,
      cancelWords: cancelWords,
      onlyWhenOpen: $('q-onlyopen').checked,
      pickCount: Number($('q-pickcount').value)
    }
  }).then(function () { ui.qDirty = false; renderQueue(); });
});

// OBS表示のデザイン
$('ovd-themes').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-ovtheme]');
  if (!btn) return;
  saveOverlayDesign({ theme: btn.dataset.ovtheme });
});

['name', 'label'].forEach(function (part) {
  $('ovd-font-' + part).addEventListener('change', function (e) {
    var fonts = {};
    fonts[part] = e.target.value;
    saveOverlayDesign({ fonts: fonts });
  });
  $('ovd-size-' + part).addEventListener('input', function (e) {
    $('ovd-size-' + part + '-label').textContent = e.target.value;
    var sizes = {};
    sizes[part] = Number(e.target.value);
    saveOverlayDesign({ sizes: sizes }, 250);
  });
});

$('ovd-custom-use').addEventListener('click', function () {
  var name = $('ovd-custom').value.replace(/["'`\\;{}<>()]/g, '').trim();
  if (!name) { window.alert('フォント名を入れてください。'); return; }
  saveOverlayDesign({ fonts: { name: 'custom:' + name.slice(0, 40) } });
});

// 黒い画面を出さずに起動したときのための終了ボタン
$('btn-quit').addEventListener('click', function () {
  if (!window.confirm('アプリを終了します。よろしいですか？\n\n記録は保存されます。OBSの表示も止まります。')) return;
  quitting = true;
  var btn = $('btn-quit');
  btn.disabled = true;
  btn.textContent = '終了しています…';
  // 終了するとサーバーからの返事が途中で切れることがあるので、失敗しても終了扱いにする
  fetch('/api/quit', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    .catch(function () { /* 返事が来なくても終了は進んでいる */ })
    .then(function () { setTimeout(showQuitScreen, 400); });
});

function showQuitScreen() {
  var box = document.createElement('div');
  box.className = 'quit-screen';
  box.innerHTML =
    '<h2>アプリを終了しました</h2>' +
    '<p>記録は保存されています。このタブは閉じて大丈夫です。<br>' +
    'もう一度使うときは「起動」をダブルクリックしてください。</p>';
  document.body.appendChild(box);
}

// ---------------------------------------------------------
render();
connect();
