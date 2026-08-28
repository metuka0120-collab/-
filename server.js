'use strict';

/**
 * デュエル・マスターズ プレイス 視聴者参加型配信ツール
 *
 *   管理画面      : http://localhost:3000/admin
 *   OBS表示画面   : http://localhost:3000/overlay
 *
 * ローカルPCだけで完結する。外部サービスへの通信は一切しない。
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Store, DATA_FILE } = require('./lib/store');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const store = new Store();
store.load();

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---------------------------------------------------------------
// 画面
// ---------------------------------------------------------------
app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/overlay', (req, res) => res.sendFile(path.join(__dirname, 'public', 'overlay.html')));

// ---------------------------------------------------------------
// WebSocket（管理画面 → OBS表示の即時反映）
// ---------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast() {
  const message = JSON.stringify({ type: 'state', payload: store.snapshot() });
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(message);
    }
  }
}

wss.on('connection', (socket) => {
  // 接続直後に現在の状態を1回送る（リロード直後でも正しい表示になる）
  socket.send(JSON.stringify({ type: 'state', payload: store.snapshot() }));

  socket.isAlive = true;
  socket.on('pong', () => {
    socket.isAlive = true;
  });
  socket.on('error', () => {
    /* 切断時のエラーは無視してよい */
  });
});

// 切れた接続を掃除する（OBSを閉じた時など）
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    try {
      socket.ping();
    } catch (err) {
      socket.terminate();
    }
  }
}, 30000);

/** 変更を保存して、全画面へ配信する */
function commit(res, body, status) {
  store.save();
  broadcast();
  res.status(status || 200).json(Object.assign({ ok: true, state: store.snapshot() }, body || {}));
}

function badRequest(res, message) {
  res.status(400).json({ ok: false, error: message });
}

function notFound(res, message) {
  res.status(404).json({ ok: false, error: message });
}

// ---------------------------------------------------------------
// API
// ---------------------------------------------------------------

// 現在の状態
app.get('/api/state', (req, res) => {
  res.json({ ok: true, state: store.snapshot() });
});

// 参加者を待機列に追加
app.post('/api/participants', (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const deck = typeof req.body.deck === 'string' ? req.body.deck.trim() : '';
  if (!name) return badRequest(res, 'リスナー名を入力してください。');
  const participant = store.addParticipant(name, deck);
  commit(res, { participant }, 201);
});

// 参加者を編集（待機列 / 現在の対戦者）
app.put('/api/participants/:id', (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : null;
  const deck = typeof req.body.deck === 'string' ? req.body.deck.trim() : null;
  if (name !== null && !name) return badRequest(res, 'リスナー名を空にはできません。');
  const participant = store.updateParticipant(req.params.id, name, deck);
  if (!participant) return notFound(res, '参加者が見つかりません。');
  commit(res, { participant });
});

// 参加者を削除
app.delete('/api/participants/:id', (req, res) => {
  const removed = store.removeParticipant(req.params.id);
  if (!removed) return notFound(res, '参加者が見つかりません。');
  commit(res, { removed });
});

// 待機列の並び替え
app.post('/api/participants/:id/move', (req, res) => {
  const direction = req.body.direction === 'down' ? 1 : -1;
  const participant = store.moveParticipant(req.params.id, direction);
  if (!participant) return notFound(res, '参加者が見つかりません。');
  commit(res, { participant });
});

// 対戦開始
app.post('/api/participants/:id/start', (req, res) => {
  const current = store.startMatch(req.params.id);
  if (!current) return notFound(res, '参加者が見つかりません。');
  commit(res, { current });
});

// 対戦終了（勝ち / 負け / 感想を保存して履歴へ）
app.post('/api/current/finish', (req, res) => {
  if (!store.data.current) return badRequest(res, '現在の対戦がありません。');
  const result = req.body.result;
  if (result !== 'win' && result !== 'lose') {
    return badRequest(res, '勝ち / 負け を選んでください。');
  }
  const comment = typeof req.body.comment === 'string' ? req.body.comment : '';
  const record = store.finishMatch(result, comment);
  commit(res, { record });
});

// 対戦を記録せず中止（待機列の先頭に戻す）
app.post('/api/current/cancel', (req, res) => {
  const cancelled = store.cancelMatch();
  if (!cancelled) return badRequest(res, '現在の対戦がありません。');
  commit(res, { cancelled });
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
  console.log(`  管理画面    : http://localhost:${PORT}/admin`);
  console.log(`  OBS表示画面 : http://localhost:${PORT}/overlay`);
  console.log(`  保存ファイル: ${DATA_FILE}`);
  console.log('');
  console.log('  終了するには この画面で Ctrl + C を押してください。');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[エラー] ポート ${PORT} はすでに使われています。`);
    console.error('別のアプリを閉じるか、環境変数 PORT を変えて起動してください。');
    console.error(`例) Windows PowerShell:  $env:PORT=3001; npm start\n`);
  } else {
    console.error('[エラー]', err.message);
  }
  process.exit(1);
});

function shutdown() {
  console.log('\n終了します。データを保存しています…');
  clearInterval(heartbeat);
  try {
    store.saveSync();
  } catch (err) {
    console.error('保存に失敗しました:', err.message);
  }
  for (const socket of wss.clients) socket.terminate();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
