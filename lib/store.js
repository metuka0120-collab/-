'use strict';

/**
 * JSONファイルによるデータ保存レイヤー。
 * SQLiteは使わず、data/data.json に読み書きする。
 * 書き込みは「一時ファイル → rename」で行い、書き込み途中の電源断でも
 * ファイルが壊れにくいようにしている。
 *
 * 参加者の待機列は持たない（参加者募集・整列はワンコメ側で行う前提）。
 * このアプリが持つのは「対戦履歴」と「現在の対戦」だけ。
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
    version: 2,
    settings: {
      streamTitle: '視聴者参加型対戦',
      myName: '配信者',
      myDeck: ''
    },
    current: null, // 現在の対戦
    history: []    // 終了した対戦
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

function str(value) {
  return String(value == null ? '' : value).trim();
}

/** 同じリスナーかどうかの判定に使うキー（表記ゆれを少し吸収する） */
function nameKey(name) {
  return str(name).toLowerCase().replace(/\s+/g, '');
}

/** 読み込んだJSONが壊れていても落ちないように整える。v1（待機列あり）も読める */
function normalize(raw) {
  const base = emptyData();
  if (!raw || typeof raw !== 'object') return base;

  if (raw.settings && typeof raw.settings === 'object') {
    base.settings.streamTitle = str(raw.settings.streamTitle) || base.settings.streamTitle;
    base.settings.myName = str(raw.settings.myName) || base.settings.myName;
    base.settings.myDeck = str(raw.settings.myDeck);
  }

  if (raw.current && typeof raw.current === 'object') {
    base.current = {
      id: str(raw.current.id) || newId(),
      name: str(raw.current.name),
      deck: str(raw.current.deck),
      myDeck: str(raw.current.myDeck),
      startedAt: raw.current.startedAt || new Date().toISOString(),
      matchNumber: Number(raw.current.matchNumber) || 1
    };
  }

  base.history = Array.isArray(raw.history)
    ? raw.history.filter(Boolean).map((h) => ({
        id: str(h.id) || newId(),
        name: str(h.name),
        deck: str(h.deck),
        myDeck: str(h.myDeck),
        result: h.result === 'lose' ? 'lose' : 'win',
        comment: String(h.comment == null ? '' : h.comment).trim(),
        matchNumber: Number(h.matchNumber) || 0,
        date: h.date || todayKey(h.finishedAt || Date.now()),
        startedAt: h.startedAt || null,
        finishedAt: h.finishedAt || new Date().toISOString()
      }))
    : [];

  // v1 の待機列は、このバージョンでは使わないので取り込まない
  return base;
}

/** 勝敗の集計 */
function summarize(records) {
  const wins = records.filter((r) => r.result === 'win').length;
  const total = records.length;
  const losses = total - wins;
  return {
    wins,
    losses,
    total,
    winRate: total === 0 ? 0 : Math.round((wins / total) * 1000) / 10
  };
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

  /** 本日の成績 */
  todayStats() {
    const key = todayKey();
    return Object.assign({ date: key }, summarize(this.data.history.filter((h) => h.date === key)));
  }

  /** 通算成績（記録している全期間） */
  totalStats() {
    const days = new Set(this.data.history.map((h) => h.date));
    return Object.assign({ days: days.size }, summarize(this.data.history));
  }

  /** 指定リスナーとの通算対戦成績 */
  opponentStats(name) {
    const key = nameKey(name);
    if (!key) return summarize([]);
    return summarize(this.data.history.filter((h) => nameKey(h.name) === key));
  }

  /** リスナー別の通算成績（対戦数の多い順） */
  opponentRanking() {
    const map = new Map();
    for (const record of this.data.history) {
      const key = nameKey(record.name);
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, { name: record.name, decks: new Set(), records: [], lastAt: record.finishedAt });
      }
      const entry = map.get(key);
      entry.records.push(record);
      entry.name = record.name; // 最新の表記に合わせる
      if (record.deck) entry.decks.add(record.deck);
      if (String(record.finishedAt) > String(entry.lastAt)) entry.lastAt = record.finishedAt;
    }

    return [...map.values()]
      .map((entry) => Object.assign(
        { name: entry.name, decks: [...entry.decks], lastAt: entry.lastAt },
        summarize(entry.records)
      ))
      .sort((a, b) => b.total - a.total || String(b.lastAt).localeCompare(String(a.lastAt)));
  }

  /** 自分の使用デッキ別の通算成績 */
  myDeckRanking() {
    const map = new Map();
    for (const record of this.data.history) {
      const deck = record.myDeck;
      if (!deck) continue;
      if (!map.has(deck)) map.set(deck, []);
      map.get(deck).push(record);
    }
    return [...map.entries()]
      .map(([deck, records]) => Object.assign({ deck }, summarize(records)))
      .sort((a, b) => b.total - a.total);
  }

  /** 現在の対戦が本日何戦目かを決める（本日の確定分 + 1） */
  nextMatchNumber() {
    return this.todayStats().total + 1;
  }

  /** 画面に配る状態 */
  snapshot() {
    const history = [...this.data.history].sort((a, b) =>
      String(b.finishedAt).localeCompare(String(a.finishedAt))
    );
    return {
      settings: this.data.settings,
      current: this.data.current,
      history,
      stats: this.todayStats(),
      totalStats: this.totalStats(),
      opponents: this.opponentRanking(),
      myDecks: this.myDeckRanking(),
      serverTime: new Date().toISOString()
    };
  }

  // ---------- 設定 ----------

  updateSettings(patch) {
    if (!patch || typeof patch !== 'object') return this.data.settings;
    if (patch.streamTitle != null) this.data.settings.streamTitle = str(patch.streamTitle);
    if (patch.myName != null) this.data.settings.myName = str(patch.myName);
    if (patch.myDeck != null) this.data.settings.myDeck = str(patch.myDeck);
    return this.data.settings;
  }

  // ---------- 対戦 ----------

  /** 対戦開始（OBSオーバーレイに出す用）。対戦中なら上書きする */
  startMatch({ name, deck, myDeck }) {
    const listener = str(name);
    if (!listener) return null;
    this.data.current = {
      id: newId(),
      name: listener,
      deck: str(deck),
      myDeck: str(myDeck) || this.data.settings.myDeck,
      startedAt: new Date().toISOString(),
      matchNumber: this.nextMatchNumber()
    };
    return this.data.current;
  }

  /** 対戦中の内容を直す（名前を打ち間違えたときなど） */
  updateCurrent(patch) {
    if (!this.data.current) return null;
    if (patch.name != null) {
      const name = str(patch.name);
      if (!name) return null;
      this.data.current.name = name;
    }
    if (patch.deck != null) this.data.current.deck = str(patch.deck);
    if (patch.myDeck != null) this.data.current.myDeck = str(patch.myDeck);
    return this.data.current;
  }

  /** 対戦終了。結果と感想を履歴に保存する */
  finishMatch(result, comment) {
    if (!this.data.current) return null;
    const current = this.data.current;
    const finishedAt = new Date().toISOString();
    const record = {
      id: newId(),
      name: current.name,
      deck: current.deck,
      myDeck: current.myDeck,
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

  /** 対戦を記録せずに取り消す */
  cancelMatch() {
    if (!this.data.current) return null;
    const cancelled = this.data.current;
    this.data.current = null;
    return cancelled;
  }

  // ---------- 履歴 ----------

  /** 対戦開始を経由せず、終わった対戦をそのまま記録する */
  addHistory({ name, deck, myDeck, result, comment }) {
    const listener = str(name);
    if (!listener) return null;
    const finishedAt = new Date().toISOString();
    const record = {
      id: newId(),
      name: listener,
      deck: str(deck),
      myDeck: str(myDeck) || this.data.settings.myDeck,
      result: result === 'lose' ? 'lose' : 'win',
      comment: String(comment == null ? '' : comment).trim(),
      matchNumber: this.nextMatchNumber(),
      date: todayKey(finishedAt),
      startedAt: null,
      finishedAt
    };
    this.data.history.push(record);
    return record;
  }

  updateHistory(id, patch) {
    const record = this.data.history.find((h) => h.id === id);
    if (!record) return null;
    if (patch.name != null) {
      const name = str(patch.name);
      if (!name) return null;
      record.name = name;
    }
    if (patch.deck != null) record.deck = str(patch.deck);
    if (patch.myDeck != null) record.myDeck = str(patch.myDeck);
    if (patch.result === 'win' || patch.result === 'lose') record.result = patch.result;
    if (patch.comment != null) record.comment = String(patch.comment).trim();
    return record;
  }

  removeHistory(id) {
    const index = this.data.history.findIndex((h) => h.id === id);
    if (index === -1) return null;
    return this.data.history.splice(index, 1)[0];
  }

  /** 本日の履歴だけ消す */
  clearToday() {
    const key = todayKey();
    const before = this.data.history.length;
    this.data.history = this.data.history.filter((h) => h.date !== key);
    return before - this.data.history.length;
  }
}

module.exports = { Store, todayKey, nameKey, DATA_FILE };
