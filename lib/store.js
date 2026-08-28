'use strict';

/**
 * JSONファイルによるデータ保存レイヤー。
 * SQLiteは使わず、data/data.json に読み書きする。
 * 書き込みは「一時ファイル → rename」で行い、書き込み途中の電源断でも
 * ファイルが壊れにくいようにしている。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const TMP_FILE = path.join(DATA_DIR, 'data.json.tmp');
const BAK_FILE = path.join(DATA_DIR, 'data.json.bak');

/** 空の初期データ */
function emptyData() {
  return {
    version: 1,
    queue: [],    // 参加待機列
    current: null, // 現在の対戦者
    history: []   // 終了した対戦
  };
}

/** ローカル時間の YYYY-MM-DD を返す（配信は日本時間ベースなのでUTCは使わない） */
function todayKey(d) {
  const date = d ? new Date(d) : new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

/** 読み込んだJSONが壊れていても落ちないように整える */
function normalize(raw) {
  const base = emptyData();
  if (!raw || typeof raw !== 'object') return base;

  base.queue = Array.isArray(raw.queue)
    ? raw.queue.filter(Boolean).map((p) => ({
        id: String(p.id || newId()),
        name: String(p.name == null ? '' : p.name),
        deck: String(p.deck == null ? '' : p.deck),
        createdAt: p.createdAt || new Date().toISOString()
      }))
    : [];

  if (raw.current && typeof raw.current === 'object') {
    base.current = {
      id: String(raw.current.id || newId()),
      name: String(raw.current.name == null ? '' : raw.current.name),
      deck: String(raw.current.deck == null ? '' : raw.current.deck),
      createdAt: raw.current.createdAt || new Date().toISOString(),
      startedAt: raw.current.startedAt || new Date().toISOString(),
      matchNumber: Number(raw.current.matchNumber) || 1
    };
  }

  base.history = Array.isArray(raw.history)
    ? raw.history.filter(Boolean).map((h) => ({
        id: String(h.id || newId()),
        participantId: h.participantId ? String(h.participantId) : null,
        name: String(h.name == null ? '' : h.name),
        deck: String(h.deck == null ? '' : h.deck),
        result: h.result === 'win' || h.result === 'lose' ? h.result : 'win',
        comment: String(h.comment == null ? '' : h.comment),
        matchNumber: Number(h.matchNumber) || 0,
        date: h.date || todayKey(h.finishedAt || Date.now()),
        startedAt: h.startedAt || null,
        finishedAt: h.finishedAt || new Date().toISOString()
      }))
    : [];

  return base;
}

class Store {
  constructor() {
    this.data = emptyData();
    this._writing = false;
    this._pending = false;
  }

  /** 起動時に1度だけ呼ぶ */
  load() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    if (!fs.existsSync(DATA_FILE)) {
      this.data = emptyData();
      this.saveSync();
      return this.data;
    }

    try {
      const text = fs.readFileSync(DATA_FILE, 'utf8');
      this.data = normalize(JSON.parse(text));
    } catch (err) {
      // 壊れていたらバックアップを取ってから作り直す（データを黙って消さない）
      console.error('[store] data.json を読み込めませんでした:', err.message);
      try {
        fs.copyFileSync(DATA_FILE, BAK_FILE);
        console.error(`[store] 壊れたファイルを ${BAK_FILE} に退避しました。`);
      } catch (copyErr) {
        console.error('[store] バックアップ作成に失敗:', copyErr.message);
      }
      this.data = emptyData();
      this.saveSync();
    }
    return this.data;
  }

  saveSync() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const text = JSON.stringify(this.data, null, 2);
    fs.writeFileSync(TMP_FILE, text, 'utf8');
    fs.renameSync(TMP_FILE, DATA_FILE);
  }

  /** 非同期保存。保存中に来た変更はまとめて1回にする */
  async save() {
    if (this._writing) {
      this._pending = true;
      return;
    }
    this._writing = true;
    try {
      const text = JSON.stringify(this.data, null, 2);
      await fs.promises.mkdir(DATA_DIR, { recursive: true });
      await fs.promises.writeFile(TMP_FILE, text, 'utf8');
      await fs.promises.rename(TMP_FILE, DATA_FILE);
    } catch (err) {
      console.error('[store] 保存に失敗しました:', err.message);
    } finally {
      this._writing = false;
      if (this._pending) {
        this._pending = false;
        await this.save();
      }
    }
  }

  // ---------- 集計 ----------

  /** 本日の成績を集計する */
  todayStats() {
    const key = todayKey();
    const todays = this.data.history.filter((h) => h.date === key);
    const wins = todays.filter((h) => h.result === 'win').length;
    const losses = todays.filter((h) => h.result === 'lose').length;
    const total = wins + losses;
    const winRate = total === 0 ? 0 : Math.round((wins / total) * 1000) / 10;
    return { date: key, wins, losses, total, winRate };
  }

  /** 現在の対戦が本日何戦目かを決める（本日の確定分 + 1） */
  nextMatchNumber() {
    return this.todayStats().total + 1;
  }

  /** 画面に配る状態（管理画面・オーバーレイ共通） */
  snapshot() {
    return {
      queue: this.data.queue,
      current: this.data.current,
      history: [...this.data.history].sort((a, b) =>
        String(b.finishedAt).localeCompare(String(a.finishedAt))
      ),
      stats: this.todayStats(),
      serverTime: new Date().toISOString()
    };
  }

  // ---------- 参加者操作 ----------

  addParticipant(name, deck) {
    const participant = {
      id: newId(),
      name: String(name).trim(),
      deck: String(deck == null ? '' : deck).trim(),
      createdAt: new Date().toISOString()
    };
    this.data.queue.push(participant);
    return participant;
  }

  updateParticipant(id, name, deck) {
    const participant = this.data.queue.find((p) => p.id === id);
    if (participant) {
      if (name != null) participant.name = String(name).trim();
      if (deck != null) participant.deck = String(deck).trim();
      return participant;
    }
    // 現在の対戦者も編集できるようにする
    if (this.data.current && this.data.current.id === id) {
      if (name != null) this.data.current.name = String(name).trim();
      if (deck != null) this.data.current.deck = String(deck).trim();
      return this.data.current;
    }
    return null;
  }

  removeParticipant(id) {
    const index = this.data.queue.findIndex((p) => p.id === id);
    if (index === -1) return null;
    return this.data.queue.splice(index, 1)[0];
  }

  /** 待機列の並び替え（-1で上へ、+1で下へ） */
  moveParticipant(id, offset) {
    const index = this.data.queue.findIndex((p) => p.id === id);
    if (index === -1) return null;
    const target = Math.min(this.data.queue.length - 1, Math.max(0, index + offset));
    if (target === index) return this.data.queue[index];
    const [participant] = this.data.queue.splice(index, 1);
    this.data.queue.splice(target, 0, participant);
    return participant;
  }

  // ---------- 対戦操作 ----------

  /** 対戦開始。すでに対戦中なら、その人を待機列の先頭に戻す */
  startMatch(id) {
    const index = this.data.queue.findIndex((p) => p.id === id);
    if (index === -1) return null;
    const [participant] = this.data.queue.splice(index, 1);

    if (this.data.current) {
      const previous = this.data.current;
      this.data.queue.unshift({
        id: previous.id,
        name: previous.name,
        deck: previous.deck,
        createdAt: previous.createdAt || new Date().toISOString()
      });
    }

    this.data.current = {
      id: participant.id,
      name: participant.name,
      deck: participant.deck,
      createdAt: participant.createdAt,
      startedAt: new Date().toISOString(),
      matchNumber: this.nextMatchNumber()
    };
    return this.data.current;
  }

  /** 対戦終了。結果と感想を履歴に保存する */
  finishMatch(result, comment) {
    if (!this.data.current) return null;
    const current = this.data.current;
    const finishedAt = new Date().toISOString();
    const record = {
      id: newId(),
      participantId: current.id,
      name: current.name,
      deck: current.deck,
      result: result === 'lose' ? 'lose' : 'win',
      comment: String(comment == null ? '' : comment).trim(),
      matchNumber: current.matchNumber,
      date: todayKey(finishedAt),
      startedAt: current.startedAt,
      finishedAt
    };
    this.data.history.push(record);
    this.data.current = null;
    return record;
  }

  /** 対戦を記録せず中止して、待機列の先頭に戻す */
  cancelMatch() {
    if (!this.data.current) return null;
    const current = this.data.current;
    this.data.queue.unshift({
      id: current.id,
      name: current.name,
      deck: current.deck,
      createdAt: current.createdAt || new Date().toISOString()
    });
    this.data.current = null;
    return current;
  }

  // ---------- 履歴操作 ----------

  updateHistory(id, patch) {
    const record = this.data.history.find((h) => h.id === id);
    if (!record) return null;
    if (patch.name != null) record.name = String(patch.name).trim();
    if (patch.deck != null) record.deck = String(patch.deck).trim();
    if (patch.result === 'win' || patch.result === 'lose') record.result = patch.result;
    if (patch.comment != null) record.comment = String(patch.comment).trim();
    return record;
  }

  removeHistory(id) {
    const index = this.data.history.findIndex((h) => h.id === id);
    if (index === -1) return null;
    return this.data.history.splice(index, 1)[0];
  }

  /** 本日の履歴だけ消す（配信終了後のリセット用） */
  clearToday() {
    const key = todayKey();
    const before = this.data.history.length;
    this.data.history = this.data.history.filter((h) => h.date !== key);
    return before - this.data.history.length;
  }
}

module.exports = { Store, todayKey, DATA_FILE };
