'use strict';

/* =========================================================
   管理画面のフロントエンド
   - 状態はサーバーが持つ。この画面は WebSocket で受け取って描画するだけ。
   - 操作は fetch で API を呼び、結果は WebSocket 経由で全画面に反映される。
   ========================================================= */

/** 画面ローカルのUI状態（入力途中の内容が再描画で消えないように保持する） */
const ui = {
  editParticipantId: null, // 待機列で編集中の参加者
  editHistoryId: null,     // 編集中の履歴
  currentId: null,         // 対戦中の参加者ID（変わったら入力欄をリセットする）
  result: null,            // 'win' | 'lose'
  comment: '',             // 感想の入力途中の内容
  historyTodayOnly: true
};

let state = { queue: [], current: null, history: [], stats: { wins: 0, losses: 0, total: 0, winRate: 0, date: '' } };

// ---------------------------------------------------------
// DOM
// ---------------------------------------------------------
const el = {
  conn: document.getElementById('conn'),
  addForm: document.getElementById('add-form'),
  addName: document.getElementById('add-name'),
  addDeck: document.getElementById('add-deck'),
  addError: document.getElementById('add-error'),
  currentArea: document.getElementById('current-area'),
  queueList: document.getElementById('queue-list'),
  queueCount: document.getElementById('queue-count'),
  historyList: document.getElementById('history-list'),
  historyCount: document.getElementById('history-count'),
  historyTodayOnly: document.getElementById('history-today-only'),
  clearToday: document.getElementById('clear-today'),
  statWin: document.getElementById('stat-win'),
  statLose: document.getElementById('stat-lose'),
  statTotal: document.getElementById('stat-total'),
  statRate: document.getElementById('stat-rate'),
  statDate: document.getElementById('stat-date')
};

// ---------------------------------------------------------
// 通信
// ---------------------------------------------------------

/** APIを呼ぶ。失敗したらアラートで知らせる */
async function api(method, url, body) {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `通信に失敗しました (${res.status})`);
    }
    if (data.state) applyState(data.state);
    return data;
  } catch (err) {
    window.alert(err.message || '通信に失敗しました。サーバーが起動しているか確認してください。');
    throw err;
  }
}

let socket = null;
let reconnectDelay = 500;

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}/ws`);

  socket.addEventListener('open', () => {
    reconnectDelay = 500;
    setConnected(true);
  });

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (err) {
      return;
    }
    if (message.type === 'state') applyState(message.payload);
  });

  socket.addEventListener('close', () => {
    setConnected(false);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 5000);
  });

  socket.addEventListener('error', () => socket.close());
}

function setConnected(connected) {
  el.conn.textContent = connected ? '● 同期中' : '× 未接続（再接続します）';
  el.conn.className = 'conn ' + (connected ? 'conn-on' : 'conn-off');
}

function applyState(next) {
  state = next;
  // 対戦者が変わったら、入力途中の勝敗・感想はリセットする
  const currentId = state.current ? state.current.id : null;
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

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatDate(key) {
  if (!key) return '';
  const [y, m, d] = key.split('-');
  return `${Number(y)}年${Number(m)}月${Number(d)}日`;
}

function render() {
  renderCurrent();
  renderQueue();
  renderStats();
  renderHistory();
}

// --- 現在の対戦者 ---
function renderCurrent() {
  const current = state.current;

  if (!current) {
    el.currentArea.innerHTML =
      '<div class="current-empty">対戦中の参加者はいません。<br>待機列から「対戦開始」を押してください。</div>';
    return;
  }

  el.currentArea.innerHTML = `
    <div class="current-box">
      <div class="current-no">本日 ${current.matchNumber} 戦目 ／ 開始 ${formatTime(current.startedAt)}</div>
      <div class="current-name">${escapeHtml(current.name)}</div>
      <div class="current-deck">${current.deck ? escapeHtml(current.deck) : 'デッキ未登録'}</div>
    </div>

    <div class="finish-box">
      <div class="result-buttons">
        <button type="button" class="btn btn-win ${ui.result === 'win' ? 'selected' : ''}" data-result="win">勝ち</button>
        <button type="button" class="btn btn-lose ${ui.result === 'lose' ? 'selected' : ''}" data-result="lose">負け</button>
      </div>
      <label>
        <span>試合の感想</span>
        <textarea id="finish-comment" placeholder="例）最後のドローが完璧だった">${escapeHtml(ui.comment)}</textarea>
      </label>
      <div class="finish-actions">
        <button type="button" class="btn btn-primary" id="finish-save">対戦終了して履歴に保存</button>
        <button type="button" class="btn btn-ghost" id="finish-cancel">待機列に戻す</button>
      </div>
    </div>
  `;

  el.currentArea.querySelectorAll('[data-result]').forEach((button) => {
    button.addEventListener('click', () => {
      ui.result = button.dataset.result;
      renderCurrent();
    });
  });

  const comment = document.getElementById('finish-comment');
  comment.addEventListener('input', () => {
    ui.comment = comment.value;
  });

  document.getElementById('finish-save').addEventListener('click', async () => {
    if (!ui.result) {
      window.alert('「勝ち」か「負け」を選んでください。');
      return;
    }
    await api('POST', '/api/current/finish', { result: ui.result, comment: ui.comment });
  });

  document.getElementById('finish-cancel').addEventListener('click', async () => {
    if (!window.confirm('この対戦を記録せずに待機列へ戻しますか？')) return;
    await api('POST', '/api/current/cancel');
  });
}

// --- 待機列 ---
function renderQueue() {
  el.queueCount.textContent = state.queue.length;

  if (state.queue.length === 0) {
    el.queueList.innerHTML = '<li class="empty">待機中の参加者はいません。</li>';
    return;
  }

  el.queueList.innerHTML = state.queue
    .map((participant, index) =>
      participant.id === ui.editParticipantId
        ? queueEditRow(participant)
        : queueRow(participant, index)
    )
    .join('');

  bindQueueEvents();
}

function queueRow(participant, index) {
  return `
    <li class="row" data-id="${participant.id}">
      <span class="row-order">${index + 1}</span>
      <div class="row-main">
        <div class="row-name">${escapeHtml(participant.name)}</div>
        <div class="row-deck">${participant.deck ? escapeHtml(participant.deck) : 'デッキ未登録'}</div>
      </div>
      <div class="row-actions">
        <button type="button" class="btn btn-primary btn-small" data-action="start">対戦開始</button>
        <button type="button" class="btn btn-ghost btn-small" data-action="up" title="上へ">▲</button>
        <button type="button" class="btn btn-ghost btn-small" data-action="down" title="下へ">▼</button>
        <button type="button" class="btn btn-ghost btn-small" data-action="edit">編集</button>
        <button type="button" class="btn btn-danger btn-small" data-action="delete">削除</button>
      </div>
    </li>
  `;
}

function queueEditRow(participant) {
  return `
    <li class="row" data-id="${participant.id}">
      <form class="edit-form" data-action="save-edit">
        <div class="edit-fields">
          <label>
            <span>リスナー名</span>
            <input type="text" name="name" value="${escapeHtml(participant.name)}" maxlength="40" required>
          </label>
          <label>
            <span>使用デッキ名</span>
            <input type="text" name="deck" value="${escapeHtml(participant.deck)}" maxlength="40">
          </label>
        </div>
        <div class="edit-actions">
          <button type="button" class="btn btn-ghost btn-small" data-action="cancel-edit">キャンセル</button>
          <button type="submit" class="btn btn-primary btn-small">保存</button>
        </div>
      </form>
    </li>
  `;
}

function bindQueueEvents() {
  el.queueList.querySelectorAll('li.row').forEach((row) => {
    const id = row.dataset.id;

    row.querySelectorAll('button[data-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.dataset.action;
        if (action === 'start') {
          await api('POST', `/api/participants/${id}/start`);
        } else if (action === 'up' || action === 'down') {
          await api('POST', `/api/participants/${id}/move`, { direction: action === 'up' ? 'up' : 'down' });
        } else if (action === 'edit') {
          ui.editParticipantId = id;
          renderQueue();
        } else if (action === 'cancel-edit') {
          ui.editParticipantId = null;
          renderQueue();
        } else if (action === 'delete') {
          const participant = state.queue.find((p) => p.id === id);
          const label = participant ? participant.name : 'この参加者';
          if (!window.confirm(`「${label}」を待機列から削除しますか？`)) return;
          await api('DELETE', `/api/participants/${id}`);
        }
      });
    });

    const form = row.querySelector('form[data-action="save-edit"]');
    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = form.elements.name.value.trim();
        const deck = form.elements.deck.value.trim();
        if (!name) {
          window.alert('リスナー名を入力してください。');
          return;
        }
        ui.editParticipantId = null;
        await api('PUT', `/api/participants/${id}`, { name, deck });
      });
    }
  });
}

// --- 本日の成績 ---
function renderStats() {
  const stats = state.stats || { wins: 0, losses: 0, total: 0, winRate: 0, date: '' };
  el.statWin.textContent = stats.wins;
  el.statLose.textContent = stats.losses;
  el.statTotal.textContent = stats.total;
  el.statRate.textContent = `${stats.winRate}%`;
  el.statDate.textContent = `集計日：${formatDate(stats.date)}（日付が変わると自動でリセットされます）`;
}

// --- 履歴 ---
function renderHistory() {
  const today = state.stats ? state.stats.date : '';
  const records = ui.historyTodayOnly
    ? state.history.filter((record) => record.date === today)
    : state.history;

  el.historyCount.textContent = records.length;

  if (records.length === 0) {
    el.historyList.innerHTML = '<li class="empty">まだ対戦履歴はありません。</li>';
    return;
  }

  el.historyList.innerHTML = records
    .map((record) => (record.id === ui.editHistoryId ? historyEditRow(record) : historyRow(record)))
    .join('');

  bindHistoryEvents();
}

function historyRow(record) {
  const badge = record.result === 'win'
    ? '<span class="badge badge-win">勝ち</span>'
    : '<span class="badge badge-lose">負け</span>';

  return `
    <li class="row" data-id="${record.id}">
      <span class="row-order">${record.matchNumber || '-'}</span>
      ${badge}
      <div class="row-main">
        <div class="row-name">${escapeHtml(record.name)}</div>
        <div class="row-deck">${record.deck ? escapeHtml(record.deck) : 'デッキ未登録'}</div>
        ${record.comment ? `<div class="row-comment">💬 ${escapeHtml(record.comment)}</div>` : ''}
      </div>
      <span class="row-time">${formatTime(record.finishedAt)}</span>
      <div class="row-actions">
        <button type="button" class="btn btn-ghost btn-small" data-action="edit">編集</button>
        <button type="button" class="btn btn-danger btn-small" data-action="delete">削除</button>
      </div>
    </li>
  `;
}

function historyEditRow(record) {
  return `
    <li class="row" data-id="${record.id}">
      <form class="edit-form" data-action="save-edit">
        <div class="edit-fields">
          <label>
            <span>リスナー名</span>
            <input type="text" name="name" value="${escapeHtml(record.name)}" maxlength="40" required>
          </label>
          <label>
            <span>使用デッキ名</span>
            <input type="text" name="deck" value="${escapeHtml(record.deck)}" maxlength="40">
          </label>
        </div>
        <label>
          <span>勝敗</span>
          <select name="result">
            <option value="win" ${record.result === 'win' ? 'selected' : ''}>勝ち</option>
            <option value="lose" ${record.result === 'lose' ? 'selected' : ''}>負け</option>
          </select>
        </label>
        <label>
          <span>試合の感想</span>
          <textarea name="comment">${escapeHtml(record.comment)}</textarea>
        </label>
        <div class="edit-actions">
          <button type="button" class="btn btn-ghost btn-small" data-action="cancel-edit">キャンセル</button>
          <button type="submit" class="btn btn-primary btn-small">保存</button>
        </div>
      </form>
    </li>
  `;
}

function bindHistoryEvents() {
  el.historyList.querySelectorAll('li.row').forEach((row) => {
    const id = row.dataset.id;

    row.querySelectorAll('button[data-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.dataset.action;
        if (action === 'edit') {
          ui.editHistoryId = id;
          renderHistory();
        } else if (action === 'cancel-edit') {
          ui.editHistoryId = null;
          renderHistory();
        } else if (action === 'delete') {
          if (!window.confirm('この履歴を削除しますか？本日の成績も再集計されます。')) return;
          await api('DELETE', `/api/history/${id}`);
        }
      });
    });

    const form = row.querySelector('form[data-action="save-edit"]');
    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = form.elements.name.value.trim();
        if (!name) {
          window.alert('リスナー名を入力してください。');
          return;
        }
        const payload = {
          name,
          deck: form.elements.deck.value.trim(),
          result: form.elements.result.value,
          comment: form.elements.comment.value
        };
        ui.editHistoryId = null;
        await api('PUT', `/api/history/${id}`, payload);
      });
    }
  });
}

// ---------------------------------------------------------
// 画面固定の操作
// ---------------------------------------------------------
el.addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = el.addName.value.trim();
  const deck = el.addDeck.value.trim();

  if (!name) {
    el.addError.textContent = 'リスナー名を入力してください。';
    el.addError.hidden = false;
    return;
  }
  el.addError.hidden = true;

  await api('POST', '/api/participants', { name, deck });
  el.addName.value = '';
  el.addDeck.value = '';
  el.addName.focus();
});

el.historyTodayOnly.addEventListener('change', () => {
  ui.historyTodayOnly = el.historyTodayOnly.checked;
  renderHistory();
});

el.clearToday.addEventListener('click', async () => {
  if (!window.confirm('本日の対戦履歴をすべて削除します。よろしいですか？（元に戻せません）')) return;
  await api('POST', '/api/history/clear-today');
});

// ---------------------------------------------------------
// 起動
// ---------------------------------------------------------
ui.historyTodayOnly = el.historyTodayOnly.checked;
render();
connect();
