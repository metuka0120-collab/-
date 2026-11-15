'use strict';

/* =========================================================
   まとめ画像
   - 対戦履歴から、そのままSNSに貼れる1枚の画像をCanvasで描く。
   - 画面に見えているものが、そのまま保存されるPNGになる。
   - 見た目（テーマ）は summary-themes.js、フォントの一覧は /font-list.js。
   ========================================================= */

var state = { settings: {}, history: [], stats: {}, totalStats: {}, opponents: [] };

/** 選べるアクセント色（クラシックのテーマで使う） */
var ACCENTS = {
  blue:   { bar: ['#45b6ff', '#a45cff'], dark: '#63b8ff', light: '#1f7ae0' },
  red:    { bar: ['#ff8a5c', '#ff4d6d'], dark: '#ff9270', light: '#d9483f' },
  green:  { bar: ['#4fe39b', '#21c7a8'], dark: '#5fe0b0', light: '#0f9d70' },
  pink:   { bar: ['#ff8fd0', '#b06cff'], dark: '#ff9ed6', light: '#d1479b' },
  orange: { bar: ['#ffc061', '#ff7a3d'], dark: '#ffc772', light: '#d97a1f' },
  mono:   { bar: ['#cfd6e6', '#8b93a8'], dark: '#c3cadb', light: '#5a6480' }
};

/** 文字の部位。フォントと大きさを、それぞれ別に変えられる */
var PARTS = [
  { id: 'title',   label: 'タイトル' },
  { id: 'stats',   label: '数字・WIN/LOSE' },
  { id: 'name',    label: 'リスナー名' },
  { id: 'deck',    label: 'デッキ名' },
  { id: 'comment', label: '感想・日付' },
  { id: 'note',    label: 'ひとこと' }
];

/** 部位ごとの太さ（フォントに太字が無いときも、にせの太字にならないよう登録してある） */
var PART_WEIGHT = { title: '700', stats: '700', name: '700', deck: '700', comment: '400', note: '400' };

// 絵文字のスタンプを描くときのフォント
var EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Yu Gothic UI", sans-serif';
var FALLBACK_FONT = '"Yu Gothic UI", "Yu Gothic", "Meiryo", "Hiragino Sans", sans-serif';

var WIDTH = 1200;   // 画像の横幅（px）
var SCALE = 2;      // 高解像度で描いて縮小表示する

var opts = {
  day: 'today', cols: 'auto',
  deck: true, comment: true, myName: false, myDeck: false, h2h: false, stamps: true, icons: true,
  title: '', note: null
};

function $(id) { return document.getElementById(id); }

/** HTMLに文字を差し込むときの用心（ファイル名に記号が入っていても壊れないように） */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
    if (message.type === 'state') {
      state = message.payload;
      // まだ送っていない変更は、届いた状態の上に重ねておく
      if (state.settings && state.settings.summary) Object.assign(state.settings.summary, pendingStyle);
      refresh();
    }
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
// テーマとフォント
// ---------------------------------------------------------
function currentStyle() {
  return (state.settings && state.settings.summary) || {};
}

function currentThemeId() {
  var id = currentStyle().theme;
  return SUMMARY_THEMES[id] ? id : 'pop';
}

function fontInfo(id) {
  var list = window.FONT_LIST || [];
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

/** フォントの指定を、Canvas で使える書き方に直す */
function fontStack(value) {
  value = String(value || '');
  if (value.indexOf('custom:') === 0) return '"' + value.slice(7).replace(/"/g, '') + '", ' + FALLBACK_FONT;
  var info = fontInfo(value);
  return info ? info.stack : FALLBACK_FONT;
}

/** 部位ごとに、実際に使うフォント（自分で選んだもの → テーマのおすすめ の順） */
function partFont(part, theme) {
  var chosen = (currentStyle().fonts || {})[part];
  return chosen || theme.fonts[part] || 'gothic';
}

/** 部位ごとの大きさ（%） */
function partScale(part) {
  var v = Number((currentStyle().sizes || {})[part]);
  return v >= 50 && v <= 250 ? v / 100 : 1;
}

var STACKS = {};   // 描いている最中の、部位ごとのフォント

function setFont(ctx, size, part) {
  ctx.font = (PART_WEIGHT[part] || '400') + ' ' + Math.round(size * 2) / 2 + 'px ' + (STACKS[part] || FALLBACK_FONT);
}

// ---------------------------------------------------------
// フォントの読み込み
//   同梱フォントは、使う文字のぶんだけ後から読み込まれる。
//   まだ読めていない文字を描いたら読み込みを頼み、読めたら描き直す。
// ---------------------------------------------------------
var fontRequests = {};
var redrawTimer = null;

function scheduleDraw() {
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(draw, 40);
}

function needGlyphs(ctx, text) {
  if (!document.fonts || !text) return;
  var font = ctx.font;
  try { if (document.fonts.check(font, text)) return; } catch (e) { return; }
  var key = font + '|' + text;
  if (fontRequests[key]) return;
  fontRequests[key] = true;
  document.fonts.load(font, text).then(scheduleDraw, function () { /* 読めなければ代わりの文字のまま */ });
}

/** 文字を描く（必要なら同梱フォントの読み込みも頼む） */
function ft(ctx, text, x, y) {
  text = String(text == null ? '' : text);
  needGlyphs(ctx, text);
  ctx.fillText(text, x, y);
}

// ---------------------------------------------------------
// 文字のはみ出し対策
// ---------------------------------------------------------
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

/**
 * 長い文章を折り返す。「…」で切らずに、複数行に分けて返す。
 * 日本語はどこでも折り返せるが、行頭に来てほしくない記号は前の行に残す。
 */
var NO_LINE_START = '、。，．・：；？！ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮー」』）］｝〉》】〕”’!?,.:;)]}';

function wrapText(ctx, text, maxWidth, maxLines) {
  text = String(text == null ? '' : text);
  if (!text) return [];

  var lines = [];
  var line = '';

  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    var next = line + ch;

    if (ctx.measureText(next).width > maxWidth && line) {
      // 行頭に来てほしくない文字なら、前の行にぶら下げる
      if (NO_LINE_START.indexOf(ch) !== -1) {
        lines.push(next);
        line = '';
      } else {
        lines.push(line);
        line = ch;
      }
      if (maxLines && lines.length >= maxLines) {
        // 入りきらないぶんだけは最後の行を詰める
        var rest = text.slice(i + (line ? 0 : 1));
        if (rest) lines[lines.length - 1] = fit(ctx, lines[lines.length - 1] + rest, maxWidth);
        return lines;
      }
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return maxLines ? lines.slice(0, maxLines) : lines;
}

// ---------------------------------------------------------
// スタンプ画像の読み込み
// 画像は読み込みが終わってから描けるので、読めたらもう一度描き直す
// ---------------------------------------------------------
var imageCache = {};

/** 直近に描いた配置。キャラをドラッグするときの当たり判定に使う */
var layout = { characters: [], height: 0 };

function stampImage(url) {
  if (imageCache[url] !== undefined) return imageCache[url];
  imageCache[url] = null; // 読み込み中
  var img = new Image();
  img.onload = function () { imageCache[url] = img; draw(); };
  img.onerror = function () { imageCache[url] = false; }; // 消えた画像は諦める
  img.src = url;
  return null;
}

/**
 * 背景画像を敷く。
 *   cover   … 縦横比を保ったまま、はみ出してでも全体を覆う
 *   contain … 全体が入る大きさにして中央に置く
 *   tile    … 元の大きさのまま敷きつめる
 */
function drawBackground(ctx, img, W, H, fit, opacity) {
  if (!img || opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, opacity / 100));

  if (fit === 'tile') {
    var pattern = ctx.createPattern(img, 'repeat');
    if (pattern) { ctx.fillStyle = pattern; ctx.fillRect(0, 0, W, H); }
  } else {
    var ratio = fit === 'contain'
      ? Math.min(W / img.width, H / img.height)
      : Math.max(W / img.width, H / img.height);
    var w = img.width * ratio;
    var h = img.height * ratio;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  }
  ctx.restore();
}

/** キャラ画像の置き場所と大きさを、実際の座標に直す */
function characterBox(chara, img, W, H) {
  var w = W * chara.scale;
  var h = img && img.width ? w * (img.height / img.width) : w;
  return { x: chara.x * W - w / 2, y: chara.y * H - h / 2, w: w, h: h };
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

/** images/ フォルダの画像をファイル名から引く */
function findImage(file) {
  var list = state.images || [];
  for (var i = 0; i < list.length; i++) if (list[i].file === file) return list[i];
  return null;
}

function findStamp(id) {
  var list = state.stamps || [];
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  if (String(id).indexOf('emoji:') === 0) return { id: id, type: 'emoji', char: String(id).slice(6) };
  return null;
}

/** 実際に描けるスタンプだけに絞る（画像を消した場合などを除く） */
function usableStamps(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.filter(function (id) { return !!findStamp(id); });
}

/** スタンプを左から順に、指定の大きさで描く */
function drawStamps(ctx, ids, leftX, centerY, size, gap) {
  var x = leftX;
  for (var i = 0; i < ids.length; i++) {
    var stamp = findStamp(ids[i]);
    if (!stamp) continue;

    if (stamp.type === 'emoji') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = size + 'px ' + EMOJI_FONT;
      ctx.fillText(stamp.char, x + size / 2, centerY);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    } else {
      var img = stampImage(stamp.url);
      if (img) ctx.drawImage(img, x, centerY - size / 2, size, size);
    }
    x += size + gap;
  }
}

// ---------------------------------------------------------
// 画像を描く
// ---------------------------------------------------------
function draw() {
  var canvas = $('cv');
  var ctx = canvas.getContext('2d');

  var style = currentStyle();
  var themeId = currentThemeId();
  var theme = SUMMARY_THEMES[themeId];
  var c = Object.assign({}, theme.c);

  // クラシックのテーマだけ、アクセント色を選べる
  var accent = ACCENTS[style.accent] || ACCENTS.blue;
  if (theme.useAccent) c.accent = theme.light ? accent.light : accent.dark;

  // 部位ごとのフォントと大きさ
  PARTS.forEach(function (p) { STACKS[p.id] = fontStack(partFont(p.id, theme)); });
  var S = {};
  PARTS.forEach(function (p) { S[p.id] = partScale(p.id); });

  var noteText = opts.note != null ? opts.note : (style.note || '');
  var background = style.background || {};
  var characters = Array.isArray(style.characters) ? style.characters : [];

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

  // --- 大きさ ---
  var twoCol = opts.cols === '2' || (opts.cols === 'auto' && records.length > 12);
  var pad = 46;
  var gap = twoCol ? 22 : 0;
  var colW = twoCol ? (WIDTH - pad * 2 - gap) / 2 : WIDTH - pad * 2;
  var rowGap = theme.gap != null ? theme.gap : 10;

  var base = twoCol
    ? { name: 24, deck: 18, comment: 18, badge: 17, no: 16, rowPad: 13, stamp: 42 }
    : { name: 28, deck: 21, comment: 20, badge: 19, no: 17, rowPad: 15, stamp: 56 };
  var sz = {
    name: base.name * S.name,
    deck: base.deck * S.deck,
    comment: base.comment * S.comment,
    badge: base.badge * S.stats,
    no: base.no * S.stats,
    rowPad: base.rowPad,
    stamp: base.stamp
  };
  // 1行ぶんの高さ（文字の大きさに合わせて広がる）
  var lh = {
    name: Math.max(sz.name * 1.3, sz.badge * 1.75),
    deck: sz.deck * 1.45,
    comment: sz.comment * 1.5,
    h2h: (sz.comment - 2) * 1.5
  };
  var STAMP_GAP = 9;
  var cardPadX = 20;
  var innerW = colW - cardPadX * 2;
  var STAMP_MARGIN = 18;

  // 各行の高さ（内容によって変わる）
  var rows = records.map(function (r) {
    var stampIds = opts.stamps ? usableStamps(r.stamps) : [];
    var stampBlock = stampIds.length
      ? stampIds.length * sz.stamp + (stampIds.length - 1) * STAMP_GAP
      : 0;
    var textW = innerW - (stampBlock ? stampBlock + STAMP_MARGIN : 0);

    // 感想は「…」で切らず、入りきらなければ折り返して行を増やす
    var commentLines = [];
    if (opts.comment && r.comment) {
      setFont(ctx, sz.comment, 'comment');
      commentLines = wrapText(ctx, '「' + r.comment + '」', textW, 0);
    }

    var h2hText = '';
    if (opts.h2h) {
      var rec = h2hOf(r.name);
      if (rec.total > 1) h2hText = '通算 ' + rec.total + '戦 ' + rec.wins + 'WIN ' + rec.losses + 'LOSE';
    }

    /*
      2行目のデッキ。デッキを入れていないリスナーのときに
      「デッキ未入力」とは出さず、書くことが無ければ行ごと詰める。
    */
    var deckText = opts.deck ? (r.deck || '') : '';
    var showMyDeck = !!(perRowMyDeck && r.myDeck);
    var deckLine = !!(deckText || showMyDeck);

    var height = sz.rowPad * 2 + lh.name +
      (deckLine ? lh.deck : 0) +
      commentLines.length * lh.comment +
      (h2hText ? lh.h2h : 0);
    // スタンプが行からはみ出さないだけの高さは確保する
    if (stampIds.length) height = Math.max(height, sz.stamp + 24);

    return {
      r: r, commentLines: commentLines, h2hText: h2hText,
      deckText: deckText, showMyDeck: showMyDeck, deckLine: deckLine,
      stampIds: stampIds, stampBlock: stampBlock, textW: textW, h: height
    };
  });

  var colHeights = [0, 0];
  if (twoCol) {
    var half = Math.ceil(rows.length / 2);
    rows.forEach(function (row, i) {
      row.col = i < half ? 0 : 1;
      colHeights[row.col] += row.h + rowGap;
    });
  } else {
    rows.forEach(function (row) { row.col = 0; colHeights[0] += row.h + rowGap; });
  }

  // --- 見出しの大きさ ---
  var titleSize = 40 * S.title;
  var subSize = 22 * S.comment;
  var statNum = 44 * S.stats;
  var statLabel = 15 * Math.max(0.8, S.stats * 0.9);
  var boxW = 380;
  var boxH = Math.round(statNum + statLabel + 46);
  var boxY = 44;

  var titleBase = 40 + titleSize;
  var subBase = titleBase + subSize * 1.55;
  var deckBase = subBase + subSize * 1.3;
  var hasHeaderDeck = opts.myDeck && (headerMyDeck || myDeckSet.length > 1);
  var headerBottom = Math.max(boxY + boxH, hasHeaderDeck ? deckBase + 8 : subBase + 8);
  var headerH = Math.round(headerBottom + 34);

  // ひとことは枠の中に入れる。折り返して切れないようにする
  var noteSize = 22 * S.note;
  var NOTE_PAD_V = 20;
  var NOTE_PAD_H = 30;
  setFont(ctx, noteSize, 'note');
  var noteLines = noteText ? wrapText(ctx, noteText, WIDTH - pad * 2 - NOTE_PAD_H * 2, 0) : [];
  var noteLineH = Math.round(noteSize * 1.5);
  var noteBoxH = noteLines.length ? noteLines.length * noteLineH + NOTE_PAD_V * 2 : 0;
  var noteH = noteBoxH ? noteBoxH + 22 : 0;
  var overflowH = overflow > 0 ? 40 : 0;
  var listH = Math.max(colHeights[0], colHeights[1]);
  var height = headerH + (total ? listH + 18 : 120) + overflowH + noteH + pad;

  // --- キャンバス準備 ---
  canvas.width = WIDTH * SCALE;
  canvas.height = Math.round(height) * SCALE;
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.textBaseline = 'alphabetic';
  $('size-label').textContent = WIDTH + ' × ' + Math.round(height) + ' px';
  layout.height = Math.round(height);

  // --- 背景 ---
  theme.background(ctx, WIDTH, height, c);

  // 背景画像（下地の上に重ねる）
  if (background.file) {
    var bgEntry = findImage(background.file);
    if (bgEntry) {
      drawBackground(ctx, stampImage(bgEntry.url), WIDTH, height, background.fit, background.opacity);
    }
  }

  if (theme.decorate) theme.decorate(ctx, WIDTH, height, c);

  // 上端のアクセントライン（クラシック）
  if (theme.topBar) {
    var accentBar = ctx.createLinearGradient(0, 0, WIDTH, 0);
    accentBar.addColorStop(0, accent.bar[0]);
    accentBar.addColorStop(1, accent.bar[1]);
    ctx.fillStyle = accentBar;
    ctx.fillRect(0, 0, WIDTH, 6);
  }

  // --- ヘッダー ---
  var titleMaxW = WIDTH - pad * 2 - boxW - 40;
  var title = (opts.title || state.settings.streamTitle || '視聴者参加型対戦').trim();
  ctx.textAlign = 'left';
  setFont(ctx, titleSize, 'title');
  var hasSpacing = ctx.letterSpacing !== undefined;
  if (theme.titleSpacing && hasSpacing) ctx.letterSpacing = theme.titleSpacing + 'px';
  var titleShown = fit(ctx, title, titleMaxW);
  var titleW = ctx.measureText(titleShown).width;

  if (theme.behindTitle) theme.behindTitle(ctx, pad, titleBase, titleW, titleSize, c);
  if (theme.titleShadow) {
    ctx.fillStyle = theme.titleShadow.color;
    ft(ctx, titleShown, pad + theme.titleShadow.x, titleBase + theme.titleShadow.y);
  }
  if (theme.titleStroke) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = theme.titleStroke.width;
    ctx.strokeStyle = theme.titleStroke.color;
    ctx.strokeText(titleShown, pad, titleBase);
  }
  ctx.fillStyle = theme.titleColor || c.text;
  ft(ctx, titleShown, pad, titleBase);
  if (hasSpacing) ctx.letterSpacing = '0px';
  if (theme.afterTitle) theme.afterTitle(ctx, pad + titleW, titleBase, titleSize, c);
  if (theme.afterTitleUnderline) theme.afterTitleUnderline(ctx, pad, titleBase, titleW, titleSize, c);

  setFont(ctx, subSize, 'comment');
  ctx.fillStyle = c.muted;
  var dateLabel = opts.day === 'all' ? '通算成績' : jpDate(opts.day);
  var who = opts.myName && state.settings.myName ? '　/　' + state.settings.myName : '';
  ft(ctx, fit(ctx, dateLabel + who, titleMaxW), pad, subBase);

  if (hasHeaderDeck) {
    setFont(ctx, subSize * 0.86, 'comment');
    ctx.fillStyle = c.dim;
    var deckLabel = headerMyDeck ? '自分の使用デッキ：' + headerMyDeck : '自分の使用デッキ：' + myDeckSet.length + '種類';
    ft(ctx, fit(ctx, deckLabel, titleMaxW), pad, deckBase);
  }

  // --- 成績（右上） ---
  var boxX = WIDTH - pad - boxW;
  theme.statsBox(ctx, boxX, boxY, boxW, boxH, c);

  ctx.textAlign = 'center';
  var cellW = boxW / 3;
  var numBase = boxY + 20 + statNum * 0.95;

  // 字幅の広いフォントや大きな数字でも、枠からはみ出さないように縮める
  function statText(text, size, color, cx, y) {
    setFont(ctx, size, 'stats');
    var w = ctx.measureText(text).width;
    if (w > cellW - 18) setFont(ctx, size * (cellW - 18) / w, 'stats');
    ctx.fillStyle = color;
    ft(ctx, text, cx, y);
  }
  statText(String(wins), statNum, c.win, boxX + cellW * 0.5, numBase);
  statText(String(losses), statNum, c.lose, boxX + cellW * 1.5, numBase);
  statText(rate + '%', statNum * 0.77, c.accent, boxX + cellW * 2.5, numBase - 2);

  setFont(ctx, statLabel, 'comment');
  ctx.fillStyle = c.dim;
  var labelBase = numBase + statLabel + 10;
  ft(ctx, 'WIN', boxX + cellW * 0.5, labelBase);
  ft(ctx, 'LOSE', boxX + cellW * 1.5, labelBase);
  ft(ctx, '勝率（全' + total + '戦）', boxX + cellW * 2.5, labelBase);

  // --- 区切り線 ---
  theme.divider(ctx, pad, WIDTH - pad, headerH - 16, c);

  // --- 対戦一覧 ---
  ctx.textAlign = 'left';
  if (!total) {
    setFont(ctx, 24, 'comment');
    ctx.fillStyle = c.dim;
    ctx.textAlign = 'center';
    ft(ctx, 'この日の対戦記録はまだありません', WIDTH / 2, headerH + 60);
  } else {
    var cursorY = [headerH + 8, headerH + 8];
    var indexInCol = [0, 0];

    rows.forEach(function (row) {
      var r = row.r;
      var col = row.col;
      var x = pad + col * (colW + gap);
      var y = cursorY[col];
      var isWin = r.result === 'win';

      // 行の下地
      theme.card(ctx, x, y, colW, row.h, isWin, c, indexInCol[col]);

      var innerX = x + cardPadX;
      var textW = row.textW;
      var lineY = y + sz.rowPad + lh.name * 0.74;

      // 1行目：番号 / 勝敗 / 名前
      setFont(ctx, sz.no, 'stats');
      ctx.fillStyle = c.dim;
      var noText = r.matchNumber ? String(r.matchNumber) : '-';
      var noW = ctx.measureText(noText).width;
      ft(ctx, noText, innerX, lineY);

      var badgeX = innerX + noW + 12;
      setFont(ctx, sz.badge, 'stats');
      var badgeW = theme.badge(ctx, badgeX, lineY, isWin, c, sz.badge, function (text, bx, by) {
        ft(ctx, text, bx, by);
      });
      ctx.textAlign = 'left';

      // スタンプは行の右端に、行の高さいっぱいの大きさで縦中央に置く
      if (row.stampBlock) {
        drawStamps(ctx, row.stampIds, innerX + innerW - row.stampBlock, y + row.h / 2, sz.stamp, STAMP_GAP);
      }

      var nameX = badgeX + badgeW + 14;

      // リスナーのアイコン（わんコメから取り込んだ場合）
      if (opts.icons && r.icon) {
        var iconSize = Math.round(sz.name * 1.15);
        var iconImg = stampImage(r.icon);
        if (iconImg) {
          drawCircleImage(ctx, iconImg, nameX, lineY - iconSize * 0.8, iconSize);
        }
        nameX += iconSize + 10;
      }

      setFont(ctx, sz.name, 'name');
      ctx.fillStyle = c.text;
      ft(ctx, fit(ctx, r.name, innerX + textW - nameX), nameX, lineY + 2);

      // 2行目：デッキ（書くことが無ければこの行ごと出さない）
      var cursor = y + sz.rowPad + lh.name;
      if (row.deckLine) {
        var deckY = cursor + lh.deck * 0.76;
        cursor += lh.deck;
        setFont(ctx, sz.deck, 'deck');
        ctx.fillStyle = c.accent;
        var maxDeckW = textW * (row.showMyDeck ? 0.5 : 1) - 10;
        var shown = row.deckText ? fit(ctx, row.deckText, maxDeckW) : '';
        var usedW = 0;
        if (shown) {
          ft(ctx, shown, innerX, deckY);
          usedW = ctx.measureText(shown).width;
        }

        if (row.showMyDeck) {
          setFont(ctx, sz.deck * 0.9, 'comment');
          ctx.fillStyle = c.dim;
          var vs = shown ? '  vs  自分：' : '自分：';
          ft(ctx, vs, innerX + usedW, deckY);
          var vsW = ctx.measureText(vs).width;
          ctx.fillStyle = c.muted;
          ft(ctx, fit(ctx, r.myDeck, textW - usedW - vsW), innerX + usedW + vsW, deckY);
        }
      }

      // 3行目以降：感想（長ければ折り返す）
      if (row.commentLines.length) {
        setFont(ctx, sz.comment, 'comment');
        ctx.fillStyle = c.comment;
        for (var ci = 0; ci < row.commentLines.length; ci++) {
          ft(ctx, row.commentLines[ci], innerX, cursor + lh.comment * 0.76);
          cursor += lh.comment;
        }
      }

      // 4行目：そのリスナーとの通算
      if (row.h2hText) {
        setFont(ctx, sz.comment - 2, 'comment');
        ctx.fillStyle = c.dim;
        ft(ctx, fit(ctx, row.h2hText, textW), innerX, cursor + lh.h2h * 0.76);
      }

      cursorY[col] += row.h + rowGap;
      indexInCol[col]++;
    });
  }

  // --- 入りきらなかった試合 ---
  if (overflow > 0) {
    setFont(ctx, 19, 'comment');
    ctx.fillStyle = c.dim;
    ctx.textAlign = 'center';
    ft(ctx, '…ほか ' + overflow + '戦（成績は全' + total + '戦ぶんを集計しています）',
      WIDTH / 2, headerH + listH + 30);
    ctx.textAlign = 'left';
  }

  // --- キャラ画像（いちばん手前に置く） ---
  layout.characters = [];
  characters.forEach(function (chara) {
    var entry = findImage(chara.file);
    if (!entry) return;
    var img = stampImage(entry.url);
    if (!img) return;
    var box = characterBox(chara, img, WIDTH, height);
    ctx.drawImage(img, box.x, box.y, box.w, box.h);
    layout.characters.push({ id: chara.id, box: box });
  });

  // --- ひとこと（枠つき） ---
  if (noteLines.length) {
    var noteBoxY = height - pad - noteBoxH;
    theme.note(ctx, pad, noteBoxY, WIDTH - pad * 2, noteBoxH, c);

    setFont(ctx, noteSize, 'note');
    ctx.fillStyle = theme.noteColor || c.comment;
    if (themeId === 'retro') ctx.fillStyle = c.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var ni = 0; ni < noteLines.length; ni++) {
      ft(ctx, noteLines[ni], WIDTH / 2, noteBoxY + NOTE_PAD_V + noteLineH * (ni + 0.5));
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
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

var styleLoaded = false;

function refresh() {
  refreshDayOptions();
  if (!$('o-title').value && state.settings.streamTitle) $('o-title').placeholder = state.settings.streamTitle;

  // 保存されている見た目の設定を、最初の1回だけ画面に反映する
  var style = state.settings.summary;
  if (style && !styleLoaded) {
    styleLoaded = true;
    $('o-accent').value = style.accent || 'blue';
    if (style.note) { $('o-note').value = style.note; opts.note = style.note; }

    var bg = style.background || {};
    $('o-bg-opacity').value = bg.opacity != null ? bg.opacity : 35;
    $('o-bg-op-label').textContent = $('o-bg-opacity').value;
    $('o-bg-fit').value = bg.fit || 'cover';
    $('bg-opts').hidden = !bg.file;
  }

  refreshImageOptions();
  renderCharacters();
  renderDesignControls();
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
$('o-cols').addEventListener('change', function (e) { opts.cols = e.target.value; draw(); });
$('o-deck').addEventListener('change', function (e) { opts.deck = e.target.checked; draw(); });
$('o-comment').addEventListener('change', function (e) { opts.comment = e.target.checked; draw(); });
$('o-mydeck').addEventListener('change', function (e) { opts.myDeck = e.target.checked; draw(); });
$('o-myname').addEventListener('change', function (e) { opts.myName = e.target.checked; draw(); });
$('o-h2h').addEventListener('change', function (e) { opts.h2h = e.target.checked; draw(); });
$('o-stamps').addEventListener('change', function (e) { opts.stamps = e.target.checked; draw(); });
$('o-icons').addEventListener('change', function (e) { opts.icons = e.target.checked; draw(); });
$('o-title').addEventListener('input', function (e) { opts.title = e.target.value; draw(); });

/** 見た目の設定を保存する（打つたびに保存しないよう少し待つ） */
var saveTimer = null;
var pendingStyle = {};   // まだ送っていない変更（続けて変えても、どれも取りこぼさない）
function saveStyle(patch) {
  var target = (state.settings && state.settings.summary) || {};
  Object.assign(target, patch);
  if (state.settings) state.settings.summary = target;
  Object.assign(pendingStyle, patch);
  draw();

  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    var body = pendingStyle;
    pendingStyle = {};
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: body })
    }).catch(function () { /* 保存できなくても表示は続けられる */ });
  }, 500);
}

$('o-accent').addEventListener('change', function (e) { saveStyle({ accent: e.target.value }); });

$('o-note').addEventListener('input', function (e) {
  opts.note = e.target.value;
  saveStyle({ note: e.target.value });
});

/** フォントを読み終えてから描き直し、画像にする */
function withFreshCanvas(done) {
  var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  ready.then(function () { draw(); done(); });
}

$('download').addEventListener('click', function () {
  var name = fileName();
  withFreshCanvas(function () { $('cv').toBlob(function (blob) {
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
  }, 'image/png'); });
});

$('copy').addEventListener('click', function () {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    say('このブラウザではコピーできません。「PNG画像として保存」を使ってください。');
    return;
  }
  withFreshCanvas(function () { $('cv').toBlob(function (blob) {
    if (!blob) { say('コピーに失敗しました。「PNG画像として保存」を使ってください。'); return; }
    navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(function () {
      say('コピーしました。X（Twitter）の投稿欄で Ctrl + V を押すと貼れます。');
    }).catch(function () {
      say('コピーできませんでした。「PNG画像として保存」を使ってください。');
    });
  }, 'image/png'); });
});


// ---------------------------------------------------------
// 背景とキャラ画像の操作
// ---------------------------------------------------------
var selectedChara = null; // 選択中のキャラのID

/** images/ フォルダの中身を選択肢に並べる */
function refreshImageOptions() {
  var list = state.images || [];
  var options = list.map(function (img) {
    var label = img.group !== '画像' ? img.group + ' / ' + img.label : img.label;
    return '<option value="' + esc(img.file) + '">' + esc(label) + '</option>';
  }).join('');

  var bg = $('o-bg');
  var keep = bg.value;
  bg.innerHTML = '<option value="">なし</option>' + options;
  bg.value = (state.settings.summary && state.settings.summary.background &&
              state.settings.summary.background.file) || keep || '';

  $('o-char-add').innerHTML = '<option value="">' +
    (list.length ? '選んで追加…' : 'images フォルダに画像を入れてください') + '</option>' + options;
}

/** 置いたキャラ画像の一覧を描く */
function renderCharacters() {
  var chars = (state.settings.summary && state.settings.summary.characters) || [];
  var box = $('char-list');

  if (!chars.length) {
    box.innerHTML = '<p class="hint">まだ置いていません。上の「キャラ画像を追加」から選ぶと、画像の上に出ます。</p>';
    return;
  }

  box.innerHTML = chars.map(function (c) {
    var entry = findImage(c.file);
    return '<div class="char-row' + (c.id === selectedChara ? ' on' : '') + '" data-id="' + esc(c.id) + '">' +
      (entry ? '<img class="char-thumb" src="' + esc(entry.url) + '" alt="">' : '<span class="char-thumb"></span>') +
      '<span class="char-body">' +
        '<span class="char-name">' + esc(entry ? entry.label : c.file + '（見つかりません）') + '</span>' +
        '<input type="range" min="5" max="120" step="1" value="' + Math.round(c.scale * 100) + '" data-scale>' +
      '</span>' +
      '<button type="button" class="btn btn-danger btn-sm" data-remove>削除</button>' +
    '</div>';
  }).join('');

  Array.prototype.forEach.call(box.querySelectorAll('.char-row'), function (row) {
    var id = row.dataset.id;
    row.addEventListener('mousedown', function (event) {
      // ボタンやつまみの上では選択し直さない（作り直すと押せなくなる）
      if (event.target.closest('button, input')) return;
      selectCharacter(id);
    });
    row.querySelector('[data-scale]').addEventListener('input', function (e) {
      updateCharacter(id, { scale: Number(e.target.value) / 100 });
    });
    row.querySelector('[data-remove]').addEventListener('click', function () {
      var next = chars.filter(function (c) { return c.id !== id; });
      if (selectedChara === id) selectedChara = null;
      saveStyle({ characters: next });
      renderCharacters();
    });
  });
}

/** 選択中の表示だけを切り替える（一覧は作り直さない） */
function selectCharacter(id) {
  selectedChara = id;
  Array.prototype.forEach.call(document.querySelectorAll('.char-row'), function (row) {
    row.classList.toggle('on', row.dataset.id === id);
  });
}

function updateCharacter(id, patch) {
  var chars = ((state.settings.summary && state.settings.summary.characters) || []).map(function (c) {
    return c.id === id ? Object.assign({}, c, patch) : c;
  });
  saveStyle({ characters: chars });
}

$('o-bg').addEventListener('change', function (e) {
  var current = (state.settings.summary && state.settings.summary.background) || {};
  saveStyle({ background: Object.assign({}, current, { file: e.target.value }) });
  $('bg-opts').hidden = !e.target.value;
});

$('o-bg-opacity').addEventListener('input', function (e) {
  $('o-bg-op-label').textContent = e.target.value;
  var current = (state.settings.summary && state.settings.summary.background) || {};
  saveStyle({ background: Object.assign({}, current, { opacity: Number(e.target.value) }) });
});

$('o-bg-fit').addEventListener('change', function (e) {
  var current = (state.settings.summary && state.settings.summary.background) || {};
  saveStyle({ background: Object.assign({}, current, { fit: e.target.value }) });
});

$('o-char-add').addEventListener('change', function (e) {
  var file = e.target.value;
  e.target.value = '';
  if (!file) return;

  var chars = ((state.settings.summary && state.settings.summary.characters) || []).slice();
  if (chars.length >= 6) { window.alert('キャラ画像は6つまでです。'); return; }

  var id = 'c' + Date.now().toString(36);
  chars.push({ id: id, file: file, x: 0.82, y: 0.72, scale: 0.22 });
  selectedChara = id;
  saveStyle({ characters: chars });
  renderCharacters();
});

$('images-reload').addEventListener('click', function () {
  fetch('/api/images/reload', { method: 'POST' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data && data.state) { state = data.state; refreshImageOptions(); renderCharacters(); draw(); }
    })
    .catch(function () { /* 失敗しても表示は続く */ });
});

// ---------------------------------------------------------
// キャラ画像をドラッグして動かす
// ---------------------------------------------------------
var dragging = null;

/** 表示上の位置を、画像の中の座標に直す */
function canvasPoint(event) {
  var canvas = $('cv');
  var rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / rect.width * WIDTH,
    y: (event.clientY - rect.top) / rect.height * layout.height
  };
}

$('cv').addEventListener('mousedown', function (event) {
  var point = canvasPoint(event);
  // 手前にあるものから当てる
  for (var i = layout.characters.length - 1; i >= 0; i--) {
    var item = layout.characters[i];
    var box = item.box;
    if (point.x >= box.x && point.x <= box.x + box.w &&
        point.y >= box.y && point.y <= box.y + box.h) {
      dragging = { id: item.id, dx: point.x - (box.x + box.w / 2), dy: point.y - (box.y + box.h / 2) };
      selectCharacter(item.id);
      $('cv').classList.add('dragging');
      event.preventDefault();
      return;
    }
  }
});

window.addEventListener('mousemove', function (event) {
  if (!dragging) return;
  var point = canvasPoint(event);
  updateCharacter(dragging.id, {
    x: (point.x - dragging.dx) / WIDTH,
    y: (point.y - dragging.dy) / layout.height
  });
});

window.addEventListener('mouseup', function () {
  if (!dragging) return;
  dragging = null;
  $('cv').classList.remove('dragging');
});

// ---------------------------------------------------------
// デザイン（テーマ・フォント・大きさ）の操作
// ---------------------------------------------------------
var ui = { part: 'title' };

/** 中身が変わったときだけ書き換える（見本のフォントを読み直させないため） */
function setHtml(id, html) {
  var el = $(id);
  if (el.__html === html) return;
  el.__html = html;
  el.innerHTML = html;
}

/** テーマ・部位・フォントの選択欄を、いまの設定に合わせて描く */
function renderDesignControls() {
  var style = currentStyle();
  var themeId = currentThemeId();
  var theme = SUMMARY_THEMES[themeId];

  // テーマ
  setHtml('theme-grid', SUMMARY_THEME_ORDER.map(function (id) {
    var t = SUMMARY_THEMES[id];
    var bars = t.swatch.map(function (color) { return '<i style="background:' + color + '"></i>'; }).join('');
    return '<button type="button" class="theme-btn' + (id === themeId ? ' on' : '') + '" data-theme="' + id + '">' +
      '<span class="theme-sw">' + bars + '</span>' +
      '<span class="theme-name">' + esc(t.label) + '</span>' +
      '<span class="theme-desc">' + esc(t.desc) + '</span>' +
    '</button>';
  }).join(''));
  $('accent-field').hidden = !theme.useAccent;

  // 部位
  var sizes = style.sizes || {};
  setHtml('part-tabs', PARTS.map(function (p) {
    var changed = (style.fonts && style.fonts[p.id]) || (sizes[p.id] && sizes[p.id] !== 100);
    return '<button type="button" class="part-tab' + (p.id === ui.part ? ' on' : '') + (changed ? ' changed' : '') +
      '" data-part="' + p.id + '">' + esc(p.label) + '</button>';
  }).join(''));

  var partLabel = PARTS.filter(function (p) { return p.id === ui.part; })[0].label;
  $('part-name').textContent = partLabel;
  var size = Number(sizes[ui.part]) || 100;
  if (document.activeElement !== $('part-size')) $('part-size').value = size;
  $('part-size-label').textContent = size;

  // フォント
  var chosen = (style.fonts || {})[ui.part] || '';
  var recommended = theme.fonts[ui.part];
  var recInfo = fontInfo(recommended);
  var list = window.FONT_LIST || [];
  var sample = sampleText(ui.part);

  function chip(value, label, stack, sub) {
    return '<button type="button" class="font-chip' + (value === chosen ? ' on' : '') + '" data-font="' + esc(value) + '">' +
      '<span class="font-sample" style="font-family:' + esc(stack) + '">' + esc(sample) + '</span>' +
      '<span class="font-label">' + esc(label) + (sub ? '<em>' + esc(sub) + '</em>' : '') + '</span>' +
    '</button>';
  }

  var html = chip('', 'おまかせ', recInfo ? recInfo.stack : FALLBACK_FONT, recInfo ? recInfo.label : '');
  html += '<div class="font-group">アプリに入っているフォント</div>';
  html += list.filter(function (f) { return f.group === 'bundled'; })
    .map(function (f) { return chip(f.id, f.label, f.stack); }).join('');
  html += '<div class="font-group">Windows のフォント</div>';
  html += list.filter(function (f) { return f.group === 'windows'; })
    .map(function (f) { return chip(f.id, f.label, f.stack); }).join('');
  if (chosen.indexOf('custom:') === 0) {
    html += '<div class="font-group">PCのフォント</div>' + chip(chosen, chosen.slice(7), fontStack(chosen));
  }
  setHtml('font-grid', html);
}

/** フォント見本に出す文字（部位に合わせる） */
function sampleText(part) {
  // ひらがなが入っている方が、フォントのちがいが分かりやすい
  if (part === 'stats') return 'WIN 12 58%';
  if (part === 'deck') return 'まどうぐ魔導具';
  if (part === 'title') return 'みんなで対戦';
  if (part === 'note') return 'ありがとう！';
  if (part === 'comment') return 'たのしかった';
  return 'あおいむし';
}

function saveFonts(patch) {
  var fonts = Object.assign({}, currentStyle().fonts || {}, patch);
  saveStyle({ fonts: fonts });
  renderDesignControls();
}

$('theme-grid').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-theme]');
  if (!btn) return;
  saveStyle({ theme: btn.dataset.theme });
  renderDesignControls();
});

$('part-tabs').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-part]');
  if (!btn) return;
  ui.part = btn.dataset.part;
  renderDesignControls();
});

$('part-size').addEventListener('input', function (e) {
  var sizes = Object.assign({}, currentStyle().sizes || {});
  sizes[ui.part] = Number(e.target.value);
  $('part-size-label').textContent = e.target.value;
  saveStyle({ sizes: sizes });
});
$('part-size').addEventListener('change', renderDesignControls);

$('font-grid').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-font]');
  if (!btn) return;
  var patch = {};
  patch[ui.part] = btn.dataset.font;
  saveFonts(patch);
});

function useCustomFont() {
  var name = $('custom-font').value.replace(/["'`\;{}<>()]/g, '').trim();
  if (!name) { $('custom-font-hint').textContent = 'フォント名を入れてください。'; return; }
  var installed = true;
  try { installed = document.fonts.check('16px "' + name + '"', 'あ'); } catch (err) { /* 調べられなくても使う */ }
  var patch = {};
  patch[ui.part] = 'custom:' + name.slice(0, 40);
  saveFonts(patch);
  $('custom-font-hint').textContent = '「' + name + '」を使いました。見た目が変わらないときは、名前がPCのフォントと合っているか確かめてください。';
  if (!installed) $('custom-font-hint').textContent += '（このPCでは見つからないかもしれません）';
}
$('custom-font-use').addEventListener('click', useCustomFont);
$('custom-font').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); useCustomFont(); } });

// PCに入っているフォントの一覧（使えるブラウザだけ。許可を聞かれます）
if (window.queryLocalFonts) {
  $('local-fonts').hidden = false;
  $('local-fonts').addEventListener('click', function () {
    window.queryLocalFonts().then(function (fonts) {
      var names = [];
      fonts.forEach(function (f) { if (names.indexOf(f.family) === -1) names.push(f.family); });
      names.sort(function (a, b) { return a.localeCompare(b, 'ja'); });
      $('custom-font-list').innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
      $('custom-font-hint').textContent = names.length + '個のフォントが見つかりました。上の欄をクリックすると選べます。';
    }).catch(function () {
      $('custom-font-hint').textContent = 'フォント一覧を読めませんでした。名前を直接入れてください。';
    });
  });
}

$('font-all').addEventListener('click', function () {
  var current = ((currentStyle().fonts || {})[ui.part]) || SUMMARY_THEMES[currentThemeId()].fonts[ui.part];
  var fonts = {};
  PARTS.forEach(function (p) { fonts[p.id] = current; });
  saveStyle({ fonts: fonts });
  renderDesignControls();
});

$('font-reset').addEventListener('click', function () {
  var fonts = {}, sizes = {};
  PARTS.forEach(function (p) { fonts[p.id] = ''; sizes[p.id] = 100; });
  saveStyle({ fonts: fonts, sizes: sizes });
  renderDesignControls();
});

// フォントが読み込まれてから描き直す（文字幅がずれないように）
if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);

fetch('/api/state').then(function (r) { return r.json(); }).then(function (data) {
  if (data && data.ok) { state = data.state; refresh(); }
}).catch(function () { /* WebSocket接続時に届く */ });

renderDesignControls();
draw();
connect();
