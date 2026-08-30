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
  ocDirty: false    // わんコメの設定を入力中か
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
        ? 'つながっています。わんコメにコメントが来ると、下に出ます。'
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
    box.innerHTML = '<div class="empty">連携をONにすると、コメントした人がここに出ます。<br>名前とアイコンをそのまま取り込めます。</div>';
    return;
  }
  if (!list.length) {
    box.innerHTML = '<div class="empty">' +
      (oc.connected ? 'コメントを待っています…' : 'わんコメに接続できていません。') + '</div>';
    return;
  }

  box.innerHTML = '<div class="oc-list">' + list.map(function (person, i) {
    return '<button type="button" class="oc-row" data-i="' + i + '">' +
      avatar(person.profileImage, person.name) +
      '<span class="oc-name">' + esc(person.name) +
        (person.comment ? '<span class="oc-comment">' + esc(person.comment) + '</span>' : '') +
      '</span>' +
      '<span class="oc-take">取り込む</span>' +
    '</button>';
  }).join('') + '</div>';

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
  mountStampPicker($('q-stamps'), ui.quickStamps);
  renderOneComme();
  renderCurrent();
  renderStats();
  renderSettings();
  renderHistory();
  renderRankings();
  renderDatalists();
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
      (rec.total ? '<div class="cur-h2h">このリスナーとは通算 ' + rec.total + '戦 ' + rec.wins + 'W ' + rec.losses + 'L</div>' : '') +
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
  $('s-date').textContent = '集計日：' + jpDate(s.date) + '（日付が変わると自動で 0 に戻ります）';
  $('t-line').textContent = (t.total || 0) + '戦 ' + (t.wins || 0) + 'W ' + (t.losses || 0) + 'L　勝率 ' + (t.winRate || 0) + '%';
  $('t-days').textContent = t.days ? '（' + t.days + '日ぶん）' : '';
}

// --- 設定 ---
function renderSettings() {
  if (ui.settingsDirty) return; // 入力中は上書きしない
  var s = state.settings || {};
  $('set-title').value = s.streamTitle || '';
  $('set-myname').value = s.myName || '';
  $('set-mydeck').value = s.myDeck || '';
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
      '<span class="day-rec">' + list.length + '戦 ' + wins + 'W ' + losses + 'L</span></div>' +
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
    (rec.total > 1 ? '<div class="m-h2h">このリスナーとは通算 <b>' + rec.total + '戦 ' + rec.wins + 'W ' + rec.losses + 'L</b></div>' : '') +
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
    '<span class="rank-rec"><span class="w">' + rec.wins + '</span>W <span class="l">' + rec.losses + '</span>L</span>' +
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
['set-title', 'set-myname', 'set-mydeck'].forEach(function (id) {
  $(id).addEventListener('input', function () { ui.settingsDirty = true; });
});

$('settings-form').addEventListener('submit', function (e) {
  e.preventDefault();
  ui.settingsDirty = false;
  api('PUT', '/api/settings', {
    streamTitle: $('set-title').value.trim(),
    myName: $('set-myname').value.trim(),
    myDeck: $('set-mydeck').value.trim()
  });
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

// ---------------------------------------------------------
render();
connect();
