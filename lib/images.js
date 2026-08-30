'use strict';

/**
 * まとめ画像で使う画像（背景・キャラクター）の一覧を作る。
 *
 * images/ フォルダに画像を入れるだけで使えるようにする。
 *   images/背景/夜空.png       →  「背景」グループの「夜空」
 *   images/うちの子.png         →  グループなしの「うちの子」
 *
 * スタンプ（stamps/）は試合ごとの小さいアイコン、
 * こちら（images/）はまとめ画像に敷く大きい絵、という住み分け。
 */

const fs = require('fs');
const path = require('path');

const IMAGE_DIR = path.join(__dirname, '..', 'images');
const EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'];
const CACHE_MS = 3000;

let cache = { at: 0, list: [] };

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
      if (!group) scanDir(full, entry.name, out);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (EXTENSIONS.indexOf(ext) === -1) continue;

    const relative = group ? group + '/' + entry.name : entry.name;
    out.push({
      file: relative,
      url: '/images/' + relative.split('/').map(encodeURIComponent).join('/'),
      label: path.basename(entry.name, ext),
      group: group || '画像'
    });
  }
}

/** 使える画像の一覧 */
function listImages(force) {
  const now = Date.now();
  if (!force && now - cache.at < CACHE_MS) return cache.list;

  const found = [];
  scanDir(IMAGE_DIR, '', found);
  cache = { at: now, list: found };
  return found;
}

/** 保存してよいファイル名かどうか（フォルダの外を指していないか） */
function safeFile(value) {
  const file = String(value == null ? '' : value).trim();
  if (!file) return '';
  if (file.indexOf('..') !== -1 || path.isAbsolute(file)) return '';
  // 「フォルダ名/ファイル名」までを許す
  if (!/^[^/\\]+(\/[^/\\]+)?$/.test(file)) return '';
  return file;
}

module.exports = { listImages, safeFile, IMAGE_DIR };
