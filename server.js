'use strict';

/**
 * デュエル・マスターズ プレイス 視聴者参加型配信ツール
 *
 *   対戦記録画面 : http://localhost:3000/admin
 *   まとめ画像   : http://localhost:3000/summary
 *   OBS表示画面  : http://localhost:3000/overlay
 *
 * ローカルPCだけで完結する。外部サービスへの通信は一切しない。
 * 参加者の受付・整列はワンコメなど別ツールに任せ、こちらは対戦履歴に専念する。
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Store, DATA_FILE } = require('./lib/store');
const { listStamps, STAMP_DIR } = require('./lib/stamps');
const { OneCommeClient } = require('./lib/onecomme');
const { cacheIcon, ICON_DIR } = require('./lib/icons');
const { listImages, IMAGE_DIR } = require('./lib/images');
const { fontList, fontCss, FONTSOURCE_DIR } = require('./lib/fonts');

// 画面に出すバージョン。更新したファイルで動いているか一目で分かるようにする
const APP_VERSION = '1.3.2 (2026-11-15)';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const store = new Store();
store.load();

const app = express();
app.use(express.json({ limit: '256kb' }));
// 画面のHTML/CSS/JSはキャッシュさせない。
// OBSやブラウザが古いファイルを使い続けて「更新したのに変わらない」が起きるのを防ぐ。
const noStore = (res) => res.setHeader('Cache-Control', 'no-store, must-revalidate');
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  etag: false,
  lastModified: false,
  setHeaders: noStore
}));
// stamps/ に置いた画像をそのまま配る
app.use('/stamps', express.static(STAMP_DIR, { index: false, dotfiles: 'ignore' }));
// わんコメから取り込んで保存したアイコンを配る
app.use('/icons', express.static(ICON_DIR, { index: false, dotfiles: 'ignore' }));
// images/ に置いた背景・キャラ画像を配る
app.use('/images', express.static(IMAGE_DIR, { index: false, dotfiles: 'ignore' }));

// 同梱フォント。中身は変わらないので、ブラウザに覚えておいてもらう
app.use('/fontsource', (req, res, next) => {
  if (!/\.woff2$/i.test(req.path)) return res.status(404).end();
  next();
}, express.static(FONTSOURCE_DIR, { index: false, dotfiles: 'ignore', maxAge: '30d', immutable: true }));

// フォントの @font-face と、選べるフォントの一覧
app.get('/fonts.css', (req, res) => {
  noStore(res);
  // ?ids=zenmaru,dot のように、使うものだけに絞れる（OBS表示を軽くするため）
  const ids = typeof req.query.ids === 'string' ? req.query.ids.split(',').slice(0, 12) : null;
  res.type('text/css').send(fontCss(ids));
});
app.get('/font-list.js', (req, res) => {
  noStore(res);
  res.type('application/javascript').send('window.FONT_LIST = ' + JSON.stringify(fontList()) + ';\n');
});

// ---------------------------------------------------------------
// 画面
// ---------------------------------------------------------------
app.get('/', (req, res) => res.redirect('/admin'));
const sendPage = (file) => (req, res) => {
  noStore(res);
  res.sendFile(path.join(__dirname, 'public', file));
};
app.get('/admin', sendPage('admin.html'));
app.get('/summary', sendPage('summary.html'));
app.get('/overlay', sendPage('overlay.html'));
app.get('/ticker', sendPage('ticker.html'));
app.get('/queue', sendPage('queue.html'));

// ---------------------------------------------------------------
// WebSocket（画面どうしの即時同期）
// ---------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// わんコメ（OneComme）との接続。状態が動いたら画面に流す
const onecomme = new OneCommeClient(function () { broadcast(); });

// 「参加希望」「辞退」のコメントで、参加待ちリストを自動で出し入れする
onecomme.onComment = function (person) {
  const result = store.handleComment(person);
  if (!result) return false;
  if (result.action === 'join') {
    console.log('[参加受付] ' + result.entry.name + ' さんが参加希望');
    attachIcon(result.entry, person.profileImage);
  } else {
    console.log('[参加受付] ' + result.entry.name + ' さんが辞退');
  }
  store.save();
  return true; // 画面を更新する
};
onecomme.configure(store.data.settings.onecomme);

function snapshot() {
  return Object.assign(store.snapshot(), {
    appVersion: APP_VERSION,
    stamps: listStamps(),
    images: listImages(),
    onecomme: onecomme.status(),
    commenters: onecomme.commenters()
  });
}

/**
 * リスナーのアイコンを自分のPCに保存して、記録に貼り直す。
 * ダウンロードに時間がかかるので、記録の保存を待たせずに後から差し替える。
 */
function attachIcon(record, sourceUrl) {
  if (!record || !sourceUrl) return;
  cacheIcon(sourceUrl).then(function (localPath) {
    if (!localPath) return;
    record.icon = localPath;
    store.save();
    broadcast();
  });
}

function broadcast() {
  const message = JSON.stringify({ type: 'state', payload: snapshot() });
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) client.send(message);
  }
}

wss.on('connection', (socket) => {
  // 接続直後に現在の状態を1回送る（リロード直後でも正しい表示になる）
  socket.send(JSON.stringify({ type: 'state', payload: snapshot() }));
  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });
  socket.on('error', () => { /* 切断時のエラーは無視してよい */ });
});

// 切れた接続を掃除する（OBSを閉じた時など）
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) { socket.terminate(); continue; }
    socket.isAlive = false;
    try { socket.ping(); } catch (err) { socket.terminate(); }
  }
}, 30000);

/** 変更を保存して、全画面へ配信する */
function commit(res, body, status) {
  store.save();
  broadcast();
  res.status(status || 200).json(Object.assign({ ok: true, state: snapshot() }, body || {}));
}

const badRequest = (res, message) => res.status(400).json({ ok: false, error: message });
const notFound = (res, message) => res.status(404).json({ ok: false, error: message });

// ---------------------------------------------------------------
// API
// ---------------------------------------------------------------

// 現在の状態
app.get('/api/state', (req, res) => {
  res.json({ ok: true, state: snapshot() });
});

// stamps/ フォルダを読み直す（画像を追加したあとに押す用）
app.post('/api/stamps/reload', (req, res) => {
  const stamps = listStamps(true);
  broadcast();
  res.json({ ok: true, stamps, state: snapshot() });
});

// images/ フォルダを読み直す
app.post('/api/images/reload', (req, res) => {
  const images = listImages(true);
  broadcast();
  res.json({ ok: true, images, state: snapshot() });
});

// 配信タイトルや自分の使用デッキ
app.put('/api/settings', (req, res) => {
  const settings = store.updateSettings(req.body || {});
  onecomme.configure(settings.onecomme);
  commit(res, { settings });
});

// わんコメに繋ぎ直す
app.post('/api/onecomme/reconnect', (req, res) => {
  onecomme.restart();
  commit(res, { onecomme: onecomme.status() });
});

// 取り込んだコメント者の一覧を消す
app.post('/api/onecomme/clear', (req, res) => {
  onecomme.clear();
  commit(res, { onecomme: onecomme.status() });
});

// 対戦開始（OBSオーバーレイに出す）
app.post('/api/match/start', (req, res) => {
  const current = store.startMatch(req.body || {});
  if (!current) return badRequest(res, 'リスナー名を入力してください。');
  attachIcon(current, req.body.icon);
  commit(res, { current }, 201);
});

// 対戦中の内容を直す
app.put('/api/match', (req, res) => {
  if (!store.data.current) return badRequest(res, '現在の対戦がありません。');
  const current = store.updateCurrent(req.body || {});
  if (!current) return badRequest(res, 'リスナー名を空にはできません。');
  commit(res, { current });
});

// 対戦終了（勝ち / 負け / 感想を履歴に保存）
app.post('/api/match/finish', (req, res) => {
  if (!store.data.current) return badRequest(res, '現在の対戦がありません。');
  const result = req.body.result;
  if (result !== 'win' && result !== 'lose') return badRequest(res, '勝ち / 負け を選んでください。');
  const record = store.finishMatch(result, req.body.comment, req.body.stamps);
  commit(res, { record });
});

// 対戦を記録せず取り消す
app.post('/api/match/cancel', (req, res) => {
  const cancelled = store.cancelMatch();
  if (!cancelled) return badRequest(res, '現在の対戦がありません。');
  commit(res, { cancelled });
});

// 終わった対戦をそのまま履歴に追加する
app.post('/api/history', (req, res) => {
  const body = req.body || {};
  if (body.result !== 'win' && body.result !== 'lose') return badRequest(res, '勝ち / 負け を選んでください。');
  const record = store.addHistory(body);
  if (!record) return badRequest(res, 'リスナー名を入力してください。');
  attachIcon(record, body.icon);
  commit(res, { record }, 201);
});

// 履歴の編集
app.put('/api/history/:id', (req, res) => {
  const record = store.updateHistory(req.params.id, req.body || {});
  if (!record) return notFound(res, '履歴が見つかりません。');
  commit(res, { record });
});

// 履歴の削除
app.delete('/api/history/:id', (req, res) => {
  const removed = store.removeHistory(req.params.id);
  if (!removed) return notFound(res, '履歴が見つかりません。');
  commit(res, { removed });
});

// 本日の履歴をリセット
app.post('/api/history/clear-today', (req, res) => {
  const removed = store.clearToday();
  commit(res, { removed });
});

// ---------- 参加待ちリスト ----------

// 手で追加する
app.post('/api/queue', (req, res) => {
  const body = req.body || {};
  const { entry, added } = store.queueAdd({ name: body.name, source: 'manual' });
  if (!entry) return badRequest(res, 'リスナー名を入力してください。');
  if (!added) return badRequest(res, entry.name + ' さんは、もうリストに入っています。');
  commit(res, { entry }, 201);
});

// リストから外す
app.delete('/api/queue/:id', (req, res) => {
  const entry = store.queueTake({ id: req.params.id });
  if (!entry) return notFound(res, 'リストに見つかりません。');
  commit(res, { removed: entry });
});

// リストを空にする
app.post('/api/queue/clear', (req, res) => {
  const removed = store.queueClear();
  commit(res, { removed });
});

// 無作為に選ぶ（mode: fill … 足りない人数だけ / all … 選び直す）
app.post('/api/queue/shuffle', (req, res) => {
  const body = req.body || {};
  if (!store.data.queue.length) return badRequest(res, '参加待ちの人がいません。');
  const picked = store.queueShuffle(Number(body.count), body.mode === 'all' ? 'all' : 'fill');
  commit(res, { picked });
});

// 選ばれた状態をやめる（リストには残す）
app.post('/api/queue/:id/unpick', (req, res) => {
  const entry = store.queueUnpick(req.params.id);
  if (!entry) return notFound(res, 'リストに見つかりません。');
  commit(res, { entry });
});

// リストの人と対戦を始める
app.post('/api/queue/:id/start', (req, res) => {
  const entry = store.data.queue.find((e) => e.id === req.params.id);
  if (!entry) return notFound(res, 'リストに見つかりません。');
  if (store.data.current) return badRequest(res, '対戦中です。いまの対戦を終えるか取り消してから始めてください。');
  const current = store.startMatch({ name: entry.name, icon: entry.icon, listenerId: entry.listenerId, queueId: entry.id });
  commit(res, { current }, 201);
});

/*
  アプリを終了する。黒い画面を出さずに起動した場合、
  記録画面の「アプリを終了」ボタンからここを呼んで止める。
  よそのページから勝手に止められないよう、同じPCの画面からの操作だけ受け付ける。
*/
app.post('/api/quit', (req, res) => {
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return res.status(403).json({ ok: false, error: 'この操作はこのPCの画面からのみ行えます。' });
  }
  res.json({ ok: true });
  // 返事を送り切ってから落とす
  setTimeout(shutdown, 150);
});

app.use((err, req, res, next) => {
  console.error('[server] エラー:', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, error: 'サーバー内部エラーが発生しました。' });
});

// ---------------------------------------------------------------
// 起動
// ---------------------------------------------------------------
const PID_FILE = path.join(path.dirname(DATA_FILE), 'app.pid');

// 動いているプロセス番号を残しておく。「終了」が効かないときの保険に使う。
function writePidFile() {
  try {
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
  } catch (err) {
    console.error('[server] app.pid を書けませんでした:', err.message);
  }
}

function removePidFile() {
  try { fs.unlinkSync(PID_FILE); } catch (err) { /* すでに無ければ何もしない */ }
}

server.listen(PORT, HOST, () => {
  writePidFile();
  console.log('');
  console.log('==============================================');
  console.log(' デュエル・マスターズ プレイス 配信ツール 起動');
  console.log(`              バージョン ${APP_VERSION}`);
  console.log('==============================================');
  console.log(`  対戦記録画面 : http://localhost:${PORT}/admin`);
  console.log(`  まとめ画像   : http://localhost:${PORT}/summary`);
  console.log(`  OBS表示画面  : http://localhost:${PORT}/overlay`);
  console.log(`  実況テロップ : http://localhost:${PORT}/ticker`);
  console.log(`  保存ファイル : ${DATA_FILE}`);
  console.log(`  スタンプ置場 : ${STAMP_DIR}`);
  console.log(`  画像置場     : ${IMAGE_DIR}`);
  if (store.data.settings.onecomme.enabled) {
    console.log(`  わんコメ連携 : ${store.data.settings.onecomme.url}`);
  }
  console.log('');
  console.log('  終了するには この画面で Ctrl + C を押すか、');
  console.log('  記録画面の右上「アプリを終了」を押してください。');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[エラー] ポート ${PORT} はすでに使われています。`);
    console.error('別のアプリを閉じるか、環境変数 PORT を変えて起動してください。');
    console.error('例) Windows PowerShell:  $env:PORT=3001; npm start\n');
  } else {
    console.error('[エラー]', err.message);
  }
  process.exit(1);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n終了します。データを保存しています…');
  removePidFile();
  clearInterval(heartbeat);
  onecomme.stop();
  try { store.saveSync(); } catch (err) { console.error('保存に失敗しました:', err.message); }
  for (const socket of wss.clients) socket.terminate();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
