'use strict';

/**
 * リスナーのアイコン画像を、自分のPCに保存しておく。
 *
 * わんコメが渡してくるアイコンのURLは配信サイトのもので、
 *   ・しばらくすると見られなくなることがある
 *   ・別サイトの画像なので、まとめ画像（Canvas）に描くと画像を保存できなくなる
 * ため、いったんダウンロードして data/icons/ に置き、自分のサーバーから配る。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ICON_DIR = path.join(__dirname, '..', 'data', 'icons');
const MAX_BYTES = 2 * 1024 * 1024; // 2MB を超える画像は諦める
const TIMEOUT_MS = 6000;

const EXT_BY_TYPE = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp'
};

/** 同じURLからは同じファイル名になるようにする */
function fileNameFor(url, ext) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 20) + ext;
}

function ensureDir() {
  if (!fs.existsSync(ICON_DIR)) fs.mkdirSync(ICON_DIR, { recursive: true });
}

/** すでに保存済みならそのパスを返す */
function findCached(url) {
  ensureDir();
  for (const ext of ['.png', '.jpg', '.gif', '.webp', '.svg', '.bmp']) {
    const name = fileNameFor(url, ext);
    if (fs.existsSync(path.join(ICON_DIR, name))) return '/icons/' + name;
  }
  return '';
}

/**
 * アイコンを保存して、自分のサーバー上のパス（/icons/xxxx.png）を返す。
 * 失敗したら空文字を返す（アイコンが無くても記録はできる）。
 */
async function cacheIcon(rawUrl) {
  const url = String(rawUrl == null ? '' : rawUrl).trim();
  if (!url) return '';

  // すでにこのアプリが配っている画像なら、そのまま使う
  if (url.indexOf('/icons/') === 0 || url.indexOf('/stamps/') === 0) return url;

  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';

  const already = findCached(url);
  if (already) return already;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) return '';

    const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = EXT_BY_TYPE[type];
    if (!ext) return ''; // 画像以外は保存しない

    const length = Number(res.headers.get('content-length'));
    if (length && length > MAX_BYTES) return '';

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_BYTES || buffer.length === 0) return '';

    ensureDir();
    const name = fileNameFor(url, ext);
    const tmp = path.join(ICON_DIR, name + '.tmp');
    await fs.promises.writeFile(tmp, buffer);
    await fs.promises.rename(tmp, path.join(ICON_DIR, name));
    return '/icons/' + name;
  } catch (err) {
    return ''; // 落とせなくても記録は続けられる
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { cacheIcon, findCached, ICON_DIR };
