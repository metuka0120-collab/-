'use strict';

/* =========================================================
   まとめ画像のデザイン（テーマ）
   - テーマごとに、背景・カード・勝敗ラベル・ひとことの枠の描き方と、
     おすすめのフォントを決める。
   - 文字そのものは summary.js が描く。ここは「入れ物」の見た目だけ。
   ========================================================= */

// ---------------------------------------------------------
// 描くための小さな道具
// ---------------------------------------------------------
function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** いつも同じ並びになる乱数（描き直すたびに飾りが動かないように） */
function seeded(seed) {
  var s = seed >>> 0 || 1;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** ステッカー風：ずらした影を下に敷き、太い線でふちどる */
function sticker(ctx, x, y, w, h, r, fill, ink, off, lw) {
  rr(ctx, x + off, y + off, w, h, r);
  ctx.fillStyle = ink;
  ctx.fill();
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = ink;
  ctx.stroke();
}

/** 5つの角の星 */
function star5(ctx, cx, cy, r, fill, ink, lw) {
  ctx.beginPath();
  for (var i = 0; i < 10; i++) {
    var rad = i % 2 ? r * 0.48 : r;
    var a = -Math.PI / 2 + i * Math.PI / 5;
    ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (ink) { ctx.lineWidth = lw || 2.5; ctx.lineJoin = 'round'; ctx.strokeStyle = ink; ctx.stroke(); }
}

/** キラッとした4つの角の光 */
function sparkle(ctx, cx, cy, r, fill) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + r * 0.16, cy - r * 0.16, cx + r, cy);
  ctx.quadraticCurveTo(cx + r * 0.16, cy + r * 0.16, cx, cy + r);
  ctx.quadraticCurveTo(cx - r * 0.16, cy + r * 0.16, cx - r, cy);
  ctx.quadraticCurveTo(cx - r * 0.16, cy - r * 0.16, cx, cy - r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** ハート */
function heart(ctx, cx, cy, s, fill) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.9);
  ctx.bezierCurveTo(cx - s * 1.3, cy + s * 0.1, cx - s * 0.75, cy - s * 0.95, cx, cy - s * 0.35);
  ctx.bezierCurveTo(cx + s * 0.75, cy - s * 0.95, cx + s * 1.3, cy + s * 0.1, cx, cy + s * 0.9);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** マスキングテープ */
function tape(ctx, cx, cy, w, h, angle, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  // 端をギザギザにして、ちぎった感じを出す
  ctx.beginPath();
  var teeth = 5, step = h / teeth;
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  for (var i = 0; i < teeth; i++) {
    ctx.lineTo(w / 2 - (i % 2 ? 0 : 3), -h / 2 + step * (i + 0.5));
    ctx.lineTo(w / 2, -h / 2 + step * (i + 1));
  }
  ctx.lineTo(-w / 2, h / 2);
  for (var j = teeth - 1; j >= 0; j--) {
    ctx.lineTo(-w / 2 + (j % 2 ? 0 : 3), -h / 2 + step * (j + 0.5));
    ctx.lineTo(-w / 2, -h / 2 + step * j);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 手で描いたような楕円（2回なぞって少しずらす） */
function handEllipse(ctx, cx, cy, rx, ry, color, lw) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, -0.05, Math.PI * 0.05, Math.PI * 2.1);
  ctx.stroke();
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = lw * 0.7;
  ctx.beginPath();
  ctx.ellipse(cx + 1.5, cy - 1, rx + 3, ry + 1.5, 0.04, Math.PI * 1.1, Math.PI * 2.95);
  ctx.stroke();
  ctx.restore();
}

/** ドット絵風のウィンドウ（角を1段かいた太いふち） */
function pixelBox(ctx, x, y, w, h, fill, border, bw) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  ctx.fillStyle = fill;
  ctx.fillRect(x + bw, y + bw, w - bw * 2, h - bw * 2);
  ctx.fillStyle = border;
  ctx.fillRect(x + bw, y, w - bw * 2, bw);          // 上
  ctx.fillRect(x + bw, y + h - bw, w - bw * 2, bw); // 下
  ctx.fillRect(x, y + bw, bw, h - bw * 2);          // 左
  ctx.fillRect(x + w - bw, y + bw, bw, h - bw * 2); // 右
}

/** 文字の幅（letterSpacing が使えるブラウザでは、それも含めて測れる） */
function textWidth(ctx, text) {
  return ctx.measureText(String(text)).width;
}

// ---------------------------------------------------------
// テーマ
//   fonts  … 部位ごとのおすすめフォント（自分で選んだものが優先）
//   c      … 色
//   gap    … カードとカードのすき間
// ---------------------------------------------------------
var SUMMARY_THEMES = {

  // ===== ポップ：クリーム色の水玉に、ふちどりステッカー =====
  pop: {
    label: 'ポップ',
    desc: '水玉とステッカー。元気でかわいい',
    swatch: ['#FFF7E8', '#FFE27A', '#FF9DB4', '#7BE3B0'],
    fonts: { title: 'mochiy', stats: 'mochiy', name: 'zenmaru', deck: 'zenmaru', comment: 'zenmaru', note: 'mochiy' },
    gap: 16,
    c: {
      text: '#2B2340', muted: '#6E6587', dim: '#968DAD', accent: '#7A5CFA', comment: '#4A4060',
      win: '#159A62', lose: '#E0416A', ink: '#2B2340',
      winFill: '#8BE8BC', loseFill: '#FFADC0', card: '#FFFFFF', paper: '#FFF7E8', dot: '#FFD9A0', yellow: '#FFE27A'
    },
    background: function (ctx, W, H, c) {
      ctx.fillStyle = c.paper;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = c.dot;
      ctx.globalAlpha = 0.55;
      for (var y = 14, row = 0; y < H + 20; y += 30, row++) {
        for (var x = row % 2 ? 29 : 14; x < W + 20; x += 30) {
          ctx.beginPath();
          ctx.arc(x, y, 3.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    },
    behindTitle: function (ctx, x, baseline, w, size, c) {
      // 蛍光ペンでなぞったような帯
      rr(ctx, x - 10, baseline - size * 0.42, w + 22, size * 0.52, size * 0.24);
      ctx.fillStyle = c.yellow;
      ctx.fill();
    },
    statsBox: function (ctx, x, y, w, h, c) { sticker(ctx, x, y, w, h, 20, c.card, c.ink, 5, 3); },
    card: function (ctx, x, y, w, h, isWin, c) { sticker(ctx, x, y, w, h, 16, c.card, c.ink, 4, 2.5); },
    badge: function (ctx, x, baseline, isWin, c, size, draw) {
      var label = isWin ? 'WIN' : 'LOSE';
      var w = textWidth(ctx, label) + size * 1.1;
      var h = size * 1.45;
      ctx.save();
      ctx.translate(x + w / 2, baseline - size * 0.36);
      ctx.rotate(isWin ? -0.07 : 0.06);
      sticker(ctx, -w / 2, -h / 2, w, h, h / 2, isWin ? c.winFill : c.loseFill, c.ink, 2.5, 2.2);
      ctx.fillStyle = c.ink;
      ctx.textAlign = 'center';
      draw(label, 0, size * 0.36);
      ctx.restore();
      return w;
    },
    divider: function (ctx, x1, x2, y, c) {
      ctx.save();
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.setLineDash([2, 10]);
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
      ctx.restore();
    },
    note: function (ctx, x, y, w, h, c) { sticker(ctx, x, y, w, h, 18, c.yellow, c.ink, 5, 3); },
    decorate: function (ctx, W, H, c) {
      star5(ctx, W - 34, 30, 15, c.yellow, c.ink, 2.5);
      star5(ctx, W - 66, 18, 8, c.loseFill, c.ink, 2);
      star5(ctx, 26, H - 30, 12, c.winFill, c.ink, 2.2);
    }
  },

  // ===== ゆめかわ：パステルのグラデーションにキラキラ =====
  yume: {
    label: 'ゆめかわ',
    desc: 'パステルとキラキラ。ふんわり可愛い',
    swatch: ['#F3E3FF', '#FFE3F1', '#DDF6F3', '#C9A0FF'],
    fonts: { title: 'hachimaru', stats: 'hachimaru', name: 'kiwimaru', deck: 'kiwimaru', comment: 'kiwimaru', note: 'hachimaru' },
    gap: 14,
    c: {
      text: '#6A4A8C', muted: '#9A7DB8', dim: '#B09BC8', accent: '#8D6BE8', comment: '#6E5A84',
      win: '#16A88E', lose: '#E65497', card: 'rgba(255,255,255,0.8)', glow: 'rgba(196,140,255,0.32)',
      winA: '#7FE7CF', winB: '#5CC8EC', loseA: '#FFA3CC', loseB: '#C9A0FF'
    },
    background: function (ctx, W, H, c) {
      var g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#F3E3FF');
      g.addColorStop(0.5, '#FFE3F1');
      g.addColorStop(1, '#DDF6F3');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // ふんわりした光のかたまり
      [[W * 0.12, 90, 260], [W * 0.92, H * 0.45, 320], [W * 0.3, H - 40, 280]].forEach(function (b) {
        var rg = ctx.createRadialGradient(b[0], b[1], 0, b[0], b[1], b[2]);
        rg.addColorStop(0, 'rgba(255,255,255,0.55)');
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, W, H);
      });

      var rnd = seeded(7);
      for (var i = 0; i < Math.round(W * H / 26000); i++) {
        var x = rnd() * W, y = rnd() * H, r = 3 + rnd() * 8;
        sparkle(ctx, x, y, r, rnd() < 0.7 ? 'rgba(255,255,255,0.95)' : 'rgba(255,236,160,0.9)');
      }
    },
    titleStroke: { color: '#FFFFFF', width: 9 },
    afterTitle: function (ctx, x, baseline, size, c) {
      heart(ctx, x + size * 0.45, baseline - size * 0.55, size * 0.2, '#FF9CCB');
      sparkle(ctx, x + size * 0.95, baseline - size * 0.85, size * 0.16, '#FFFFFF');
    },
    statsBox: function (ctx, x, y, w, h, c) {
      ctx.save();
      ctx.shadowColor = c.glow;
      ctx.shadowBlur = 22;
      ctx.shadowOffsetY = 6;
      rr(ctx, x, y, w, h, 28);
      ctx.fillStyle = c.card;
      ctx.fill();
      ctx.restore();
      rr(ctx, x, y, w, h, 28);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2;
      ctx.stroke();
    },
    card: function (ctx, x, y, w, h, isWin, c) {
      ctx.save();
      ctx.shadowColor = c.glow;
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 4;
      rr(ctx, x, y, w, h, 22);
      ctx.fillStyle = c.card;
      ctx.fill();
      ctx.restore();
    },
    badge: function (ctx, x, baseline, isWin, c, size, draw) {
      var label = isWin ? 'WIN' : 'LOSE';
      var w = textWidth(ctx, label) + size * 1.2;
      var h = size * 1.45;
      var top = baseline - size * 0.36 - h / 2;
      var g = ctx.createLinearGradient(x, top, x + w, top + h);
      g.addColorStop(0, isWin ? c.winA : c.loseA);
      g.addColorStop(1, isWin ? c.winB : c.loseB);
      rr(ctx, x, top, w, h, h / 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      draw(label, x + w / 2, baseline);
      sparkle(ctx, x + w - 4, top + 3, size * 0.32, '#FFFFFF');
      return w;
    },
    divider: function (ctx, x1, x2, y, c) {
      var g = ctx.createLinearGradient(x1, 0, x2, 0);
      g.addColorStop(0, 'rgba(201,160,255,0)');
      g.addColorStop(0.5, 'rgba(201,160,255,0.9)');
      g.addColorStop(1, 'rgba(255,163,204,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x1, y - 1, x2 - x1, 2);
    },
    note: function (ctx, x, y, w, h, c) {
      SUMMARY_THEMES.yume.card(ctx, x, y, w, h, true, c);
      rr(ctx, x + 6, y + 6, w - 12, h - 12, 18);
      ctx.save();
      ctx.setLineDash([7, 6]);
      ctx.strokeStyle = '#FFA3CC';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  },

  // ===== ノート：罫線の紙に手書き、マスキングテープ =====
  note: {
    label: 'ノート',
    desc: '罫線ノートに手書き。ゆるくておしゃれ',
    swatch: ['#FBF8F0', '#D6E6F2', '#FFD666', '#E2483D'],
    fonts: { title: 'yusei', stats: 'yusei', name: 'klee', deck: 'klee', comment: 'klee', note: 'yusei' },
    gap: 12,
    c: {
      text: '#2F3A4A', muted: '#5D6B7E', dim: '#8792A2', accent: '#D9701A', comment: '#3B4656',
      win: '#E2483D', lose: '#2F6FD0', paper: '#FBF8F0', rule: '#D6E6F2', margin: '#F0A9A9',
      tapeA: 'rgba(255,214,102,0.78)', tapeB: 'rgba(126,214,200,0.72)', tapeC: 'rgba(255,170,190,0.72)'
    },
    background: function (ctx, W, H, c) {
      ctx.fillStyle = c.paper;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = c.rule;
      for (var y = 44; y < H; y += 36) ctx.fillRect(0, y, W, 1.5);
      ctx.fillStyle = c.margin;
      ctx.fillRect(22, 0, 1.5, H);
      ctx.fillRect(27, 0, 1.5, H);
    },
    afterTitleUnderline: function (ctx, x, baseline, w, size, c) {
      // マーカーでぐるっと引いた波線
      ctx.save();
      ctx.strokeStyle = c.accent;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = Math.max(3, size * 0.09);
      ctx.lineCap = 'round';
      ctx.beginPath();
      var y = baseline + size * 0.2;
      for (var i = 0; i <= w; i += 4) {
        ctx.lineTo(x + i, y + Math.sin(i / 14) * 2.5);
      }
      ctx.stroke();
      ctx.restore();
    },
    statsBox: function (ctx, x, y, w, h, c) {
      rr(ctx, x, y, w, h, 8);
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.fill();
      ctx.save();
      ctx.strokeStyle = c.text;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.6;
      rr(ctx, x, y, w, h, 8);
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      rr(ctx, x + 2, y - 1.5, w - 1, h + 2, 9);
      ctx.stroke();
      ctx.restore();
      tape(ctx, x + w / 2, y - 2, 96, 26, -0.05, c.tapeA);
    },
    card: function (ctx, x, y, w, h, isWin, c, index) {
      rr(ctx, x, y, w, h, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.fill();
      var colors = [c.tapeB, c.tapeC, c.tapeA];
      tape(ctx, x + 22, y + 4, 54, 18, -0.5 + (index % 3) * 0.08, colors[index % 3]);
    },
    badge: function (ctx, x, baseline, isWin, c, size, draw) {
      var label = isWin ? 'WIN' : 'LOSE';
      var tw = textWidth(ctx, label);
      var w = tw + size * 1.3;
      ctx.fillStyle = isWin ? c.win : c.lose;
      ctx.textAlign = 'center';
      draw(label, x + w / 2, baseline);
      handEllipse(ctx, x + w / 2, baseline - size * 0.36, w / 2, size * 0.78, isWin ? c.win : c.lose, 2.2);
      return w;
    },
    divider: function (ctx, x1, x2, y, c) {
      ctx.save();
      ctx.strokeStyle = c.text;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([9, 7]);
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
      ctx.restore();
    },
    note: function (ctx, x, y, w, h, c) {
      ctx.save();
      ctx.shadowColor = 'rgba(60,50,20,0.18)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = '#FFF1A6';
      ctx.fillRect(x, y, w, h);
      ctx.restore();
      tape(ctx, x + 40, y + 2, 80, 24, -0.25, c.tapeB);
      tape(ctx, x + w - 40, y + 2, 80, 24, 0.22, c.tapeC);
    }
  },

  // ===== レトロゲーム：ドット文字とRPGのウィンドウ =====
  retro: {
    label: 'レトロゲーム',
    desc: 'ドット文字とRPGのウィンドウ',
    swatch: ['#15122E', '#FFD93D', '#45F07F', '#FF4D6D'],
    fonts: { title: 'dot', stats: 'dot', name: 'dot', deck: 'dot', comment: 'dot', note: 'dot' },
    gap: 12,
    c: {
      text: '#FFFFFF', muted: '#C3BEEA', dim: '#9A94CE', accent: '#FFD93D', comment: '#E6E3FF',
      win: '#45F07F', lose: '#FF5C7A', panel: '#1E1840', border: '#FFFFFF', shadow: '#E8436B'
    },
    background: function (ctx, W, H, c) {
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#15122E');
      g.addColorStop(1, '#2A1E57');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      var rnd = seeded(11);
      for (var i = 0; i < Math.round(W * H / 9000); i++) {
        var size = rnd() < 0.8 ? 2 : 4;
        ctx.fillStyle = rnd() < 0.85 ? 'rgba(255,255,255,0.75)' : 'rgba(255,217,61,0.9)';
        ctx.fillRect(Math.round(rnd() * W), Math.round(rnd() * H), size, size);
      }
      // 走査線
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      for (var y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 2);
    },
    titleShadow: { color: '#E8436B', x: 4, y: 4 },
    titleColor: '#FFD93D',
    statsBox: function (ctx, x, y, w, h, c) {
      pixelBox(ctx, x, y, w, h, c.panel, c.border, 5);
      pixelBox(ctx, x + 9, y + 9, w - 18, h - 18, c.panel, 'rgba(255,255,255,0.25)', 2);
    },
    card: function (ctx, x, y, w, h, isWin, c) {
      pixelBox(ctx, x, y, w, h, c.panel, 'rgba(255,255,255,0.85)', 4);
      ctx.fillStyle = isWin ? c.win : c.lose;
      ctx.fillRect(Math.round(x) + 4, Math.round(y) + 4, 6, Math.round(h) - 8);
    },
    badge: function (ctx, x, baseline, isWin, c, size, draw) {
      var label = isWin ? 'WIN' : 'LOSE';
      var w = Math.round(textWidth(ctx, label) + size * 1.0);
      var h = Math.round(size * 1.5);
      var top = Math.round(baseline - size * 0.36 - h / 2);
      ctx.fillStyle = '#000000';
      ctx.fillRect(Math.round(x) + 3, top + 3, w, h);
      ctx.fillStyle = isWin ? c.win : c.lose;
      ctx.fillRect(Math.round(x), top, w, h);
      ctx.fillStyle = '#120F26';
      ctx.textAlign = 'center';
      draw(label, x + w / 2, baseline);
      return w + 3;
    },
    divider: function (ctx, x1, x2, y, c) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (var x = x1; x < x2; x += 12) ctx.fillRect(Math.round(x), Math.round(y) - 2, 6, 4);
    },
    note: function (ctx, x, y, w, h, c) {
      pixelBox(ctx, x, y, w, h, '#0E0B22', c.border, 5);
      // メッセージの続きを知らせる ▼
      ctx.fillStyle = c.accent;
      var tx = Math.round(x + w - 30), ty = Math.round(y + h - 22);
      ctx.fillRect(tx, ty, 12, 3);
      ctx.fillRect(tx + 2, ty + 3, 8, 3);
      ctx.fillRect(tx + 4, ty + 6, 4, 3);
    }
  },

  // ===== シック：生成りの紙に明朝、細い線だけ =====
  chic: {
    label: 'シック',
    desc: '生成りの紙と明朝体。大人っぽく上品',
    swatch: ['#F4EFE6', '#26231F', '#9A7445', '#A84B36'],
    fonts: { title: 'shippori', stats: 'shippori', name: 'shippori', deck: 'zenkaku', comment: 'zenkaku', note: 'shippori' },
    gap: 0,
    titleSpacing: 3,
    c: {
      text: '#26231F', muted: '#6F675C', dim: '#9B9284', accent: '#94703F', comment: '#4A443C',
      win: '#4E6E4A', lose: '#A84B36', paper: '#F4EFE6', line: '#D3C8B5'
    },
    background: function (ctx, W, H, c) {
      ctx.fillStyle = c.paper;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = c.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(16.5, 16.5, W - 33, H - 33);
      ctx.globalAlpha = 0.55;
      ctx.strokeRect(22.5, 22.5, W - 45, H - 45);
      ctx.globalAlpha = 1;
    },
    statsBox: function (ctx, x, y, w, h, c) {
      ctx.fillStyle = c.line;
      ctx.fillRect(x, y, w, 1);
      ctx.fillRect(x, y + h - 1, w, 1);
      ctx.fillRect(x + w / 3, y + 16, 1, h - 32);
      ctx.fillRect(x + w * 2 / 3, y + 16, 1, h - 32);
    },
    card: function (ctx, x, y, w, h, isWin, c) {
      // 上には見出しの線があるので、下にだけ細い線を引く
      ctx.fillStyle = c.line;
      ctx.fillRect(x, y + h - 1, w, 1);
    },
    badge: function (ctx, x, baseline, isWin, c, size, draw) {
      var label = isWin ? 'WIN' : 'LOSE';
      var old = ctx.letterSpacing;
      if (old !== undefined) ctx.letterSpacing = '3px';
      var w = textWidth(ctx, label) + size * 1.1;
      var h = size * 1.5;
      var top = baseline - size * 0.36 - h / 2;
      rr(ctx, x, top, w, h, 3);
      ctx.strokeStyle = isWin ? c.win : c.lose;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = isWin ? c.win : c.lose;
      ctx.textAlign = 'center';
      draw(label, x + w / 2 + 1.5, baseline);
      if (old !== undefined) ctx.letterSpacing = old;
      return w;
    },
    divider: function (ctx, x1, x2, y, c) {
      ctx.fillStyle = c.text;
      ctx.fillRect(x1, y, x2 - x1, 1.2);
    },
    note: function (ctx, x, y, w, h, c) {
      ctx.fillStyle = c.line;
      ctx.fillRect(x + w * 0.2, y, w * 0.6, 1);
      ctx.fillRect(x + w * 0.2, y + h - 1, w * 0.6, 1);
    }
  },

  // ===== クラシック（これまでの見た目） =====
  classic: {
    label: 'クラシック（黒）',
    desc: 'これまでの見た目',
    swatch: ['#12141F', '#1D1636', '#63B8FF', '#3FDC92'],
    fonts: { title: 'gothic', stats: 'gothic', name: 'gothic', deck: 'gothic', comment: 'gothic', note: 'gothic' },
    gap: 10,
    useAccent: true,
    c: {
      text: '#f2f5fb', muted: '#9aa5c0', dim: '#727d9b', comment: '#dbe2f2',
      win: '#3fdc92', lose: '#ff6d79', card: 'rgba(255,255,255,0.045)', cardLine: 'rgba(255,255,255,0.09)',
      winBg: 'rgba(63,220,146,0.18)', loseBg: 'rgba(255,109,121,0.18)', line: 'rgba(255,255,255,0.13)',
      bg1: '#12141f', bg2: '#1d1636'
    },
    background: function (ctx, W, H, c) {
      var g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, c.bg1);
      g.addColorStop(1, c.bg2);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    },
    topBar: true,
    statsBox: function (ctx, x, y, w, h, c) {
      rr(ctx, x, y, w, h, 14);
      ctx.fillStyle = c.card; ctx.fill();
      ctx.strokeStyle = c.cardLine; ctx.lineWidth = 1; ctx.stroke();
    },
    card: function (ctx, x, y, w, h, isWin, c) {
      rr(ctx, x, y, w, h, 11);
      ctx.fillStyle = c.card; ctx.fill();
      ctx.strokeStyle = c.cardLine; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = isWin ? c.win : c.lose;
      rr(ctx, x, y, 5, h, 3);
      ctx.fill();
    },
    badge: function (ctx, x, baseline, isWin, c, size, draw) {
      var label = isWin ? 'WIN' : 'LOSE';
      var w = Math.max(size * 3.4, textWidth(ctx, label) + size);
      var h = size + 12;
      rr(ctx, x, baseline - size - 2, w, h, 6);
      ctx.fillStyle = isWin ? c.winBg : c.loseBg;
      ctx.fill();
      ctx.fillStyle = isWin ? c.win : c.lose;
      ctx.textAlign = 'center';
      draw(label, x + w / 2, baseline + 1);
      return w;
    },
    divider: function (ctx, x1, x2, y, c) {
      ctx.fillStyle = c.line;
      ctx.fillRect(x1, y, x2 - x1, 1);
    },
    note: function (ctx, x, y, w, h, c) { SUMMARY_THEMES.classic.statsBox(ctx, x, y, w, h, c); }
  }
};

// クラシック（白）は、クラシックの色だけを変えたもの
SUMMARY_THEMES.classicLight = Object.assign({}, SUMMARY_THEMES.classic, {
  label: 'クラシック（白）',
  desc: 'これまでの見た目（白背景）',
  swatch: ['#F4F7FC', '#E3E9F6', '#1F7AE0', '#0F9D58'],
  light: true,
  c: {
    text: '#161a24', muted: '#5a6480', dim: '#8d96ab', comment: '#333a4a',
    win: '#0f9d58', lose: '#d93843', card: '#ffffff', cardLine: '#d5dceb',
    winBg: 'rgba(15,157,88,0.13)', loseBg: 'rgba(217,56,67,0.13)', line: '#dfe4ee',
    bg1: '#f4f7fc', bg2: '#e3e9f6'
  }
});

var SUMMARY_THEME_ORDER = ['pop', 'yume', 'note', 'retro', 'chic', 'classic', 'classicLight'];
