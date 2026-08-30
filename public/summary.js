'use strict';

/* =========================================================
   まとめ画像
   - 対戦履歴から、そのままSNSに貼れる1枚の画像をCanvasで描く。
   - 画面に見えているものが、そのまま保存されるPNGになる。
   ========================================================= */

var state = { settings: {}, history: [], stats: {}, totalStats: {}, opponents: [] };

var FONT = '"Yu Gothic UI", "Hiragino Sans", "Meiryo", "Noto Sans JP", sans-serif';
var WIDTH = 1200;   // 画像の横幅（px）
var SCALE = 2;      // 高解像度で描いて縮小表示する

var THEMES = {
  dark: {
    bg1: '#12141f', bg2: '#1d1636',
    card: 'rgba(255,255,255,0.045)', cardLine: 'rgba(255,255,255,0.09)',
    text: '#f2f5fb', muted: '#9aa5c0', dim: '#727d9b',
    win: '#3fdc92', lose: '#ff6d79', accent: '#63b8ff',
    chip: 'rgba(255,255,255,0.08)', line: 'rgba(255,255,255,0.13)',
    winBg: 'rgba(63,220,146,0.18)', loseBg: 'rgba(255,109,121,0.18)',
    comment: '#dbe2f2'
  },
  light: {
    bg1: '#f4f7fc', bg2: '#e3e9f6',
    card: '#ffffff', cardLine: '#d5dceb',
    text: '#161a24', muted: '#5a6480', dim: '#8d96ab',
    win: '#0f9d58', lose: '#d93843', accent: '#1f7ae0',
    chip: '#eef1f7', line: '#dfe4ee',
    winBg: 'rgba(15,157,88,0.13)', loseBg: 'rgba(217,56,67,0.13)',
    comment: '#333a4a'
  }
};

var opts = {
  day: 'today', theme: 'dark', cols: 'auto',
  comment: true, myDeck: true, h2h: false, stamps: true, icons: true, title: '', note: ''
};

function $(id) { return document.getElementById(id); }

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

// ---------------------------------------------------------
// 通信
// ---------------------------------------------------------
function connect() {
  var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var socket = new WebSocket(protocol + '//' + location.host + '/ws');
  var delay = 500;

  socket.addEventListener('open', function () {
    $('conn').textContent = '● 同期中';
    $('conn').className = 'conn conn-on';
  });
  socket.addEventListener('message', function (event) {
    var message;
    try { message = JSON.parse(event.data); } catch (e) { return; }
    if (message.type === 'state') { state = message.payload; refresh(); }
  });
  socket.addEventListener('close', function () {
    $('conn').textContent = '× 未接続（再接続します）';
    $('conn').className = 'conn conn-off';
    setTimeout(connect, delay);
    delay = Math.min(delay * 2, 5000);
  });
  socket.addEventListener('error', function () { socket.close(); });
}

// ---------------------------------------------------------
// 対象データの組み立て
// ---------------------------------------------------------
function availableDays() {
  var days = [];
  state.history.forEach(function (h) { if (days.indexOf(h.date) === -1) days.push(h.date); });
  days.sort().reverse();
  return days;
}

/** 1枚の画像に載せる最大の試合数。これを超えると画像が縦に長くなりすぎて読めない */
var MAX_ROWS = 40;

function targetRecords() {
  var records;
  if (opts.day === 'all') records = state.history.slice();
  else records = state.history.filter(function (h) { return h.date === opts.day; });
  // 古い順（1戦目が上）に並べる
  return records.sort(function (a, b) {
    return String(a.date).localeCompare(String(b.date)) ||
      (a.matchNumber - b.matchNumber) ||
      String(a.finishedAt).localeCompare(String(b.finishedAt));
  });
}

function h2hOf(name) {
  var key = normName(name), wins = 0, losses = 0;
  state.history.forEach(function (h) {
    if (normName(h.name) !== key) return;
    if (h.result === 'win') wins++; else losses++;
  });
  return { wins: wins, losses: losses, total: wins + losses };
}

// ---------------------------------------------------------
// 描画ヘルパー
// ---------------------------------------------------------
function setFont(ctx, size, weight) {
  ctx.font = (weight || '') + ' ' + size + 'px ' + FONT;
}

/** 収まらない文字列を「…」で切り詰める */
function fit(ctx, text, maxWidth) {
  text = String(text == null ? '' : text);
  if (ctx.measureText(text).width <= maxWidth) return text;
  var lo = 0, hi = text.length;
  while (lo < hi) {
    var mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

/** 角丸の塗り（枠線は任意） */
function panel(ctx, x, y, w, h, r, fill, stroke) {
  roundRect(ctx, x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}


// ---------------------------------------------------------
// スタンプ画像の読み込み
// 画像は読み込みが終わってから描けるので、読めたらもう一度描き直す
// ---------------------------------------------------------
var imageCache = {};

function stampImage(url) {
  if (imageCache[url] !== undefined) return imageCache[url];
  imageCache[url] = null; // 読み込み中
  var img = new Image();
  img.onload = function () { imageCache[url] = img; draw(); };
  img.onerror = function () { imageCache[url] = false; }; // 消えた画像は諦める
  img.src = url;
  return null;
}

/** 丸く切り抜いて画像を描く */
function drawCircleImage(ctx, img, x, y, size) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, x, y, size, size);
  ctx.restore();
}

function findStamp(id) {
  var list = state.stamps || [];
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  if (String(id).indexOf('emoji:') === 0) return { id: id, type: 'emoji', char: String(id).slice(6) };
  return null;
}

/** 1試合ぶんのスタンプを右端から順に描く。描いた幅を返す */
function drawStamps(ctx, ids, rightX, centerY, size) {
  if (!ids || !ids.length) return 0;
  var gap = 6;
  var x = rightX;
  var drawn = 0;

  for (var i = ids.length - 1; i >= 0; i--) {
    var stamp = findStamp(ids[i]);
    if (!stamp) continue;

    x -= size;
    if (stamp.type === 'emoji') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      setFont(ctx, size, '');
      ctx.fillText(stamp.char, x + size / 2, centerY);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    } else {
      var img = stampImage(stamp.url);
      if (img) ctx.drawImage(img, x, centerY - size / 2, size, size);
    }
    x -= gap;
    drawn += size + gap;
  }
  return drawn;
}

// ---------------------------------------------------------
// 画像を描く
// ---------------------------------------------------------
function draw() {
  var canvas = $('cv');
  var ctx = canvas.getContext('2d');
  var t = THEMES[opts.theme] || THEMES.dark;
  var allRecords = targetRecords();
  var records = allRecords.slice(0, MAX_ROWS);
  var overflow = allRecords.length - records.length;

  // 自分のデッキが最初から最後まで同じなら、各行に繰り返さず見出しにまとめる
  var myDeckSet = [];
  records.forEach(function (r) {
    if (r.myDeck && myDeckSet.indexOf(r.myDeck) === -1) myDeckSet.push(r.myDeck);
  });
  var headerMyDeck = myDeckSet.length === 1 ? myDeckSet[0] : (myDeckSet.length ? '' : state.settings.myDeck);
  var perRowMyDeck = opts.myDeck && myDeckSet.length > 1;

  var wins = allRecords.filter(function (r) { return r.result === 'win'; }).length;
  var losses = allRecords.length - wins;
  var total = allRecords.length;
  var rate = total ? Math.round((wins / total) * 1000) / 10 : 0;

  // --- 行の高さを決める ---
  var twoCol = opts.cols === '2' || (opts.cols === 'auto' && records.length > 12);
  var pad = 46;
  var gap = twoCol ? 22 : 0;
  var colW = twoCol ? (WIDTH - pad * 2 - gap) / 2 : WIDTH - pad * 2;

  var sz = twoCol
    ? { name: 24, deck: 18, comment: 18, badge: 17, no: 16, rowPad: 12, lineGap: 24 }
    : { name: 28, deck: 21, comment: 20, badge: 19, no: 17, rowPad: 14, lineGap: 28 };

  // 各行の高さ（内容によって変わる）
  var rows = records.map(function (r) {
    var lines = 2; // 1行目：名前 / 2行目：デッキ
    var comment = opts.comment && r.comment ? r.comment : '';
    if (comment) lines++;
    var h2hText = '';
    if (opts.h2h) {
      var rec = h2hOf(r.name);
      if (rec.total > 1) { h2hText = '通算 ' + rec.total + '戦 ' + rec.wins + 'W ' + rec.losses + 'L'; lines++; }
    }
    return { r: r, comment: comment, h2hText: h2hText, h: sz.rowPad * 2 + lines * sz.lineGap };
  });

  var colHeights = [0, 0];
  if (twoCol) {
    var half = Math.ceil(rows.length / 2);
    rows.forEach(function (row, i) {
      row.col = i < half ? 0 : 1;
      colHeights[row.col] += row.h + 10;
    });
  } else {
    rows.forEach(function (row) { row.col = 0; colHeights[0] += row.h + 10; });
  }

  var headerH = 178;
  var noteH = opts.note ? 56 : 0;
  var overflowH = overflow > 0 ? 40 : 0;
  var listH = Math.max(colHeights[0], colHeights[1]);
  var height = headerH + (total ? listH + 18 : 120) + overflowH + noteH + pad;

  // --- キャンバス準備 ---
  canvas.width = WIDTH * SCALE;
  canvas.height = Math.round(height) * SCALE;
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.textBaseline = 'alphabetic';
  $('size-label').textContent = WIDTH + ' × ' + Math.round(height) + ' px';

  // --- 背景 ---
  var bg = ctx.createLinearGradient(0, 0, WIDTH, height);
  bg.addColorStop(0, t.bg1);
  bg.addColorStop(1, t.bg2);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, height);

  // 上端のアクセントライン
  var accentBar = ctx.createLinearGradient(0, 0, WIDTH, 0);
  accentBar.addColorStop(0, '#45b6ff');
  accentBar.addColorStop(1, '#a45cff');
  ctx.fillStyle = accentBar;
  ctx.fillRect(0, 0, WIDTH, 6);

  // --- ヘッダー ---
  var title = (opts.title || state.settings.streamTitle || '視聴者参加型対戦').trim();
  ctx.textAlign = 'left';
  setFont(ctx, 40, 'bold');
  ctx.fillStyle = t.text;
  ctx.fillText(fit(ctx, title, WIDTH - pad * 2 - 430), pad, 84);

  setFont(ctx, 22, '');
  ctx.fillStyle = t.muted;
  var dateLabel = opts.day === 'all' ? '通算成績' : jpDate(opts.day);
  var who = state.settings.myName ? '　/　' + state.settings.myName : '';
  ctx.fillText(fit(ctx, dateLabel + who, WIDTH - pad * 2 - 430), pad, 118);

  if (opts.myDeck && headerMyDeck) {
    setFont(ctx, 19, '');
    ctx.fillStyle = t.dim;
    ctx.fillText(fit(ctx, '自分の使用デッキ：' + headerMyDeck, WIDTH - pad * 2 - 430), pad, 147);
  } else if (opts.myDeck && myDeckSet.length > 1) {
    setFont(ctx, 19, '');
    ctx.fillStyle = t.dim;
    ctx.fillText(fit(ctx, '自分の使用デッキ：' + myDeckSet.length + '種類', WIDTH - pad * 2 - 430), pad, 147);
  }

  // --- 成績（右上） ---
  var boxW = 380, boxH = 104, boxX = WIDTH - pad - boxW, boxY = 44;
  panel(ctx, boxX, boxY, boxW, boxH, 14, t.card, t.cardLine);

  ctx.textAlign = 'center';
  var cellW = boxW / 3;

  setFont(ctx, 44, 'bold');
  ctx.fillStyle = t.win;
  ctx.fillText(String(wins), boxX + cellW * 0.5, boxY + 62);
  ctx.fillStyle = t.lose;
  ctx.fillText(String(losses), boxX + cellW * 1.5, boxY + 62);
  ctx.fillStyle = t.accent;
  setFont(ctx, 34, 'bold');
  ctx.fillText(rate + '%', boxX + cellW * 2.5, boxY + 60);

  setFont(ctx, 15, '');
  ctx.fillStyle = t.dim;
  ctx.fillText('WIN', boxX + cellW * 0.5, boxY + 86);
  ctx.fillText('LOSE', boxX + cellW * 1.5, boxY + 86);
  ctx.fillText('勝率（全' + total + '戦）', boxX + cellW * 2.5, boxY + 86);

  // --- 区切り線 ---
  ctx.strokeStyle = t.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, headerH - 16);
  ctx.lineTo(WIDTH - pad, headerH - 16);
  ctx.stroke();

  // --- 対戦一覧 ---
  ctx.textAlign = 'left';
  if (!total) {
    setFont(ctx, 24, '');
    ctx.fillStyle = t.dim;
    ctx.textAlign = 'center';
    ctx.fillText('この日の対戦記録はまだありません', WIDTH / 2, headerH + 60);
  } else {
    var cursorY = [headerH + 8, headerH + 8];

    rows.forEach(function (row) {
      var r = row.r;
      var col = row.col;
      var x = pad + col * (colW + gap);
      var y = cursorY[col];
      var isWin = r.result === 'win';

      // 行の下地
      panel(ctx, x, y, colW, row.h, 11, t.card, t.cardLine);
      // 左端の勝敗ライン
      ctx.fillStyle = isWin ? t.win : t.lose;
      roundRect(ctx, x, y, 5, row.h, 3);
      ctx.fill();

      var innerX = x + 18;
      var innerW = colW - 36;
      var lineY = y + sz.rowPad + sz.lineGap - 8;

      // 1行目：番号 / 勝敗 / 名前
      setFont(ctx, sz.no, 'bold');
      ctx.fillStyle = t.dim;
      var noText = r.matchNumber ? String(r.matchNumber) : '-';
      var noW = ctx.measureText(noText).width;
      ctx.fillText(noText, innerX, lineY);

      var badgeX = innerX + noW + 12;
      var badgeW = sz.badge * 3.4;
      var badgeH = sz.badge + 12;
      panel(ctx, badgeX, lineY - sz.badge - 2, badgeW, badgeH, 6, isWin ? t.winBg : t.loseBg, null);
      setFont(ctx, sz.badge, 'bold');
      ctx.fillStyle = isWin ? t.win : t.lose;
      ctx.textAlign = 'center';
      ctx.fillText(isWin ? 'WIN' : 'LOSE', badgeX + badgeW / 2, lineY + 1);
      ctx.textAlign = 'left';

      // スタンプは行の右端に置く。名前はその手前までに収める
      var stampSize = Math.round(sz.name * 1.05);
      var stampW = opts.stamps ? drawStamps(ctx, r.stamps, innerX + innerW, lineY - sz.name * 0.32, stampSize) : 0;

      var nameX = badgeX + badgeW + 14;

      // リスナーのアイコン（わんコメから取り込んだ場合）
      if (opts.icons && r.icon) {
        var iconSize = Math.round(sz.name * 1.15);
        var iconImg = stampImage(r.icon);
        if (iconImg) {
          drawCircleImage(ctx, iconImg, nameX, lineY - iconSize * 0.78, iconSize);
        }
        nameX += iconSize + 10;
      }

      setFont(ctx, sz.name, 'bold');
      ctx.fillStyle = t.text;
      ctx.fillText(fit(ctx, r.name, innerX + innerW - nameX - stampW - (stampW ? 12 : 0)), nameX, lineY + 2);

      // 2行目：デッキ
      lineY += sz.lineGap;
      var deckX = innerX;
      setFont(ctx, sz.deck, 'bold');
      ctx.fillStyle = t.accent;
      var deckText = r.deck || 'デッキ未入力';
      var maxDeckW = innerW * (perRowMyDeck && r.myDeck ? 0.5 : 1) - 10;
      var shown = fit(ctx, deckText, maxDeckW);
      ctx.fillText(shown, deckX, lineY);

      if (perRowMyDeck && r.myDeck) {
        var usedW = ctx.measureText(shown).width;
        setFont(ctx, sz.deck - 2, '');
        ctx.fillStyle = t.dim;
        var vs = '  vs  自分：';
        ctx.fillText(vs, deckX + usedW, lineY);
        var vsW = ctx.measureText(vs).width;
        ctx.fillStyle = t.muted;
        ctx.fillText(fit(ctx, r.myDeck, innerW - usedW - vsW), deckX + usedW + vsW, lineY);
      }

      // 3行目：感想
      if (row.comment) {
        lineY += sz.lineGap;
        setFont(ctx, sz.comment, '');
        ctx.fillStyle = t.comment;
        ctx.fillText(fit(ctx, '「' + row.comment + '」', innerW), innerX, lineY);
      }

      // 4行目：そのリスナーとの通算
      if (row.h2hText) {
        lineY += sz.lineGap;
        setFont(ctx, sz.comment - 2, '');
        ctx.fillStyle = t.dim;
        ctx.fillText(fit(ctx, row.h2hText, innerW), innerX, lineY);
      }

      cursorY[col] += row.h + 10;
    });
  }

  // --- 入りきらなかった試合 ---
  if (overflow > 0) {
    setFont(ctx, 19, '');
    ctx.fillStyle = t.dim;
    ctx.textAlign = 'center';
    ctx.fillText('…ほか ' + overflow + '戦（成績は全' + total + '戦ぶんを集計しています）',
      WIDTH / 2, headerH + Math.max(colHeights[0], colHeights[1]) + 30);
    ctx.textAlign = 'left';
  }

  // --- ひとこと ---
  if (opts.note) {
    setFont(ctx, 22, '');
    ctx.fillStyle = t.muted;
    ctx.textAlign = 'center';
    ctx.fillText(fit(ctx, opts.note, WIDTH - pad * 2), WIDTH / 2, height - pad + 10);
    ctx.textAlign = 'left';
  }
}

// ---------------------------------------------------------
// 画面の操作
// ---------------------------------------------------------
function refreshDayOptions() {
  var select = $('o-day');
  var days = availableDays();
  var today = state.stats ? state.stats.date : '';
  if (today && days.indexOf(today) === -1) days.unshift(today);

  var html = days.map(function (d) {
    return '<option value="' + d + '">' + jpDate(d) + (d === today ? '（本日）' : '') + '</option>';
  }).join('');
  html += '<option value="all">すべての日（通算）</option>';
  select.innerHTML = html;

  // 以前の選択を保つ。初回は本日
  if (opts.day === 'today') opts.day = today || days[0] || 'all';
  var exists = Array.prototype.some.call(select.options, function (o) { return o.value === opts.day; });
  if (!exists) opts.day = days[0] || 'all';
  select.value = opts.day;
}

function refresh() {
  refreshDayOptions();
  if (!$('o-title').value && state.settings.streamTitle) $('o-title').placeholder = state.settings.streamTitle;
  draw();
}

/**
 * 保存するファイル名。
 * ブラウザによっては日本語のファイル名が無視されて "download.png" になるため、
 * 半角英数字と日付だけで組み立てる。
 */
function fileName() {
  var base = opts.day === 'all' ? 'total' : opts.day;
  return 'dmps-record-' + base + '.png';
}

function say(text) { $('msg').textContent = text; }

$('o-day').addEventListener('change', function (e) { opts.day = e.target.value; draw(); });
$('o-theme').addEventListener('change', function (e) { opts.theme = e.target.value; draw(); });
$('o-cols').addEventListener('change', function (e) { opts.cols = e.target.value; draw(); });
$('o-comment').addEventListener('change', function (e) { opts.comment = e.target.checked; draw(); });
$('o-mydeck').addEventListener('change', function (e) { opts.myDeck = e.target.checked; draw(); });
$('o-h2h').addEventListener('change', function (e) { opts.h2h = e.target.checked; draw(); });
$('o-stamps').addEventListener('change', function (e) { opts.stamps = e.target.checked; draw(); });
$('o-icons').addEventListener('change', function (e) { opts.icons = e.target.checked; draw(); });
$('o-title').addEventListener('input', function (e) { opts.title = e.target.value; draw(); });
$('o-note').addEventListener('input', function (e) { opts.note = e.target.value; draw(); });

$('download').addEventListener('click', function () {
  var name = fileName();
  $('cv').toBlob(function (blob) {
    if (!blob) { say('画像を作れませんでした。もう一度お試しください。'); return; }
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // すぐ消すとダウンロードが始まらないブラウザがあるので少し待つ
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    say('保存しました：' + name);
  }, 'image/png');
});

$('copy').addEventListener('click', function () {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    say('このブラウザではコピーできません。「PNG画像として保存」を使ってください。');
    return;
  }
  $('cv').toBlob(function (blob) {
    if (!blob) { say('コピーに失敗しました。「PNG画像として保存」を使ってください。'); return; }
    navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(function () {
      say('コピーしました。X（Twitter）の投稿欄で Ctrl + V を押すと貼れます。');
    }).catch(function () {
      say('コピーできませんでした。「PNG画像として保存」を使ってください。');
    });
  }, 'image/png');
});

// フォントが読み込まれてから描き直す（文字幅がずれないように）
if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);

fetch('/api/state').then(function (r) { return r.json(); }).then(function (data) {
  if (data && data.ok) { state = data.state; refresh(); }
}).catch(function () { /* WebSocket接続時に届く */ });

draw();
connect();
