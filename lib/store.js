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
const { normalizeFontValue } = require('./fonts');
const crypto = require('crypto');
const { sanitize: sanitizeStamps } = require('./stamps');
const { safeFile } = require('./images');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const TMP_FILE = path.join(DATA_DIR, 'data.json.tmp');
const BAK_FILE = path.join(DATA_DIR, 'data.json.bak');

/** 募集状況として使える値 */
const RECRUIT = ['open', 'paused', 'closed'];

/** まとめ画像で選べるフォントとアクセント色 */
const SUMMARY_FONTS = ['gothic', 'ud', 'mincho', 'kyokasho'];
const SUMMARY_ACCENTS = ['blue', 'red', 'green', 'pink', 'orange', 'mono'];
/** まとめ画像とOBS表示のデザイン */
const SUMMARY_THEMES = ['pop', 'yume', 'note', 'retro', 'chic', 'classic', 'classicLight'];
const OVERLAY_THEMES = ['pop', 'yume', 'note', 'retro', 'chic', 'classic'];
/** 文字の部位（フォントと大きさを別々に変えられる） */
const TEXT_PARTS = ['title', 'stats', 'name', 'deck', 'comment', 'note'];
const OVERLAY_PARTS = ['name', 'label'];
const BACKGROUND_FITS = ['cover', 'contain', 'tile'];
const MAX_CHARACTERS = 6;

/** 部位ごとのフォント指定を整える（空はテーマのおすすめ） */
function normalizeFonts(raw, parts, base) {
  const out = Object.assign({}, base || {});
  parts.forEach((part) => { if (out[part] == null) out[part] = ''; });
  if (!raw || typeof raw !== 'object') return out;
  parts.forEach((part) => {
    if (raw[part] == null) return;
    if (raw[part] === '') { out[part] = ''; return; }
    const value = normalizeFontValue(raw[part]);
    if (value) out[part] = value;
  });
  return out;
}

/** 部位ごとの大きさ（%）を整える */
function normalizeSizes(raw, parts, base) {
  const out = Object.assign({}, base || {});
  parts.forEach((part) => { if (out[part] == null) out[part] = 100; });
  if (!raw || typeof raw !== 'object') return out;
  parts.forEach((part) => {
    if (raw[part] == null) return;
    out[part] = Math.round(clamp(raw[part], 50, 250, out[part]));
  });
  return out;
}

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (!isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

/** 背景画像の設定を整える */
function normalizeBackground(raw, base) {
  const out = { file: '', fit: 'cover', opacity: 35 };
  Object.assign(out, base || {});
  if (!raw || typeof raw !== 'object') return out;
  if (raw.file != null) out.file = safeFile(raw.file);
  if (BACKGROUND_FITS.indexOf(raw.fit) !== -1) out.fit = raw.fit;
  if (raw.opacity != null) out.opacity = Math.round(clamp(raw.opacity, 0, 100, out.opacity));
  return out;
}

/** キャラ画像の配置を整える（画面外や巨大サイズにならないようにする） */
function normalizeCharacters(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const file = safeFile(item.file);
    if (!file) continue;
    out.push({
      id: String(item.id || '').slice(0, 24) || 'c' + (out.length + 1) + Date.now().toString(36),
      file,
      x: clamp(item.x, -0.2, 1.2, 0.5),
      y: clamp(item.y, -0.2, 1.2, 0.5),
      scale: clamp(item.scale, 0.05, 1.2, 0.25)
    });
    if (out.length >= MAX_CHARACTERS) break;
  }
  return out;
}

/** 空の初期データ */
function emptyData() {
  return {
    version: 3,
    settings: {
      streamTitle: '視聴者参加型対戦',
      myName: '配信者',
      myDeck: '',
      // 参加者の募集状況（OBS表示画面に出る）
      //   open   … 次の対戦者募集中
      //   paused … 対戦者募集ストップ中（待機消化後に再募集）
      //   closed … 募集終了
      recruit: 'open',
      // 1日の区切り（0〜23時）。深夜をまたぐ配信は 5 などにする
      dayCutoffHour: 0,
      // 参加者に伝えるルームID（OBS表示画面に出る。空なら出ない）
      roomId: '',
      // まとめ画像の見た目
      summary: {
        theme: 'pop',      // デザイン（SUMMARY_THEMES）
        // 部位ごとのフォント（空ならテーマのおすすめ）と大きさ（%）
        fonts: { title: '', stats: '', name: '', deck: '', comment: '', note: '' },
        sizes: { title: 100, stats: 100, name: 100, deck: 100, comment: 100, note: 100 },
        font: 'gothic',    // 古い設定（1つのフォントで全部を描いていたころ）
        accent: 'blue',    // blue / red / green / pink / orange / mono（クラシックで使う）
        noteSize: 22,      // ひとことの文字の大きさ
        note: '',          // ひとこと（画像の下に入る文字）
        // 背景に敷く画像（images/ フォルダのファイル名）
        background: { file: '', fit: 'cover', opacity: 35 },
        // 好きな場所に置くキャラ画像
        characters: []     // { id, file, x, y, scale }
      },
      // OBS表示のデザイン
      overlay: {
        theme: 'pop',
        fonts: { name: '', label: '' },
        sizes: { name: 100, label: 100 }
      },
      // わんコメ（OneComme）からリスナー名とアイコンを取り込む設定
      onecomme: { enabled: false, url: 'ws://127.0.0.1:11180/sub' },
      // 参加受付（わんコメのコメントで自動受付）
      queue: {
        autoJoin: true,            // 「参加希望」で自動でリストに入れる
        joinWords: ['参加希望'],    // この言葉を含むコメントで参加
        cancelWords: ['辞退'],      // この言葉を含むコメントでリストから外す
        onlyWhenOpen: true,        // 「次の対戦者募集中」のときだけ受け付ける
        pickCount: 3               // シャッフルで選ぶ人数
      }
    },
    current: null, // 現在の対戦
    history: [],   // 終了した対戦
    queue: [],     // 参加待ちのリスト
    queueMeta: { shuffleId: 0, lastPicked: [] } // 直近のシャッフル（OBSの演出用）
  };
}

/** 参加待ちの1人分を整える */
function normalizeQueueEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = str(raw.name).slice(0, 40);
  if (!name) return null;
  const pick = Number(raw.pick);
  return {
    id: str(raw.id) || newId(),
    name,
    icon: safeIcon(raw.icon),
    listenerId: str(raw.listenerId).slice(0, 120),
    comment: str(raw.comment).slice(0, 60),
    source: raw.source === 'onecomme' ? 'onecomme' : 'manual',
    joinedAt: raw.joinedAt || new Date().toISOString(),
    pick: Number.isInteger(pick) && pick > 0 ? pick : 0
  };
}

/** 受付の言葉の一覧を整える（空や長すぎるものは落とす） */
function normalizeWords(raw, fallback) {
  const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(/[,、，\n]/) : null);
  if (!list) return fallback.slice();
  const out = [];
  list.forEach((w) => {
    const word = str(w).slice(0, 20);
    if (word && out.indexOf(word) === -1 && out.length < 10) out.push(word);
  });
  return out;
}

/** 受付の設定を整える */
function normalizeQueueSettings(raw, base) {
  const out = Object.assign({}, base);
  if (!raw || typeof raw !== 'object') return out;
  if (raw.autoJoin != null) out.autoJoin = !!raw.autoJoin;
  if (raw.onlyWhenOpen != null) out.onlyWhenOpen = !!raw.onlyWhenOpen;
  if (raw.joinWords != null) out.joinWords = normalizeWords(raw.joinWords, base.joinWords);
  if (raw.cancelWords != null) out.cancelWords = normalizeWords(raw.cancelWords, base.cancelWords);
  if (raw.pickCount != null) {
    const n = Number(raw.pickCount);
    if (Number.isInteger(n) && n >= 1 && n <= 10) out.pickCount = n;
  }
  return out;
}

/**
 * コメントと受付の言葉を比べるための整形。
 * 全角・半角や大文字・小文字、空白のちがいを気にせず見つけられるようにする。
 */
function matchText(value) {
  return String(value == null ? '' : value).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

/**
 * 「配信の1日」を YYYY-MM-DD で返す。
 *
 * 深夜をまたぐ配信のために、1日の区切りを何時にするか選べる。
 *   区切り 0時  … 0:00 に日付が変わる（ふつうのカレンダーどおり）
 *   区切り 5時  … 深夜4:59 までは前の日として数える
 *
 * 時刻は配信するPCのローカル時間で扱う（UTCは使わない）。
 */
function dayKey(when, cutoffHour) {
  const date = when ? new Date(when) : new Date();
  const cutoff = Number(cutoffHour) || 0;
  if (cutoff > 0) date.setHours(date.getHours() - cutoff);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 区切りを考えない素の日付（互換のために残す） */
function todayKey(d) {
  return dayKey(d, 0);
}

function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function str(value) {
  return String(value == null ? '' : value).trim();
}

/**
 * 保存してよいアイコンのパスかどうか。
 * 外からもらったURL（http:// や file:// など）はそのまま保存しない。
 * 一度ダウンロードして /icons/ に置いたものだけを記録に残す。
 */
function safeIcon(value) {
  const icon = str(value);
  if (!icon) return '';
  if (!/^\/icons\/[A-Za-z0-9._-]+$/.test(icon)) return '';
  if (icon.indexOf('..') !== -1) return '';
  return icon;
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
    base.settings.recruit = RECRUIT.indexOf(raw.settings.recruit) !== -1 ? raw.settings.recruit : 'open';
    base.settings.roomId = str(raw.settings.roomId).slice(0, 24);
    const cutoff = Number(raw.settings.dayCutoffHour);
    base.settings.dayCutoffHour = Number.isInteger(cutoff) && cutoff >= 0 && cutoff <= 23 ? cutoff : 0;

    if (raw.settings.summary && typeof raw.settings.summary === 'object') {
      const sum = raw.settings.summary;
      if (SUMMARY_FONTS.indexOf(sum.font) !== -1) base.settings.summary.font = sum.font;
      if (SUMMARY_ACCENTS.indexOf(sum.accent) !== -1) base.settings.summary.accent = sum.accent;
      const size = Number(sum.noteSize);
      if (size >= 14 && size <= 48) base.settings.summary.noteSize = Math.round(size);
      base.settings.summary.note = str(sum.note).slice(0, 60);
      base.settings.summary.background = normalizeBackground(sum.background, base.settings.summary.background);
      base.settings.summary.characters = normalizeCharacters(sum.characters);
      if (SUMMARY_THEMES.indexOf(sum.theme) !== -1) base.settings.summary.theme = sum.theme;

      // 部位ごとのフォント。前のバージョンの「1つのフォント」は引き継がず、
      // 新しいデザインのおすすめフォントで描く（選び直せば上書きされる）
      base.settings.summary.fonts = normalizeFonts(sum.fonts, TEXT_PARTS, base.settings.summary.fonts);
      // ひとことの大きさ（px）は、%に直して引き継ぐ
      const migratedSizes = {};
      if (!sum.sizes && Number(sum.noteSize) && Number(sum.noteSize) !== 22) {
        migratedSizes.note = Math.round(Number(sum.noteSize) / 22 * 100);
      }
      base.settings.summary.sizes = normalizeSizes(sum.sizes || migratedSizes, TEXT_PARTS, base.settings.summary.sizes);
    }
    if (raw.settings.overlay && typeof raw.settings.overlay === 'object') {
      const ov = raw.settings.overlay;
      if (OVERLAY_THEMES.indexOf(ov.theme) !== -1) base.settings.overlay.theme = ov.theme;
      base.settings.overlay.fonts = normalizeFonts(ov.fonts, OVERLAY_PARTS, base.settings.overlay.fonts);
      base.settings.overlay.sizes = normalizeSizes(ov.sizes, OVERLAY_PARTS, base.settings.overlay.sizes);
    }
    if (raw.settings.onecomme && typeof raw.settings.onecomme === 'object') {
      base.settings.onecomme.enabled = !!raw.settings.onecomme.enabled;
      base.settings.onecomme.url = str(raw.settings.onecomme.url) || base.settings.onecomme.url;
    }
    base.settings.queue = normalizeQueueSettings(raw.settings.queue, base.settings.queue);
  }

  if (raw.current && typeof raw.current === 'object') {
    base.current = {
      id: str(raw.current.id) || newId(),
      name: str(raw.current.name),
      deck: str(raw.current.deck),
      myDeck: str(raw.current.myDeck),
      icon: safeIcon(raw.current.icon),
      listenerId: str(raw.current.listenerId),
      startedAt: raw.current.startedAt || new Date().toISOString(),
      matchNumber: Number(raw.current.matchNumber) || 1,
      // 参加待ちリストから呼んだ人（取り消したら元に戻すため）
      fromQueue: normalizeQueueEntry(raw.current.fromQueue)
    };
  }

  base.history = Array.isArray(raw.history)
    ? raw.history.filter(Boolean).map((h) => ({
        id: str(h.id) || newId(),
        name: str(h.name),
        deck: str(h.deck),
        myDeck: str(h.myDeck),
        icon: safeIcon(h.icon),
        listenerId: str(h.listenerId),
        result: h.result === 'lose' ? 'lose' : 'win',
        comment: String(h.comment == null ? '' : h.comment).trim(),
        stamps: sanitizeStamps(h.stamps),
        matchNumber: Number(h.matchNumber) || 0,
        date: h.date || dayKey(h.finishedAt || Date.now(), 0),
        startedAt: h.startedAt || null,
        finishedAt: h.finishedAt || new Date().toISOString()
      }))
    : [];

  // 参加待ちのリスト。v1 の待機列（形がちがう）は取り込まない
  if (Number(raw.version) >= 3 && Array.isArray(raw.queue)) {
    const seen = new Set();
    raw.queue.forEach((item) => {
      const entry = normalizeQueueEntry(item);
      if (!entry || seen.has(entry.id)) return;
      seen.add(entry.id);
      base.queue.push(entry);
    });
    if (raw.queueMeta && typeof raw.queueMeta === 'object') {
      base.queueMeta.shuffleId = Number(raw.queueMeta.shuffleId) || 0;
      base.queueMeta.lastPicked = Array.isArray(raw.queueMeta.lastPicked)
        ? raw.queueMeta.lastPicked.map(str).filter(Boolean).slice(0, 10) : [];
    }
  }
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
      this.applyDayCutoff();
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

  /** いまの区切り設定での「本日」 */
  today() {
    return dayKey(Date.now(), this.data.settings.dayCutoffHour);
  }

  /**
   * 区切り時刻に合わせて、すべての記録の所属日を計算し直す。
   * 記録そのものは消さない（date を付け替えるだけ）。
   */
  applyDayCutoff() {
    const cutoff = this.data.settings.dayCutoffHour;
    for (const record of this.data.history) {
      if (record.finishedAt) record.date = dayKey(record.finishedAt, cutoff);
    }
  }

  /** 本日の成績 */
  todayStats() {
    const key = this.today();
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
        map.set(key, { name: record.name, icon: '', decks: new Set(), records: [], lastAt: record.finishedAt });
      }
      const entry = map.get(key);
      entry.records.push(record);
      entry.name = record.name; // 最新の表記に合わせる
      if (record.deck) entry.decks.add(record.deck);
      if (String(record.finishedAt) >= String(entry.lastAt)) {
        entry.lastAt = record.finishedAt;
        if (record.icon) entry.icon = record.icon;
      }
      if (!entry.icon && record.icon) entry.icon = record.icon;
    }

    return [...map.values()]
      .map((entry) => Object.assign(
        { name: entry.name, icon: entry.icon, decks: [...entry.decks], lastAt: entry.lastAt },
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
      dayCutoffHour: this.data.settings.dayCutoffHour,
      opponents: this.opponentRanking(),
      myDecks: this.myDeckRanking(),
      queue: this.queueList(),
      queueMeta: this.data.queueMeta,
      serverTime: new Date().toISOString()
    };
  }

  // ---------- 設定 ----------

  updateSettings(patch) {
    if (!patch || typeof patch !== 'object') return this.data.settings;
    if (patch.streamTitle != null) this.data.settings.streamTitle = str(patch.streamTitle);
    if (patch.myName != null) this.data.settings.myName = str(patch.myName);
    if (patch.myDeck != null) this.data.settings.myDeck = str(patch.myDeck);
    if (patch.recruit != null && RECRUIT.indexOf(patch.recruit) !== -1) {
      this.data.settings.recruit = patch.recruit;
    }
    if (patch.roomId != null) this.data.settings.roomId = str(patch.roomId).slice(0, 24);
    if (patch.summary && typeof patch.summary === 'object') {
      const target = this.data.settings.summary;
      if (SUMMARY_FONTS.indexOf(patch.summary.font) !== -1) target.font = patch.summary.font;
      if (SUMMARY_ACCENTS.indexOf(patch.summary.accent) !== -1) target.accent = patch.summary.accent;
      if (patch.summary.noteSize != null) {
        const size = Number(patch.summary.noteSize);
        if (size >= 14 && size <= 48) target.noteSize = Math.round(size);
      }
      if (patch.summary.note != null) target.note = str(patch.summary.note).slice(0, 60);
      if (patch.summary.background != null) {
        target.background = normalizeBackground(patch.summary.background, target.background);
      }
      if (patch.summary.characters != null) {
        target.characters = normalizeCharacters(patch.summary.characters);
      }
      if (SUMMARY_THEMES.indexOf(patch.summary.theme) !== -1) target.theme = patch.summary.theme;
      if (patch.summary.fonts != null) target.fonts = normalizeFonts(patch.summary.fonts, TEXT_PARTS, target.fonts);
      if (patch.summary.sizes != null) target.sizes = normalizeSizes(patch.summary.sizes, TEXT_PARTS, target.sizes);
      // 前のバージョンの「ひとことの大きさ（px）」も受け付ける
      if (patch.summary.noteSize != null && patch.summary.sizes == null) {
        const px = Number(patch.summary.noteSize);
        if (px >= 14 && px <= 48) target.sizes = normalizeSizes({ note: px / 22 * 100 }, TEXT_PARTS, target.sizes);
      }
    }
    if (patch.overlay && typeof patch.overlay === 'object') {
      const target = this.data.settings.overlay;
      if (OVERLAY_THEMES.indexOf(patch.overlay.theme) !== -1) target.theme = patch.overlay.theme;
      if (patch.overlay.fonts != null) target.fonts = normalizeFonts(patch.overlay.fonts, OVERLAY_PARTS, target.fonts);
      if (patch.overlay.sizes != null) target.sizes = normalizeSizes(patch.overlay.sizes, OVERLAY_PARTS, target.sizes);
    }
    if (patch.dayCutoffHour != null) {
      const hour = Number(patch.dayCutoffHour);
      if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
        this.data.settings.dayCutoffHour = hour;
        this.applyDayCutoff(); // 過去の記録も新しい区切りで数え直す
      }
    }
    if (patch.queue && typeof patch.queue === 'object') {
      this.data.settings.queue = normalizeQueueSettings(patch.queue, this.data.settings.queue);
    }
    if (patch.onecomme && typeof patch.onecomme === 'object') {
      if (patch.onecomme.enabled != null) this.data.settings.onecomme.enabled = !!patch.onecomme.enabled;
      if (patch.onecomme.url != null) {
        this.data.settings.onecomme.url = str(patch.onecomme.url) || this.data.settings.onecomme.url;
      }
    }
    return this.data.settings;
  }

  /** 過去の記録から、そのリスナーの一番新しいアイコンを探す */
  iconFor(name) {
    const key = nameKey(name);
    if (!key) return '';
    for (let i = this.data.history.length - 1; i >= 0; i--) {
      const record = this.data.history[i];
      if (nameKey(record.name) === key && record.icon) return record.icon;
    }
    return '';
  }

  // ---------- 対戦 ----------

  /** 対戦開始（OBSオーバーレイに出す用）。対戦中なら上書きする */
  startMatch({ name, deck, myDeck, icon, listenerId, queueId }) {
    const listener = str(name);
    if (!listener) return null;
    // 参加待ちリストにいる人なら、リストから外す（取り消したときに戻せるよう覚えておく）
    const fromQueue = this.queueTake({ id: queueId, listenerId, name: listener });
    this.data.current = {
      id: newId(),
      name: listener,
      deck: str(deck),
      myDeck: str(myDeck) || this.data.settings.myDeck,
      icon: safeIcon(icon) || (fromQueue && fromQueue.icon) || this.iconFor(listener),
      listenerId: str(listenerId) || (fromQueue ? fromQueue.listenerId : ''),
      startedAt: new Date().toISOString(),
      matchNumber: this.nextMatchNumber(),
      fromQueue
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
    if (patch.icon != null) this.data.current.icon = safeIcon(patch.icon);
    if (patch.listenerId != null) this.data.current.listenerId = str(patch.listenerId);
    return this.data.current;
  }

  /** 対戦終了。結果と感想を履歴に保存する */
  finishMatch(result, comment, stamps) {
    if (!this.data.current) return null;
    const current = this.data.current;
    const finishedAt = new Date().toISOString();
    const record = {
      id: newId(),
      name: current.name,
      deck: current.deck,
      myDeck: current.myDeck,
      icon: current.icon,
      listenerId: current.listenerId,
      result: result === 'lose' ? 'lose' : 'win',
      comment: String(comment == null ? '' : comment).trim(),
      stamps: sanitizeStamps(stamps),
      matchNumber: current.matchNumber,
      date: dayKey(finishedAt, this.data.settings.dayCutoffHour),
      startedAt: current.startedAt,
      finishedAt
    };
    this.data.history.push(record);
    this.data.current = null;
    return record;
  }

  // ---------- 参加待ちリスト ----------

  /** 表示する順番（選ばれた人が上、あとは来た順） */
  queueList() {
    const picked = this.data.queue.filter((e) => e.pick > 0).sort((a, b) => a.pick - b.pick);
    const waiting = this.data.queue.filter((e) => !e.pick);
    return picked.concat(waiting);
  }

  /** 同じ人がリストにいるか（ID → わんコメのID → 名前 の順に探す） */
  queueFind({ id, listenerId, name }) {
    const queue = this.data.queue;
    if (id) {
      const byId = queue.find((e) => e.id === id);
      if (byId) return byId;
    }
    const lid = str(listenerId);
    if (lid) {
      const byListener = queue.find((e) => e.listenerId && e.listenerId === lid);
      if (byListener) return byListener;
    }
    const key = nameKey(name);
    return key ? queue.find((e) => nameKey(e.name) === key) || null : null;
  }

  /** 選ばれた人の番号を 1, 2, 3… に詰め直す */
  renumberPicks() {
    this.data.queue.filter((e) => e.pick > 0)
      .sort((a, b) => a.pick - b.pick)
      .forEach((e, i) => { e.pick = i + 1; });
  }

  /** リストに入れる。もういる人は入れない */
  queueAdd({ name, icon, listenerId, comment, source }) {
    const entry = normalizeQueueEntry({
      name,
      icon: safeIcon(icon) || this.iconFor(name),
      listenerId,
      comment,
      source
    });
    if (!entry) return { entry: null, added: false };
    const existing = this.queueFind(entry);
    if (existing) return { entry: existing, added: false };
    if (this.data.queue.length >= 200) return { entry: null, added: false };
    this.data.queue.push(entry);
    return { entry, added: true };
  }

  /** リストから外して、その人を返す */
  queueTake(who) {
    const entry = this.queueFind(who || {});
    if (!entry) return null;
    this.data.queue = this.data.queue.filter((e) => e !== entry);
    this.renumberPicks();
    return entry;
  }

  queueClear() {
    const count = this.data.queue.length;
    this.data.queue = [];
    this.data.queueMeta.lastPicked = [];
    return count;
  }

  /** 選ばれた状態だけをやめる（リストには残す） */
  queueUnpick(id) {
    const entry = this.data.queue.find((e) => e.id === id);
    if (!entry) return null;
    entry.pick = 0;
    this.renumberPicks();
    return entry;
  }

  /**
   * 参加待ちから、無作為に選ぶ。
   *   fill … すでに選ばれている人は残して、足りない人数だけ選ぶ
   *   all  … 選び直す（全員の中からもう一度）
   * 偏りが出ないよう、暗号用の乱数で選ぶ。
   */
  queueShuffle(count, mode) {
    const n = Number.isInteger(count) && count >= 1 && count <= 10 ? count : this.data.settings.queue.pickCount;
    if (mode === 'all') this.data.queue.forEach((e) => { e.pick = 0; });

    const already = this.data.queue.filter((e) => e.pick > 0).length;
    const pool = this.data.queue.filter((e) => !e.pick);
    const need = Math.max(0, Math.min(n - already, pool.length));

    const chosen = [];
    for (let i = 0; i < need; i++) {
      const j = crypto.randomInt(pool.length);
      chosen.push(pool[j]);
      pool.splice(j, 1);
    }
    chosen.forEach((e, i) => { e.pick = already + i + 1; });

    this.data.queueMeta.shuffleId = (Number(this.data.queueMeta.shuffleId) || 0) + 1;
    this.data.queueMeta.lastPicked = chosen.map((e) => e.id);
    return chosen;
  }

  /**
   * わんコメのコメントを見て、参加・辞退を自動で受け付ける。
   * 返り値：{ action: 'join' | 'leave', entry } または null（何もしなかった）
   */
  handleComment(person) {
    const config = this.data.settings.queue;
    if (!config.autoJoin || !person || !person.name) return null;
    // 配信者本人のコメント（「参加希望の方は〜」など）は受け付けない
    if (person.isOwner) return null;
    if (nameKey(person.name) === nameKey(this.data.settings.myName)) return null;

    const text = matchText(person.comment);
    if (!text) return null;
    const has = (words) => words.some((w) => {
      const word = matchText(w);
      return word && text.indexOf(word) !== -1;
    });

    // 「参加希望を辞退します」のように両方あるときは、辞退を優先する
    if (has(config.cancelWords)) {
      const entry = this.queueTake({ listenerId: person.userId, name: person.name });
      return entry ? { action: 'leave', entry } : null;
    }
    if (has(config.joinWords)) {
      if (config.onlyWhenOpen && this.data.settings.recruit !== 'open') return null;
      const { entry, added } = this.queueAdd({
        name: person.name,
        listenerId: person.userId,
        comment: person.comment,
        source: 'onecomme'
      });
      return added ? { action: 'join', entry } : null;
    }
    return null;
  }

  /** 対戦を記録せずに取り消す */
  cancelMatch() {
    if (!this.data.current) return null;
    const cancelled = this.data.current;
    this.data.current = null;
    // リストから呼んだ人は、いちばん上に戻す
    if (cancelled.fromQueue && !this.queueFind(cancelled.fromQueue)) {
      this.data.queue.unshift(cancelled.fromQueue);
      this.renumberPicks();
    }
    return cancelled;
  }

  // ---------- 履歴 ----------

  /** 対戦開始を経由せず、終わった対戦をそのまま記録する */
  addHistory({ name, deck, myDeck, result, comment, stamps, icon, listenerId }) {
    const listener = str(name);
    if (!listener) return null;
    const finishedAt = new Date().toISOString();
    const record = {
      id: newId(),
      name: listener,
      deck: str(deck),
      myDeck: str(myDeck) || this.data.settings.myDeck,
      icon: safeIcon(icon) || this.iconFor(listener),
      listenerId: str(listenerId),
      result: result === 'lose' ? 'lose' : 'win',
      comment: String(comment == null ? '' : comment).trim(),
      stamps: sanitizeStamps(stamps),
      matchNumber: this.nextMatchNumber(),
      date: dayKey(finishedAt, this.data.settings.dayCutoffHour),
      startedAt: null,
      finishedAt
    };
    this.data.history.push(record);
    // 対戦した人は参加待ちリストから外す
    this.queueTake({ listenerId: record.listenerId, name: record.name });
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
    if (patch.icon != null) record.icon = safeIcon(patch.icon);
    if (patch.listenerId != null) record.listenerId = str(patch.listenerId);
    if (patch.result === 'win' || patch.result === 'lose') record.result = patch.result;
    if (patch.comment != null) record.comment = String(patch.comment).trim();
    if (patch.stamps != null) record.stamps = sanitizeStamps(patch.stamps);
    return record;
  }

  removeHistory(id) {
    const index = this.data.history.findIndex((h) => h.id === id);
    if (index === -1) return null;
    return this.data.history.splice(index, 1)[0];
  }

  /** 本日の履歴だけ消す */
  clearToday() {
    const key = this.today();
    const before = this.data.history.length;
    this.data.history = this.data.history.filter((h) => h.date !== key);
    return before - this.data.history.length;
  }
}

module.exports = { Store, todayKey, dayKey, nameKey, safeIcon, RECRUIT, SUMMARY_FONTS, SUMMARY_ACCENTS, SUMMARY_THEMES, OVERLAY_THEMES, DATA_FILE };
