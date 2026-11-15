'use strict';

/**
 * まとめ画像とOBS表示で選べるフォント。
 *
 *   bundled … アプリに同梱しているフォント（どのPCでも同じ見た目になる）
 *             node_modules/@fontsource から配る。ネット接続は不要。
 *   windows … Windows（または Office）に入っているフォント
 *
 * どれにも無いフォントは「custom:フォント名」で、PCに入っている名前をそのまま使える。
 */

const fs = require('fs');
const path = require('path');

const FONTSOURCE_DIR = path.join(__dirname, '..', 'node_modules', '@fontsource');

// 文字が無いときの代わり（絵文字や記号など）
const FALLBACK = '"Yu Gothic UI", "Yu Gothic", "Meiryo", "Hiragino Sans", sans-serif';

const FONTS = [
  // ---- 同梱フォント ----
  { id: 'zenmaru',   group: 'bundled', label: 'やさしい丸ゴシック',     family: 'Zen Maru Gothic',     pkg: 'zen-maru-gothic',     weights: [500, 900] },
  { id: 'kiwimaru',  group: 'bundled', label: 'ふんわり丸文字',         family: 'Kiwi Maru',           pkg: 'kiwi-maru',           weights: [500] },
  { id: 'mochiy',    group: 'bundled', label: 'ぽってりポップ',         family: 'Mochiy Pop One',      pkg: 'mochiy-pop-one',      weights: [400] },
  { id: 'hachimaru', group: 'bundled', label: 'まるもじ（ゆめかわ）',   family: 'Hachi Maru Pop',      pkg: 'hachi-maru-pop',      weights: [400] },
  { id: 'rocknroll', group: 'bundled', label: 'げんき丸ゴシック',       family: 'RocknRoll One',       pkg: 'rocknroll-one',       weights: [400] },
  { id: 'yusei',     group: 'bundled', label: 'マジックペン手書き',     family: 'Yusei Magic',         pkg: 'yusei-magic',         weights: [400] },
  { id: 'klee',      group: 'bundled', label: 'えんぴつ手書き',         family: 'Klee One',            pkg: 'klee-one',            weights: [600] },
  { id: 'dela',      group: 'bundled', label: '極太（ゲーム風）',       family: 'Dela Gothic One',     pkg: 'dela-gothic-one',     weights: [400] },
  { id: 'dot',       group: 'bundled', label: 'ドット文字（レトロ）',   family: 'DotGothic16',         pkg: 'dotgothic16',         weights: [400] },
  { id: 'shippori',  group: 'bundled', label: '上品な明朝',             family: 'Shippori Mincho',     pkg: 'shippori-mincho',     weights: [600] },
  { id: 'zenkaku',   group: 'bundled', label: 'すっきりゴシック',       family: 'Zen Kaku Gothic New', pkg: 'zen-kaku-gothic-new', weights: [500, 900] },

  // ---- Windows に入っているフォント ----
  { id: 'gothic',   group: 'windows', label: '游ゴシック（標準）',      stack: '"Yu Gothic UI", "Yu Gothic"' },
  { id: 'ud',       group: 'windows', label: 'BIZ UDPゴシック',          stack: '"BIZ UDPGothic", "BIZ UDGothic"' },
  { id: 'meiryo',   group: 'windows', label: 'メイリオ',                 stack: '"Meiryo"' },
  { id: 'mincho',   group: 'windows', label: '游明朝',                   stack: '"Yu Mincho", "BIZ UDPMincho", "MS PMincho"' },
  { id: 'kyokasho', group: 'windows', label: 'UDデジタル教科書体',       stack: '"UD Digi Kyokasho NP-R", "UD Digi Kyokasho N-R"' },
  { id: 'hgmaru',   group: 'windows', label: 'HG丸ゴシック（Office）',   stack: '"HG丸ｺﾞｼｯｸM-PRO", "HG丸ゴシックM-PRO"' },
  { id: 'hgpop',    group: 'windows', label: 'HG創英角ポップ体（Office）', stack: '"HGP創英角ﾎﾟｯﾌﾟ体", "HG創英角ﾎﾟｯﾌﾟ体"' }
];

const BY_ID = new Map(FONTS.map((f) => [f.id, f]));

/** PCに入っているフォント名として受け付ける文字（CSSを壊す記号は通さない） */
function safeCustomName(name) {
  const clean = String(name == null ? '' : name).replace(/["'`\\;{}<>()\r\n\t]/g, '').trim();
  return clean.slice(0, 40);
}

/**
 * 保存できるフォント指定かどうかを確かめて、整えた値を返す。
 * 使えないものは null。
 */
function normalizeFontValue(value) {
  const text = String(value == null ? '' : value);
  if (BY_ID.has(text)) return text;
  if (text.indexOf('custom:') === 0) {
    const name = safeCustomName(text.slice(7));
    return name ? 'custom:' + name : null;
  }
  return null;
}

/** 画面側に渡す一覧（中身を知られても困らない情報だけ） */
function fontList() {
  return FONTS.map((f) => ({
    id: f.id,
    group: f.group,
    label: f.label,
    family: f.family || '',
    stack: (f.family ? '"' + f.family + '", ' : (f.stack + ', ')) + FALLBACK
  }));
}

/**
 * 同梱フォントの @font-face をまとめたCSSを作る。
 * - woff2 だけを使う（今のブラウザとOBSはすべて読める）
 * - 太さは範囲で登録する。1種類しか無いフォントを太字で描いても
 *   ブラウザがにせの太字を作らず、そのまま使われるようにするため。
 * - 日本語は文字のまとまりごとにファイルが分かれていて、使う文字のぶんだけ読まれる。
 */
const cssCache = new Map();
function fontCss(onlyIds) {
  const wanted = Array.isArray(onlyIds) && onlyIds.length ? onlyIds.filter((id) => BY_ID.has(id)).sort() : null;
  const key = wanted ? wanted.join(',') : '*';
  if (cssCache.has(key)) return cssCache.get(key);

  const parts = ['/* 同梱フォント（自動で作っています） */'];
  for (const font of FONTS) {
    if (!font.pkg) continue;
    if (wanted && wanted.indexOf(font.id) === -1) continue;
    font.weights.forEach((weight, index) => {
      const file = path.join(FONTSOURCE_DIR, font.pkg, weight + '.css');
      let source;
      try {
        source = fs.readFileSync(file, 'utf8');
      } catch (err) {
        parts.push('/* ' + font.pkg + ' ' + weight + ' が見つかりません */');
        return;
      }

      // 太さを受け持つ範囲。2種類あるときは、ふつう（〜600）と太字（700〜）で分ける
      let range = '1 1000';
      if (font.weights.length > 1) range = index === 0 ? '1 600' : '601 1000';

      const blocks = source.match(/@font-face\s*\{[^}]*\}/g) || [];
      for (const block of blocks) {
        const woff2 = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(block);
        if (!woff2) continue;
        const unicode = /unicode-range:\s*([^;]+);/.exec(block);
        parts.push(
          '@font-face{font-family:"' + font.family + '";font-style:normal;font-display:swap;' +
          'font-weight:' + range + ';' +
          'src:url(/fontsource/' + font.pkg + '/files/' + woff2[1] + ') format("woff2");' +
          (unicode ? 'unicode-range:' + unicode[1].trim() + ';' : '') + '}'
        );
      }
    });
  }
  const css = parts.join('\n');
  cssCache.set(key, css);
  return css;
}

/** 配っているフォントファイルの一覧（ZIPを作るときに、要らないものを省くため） */
function usedFontFiles() {
  const files = [];
  for (const font of FONTS) {
    if (!font.pkg) continue;
    for (const weight of font.weights) {
      const file = path.join(FONTSOURCE_DIR, font.pkg, weight + '.css');
      let source = '';
      try { source = fs.readFileSync(file, 'utf8'); } catch (err) { continue; }
      const re = /url\(\.\/files\/([^)]+\.woff2)\)/g;
      let m;
      while ((m = re.exec(source))) files.push(path.join(font.pkg, 'files', m[1]));
    }
  }
  return files;
}

module.exports = { FONTS, FONTSOURCE_DIR, normalizeFontValue, safeCustomName, fontList, fontCss, usedFontFiles };
