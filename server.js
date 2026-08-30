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

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Store, DATA_FILE } = require('./lib/store');
const { listStamps, STAMP_DIR } = require('./lib/stamps');
const { OneCommeClient } = require('./lib/onecomme');
const { cacheIcon, ICON_DIR } = require('./lib/icons');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const store = new Store();
store.load();

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
// stamps/ に置いた画像をそのまま配る
app.use('/stamps', express.static(STAMP_DIR, { index: false, dotfiles: 'ignore' }));
// わんコメから取り込んで保存したアイコンを配る
app.use('/icons', express.static(ICON_DIR, { index: false, dotfiles: 'ignore' }));

// ---------------------------------------------------------------
// 画面
// ---------------------------------------------------------------
app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/summary', (req, res) => res.sendFile(path.join(__dirname, 'public', 'summary.html')));
app.get('/overlay', (req, res) => res.sendFile(path.join(__dirname, 'public', 'overlay.html')));

// ---------------------------------------------------------------
// WebSocket（画面どうしの即時同期）
// ---------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// わんコメ（OneComme）との接続。状態が動いたら画面に流す
const onecomme = new OneCommeClient(function () { broadcast(); });
onecomme.configure(store.data.settings.onecomme);

function snapshot() {
  return Object.assign(store.snapshot(), {
    stamps: listStamps(),
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

app.use((err, req, res, next) => {
  console.error('[server] エラー:', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, error: 'サーバー内部エラーが発生しました。' });
});

// ---------------------------------------------------------------
// 起動
// ---------------------------------------------------------------
server.listen(PORT, HOST, () => {
  console.log('');
  console.log('==============================================');
  console.log(' デュエル・マスターズ プレイス 配信ツール 起動');
  console.log('==============================================');
  console.log(`  対戦記録画面 : http://localhost:${PORT}/admin`);
  console.log(`  まとめ画像   : http://localhost:${PORT}/summary`);
  console.log(`  OBS表示画面  : http://localhost:${PORT}/overlay`);
  console.log(`  保存ファイル : ${DATA_FILE}`);
  console.log(`  スタンプ置場 : ${STAMP_DIR}`);
  if (store.data.settings.onecomme.enabled) {
    console.log(`  わんコメ連携 : ${store.data.settings.onecomme.url}`);
  }
  console.log('');
  console.log('  終了するには この画面で Ctrl + C を押してください。');
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

function shutdown() {
  console.log('\n終了します。データを保存しています…');
  clearInterval(heartbeat);
  onecomme.stop();
  try { store.saveSync(); } catch (err) { console.error('保存に失敗しました:', err.message); }
  for (const socket of wss.clients) socket.terminate();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
