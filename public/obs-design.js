'use strict';

/* =========================================================
   OBS用の画面（OBS表示・参加待ちテロップ）で共通のデザイン
   - 記録画面の「OBS表示のデザイン」で選んだテーマとフォントを当てる
   - ?theme=pop のように URL で決めることもできる
   ========================================================= */

const DESIGN_PARAMS = new URLSearchParams(location.search);

// ---------------------------------------------------------
// デザイン（テーマとフォント）
// ---------------------------------------------------------
const THEMES = ['pop', 'yume', 'note', 'retro', 'chic', 'classic'];
const URL_THEME = THEMES.indexOf(DESIGN_PARAMS.get('theme')) !== -1 ? DESIGN_PARAMS.get('theme') : '';

/** テーマごとのおすすめフォント（name … リスナー名、label … ラベルや数字） */
const THEME_FONTS = {
  pop:     { name: 'mochiy',    label: 'zenmaru' },
  yume:    { name: 'hachimaru', label: 'kiwimaru' },
  note:    { name: 'yusei',     label: 'klee' },
  retro:   { name: 'dot',       label: 'dot' },
  chic:    { name: 'shippori',  label: 'zenkaku' },
  classic: { name: 'gothic',    label: 'gothic' }
};
const FALLBACK_FONT = '"Yu Gothic UI", "Meiryo", "Segoe UI", system-ui, sans-serif';

function fontInfo(id) {
  const list = window.FONT_LIST || [];
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function fontStack(value) {
  value = String(value || '');
  if (value.indexOf('custom:') === 0) return '"' + value.slice(7).replace(/"/g, '') + '", ' + FALLBACK_FONT;
  const info = fontInfo(value);
  return info ? info.stack : FALLBACK_FONT;
}

// 同梱フォントは、使うものだけ読み込む（OBSを軽くするため）
const linkedFonts = new Set();
function loadFonts(ids) {
  const missing = ids.filter((id) => {
    const info = fontInfo(id);
    return info && info.group === 'bundled' && !linkedFonts.has(id);
  });
  if (!missing.length) return;
  missing.forEach((id) => linkedFonts.add(id));
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/fonts.css?ids=' + missing.join(',');
  document.head.appendChild(link);
}

let lastDesign = '';
function applyDesign(settings) {
  const design = settings.overlay || {};
  const theme = URL_THEME || (THEMES.indexOf(design.theme) !== -1 ? design.theme : 'pop');
  const fonts = design.fonts || {};
  const sizes = design.sizes || {};
  const nameFont = fonts.name || THEME_FONTS[theme].name;
  const labelFont = fonts.label || THEME_FONTS[theme].label;
  const nameScale = (Number(sizes.name) || 100) / 100;
  const labelScale = (Number(sizes.label) || 100) / 100;

  const key = [theme, nameFont, labelFont, nameScale, labelScale].join('|');
  if (key === lastDesign) return;
  lastDesign = key;

  document.body.className = 'th-' + theme;
  // body の文字にも効かせたいので、いちばん外側に置く
  const root = document.documentElement.style;
  root.setProperty('--font-name', fontStack(nameFont));
  root.setProperty('--font-label', fontStack(labelFont));
  root.setProperty('--ns', String(nameScale));
  root.setProperty('--ls', String(labelScale));
  loadFonts([nameFont, labelFont]);
}
