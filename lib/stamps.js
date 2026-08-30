'use strict';

/**
 * スタンプ（試合の感情を表すアイコン）の一覧を作る。
 *
 * 2種類ある。
 *   1. 組み込みの絵文字スタンプ … 何も用意しなくてもすぐ使える
 *   2. 画像ファイルのスタンプ  … stamps/ フォルダに画像を入れるだけで使える
 *
 * stamps/ の中はフォルダで分けてもよい。
 *   stamps/＠参加型/うれしい.png  →  「＠参加型」グループの「うれしい」
 *   stamps/くやしい.png           →  グループなしの「くやしい」
 */

const fs = require('fs');
const path = require('path');

const STAMP_DIR = path.join(__dirname, '..', 'stamps');
const EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.apng'];
const CACHE_MS = 3000; // フォルダの読み直しは3秒に1回までにする

/** 何も用意しなくても使える絵文字スタンプ */
const BUILT_IN = [
  { char: '🔥', label: '熱かった' },
  { char: '😄', label: 'うれしい' },
  { char: '😭', label: 'くやしい' },
  { char: '😱', label: 'まさか' },
  { char: '👏', label: 'ナイス' },
  { char: '🤝', label: '好勝負' },
  { char: '😂', label: '笑った' },
  { char: '💀', label: '完敗' },
  { char: '⚡', label: '一瞬で終了' },
  { char: '🎯', label: '決まった' },
  { char: '🙏', label: 'ありがとう' },
  { char: '🤯', label: '理解不能' }
];

let cache = { at: 0, list: [] };

function builtInStamps() {
  return BUILT_IN.map((s) => ({
    id: 'emoji:' + s.char,
    type: 'emoji',
    char: s.char,
    label: s.label,
    group: '絵文字'
  }));
}

/** 1階層だけフォルダを掘って画像を集める */
function scanDir(dir, group, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'ja'))) {
    if (entry.name.startsWith('.')) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!group) scanDir(full, entry.name, out); // 掘るのは1階層まで
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (EXTENSIONS.indexOf(ext) === -1) continue;

    const relative = group ? group + '/' + entry.name : entry.name;
    out.push({
      id: 'file:' + relative,
      type: 'image',
      // URLに使えるようにエンコードする（日本語のファイル名でも動くように）
      url: '/stamps/' + relative.split('/').map(encodeURIComponent).join('/'),
      label: path.basename(entry.name, ext),
      group: group || 'スタンプ'
    });
  }
}

/** 使えるスタンプの一覧（絵文字 + stamps フォルダの画像） */
function listStamps(force) {
  const now = Date.now();
  if (!force && now - cache.at < CACHE_MS) return cache.list;

  const images = [];
  scanDir(STAMP_DIR, '', images);

  cache = { at: now, list: builtInStamps().concat(images) };
  return cache.list;
}

/** 保存されているIDが今も使えるかを見て、使えるものだけ残す */
function sanitize(ids) {
  if (!Array.isArray(ids)) return [];
  const seen = [];
  for (const raw of ids) {
    const id = String(raw == null ? '' : raw).trim();
    if (!id) continue;
    // 絵文字はそのまま通す。ファイルはパスの細工を弾く
    if (id.indexOf('file:') === 0) {
      const relative = id.slice(5);
      if (relative.indexOf('..') !== -1 || path.isAbsolute(relative)) continue;
    } else if (id.indexOf('emoji:') !== 0) {
      continue;
    }
    if (seen.indexOf(id) === -1) seen.push(id);
    if (seen.length >= 3) break; // 1試合につき3個まで
  }
  return seen;
}

module.exports = { listStamps, sanitize, STAMP_DIR };
