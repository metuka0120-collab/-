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
  myDecks: []
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
  settingsDirty: false
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
  }
  render();
}

// ---------------------------------------------------------
// 描画
// ---------------------------------------------------------
function render() {
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
      api('POST', '/api/match/start', { name: name, deck: $('st-deck').value.trim() });
    });
    return;
  }

  var rec = h2h(c.name);
  box.innerHTML =
    '<div class="cur-box">' +
      '<div class="cur-no">本日 ' + c.matchNumber + ' 戦目 ／ 開始 ' + hhmm(c.startedAt) + '</div>' +
      '<div class="cur-name">' + esc(c.name) + '</div>' +
      '<div class="cur-deck">' + (c.deck ? esc(c.deck) : 'デッキ未入力') +
        (c.myDeck ? ' <span class="vs">VS</span> 自分: ' + esc(c.myDeck) : '') + '</div>' +
      (rec.total ? '<div class="cur-h2h">このリスナーとは通算 ' + rec.total + '戦 ' + rec.wins + '勝' + rec.losses + '敗</div>' : '') +
    '</div>' +
    '<div class="form" style="margin-top:12px">' +
      '<div class="results">' +
        '<button type="button" class="btn btn-win ' + (ui.result === 'win' ? 'on' : '') + '" data-result="win">勝ち</button>' +
        '<button type="button" class="btn btn-lose ' + (ui.result === 'lose' ? 'on' : '') + '" data-result="lose">負け</button>' +
      '</div>' +
      '<label class="field"><span>試合の感想</span>' +
      '<textarea id="cmt" maxlength="200" placeholder="例）最後のシールドトリガーが決まった">' + esc(ui.comment) + '</textarea></label>' +
      '<div class="cur-actions">' +
        '<button type="button" class="btn btn-primary" id="fin">対戦終了して保存</button>' +
        '<button type="button" class="btn btn-ghost" id="cancel">取り消す</button>' +
      '</div>' +
    '</div>';

  Array.prototype.forEach.call(box.querySelectorAll('[data-result]'), function (b) {
    b.addEventListener('click', function () { ui.result = b.dataset.result; renderCurrent(); });
  });
  $('cmt').addEventListener('input', function (e) { ui.comment = e.target.value; });
  $('fin').addEventListener('click', function () {
    if (!ui.result) { window.alert('「勝ち」か「負け」を選んでください。'); return; }
    api('POST', '/api/match/finish', { result: ui.result, comment: ui.comment });
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
  $('t-line').textContent = (t.total || 0) + '戦 ' + (t.wins || 0) + '勝' + (t.losses || 0) + '敗　勝率 ' + (t.winRate || 0) + '%';
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

function renderHistory() {
  var rows = filtered();
  var area = $('history-area');
  $('h-count').textContent = rows.length;

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
      '<span class="day-rec">' + list.length + '戦 ' + wins + '勝' + losses + '敗</span></div>' +
      list.map(matchCard).join('');
  }).join('');

  bindHistory();
}

function matchCard(h) {
  if (h.id === ui.editId) return matchEditCard(h);

  var rec = h2h(h.name);
  return '<div class="match ' + h.result + '" data-id="' + h.id + '">' +
    '<div class="m-top">' +
      '<span class="m-no">' + (h.matchNumber || '-') + '戦目</span>' +
      '<span class="m-badge ' + h.result + '">' + (h.result === 'win' ? '勝ち' : '負け') + '</span>' +
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
    (h.comment ? '<div class="m-comment">' + esc(h.comment) + '</div>' : '') +
    (rec.total > 1 ? '<div class="m-h2h">このリスナーとは通算 <b>' + rec.total + '戦 ' + rec.wins + '勝' + rec.losses + '敗</b></div>' : '') +
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
        '<option value="win"' + (h.result === 'win' ? ' selected' : '') + '>勝ち</option>' +
        '<option value="lose"' + (h.result === 'lose' ? ' selected' : '') + '>負け</option>' +
      '</select></label>' +
    '</div>' +
    '<label class="field"><span>試合の感想</span><textarea name="comment" maxlength="200">' + esc(h.comment) + '</textarea></label>' +
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
        if (action === 'edit') { ui.editId = id; renderHistory(); }
        else if (action === 'cancel-edit') { ui.editId = null; renderHistory(); }
        else if (action === 'del') {
          if (!window.confirm('この対戦記録を削除しますか？成績も再集計されます。')) return;
          api('DELETE', '/api/history/' + id);
        }
      });
    });

    var form = card.querySelector('form.m-edit');
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.elements.name.value.trim();
      if (!name) { window.alert('リスナー名を入力してください。'); return; }
      ui.editId = null;
      api('PUT', '/api/history/' + id, {
        name: name,
        deck: form.elements.deck.value.trim(),
        myDeck: form.elements.myDeck.value.trim(),
        result: form.elements.result.value,
        comment: form.elements.comment.value
      });
    });
  });
}

// --- ランキング ---
function rankRow(label, sub, rec) {
  var pct = rec.total ? (rec.wins / rec.total) * 100 : 0;
  return '<div class="rank-row">' +
    '<span class="rank-name">' + esc(label) + (sub ? '<span class="rank-sub">' + esc(sub) + '</span>' : '') + '</span>' +
    '<span class="rank-rec"><span class="w">' + rec.wins + '</span>勝 <span class="l">' + rec.losses + '</span>敗</span>' +
    '<span class="rank-bar"><i style="width:' + pct.toFixed(1) + '%"></i></span>' +
    '<span class="rank-rate">' + rec.winRate + '%</span>' +
  '</div>';
}

function renderRankings() {
  var opponents = state.opponents || [];
  $('o-count').textContent = opponents.length;
  $('opponents-area').innerHTML = opponents.length
    ? '<div class="rank">' + opponents.slice(0, 50).map(function (o) {
        return rankRow(o.name, o.decks.join(' / '), o);
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
  if (!ui.quickResult) { window.alert('「勝ち」か「負け」を選んでください。'); return; }

  api('POST', '/api/history', {
    name: name,
    deck: $('q-deck').value.trim(),
    myDeck: $('q-mydeck').value.trim(),
    result: ui.quickResult,
    comment: $('q-comment').value
  }).then(function () {
    $('q-name').value = ''; $('q-deck').value = ''; $('q-comment').value = '';
    ui.quickResult = null;
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
