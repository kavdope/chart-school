/* Chart School: app engine. Plain JS, no dependencies, works offline. Content scripts load first (see index.html). */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const LEVELS = CS.levels.sort((a, b) => a.n - b.n);
LEVELS.forEach(L => L.lessons.forEach((l, i) => { l.level = L.n; l.idx = i; }));
const LESSONS = LEVELS.flatMap(L => L.lessons);
const LMAP = Object.fromEntries(LESSONS.map(l => [l.id, l]));
const GLOSSARY = CS.glossary;
const G = Object.fromEntries(GLOSSARY.map(g => [g[0], g]));
const FOOT = '<p class="foot">Educational only, not financial advice. Not affiliated with ICT. <a href="#about">Disclaimer &amp; About</a></p>';

/* ---------------- Mini markup ----------------
   blocks: "## h2", "### h3", "- list", "1. list", "> callout", "<raw html>", "{{widget}}", else paragraph
   inline: **bold**, *italic*, `code`, [[termkey]] or [[termkey|shown text]] */
function inline(s) {
  return s.replace(/\[\[([a-z0-9_]+)(?:\|([^\]]+))?\]\]/g, (m, k, t) => `<span class="term" data-t="${k}">${t || (G[k] ? G[k][1] : k)}</span>`)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');
}
function md(src) {
  const out = [], lines = String(src).trim().split('\n').map(x => x.trim());
  let buf = [], kind = null;
  const flush = () => {
    if (!buf.length) return;
    if (kind === 'ul') out.push('<ul>' + buf.map(x => `<li>${inline(x.slice(2))}</li>`).join('') + '</ul>');
    else if (kind === 'ol') out.push('<ol>' + buf.map(x => `<li>${inline(x.replace(/^\d+\. /, ''))}</li>`).join('') + '</ol>');
    else if (kind === 'q') out.push(`<div class="callout">${inline(buf.map(x => x.replace(/^> ?/, '')).join(' '))}</div>`);
    else if (kind === 'raw') out.push(buf.join('\n'));
    else out.push(`<p>${inline(buf.join(' '))}</p>`);
    buf = []; kind = null;
  };
  for (const ln of lines) {
    if (!ln) { flush(); continue; }
    if (ln.startsWith('{{')) { flush(); out.push(widget(ln.slice(2, -2).trim())); continue; }
    if (ln.startsWith('### ')) { flush(); out.push(`<h3>${inline(ln.slice(4))}</h3>`); continue; }
    if (ln.startsWith('## ')) { flush(); out.push(`<h2>${inline(ln.slice(3))}</h2>`); continue; }
    const k = ln.startsWith('- ') ? 'ul' : /^\d+\. /.test(ln) ? 'ol' : ln.startsWith('> ') ? 'q' : ln.startsWith('<') ? 'raw' : 'p';
    if (k !== kind) flush();
    kind = k; buf.push(ln);
  }
  flush();
  return out.join('\n');
}

/* ---------------- State ---------------- */
const KEY = 'chartschool.v2';
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const today = () => ymd(new Date());
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };
function load() {
  let s; try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  s = Object.assign({q: {}, days: [], spot: {}, take: {right: 0, total: 0}, fc: {}, fcNew: {}, start: 0, placed: false, unlockAll: false, plan: {}, calc: {}, dr: {}, drf: {k: 'all', lv: 0}, bm: {}, tv: {}, twAnn: true, mf: 'all'}, s || {});
  if (!s.days.includes(today())) s.days.push(today());
  s.days = s.days.slice(-400);
  return s;
}
let S = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
save();
function streak() { let n = 0; while (S.days.includes(daysAgo(n))) n++; return n; }
const passed = id => (S.q[id] || 0) >= 80;
const levelDone = L => L.lessons.filter(l => passed(l.id)).length;
const levelPassed = L => levelDone(L) === L.lessons.length;
function unlocked(L) {
  if (S.unlockAll || L.n <= S.start) return true;
  const prev = LEVELS.find(x => x.n === L.n - 1);
  return !prev || levelPassed(prev);
}

/* ---------------- Random + candle generation ---------------- */
function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const K = (o, h, l, c) => ({o, h, l, c});
/* walk(): candles that pass exactly through waypoint extremes.
   pts: prices (or {p, close}); legs: candle counts per leg, or {n:3, disp:true} for a displacement leg that leaves an FVG.
   Inside a leg no candle exceeds the leg's endpoints, so waypoint highs/lows are exact. Returns {c, at, fvg, v}. */
function walk(pts, legs, seed = 7, o = {}) {
  const R = rng(seed), r = (a, b) => a + R() * (b - a);
  const P = pts.map(p => typeof p === 'number' ? {p} : p);
  const ps = P.map(p => p.p), v = o.vol || (Math.max(...ps) - Math.min(...ps)) * 0.035;
  const c = [], at = [0], fvg = [];
  let price = P[0].p;
  legs.forEach((lg, i) => {
    const pa = P[i].p, pb = P[i + 1].p, d = pb >= pa ? 1 : -1, D = Math.abs(pb - pa);
    const n = typeof lg === 'number' ? lg : lg.n, disp = typeof lg === 'object' && lg.disp;
    const out = (u) => d === 1 ? K(pa + u.o, pa + u.h, pa + u.l, pa + u.c) : K(pa - u.o, pa - u.l, pa - u.h, pa - u.c);
    let uo = (price - pa) * d;
    const endClose = P[i + 1].close != null ? (P[i + 1].close - pa) * d : null;
    if (disp) {
      const pre = Math.max(0, n - 3);
      for (let k = 1; k <= pre; k++) { const cl = D * 0.04 * k + r(0, .2) * v; const u = {o: uo, c: cl, h: Math.max(uo, cl) + r(.05, .3) * v, l: Math.max(0.03 * v, Math.min(uo, cl) - r(.05, .3) * v)}; u.l = Math.min(u.l, u.o, u.c); c.push(out(u)); uo = cl; }
      const b1 = Math.max(uo, D * 0.04 * pre) + D * r(.06, .1);
      const u1 = {o: uo, c: b1, l: Math.max(0.02 * v, Math.min(uo, b1) - r(.1, .3) * v)}; u1.l = Math.min(u1.l, uo, b1); u1.h = b1 + r(.08, .25) * v;
      const b2 = D * r(.74, .82);
      const u2 = {o: b1, c: b2, l: b1 - r(0, .12) * v, h: b2 + r(.05, .15) * v};
      const cl3 = endClose != null ? endClose : D - r(.15, .45) * v, o3 = b2 - r(0, .08) * v;
      const lo3 = Math.min(u1.h + D * r(.18, .26), o3, cl3);
      const u3 = {o: o3, c: cl3, h: D, l: lo3};
      [u1, u2, u3].forEach(u => c.push(out(u)));
      const A = c[c.length - 3], B = c[c.length - 1];
      fvg.push(d === 1 ? {i: c.length - 3, top: B.l, bot: A.h, dir: 1} : {i: c.length - 3, top: A.l, bot: B.h, dir: -1});
      price = B.c;
    } else {
      for (let k = 1; k <= n; k++) {
        const last = k === n;
        const big = P[i + 1].big, sc = big ? 0.62 : 1;
        let cl = last ? (endClose != null ? endClose : big ? D - r(.05, .2) * v : D - Math.min(r(.15, .55) * v, D * .45)) : Math.min(Math.max(D * sc * k / n + r(-.45, .45) * v * sc, .06 * v), D - .06 * v);
        let h = Math.max(uo, cl) + r(0, .5) * v, l = Math.min(uo, cl) - r(0, .5) * v;
        h = last ? D : Math.min(h, D - .04 * v); l = Math.max(l, k === 1 ? .08 * v : .02 * v);
        h = Math.max(h, uo, cl); l = Math.min(l, uo, cl);
        c.push(out({o: uo, c: cl, h, l})); uo = cl;
      }
      price = c[c.length - 1].c;
    }
    at.push(c.length - 1);
  });
  return {c, at, fvg, v, P: ps};
}
function mirrorW(w, M) {
  w.c = w.c.map(k => K(M - k.o, M - k.l, M - k.h, M - k.c));
  w.fvg = w.fvg.map(f => ({i: f.i, top: M - f.bot, bot: M - f.top, dir: -f.dir}));
  w.P = w.P.map(p => M - p);
  return w;
}

/* ---------------- Chart rendering ---------------- */
function chart(c, o = {}) {
  const W = o.w || 360, H = o.h || 200, pl = o.pl || 6, pr = o.pr || 6, pt = o.pt || 16, pb = o.pb || 16;
  let hi = Math.max(...c.map(k => k.h), ...(o.extra || [])), lo = Math.min(...c.map(k => k.l), ...(o.extra || []));
  const padv = (hi - lo) * 0.04; hi += padv; lo -= padv;
  const sp = (W - pl - pr) / Math.max(c.length, o.slots || 0), cw = Math.max(2, sp * (o.bw || 0.62));
  const x = i => pl + sp * i + sp / 2, y = p => pt + (hi - p) / (hi - lo) * (H - pt - pb);
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">`;
  (o.zones || []).forEach(z => {
    const x0 = x(z.i0) - sp / 2, x1 = z.i1 == null ? W - pr : x(z.i1) + sp / 2;
    s += `<rect x="${x0}" y="${y(z.top)}" width="${x1 - x0}" height="${Math.max(1, y(z.bot) - y(z.top))}" fill="${z.fill || 'rgba(0,0,0,.08)'}" stroke="${z.stroke || 'none'}" stroke-width="1" ${z.dash ? 'stroke-dasharray="3 2"' : ''}/>`;
    if (z.label) s += z.out ? `<text x="${x1 + 4}" y="${y(z.top) + 8}" font-size="8.5" fill="#555">${z.label}</text>` : `<text x="${z.la === 'start' ? x0 + 3 : x1 - 3}" y="${z.lb ? y(z.bot) - 3 : y(z.top) + 10}" text-anchor="${z.la || 'end'}" font-size="8.5" fill="${z.lc || '#555'}">${z.label}</text>`;
  });
  (o.lines || []).forEach(l => {
    const x0 = l.i0 == null ? pl : x(l.i0) - sp / 2, x1 = l.i1 == null ? W - pr : x(l.i1) + sp / 2;
    s += `<line x1="${x0}" x2="${x1}" y1="${y(l.y)}" y2="${y(l.y)}" stroke="${l.c || '#000'}" stroke-width="${l.sw || 0.8}" ${l.dash ? `stroke-dasharray="${l.dash}"` : ''}/>`;
    if (l.label && l.out) s += `<text x="${x1 + 4}" y="${y(l.y) + 3}" font-size="8.5" fill="${l.c || '#000'}">${l.label}</text>`;
    else if (l.label) s += `<text x="${l.la === 'start' ? x0 + 2 : x1 - 2}" y="${y(l.y) + (l.below ? 10 : -3)}" text-anchor="${l.la || 'end'}" font-size="8.5" fill="${l.c || '#000'}">${l.label}</text>`;
  });
  c.forEach((k, i) => {
    const bull = k.c >= k.o, X = x(i), top = y(Math.max(k.o, k.c)), bh = Math.max(1, y(Math.min(k.o, k.c)) - top);
    const dim = o.dim && o.dim(i);
    s += `<g opacity="${dim ? 0.35 : 1}"><line x1="${X}" x2="${X}" y1="${y(k.h)}" y2="${y(k.l)}" stroke="#000" stroke-width="1"/>` +
      `<rect x="${X - cw / 2}" y="${top}" width="${cw}" height="${bh}" fill="${bull ? '#fff' : '#000'}" stroke="#000" stroke-width="1"/></g>`;
  });
  (o.labels || []).forEach(L => {
    const k = c[L.i], above = L.pos !== 'below';
    const yy = above ? y(k.h) - 5 : y(k.l) + 12;
    if (L.circle) s += `<circle cx="${x(L.i)}" cy="${yy - 3}" r="6.5" fill="#fff" stroke="#000" stroke-width=".8"/>`;
    const lx = x(L.i), anc = lx > W - 30 ? 'end' : lx < 30 ? 'start' : 'middle', tx = anc === 'end' ? lx + 4 : anc === 'start' ? lx - 4 : lx;
    s += `<text x="${L.circle ? lx : tx}" y="${yy}" text-anchor="${L.circle ? 'middle' : anc}" font-size="${L.fs || 9}" font-weight="${L.fw || 600}" fill="${L.c || '#000'}">${L.text}</text>`;
  });
  (o.marks || []).forEach(m => { s += m(x, y, sp); });
  s += '</svg>';
  return {svg: s, x, y, sp, W, H, hi, lo};
}
/* plot(): walk + annotations in one compact spec (used by lesson content).
   ann: ['line', wp, label, {to:wp, dash, c}] | ['lvl', price, label, {i0, i1}] | ['zone', wpOrIdx, top, bot, label, {to}]
        ['fvg', n, label] | ['lab', wp, text, 'above'|'below'] | ['ob', wp, label] | ['txt', wp, text, 'above'|'below'] */
function plot(sp) {
  const w = walk(sp.pts, sp.legs, sp.seed || 7, sp);
  if (sp.mirror) mirrorW(w, sp.mirror);
  const ix = a => typeof a === 'object' && a ? a.c : w.at[a];
  const price = a => w.P[a];
  const isHigh = a => { const p = w.P[a], q = w.P[a - 1] != null ? w.P[a - 1] : w.P[a + 1]; return p >= q; };
  const o = {h: sp.h || 200, zones: [], lines: [], labels: [], marks: [], pr: sp.pr || 46, pt: sp.pt || 18, pb: sp.pb || 18, extra: sp.extra};
  (sp.ann || []).forEach(a => {
    const [t] = a, op = a[a.length - 1] && typeof a[a.length - 1] === 'object' && !Array.isArray(a[a.length - 1]) && t !== 'zone' ? a[a.length - 1] : {};
    if (t === 'line') o.lines.push({i0: ix(a[1]), i1: op.to != null ? ix(op.to) : null, y: price(a[1]), dash: op.dash || '3 2', label: a[2], out: op.to == null, c: op.c, la: op.la || 'start', below: !isHigh(a[1])});
    if (t === 'lvl') o.lines.push({i0: op.i0 != null ? ix(op.i0) : null, i1: op.i1 != null ? ix(op.i1) : null, y: a[1], dash: op.dash || '3 2', label: a[2], out: op.i1 == null, c: op.c});
    if (t === 'zone') { const z = a[5] || {}; o.zones.push({i0: ix(a[1]), i1: z.to != null ? ix(z.to) : null, top: a[2], bot: a[3], label: a[4], out: z.to == null, fill: z.fill}); }
    if (t === 'fvg') { const f = w.fvg[a[1] || 0]; if (f) { o.zones.push({i0: f.i, top: f.top, bot: f.bot, label: a[2] || 'FVG', out: 1}); if (a[3] !== false) o.lines.push({i0: f.i, y: (f.top + f.bot) / 2, dash: '3 2', sw: .6}); } }
    if (t === 'ob') { const i = ix(a[1]), k = w.c[i]; o.zones.push({i0: i, top: Math.max(k.o, k.c), bot: Math.min(k.o, k.c), label: a[2] || 'OB', out: 1, fill: 'rgba(0,0,0,.12)'}); }
    if (t === 'lab' || t === 'txt') { const pos = a[3] || (isHigh(a[1]) ? 'above' : 'below'); o.labels.push({i: ix(a[1]), text: a[2], pos, fs: t === 'txt' ? 8.5 : 9, fw: t === 'txt' ? 400 : 600, c: t === 'txt' ? '#555' : '#000'}); }
  });
  return chart(w.c, o).svg;
}

/* ---------------- Simple non-candle diagrams ---------------- */
const SVG0 = (W, H) => `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">`;
// Price ladder: rows [{p, label, note, kind:'cur'|'buy'|'sell'|'muted'}]
function ladder(rows, o = {}) {
  const W = 360, H = o.h || 170, ps = rows.map(r => r.p), hi = Math.max(...ps), lo = Math.min(...ps), pad = (hi - lo) * 0.15 || 1;
  const y = p => 14 + (hi + pad - p) / (hi - lo + 2 * pad) * (H - 28);
  let s = SVG0(W, H) + `<line x1="70" x2="70" y1="6" y2="${H - 6}" stroke="#E5E5E5"/>`;
  rows.forEach(r => {
    const Y = y(r.p), col = r.kind === 'sell' ? '#c0392b' : r.kind === 'buy' ? '#1f8a4c' : r.kind === 'muted' ? '#999' : '#000';
    s += `<text x="62" y="${Y + 3}" text-anchor="end" font-size="9" fill="#555">${r.p}</text>`;
    s += `<line x1="70" x2="${W - 6}" y1="${Y}" y2="${Y}" stroke="${col}" stroke-width="${r.kind === 'cur' ? 1.4 : .9}" ${r.kind === 'cur' ? '' : 'stroke-dasharray="4 3"'}/>`;
    s += `<text x="78" y="${Y - 4}" font-size="9.5" font-weight="600" fill="${col}">${r.label}</text>`;
    if (r.note) s += `<text x="${W - 8}" y="${Y - 4}" text-anchor="end" font-size="8.5" fill="#777">${r.note}</text>`;
  });
  return s + '</svg>';
}
// Horizontal bars: [{label, v, note}]
function bars(items, o = {}) {
  const W = 360, rh = 22, H = items.length * rh + 10, max = o.max || Math.max(...items.map(i => Math.abs(i.v)));
  let s = SVG0(W, H);
  items.forEach((it, i) => {
    const Y = 6 + i * rh, w = Math.abs(it.v) / max * (W - 150);
    s += `<text x="0" y="${Y + 12}" font-size="9.5" fill="#000">${it.label}</text><rect x="92" y="${Y + 3}" width="${Math.max(1, w)}" height="12" fill="${it.c || (it.v < 0 ? '#000' : '#bbb')}"/><text x="${96 + w}" y="${Y + 12}" font-size="9" fill="#555">${it.note || it.v}</text>`;
  });
  return s + '</svg>';
}
// Line chart: series [{pts:[...], label, dash, c}]
function curve(series, o = {}) {
  const W = 360, H = o.h || 170, all = series.flatMap(s => s.pts), hi = o.hi != null ? o.hi : Math.max(...all), lo = o.lo != null ? o.lo : Math.min(...all), n = Math.max(...series.map(s => s.pts.length));
  const x = i => 34 + i / (n - 1) * (W - 44), y = v => 10 + (hi - v) / (hi - lo || 1) * (H - 30);
  let s = SVG0(W, H) + `<line x1="34" x2="${W - 10}" y1="${H - 20}" y2="${H - 20}" stroke="#E5E5E5"/>`;
  [hi, (hi + lo) / 2, lo].forEach(v => s += `<text x="30" y="${y(v) + 3}" text-anchor="end" font-size="8" fill="#8a8a8a">${o.fmt ? o.fmt(v) : Math.round(v)}</text><line x1="34" x2="${W - 10}" y1="${y(v)}" y2="${y(v)}" stroke="#f0f0f0"/>`);
  series.forEach(se => {
    s += `<polyline fill="none" stroke="${se.c || '#000'}" stroke-width="1.4" ${se.dash ? 'stroke-dasharray="4 3"' : ''} points="${se.pts.map((v, i) => x(i) + ',' + y(v)).join(' ')}"/>`;
    if (se.label && o.legend) { const k = series.indexOf(se), lx = 40 + k * 70, ly = H - 6; s += `<line x1="${lx}" x2="${lx + 16}" y1="${ly - 3}" y2="${ly - 3}" stroke="${se.c || '#000'}" stroke-width="1.4" ${se.dash ? 'stroke-dasharray="4 3"' : ''}/><text x="${lx + 20}" y="${ly}" font-size="8.5" fill="${se.c || '#000'}">${se.label}</text>`; }
    else if (se.label) { const i = se.pts.length - 1; s += `<text x="${x(i) - 2}" y="${y(se.pts[i]) - 5}" text-anchor="end" font-size="8.5" fill="${se.c || '#000'}">${se.label}</text>`; }
  });
  if (o.xlab) s += `<text x="${W - 10}" y="${H - 6}" text-anchor="end" font-size="8" fill="#8a8a8a">${o.xlab}</text>`;
  return s + '</svg>';
}
// Candle anatomy
function anatomy() {
  let s = SVG0(360, 170);
  const cd = (X, o, c, h, l, bull) => `<line x1="${X}" x2="${X}" y1="${h}" y2="${l}" stroke="#000"/><rect x="${X - 14}" y="${Math.min(o, c)}" width="28" height="${Math.abs(o - c)}" fill="${bull ? '#fff' : '#000'}" stroke="#000"/>`;
  const lab = (x1, y1, t, anchor = 'start') => `<line x1="${x1}" x2="${anchor === 'start' ? x1 + 18 : x1 - 18}" y1="${y1}" y2="${y1}" stroke="#bbb"/><text x="${anchor === 'start' ? x1 + 22 : x1 - 22}" y="${y1 + 3}" font-size="9" text-anchor="${anchor}">${t}</text>`;
  s += cd(110, 120, 50, 22, 148, true) + lab(126, 22, 'High') + lab(126, 50, 'Close') + lab(126, 120, 'Open') + lab(126, 148, 'Low') + lab(94, 36, 'Upper wick', 'end') + lab(94, 85, 'Body', 'end');
  s += cd(260, 50, 120, 22, 148, false) + lab(276, 22, 'High') + lab(276, 50, 'Open') + lab(276, 120, 'Close') + lab(276, 148, 'Low');
  s += `<text x="110" y="166" text-anchor="middle" font-size="9" fill="#555">Bullish (up) candle</text><text x="260" y="166" text-anchor="middle" font-size="9" fill="#555">Bearish (down) candle</text>`;
  return s + '</svg>';
}
const H = {chart, walk, plot, mirrorW, K, ladder, bars, curve, anatomy, rng};

/* ---------------- Router / shell ---------------- */
const view = $('#view');
const SEARCH_BTN = '<button class="sbtn" id="sbtn" aria-label="Search" title="Search (/)" onclick="location.hash=\'#search\'"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/></svg></button>';
/* ---------------- Theme (light / dark / system) ----------------
   Preference in localStorage 'chartschool.theme' = 'light' | 'dark' | 'system' (default). The inline script in index.html
   applies it before first paint; colours live in CSS variables (styles.css), including every chart colour (--sv-*). */
const THEME_KEY = 'chartschool.theme', DARK_MQ = matchMedia('(prefers-color-scheme: dark)');
const THEME_BAR = {light: '#000000', dark: '#141414'};
const svVar = c => { let h = String(c).replace('#', '').toLowerCase(); if (h.length === 3) h = h.split('').map(x => x + x).join(''); return `var(--sv-${h}, ${c})`; };
function themePref() { let t = null; try { t = localStorage.getItem(THEME_KEY); } catch (e) {} return t === 'light' || t === 'dark' ? t : 'system'; }
const themeNow = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
function applyTheme(pref) {
  if (pref) { try { if (pref === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, pref); } catch (e) {} }
  const p = themePref(), mode = p === 'system' ? (DARK_MQ.matches ? 'dark' : 'light') : p, el = document.documentElement;
  el.dataset.theme = mode; el.dataset.themePref = p;
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', THEME_BAR[mode]));
  const b = document.getElementById('thbtn'); if (b) b.outerHTML = themeBtn();
  document.querySelectorAll('.seg.th button').forEach(x => x.classList.toggle('on', x.dataset.th === p));
}
const SUN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24"><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/></svg>';
const themeBtn = () => { const d = themeNow() === 'dark'; return `<button class="thbtn" id="thbtn" aria-label="${d ? 'Switch to light mode' : 'Switch to dark mode'}" title="${d ? 'Light mode' : 'Dark mode'}" onclick="applyTheme(themeNow() === 'dark' ? 'light' : 'dark')">${d ? SUN : MOON}</button>`; };
(DARK_MQ.addEventListener ? DARK_MQ.addEventListener.bind(DARK_MQ, 'change') : DARK_MQ.addListener.bind(DARK_MQ))(() => { if (themePref() === 'system') applyTheme(); });
applyTheme();
function setTop(title, left = '', right = '', noSearch) { $('#tt').textContent = title; $('#tl').innerHTML = left; $('#tr').innerHTML = right + themeBtn() + (noSearch ? '' : SEARCH_BTN); }
const back = (href, t) => `<button onclick="location.hash='${href}'">‹ ${t}</button>`;
let timer = null;
const ROUTES = {};
function route() {
  clearInterval(timer); timer = null; closePop();
  const raw = (location.hash || '#home').slice(1), cut = raw.indexOf('/');
  const h = cut < 0 ? raw : raw.slice(0, cut), arg = cut < 0 ? '' : raw.slice(cut + 1);
  if (!S.placed && h !== 'placement' && h !== 'about') { location.replace('#placement'); return; }
  const tabOf = {lesson: 'home', quiz: 'home', level: 'home', placement: 'home', spot: 'practice', take: 'practice', flash: 'practice', calc: 'tools', plan: 'tools', settings: 'tools', drill: 'drills', term: 'glossary', about: 'tools', bookmarks: 'tools', search: '', clock: 'tools', trade: 'trades', mistakes: 'trades', mistake: 'trades'};
  const tab = tabOf[h] || h;
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  let a2 = arg; try { a2 = decodeURIComponent(arg); } catch (e) {}
  (ROUTES[h] || ROUTES.home)(a2);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* ---------------- Home ---------------- */
function nextLesson() {
  for (const L of LEVELS) { if (!unlocked(L)) continue; if (L.n < S.start && !S.unlockAll) continue; const l = L.lessons.find(x => !passed(x.id)); if (l) return l; }
  return LESSONS.find(l => !passed(l.id) && unlocked(LEVELS.find(L => L.n === l.level))) || null;
}
const START_NAMES = {0: 'Beginner', 2: 'Intermediate', 6: 'Advanced'};
ROUTES.home = function () {
  setTop('Chart School', '', `<span>🔥 ${streak()}</span>`);
  const total = LESSONS.length, done = LESSONS.filter(l => passed(l.id)).length;
  const qs = LESSONS.map(l => S.q[l.id]).filter(v => v != null), avg = qs.length ? Math.round(qs.reduce((a, b) => a + b, 0) / qs.length) + '%' : '–';
  const nx = nextLesson();
  let h = `<h1>Good to see you</h1><p class="sub">From your first candle to trading like a professional.</p>
  <div class="stats"><div><b>${done}<small style="font-size:11px;color:var(--mute);font-weight:400">/${total}</small></b><span>Lessons</span></div><div><b>${streak()} day${streak() === 1 ? '' : 's'}</b><span>Streak</span></div><div><b>${avg}</b><span>Quiz avg</span></div></div>
  ${nx ? `<a class="cont" href="#lesson/${nx.id}"><div><div class="k">${passed(nx.id) ? 'Review' : 'Continue'} · Level ${nx.level}</div><div style="font-weight:600">${nx.t}</div></div><span class="go">Start →</span></a>` : '<div class="cont"><div><div class="k">All done</div><div style="font-weight:600">Every lesson passed. Keep reviewing.</div></div></div>'}
  <div class="label">Curriculum · ${LEVELS.length} levels · ${total} lessons</div><ul class="levels">`;
  LEVELS.forEach(L => {
    const d = levelDone(L), un = unlocked(L), full = d === L.lessons.length;
    const open = nx && nx.level === L.n;
    h += `<li class="lvl ${un ? '' : 'locked'} ${full ? 'done' : ''} ${open ? 'open' : ''}" data-n="${L.n}"><div class="head"><span class="n">${full ? '✓' : L.n}</span><div style="flex:1;min-width:0"><div class="nm">${L.name}</div><div class="ds">${L.d}</div>${un ? `<div class="bar"><i style="width:${d / L.lessons.length * 100}%"></i></div>` : ''}</div><div class="meta">${un ? `${d}/${L.lessons.length}` : `🔒 ${L.lessons.length} lessons`}</div></div><ul class="lessons">`;
    L.lessons.forEach(l => {
      const ok = passed(l.id), sc = S.q[l.id];
      h += `<li class="${ok ? 'ok' : ''}"><span class="d"></span>${un ? `<a href="#lesson/${l.id}">${l.t}</a>` : l.t}<span class="tag">${ok ? sc + '%' : sc != null ? sc + '% · retry' : un ? (l.m || 6) + ' min' : 'Locked'}</span></li>`;
    });
    if (!un) h += `<li class="sub" style="font-size:11px">Pass every Level ${L.n - 1} quiz (80%+) to unlock, or turn on Unlock all in Tools → Settings.</li>`;
    h += '</ul></li>';
  });
  h += `</ul><p class="sub" style="margin-top:10px">Starting point: ${START_NAMES[S.start] || 'Level ' + S.start}${S.unlockAll ? ' · Unlock all is on' : ''}. <a href="#settings" style="color:var(--fg)">Settings</a></p>${FOOT}`;
  view.innerHTML = h;
  view.querySelectorAll('.lvl .head').forEach(e => e.onclick = () => e.parentNode.classList.toggle('open'));
};

/* ---------------- Lesson ---------------- */
function renderChart(ch) {
  if (!ch) return '';
  const one = c => {
    const svg = typeof c.f === 'function' ? c.f(H) : c.spec ? plot(c.spec) : '';
    return `<div class="chart">${svg}</div>${c.cap ? `<p class="cap">${inline(c.cap)}</p>` : ''}`;
  };
  return (Array.isArray(ch) ? ch : [ch]).map(one).join('');
}
ROUTES.lesson = function (id) {
  const l = LMAP[id] || LESSONS[0], L = LEVELS.find(x => x.n === l.level);
  if (!unlocked(L)) { location.replace('#home'); return; }
  const nxt = L.lessons[l.idx + 1], q = l.quiz.length;
  setTop(l.t.length > 26 ? l.t.slice(0, 25) + '…' : l.t, back('#home', 'Learn'), `<span>${l.id.replace('-', '.')}</span>`);
  view.innerHTML = `<div class="lesson">
  <div class="crumb row"><span>Level ${L.n} · ${L.name} · Lesson ${l.idx + 1} of ${L.lessons.length} · ${l.m || 6} min</span>${bmBtn('l:' + l.id)}</div>
  <h1>${l.t}</h1>
  <p class="lead">${inline(l.intro)}</p>
  ${renderChart(l.chart)}
  ${md(l.body)}
  <h2>Key takeaways</h2><ul>${l.take.map(t => `<li>${inline(t)}</li>`).join('')}</ul>
  <h2>Common mistakes</h2><ul class="miss">${l.miss.map(t => `<li>${inline(t)}</li>`).join('')}</ul>
  <hr>
  <a class="btn block" href="#quiz/${l.id}">${passed(l.id) ? 'Retake' : 'Take'} the quiz · ${q} questions</a>
  ${nxt ? `<a class="btn ghost block" style="margin-top:8px" href="#lesson/${nxt.id}">Next lesson: ${nxt.t} →</a>` : ''}
  ${FOOT}</div>`;
  bindWidgets(view);
};

/* ---------------- Quiz ---------------- */
let QZ = null;
ROUTES.quiz = function (id) {
  const l = LMAP[id] || LESSONS[0];
  QZ = {l, i: 0, score: 0, res: []};
  renderQ();
};
function qdots() { return '<div class="dots">' + QZ.l.quiz.map((_, i) => `<i class="${QZ.res[i] === 1 ? 'c' : QZ.res[i] === 0 ? 'x' : ''}"></i>`).join('') + '</div>'; }
function renderQ() {
  const {l} = QZ, N = l.quiz.length;
  setTop('Quiz', back('#lesson/' + l.id, 'Lesson'), `<span>${Math.min(QZ.i + 1, N)}/${N}</span>`);
  if (QZ.i >= N) return endQuiz();
  const [q, opts, a, e] = l.quiz[QZ.i];
  view.innerHTML = `<div class="q">${qdots()}<div class="qn">Question ${QZ.i + 1} of ${N} · ${l.t}</div><div class="qt">${inline(q)}</div>
    <div id="opts">${opts.map((o, i) => `<button class="opt" data-i="${i}">${String.fromCharCode(65 + i)}. ${inline(o)}</button>`).join('')}</div><div id="fb"></div></div>${FOOT}`;
  view.querySelectorAll('.opt').forEach(b => b.onclick = ev => {
    if (ev.target.closest('.term')) return;
    const i = +b.dataset.i, ok = i === a;
    if (ok) QZ.score++; QZ.res[QZ.i] = ok ? 1 : 0;
    view.querySelectorAll('.opt').forEach(x => { x.disabled = true; const j = +x.dataset.i; if (j === a) x.classList.add('right'); else if (j === i) x.classList.add('wrong'); });
    $('.dots').outerHTML = qdots();
    $('#fb').innerHTML = `<div class="explain"><b>${ok ? 'Correct.' : 'Not quite.'}</b> ${inline(e)}</div><button class="btn block" id="next">${QZ.i === N - 1 ? 'See score' : 'Next question'}</button>`;
    $('#next').onclick = () => { QZ.i++; renderQ(); };
  });
}
function endQuiz() {
  const {l} = QZ, N = l.quiz.length, pct = Math.round(QZ.score / N * 100), pass = pct >= 80;
  const L = LEVELS.find(x => x.n === l.level), wasPassed = levelPassed(L);
  S.q[l.id] = Math.max(S.q[l.id] || 0, pct); save();
  const nowPassed = levelPassed(L), nextL = LEVELS.find(x => x.n === L.n + 1);
  const nxt = L.lessons[l.idx + 1];
  view.innerHTML = `<div class="q">${qdots()}<div class="qn">${l.t} · Result</div>
    <div class="big">${QZ.score}/${N}</div><p>${pct}% · ${pass ? 'Passed. Lesson complete.' : 'You need 80% to complete this lesson. Review it and try again.'}</p>
    ${!wasPassed && nowPassed ? `<div class="result" id="lvlup"><b>Level ${L.n} complete.</b> ${nextL ? `Level ${nextL.n}: ${nextL.name} is unlocked.` : 'You finished the whole curriculum.'}</div>` : ''}
    <hr><div class="row"><button class="btn ghost" id="retry">Retry</button>${nxt ? `<a class="btn" href="#lesson/${nxt.id}" style="margin-left:auto">Next lesson →</a>` : nextL ? `<a class="btn" href="#lesson/${nextL.lessons[0].id}" style="margin-left:auto">Level ${nextL.n} →</a>` : `<a class="btn" href="#home" style="margin-left:auto">Home</a>`}</div></div>${FOOT}`;
  $('#retry').onclick = () => ROUTES.quiz(l.id);
}

/* ---------------- Placement quiz ---------------- */
const PLACEMENT = [
  ['On a candlestick chart, the thick **body** of a candle shows…', ['The distance from open to close', 'The highest and lowest price', 'Trading volume', 'The spread'], 0],
  ['When you buy with a market order, you usually pay the…', ['Bid', 'Ask', 'Last close', 'Midpoint'], 1],
  ['If your account falls 50%, what gain do you need to get back to even?', ['50%', '75%', '100%', '150%'], 2],
  ['A series of higher highs and higher lows means…', ['A downtrend', 'An uptrend', 'A range', 'Low volume'], 1],
  ['Buy-side liquidity mostly rests…', ['Below old lows', 'Above old highs', 'At the daily open', 'Inside fair value gaps'], 1],
  ['A bullish fair value gap is the space between…', ["Candle 1's high and candle 3's low", "Candle 1's low and candle 3's high", "Candle 2's open and close", 'Two daily closes'], 0],
  ['How is a market structure shift (MSS) different from a break of structure (BOS)?', ['An MSS breaks structure against the prior move, usually after a liquidity sweep', 'They are identical', 'An MSS only happens on weekly charts', 'A BOS is always a reversal'], 0],
  ['The optimal trade entry (OTE) zone sits roughly between which retracement levels?', ['23.6% and 38.2%', '50% and 55%', '62% and 79%', '100% and 127%'], 2],
  ['The New York AM Silver Bullet window is…', ['8:00 to 9:00 am NY', '10:00 to 11:00 am NY', '1:00 to 2:00 pm NY', '7:00 to 8:00 pm NY'], 1],
  ['ES makes a new high but NQ fails to. This is called…', ['A breaker', 'SMT divergence', 'A volume imbalance', 'The Judas swing'], 1],
];
ROUTES.placement = function (arg) {
  setTop('Welcome', S.placed ? back('#settings', 'Settings') : '', '', !S.placed);
  if (arg !== 'quiz') {
    view.innerHTML = `<h1>Welcome to Chart School</h1><p class="sub">Let's find the right starting point. You can change this any time in Settings.</p>
      <div class="label">Choose one</div>
      <button class="opt" id="pq"><b>Take the placement quiz</b><br><span class="sub">10 quick questions, about 2 minutes</span></button>
      <button class="opt" data-s="0"><b>I'm brand new</b><br><span class="sub">Start at Level 0: Absolute Basics</span></button>
      <button class="opt" data-s="2"><b>I know the basics</b><br><span class="sub">Intermediate: start at Level 2, Liquidity</span></button>
      <button class="opt" data-s="6"><b>I already trade ICT concepts</b><br><span class="sub">Advanced: start at Level 6, Time & Price</span></button>${FOOT}`;
    $('#pq').onclick = () => { location.hash = '#placement/quiz'; };
    view.querySelectorAll('[data-s]').forEach(b => b.onclick = () => setStart(+b.dataset.s));
    return;
  }
  let i = 0, sc = 0;
  const step = () => {
    if (i >= PLACEMENT.length) {
      const lv = sc >= 8 ? 6 : sc >= 4 ? 2 : 0;
      view.innerHTML = `<div class="qn">Placement result</div><div class="big">${sc}/${PLACEMENT.length}</div>
        <p id="placeres" data-level="${lv}">Suggested start: <b>${START_NAMES[lv]}</b> (Level ${lv}: ${LEVELS.find(L => L.n === lv).name}). Earlier levels stay open for review.</p>
        <button class="btn block" id="accept">Start at Level ${lv}</button><button class="btn ghost block" style="margin-top:8px" id="zero">Start from Level 0 instead</button>${FOOT}`;
      $('#accept').onclick = () => setStart(lv); $('#zero').onclick = () => setStart(0);
      return;
    }
    const [q, o, a] = PLACEMENT[i];
    view.innerHTML = `<div class="q"><div class="qn">Placement · ${i + 1} of ${PLACEMENT.length}</div><div class="qt">${inline(q)}</div>${o.map((x, j) => `<button class="opt" data-i="${j}">${String.fromCharCode(65 + j)}. ${x}</button>`).join('')}
      <button class="btn ghost" id="idk" style="margin-top:4px">I don't know</button></div>${FOOT}`;
    view.querySelectorAll('.opt').forEach(b => b.onclick = () => { if (+b.dataset.i === a) sc++; i++; step(); });
    $('#idk').onclick = () => { i++; step(); };
  };
  step();
};
function setStart(lv) { S.start = lv; S.placed = true; save(); location.hash = '#home'; }

/* ---------------- Practice hub ---------------- */
const DRILLS = {
  fvg: {name: 'Fair value gap', d: 'Tap the 3-candle imbalance'},
  liq: {name: 'BSL / SSL pools', d: 'Find buy-side or sell-side liquidity'},
  sweep: {name: 'Liquidity sweep', d: 'Tap the candle that ran the stops'},
  ob: {name: 'Order block', d: 'Tap the last opposite candle before displacement'},
  mss: {name: 'Market structure shift', d: 'Tap the swing that had to break'},
};
ROUTES.practice = function () {
  setTop('Practice');
  const due = fcDue().length;
  const sc = k => { const v = S.spot[k]; return v ? `${v.right}/${v.total}` : 'New'; };
  view.innerHTML = `<h1>Practice</h1><p class="sub">Drills on generated charts. Every chart is new.</p>
    <div class="label">Chart drills</div><ul class="menu"><li><a href="#drills"><div><b>Chart drills</b><span>${DR.length} hand-built scenarios across ${Object.keys(DK).length} concepts</span></div><em>${drSolved()}/${DR.length}</em></a></li></ul>
    <div class="label">Spot It</div><ul class="menu">${Object.entries(DRILLS).map(([k, d]) => `<li><a href="#spot/${k}"><div><b>${d.name}</b><span>${d.d}</span></div><em>${sc(k)}</em></a></li>`).join('')}</ul>
    <div class="label">Decision training</div><ul class="menu"><li><a href="#take"><div><b>Should I take it?</b><span>Run the pre-entry checklist on a live-looking setup</span></div><em>${S.take.right}/${S.take.total}</em></a></li></ul>
    <div class="label">Memory</div><ul class="menu"><li><a href="#flash"><div><b>Flashcards</b><span>Spaced repetition over ${GLOSSARY.length} glossary terms</span></div><em>${due} due</em></a></li></ul>${FOOT}`;
};

/* ---------------- Spot It generators ----------------
   Each returns {c, prompt, target:{i0,i1,top,bot}, reveal:{zones,lines,labels}, explain} */
const rnd = (a, b) => a + Math.random() * (b - a), rint = (a, b) => Math.floor(rnd(a, b + 1)), seedR = () => Math.floor(Math.random() * 1e9);
function genFVG() {
  const r = rnd, v = r(0.5, 0.8), k = Math.floor(r(14, 25)), c = []; let p = 100; const N = 36;
  const push = (drift, size = 1) => { const o = p, cl = o + drift * v + r(-1, 1) * v * size; const h = Math.max(o, cl) + Math.abs(r(0, .6)) * v, l = Math.min(o, cl) - Math.abs(r(0, .6)) * v; c.push(K(o, h, l, cl)); p = cl; };
  const bias = r(-0.15, 0.15);
  for (let i = 0; i < k - 5; i++) push(bias + (i > k - 10 ? -0.35 : 0), 0.9);
  for (let i = k - 5; i < k - 1; i++) push(-0.4, 0.8);
  { const o = p, cl = o + r(-0.2, 0.4) * v; c.push(K(o, Math.max(o, cl) + r(.15, .4) * v, Math.min(o, cl) - r(.3, .9) * v, cl)); p = cl; }
  const c1 = c[k - 1], body = r(4.2, 6) * v;
  { const o = p, cl = o + body; c.push(K(o, cl + r(.05, .25) * v, o - r(0, .15) * v, cl)); p = cl; }
  const gap = r(0.3, 0.45) * body;
  { const o = p - r(0, .1) * v, cl = o + r(0.2, 1.1) * v; c.push(K(o, Math.max(o, cl) + r(.1, .4) * v, Math.min(c1.h + gap, Math.min(o, cl) - .05 * v), cl)); p = cl; }
  const rest = N - c.length;
  for (let i = 0; i < rest; i++) { const ph = i / rest; push(ph < .25 ? 0.45 : ph < .5 ? -0.4 : 0.3, 0.9); }
  let dir = 1;
  if (Math.random() < 0.5) { dir = -1; for (let i = 0; i < c.length; i++) { const x = c[i]; c[i] = K(200 - x.o, 200 - x.l, 200 - x.h, 200 - x.c); } }
  const tgt = new Set([k - 1, k, k + 1]);
  for (let i = 0; i + 2 < c.length; i++) {
    if (i === k - 1) continue;
    const a = c[i], b = c[i + 2], fix = tgt.has(i + 2) ? i : i + 2;
    if (b.l > a.h) { if (fix === i + 2) b.l = a.h - 0.02 * v; else a.h = b.l + 0.02 * v; }
    if (b.h < a.l) { if (fix === i + 2) b.h = a.l + 0.02 * v; else a.l = b.h - 0.02 * v; }
  }
  const A = c[k - 1], B = c[k + 1], z = dir === 1 ? {top: B.l, bot: A.h} : {top: A.l, bot: B.h};
  const cs = c.slice(k - 1, k + 2);
  return {c, prompt: 'There is one clear fair value gap. Tap the three candles (or the gap) where it formed.',
    target: {i0: k - 1, i1: k + 1, top: Math.max(...cs.map(x => x.h)), bot: Math.min(...cs.map(x => x.l))},
    reveal: {zones: [{i0: k - 1, top: z.top, bot: z.bot, fill: 'rgba(0,0,0,.10)', stroke: '#000', dash: 1, label: (dir === 1 ? 'Bullish' : 'Bearish') + ' FVG'}],
      lines: [{i0: k - 1, y: (z.top + z.bot) / 2, dash: '4 3', sw: .7, label: 'CE', below: true}],
      labels: [0, 1, 2].map(j => ({i: k - 1 + j, text: String(j + 1), pos: dir === 1 ? (j === 2 ? 'above' : 'below') : (j === 2 ? 'below' : 'above'), circle: 1}))},
    explain: dir === 1 ? "Bullish FVG: candle 3's low stays above candle 1's high. The dashed line is consequent encroachment (50%)." : "Bearish FVG: candle 3's high stays below candle 1's low. The dashed line is consequent encroachment (50%)."};
}
function genLiq() {
  const a = rnd(3, 5), m = 100, Hh = m + a, Ll = m - a, e = () => rnd(0, 0.06);
  const order = Math.random() < .5;
  const pts = order ? [m - a * .3, Hh, Ll, Hh - e(), Ll + e(), m + rnd(-.8, .8)] : [m + a * .3, Ll, Hh, Ll + e(), Hh - e(), m + rnd(-.8, .8)];
  const w = walk(pts, pts.slice(1).map(() => rint(3, 6)), seedR());
  const hiW = order ? [1, 3] : [2, 4], loW = order ? [2, 4] : [1, 3];
  const askB = Math.random() < .5, ws = askB ? hiW : loW, P = w.P[ws[0]];
  const i0 = w.at[ws[0]], i1 = w.at[ws[1]], range = 2 * a;
  return {c: w.c, prompt: `Tap where the <b>${askB ? 'buy-side' : 'sell-side'} liquidity</b> is resting on this chart.`,
    target: askB ? {i0, i1, top: P + range * .06, bot: P - range * .03} : {i0, i1, top: P + range * .03, bot: P - range * .06},
    reveal: {lines: [{i0, y: P, dash: '4 3', sw: 1, label: askB ? 'BSL · equal highs' : 'SSL · equal lows', below: !askB}],
      labels: [{i: i0, text: '=', pos: askB ? 'above' : 'below'}, {i: i1, text: '=', pos: askB ? 'above' : 'below'}]},
    explain: askB ? 'Two near-equal highs. Stops from shorts and breakout buy orders rest just above them: buy-side liquidity.' : 'Two near-equal lows. Stops from longs and breakout sell orders rest just below them: sell-side liquidity.'};
}
function genSweep() {
  const L = 100, dn = Math.random() < .5;
  const pts = [L + rnd(5, 7), L, L + rnd(3, 4.5), L + rnd(.6, 1.2), {p: L - rnd(.6, 1.1), close: L + rnd(.3, .8)}, L + rnd(4, 6), L + rnd(2.5, 3.5), L + rnd(5, 7)];
  const w = walk([L + rnd(3, 4), ...pts], [rint(3, 5), rint(4, 6), rint(3, 5), rint(3, 5), 1, rint(2, 3), rint(3, 4), rint(2, 4)], seedR());
  if (dn) mirrorW(w, 2 * L);
  const si = w.at[5], k = w.c[si], oldI = w.at[2];
  return {c: w.c, prompt: `Tap the candle that <b>swept ${dn ? 'buy-side' : 'sell-side'} liquidity</b> and closed back inside.`,
    target: {i0: si, i1: si, top: k.h, bot: k.l},
    reveal: {lines: [{i0: oldI, i1: si + 2, y: w.P[2], dash: '3 2', label: dn ? 'old high' : 'old low', la: 'start', below: !dn}], labels: [{i: si, text: 'sweep', pos: dn ? 'above' : 'below', fs: 8.5}]},
    explain: dn ? 'The wick ran above the old high, triggered the stops resting there, and the candle closed back below it. That is a sweep, not a breakout.' : 'The wick ran below the old low, triggered the stops resting there, and the candle closed back above it. That is a sweep, not a breakdown.'};
}
function genOB() {
  const bear = Math.random() < .5, s = seedR();
  const pts = [108, rnd(103, 104), rnd(105.2, 106), {p: rnd(101, 102), close: null}, rnd(108.5, 110), rnd(105.5, 106.5), rnd(109, 111)];
  const w = walk(pts, [rint(4, 6), rint(3, 4), rint(4, 6), {n: 3, disp: true}, rint(3, 4), rint(3, 5)], s);
  const oi = w.at[3], k = w.c[oi];
  if (k.c >= k.o) { const top = k.l + (k.h - k.l) * .75; k.o = Math.max(top, k.c + .2 * w.v); k.c = k.l + (k.h - k.l) * .2; k.o = Math.min(k.o, k.h); }
  if (bear) mirrorW(w, 210);
  const kk = w.c[oi];
  return {c: w.c, prompt: `Tap the <b>${bear ? 'bearish' : 'bullish'} order block</b>: the last opposite-colour candle before the displacement.`,
    target: {i0: oi, i1: oi, top: kk.h, bot: kk.l},
    reveal: {zones: [{i0: oi, top: Math.max(kk.o, kk.c), bot: Math.min(kk.o, kk.c), fill: 'rgba(0,0,0,.12)', stroke: '#000', dash: 1, label: (bear ? 'Bearish' : 'Bullish') + ' OB'}], labels: [{i: oi, text: 'OB', pos: bear ? 'above' : 'below', fs: 8.5}]},
    explain: bear ? 'The last up-close candle before price displaced lower. Its body (open to close) is the zone traders watch on a retracement.' : 'The last down-close candle before price displaced higher. Its body (open to close) is the zone traders watch on a retracement.'};
}
function genMSS() {
  const bear = Math.random() < .5;
  const lh = rnd(106.5, 107.5);
  const pts = [rnd(111, 112), rnd(104, 104.8), lh, rnd(101, 102), rnd(108.5, 110), rnd(105.8, 106.8), rnd(109.5, 111)];
  const w = walk(pts, [rint(4, 6), rint(3, 5), rint(4, 6), {n: 3, disp: true}, rint(3, 4), rint(3, 4)], seedR());
  if (bear) mirrorW(w, 212);
  const si = w.at[2], P = w.P[2], range = Math.max(...w.P) - Math.min(...w.P);
  let bi = w.c.findIndex((k, i) => i > w.at[3] && (bear ? k.c < P : k.c > P)); if (bi < 0) bi = w.at[4];
  return {c: w.c, prompt: `Tap the <b>swing ${bear ? 'low' : 'high'}</b> whose break confirmed the market structure shift.`,
    target: bear ? {i0: si - 1, i1: si + 1, top: P + range * .03, bot: P - range * .07} : {i0: si - 1, i1: si + 1, top: P + range * .07, bot: P - range * .03},
    reveal: {lines: [{i0: si, i1: bi, y: P, dash: '4 3', sw: 1, label: 'MSS', below: bear}], labels: [{i: si, text: bear ? 'HL' : 'LH', pos: bear ? 'below' : 'above', fs: 8.5}]},
    explain: bear ? 'Price was making higher lows. After a run on buy-side liquidity, it displaced down and closed below the last higher low: a bearish shift.' : 'Price was making lower highs. After a run on sell-side liquidity, it displaced up and closed above the last lower high: a bullish shift.'};
}
const GENS = {fvg: genFVG, liq: genLiq, sweep: genSweep, ob: genOB, mss: genMSS};
let SP = null;
ROUTES.spot = function (type) {
  type = GENS[type] ? type : 'fvg';
  S.spot[type] = S.spot[type] || {right: 0, total: 0};
  setTop('Spot It', back('#practice', 'Practice'), `<span id="spsc">${S.spot[type].right}/${S.spot[type].total}</span>`);
  SP = GENS[type](); SP.type = type; SP.answered = false;
  view.innerHTML = `<div class="seg" style="margin-bottom:10px;flex-wrap:wrap">${Object.keys(DRILLS).map(k => `<button class="${k === type ? 'on' : ''}" onclick="location.hash='#spot/${k}'">${DRILLS[k].name.replace('Market structure shift', 'MSS').replace('Fair value gap', 'FVG').replace('Liquidity sweep', 'Sweep')}</button>`).join('')}</div>
    <h1>${DRILLS[type].name}</h1><p class="sub" id="prompt">${SP.prompt}</p>
    <div class="chart spot" id="sc"></div><div id="sres"></div>
    <div class="row" style="margin-top:6px"><button class="btn ghost" id="reveal">Show me</button><button class="btn" id="snext" style="margin-left:auto">Next chart</button></div>${FOOT}`;
  drawSpot();
  $('#snext').onclick = () => ROUTES.spot(type);
  $('#reveal').onclick = () => { if (!SP.answered) answer(null); };
};
function drawSpot(tap) {
  const o = {h: 230, pt: 16, pb: 16, pr: 8};
  if (SP.answered) {
    Object.assign(o, SP.reveal);
    if (tap) o.marks = [() => `<circle cx="${tap.x}" cy="${tap.y}" r="7" fill="none" stroke="${tap.ok ? '#000' : '#c0392b'}" stroke-width="1.6"/><circle cx="${tap.x}" cy="${tap.y}" r="1.6" fill="${tap.ok ? '#000' : '#c0392b'}"/>`];
  }
  SP.ch = chart(SP.c, o);
  const el = $('#sc'); el.innerHTML = SP.ch.svg;
  const svg = el.querySelector('svg');
  svg.addEventListener('click', ev => {
    if (SP.answered) return;
    const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM().inverse());
    answer({x: q.x, y: q.y});
  });
}
// A tap is correct if it lands within the target candles (plus slack) and the target price band (plus 10px).
function hitTest(x, y) {
  const ch = SP.ch, t = SP.target;
  const x0 = ch.x(t.i0) - ch.sp * 0.8, x1 = ch.x(t.i1) + ch.sp * 0.8;
  return x >= x0 && x <= x1 && y >= ch.y(t.top) - 10 && y <= ch.y(t.bot) + 10;
}
function answer(tap) {
  SP.answered = true; $('#reveal').disabled = true;
  const ok = tap ? hitTest(tap.x, tap.y) : false, st = S.spot[SP.type];
  if (tap) { st.total++; if (ok) st.right++; save(); }
  drawSpot(tap ? {...tap, ok} : null);
  $('#spsc').textContent = `${st.right}/${st.total}`;
  $('#sres').innerHTML = (tap ? (ok ? '<div class="result" id="verdict" data-ok="1"><b>Correct.</b> You found it.</div>' : '<div class="result bad" id="verdict" data-ok="0"><b>Not quite.</b> The answer is marked on the chart.</div>')
    : '<div class="result" id="verdict" data-ok="-1">Here it is.</div>') + `<p class="cap">${SP.explain}</p>`;
}
window.__spot = () => SP && ({type: SP.type, cx: (SP.ch.x(SP.target.i0) + SP.ch.x(SP.target.i1)) / 2, cy: SP.ch.y((SP.target.top + SP.target.bot) / 2)});

/* ---------------- "Should I take it?" drill ---------------- */
const CHECK = [
  ['bias', 'HTF bias agrees with the trade'],
  ['sweep', 'Liquidity was swept first'],
  ['disp', 'Displacement away from the sweep'],
  ['mss', 'Market structure shift / CISD'],
  ['pd', 'Price returned to a PD array (FVG)'],
  ['kz', 'Inside a killzone'],
  ['news', 'No high-impact news in the next 30 min'],
  ['rr', 'Reward-to-risk is at least 2:1'],
];
function genTake() {
  const f = Object.fromEntries(CHECK.map(c => [c[0], true]));
  if (Math.random() > 0.35) { const keys = CHECK.map(c => c[0]); const n = rint(1, 3); for (let i = 0; i < n; i++) f[keys[rint(0, keys.length - 1)]] = false; }
  if (!f.disp) f.pd = false; // no displacement means no fresh FVG to return to
  const bull = Math.random() < .5;
  const L1 = 102, LH = rnd(105.3, 105.8);
  const pts = [rnd(108, 109), rnd(106.3, 106.8), rnd(107, 107.6), L1, LH, f.sweep ? rnd(100.9, 101.4) : rnd(102.6, 103.1)];
  const legs = [rint(3, 4), rint(2, 3), rint(3, 4), rint(3, 4), rint(3, 4)];
  const top = f.mss ? rnd(107.2, 108.2) : LH - rnd(.5, .8);
  pts.push(top); legs.push(f.disp ? {n: 3, disp: true} : 7);
  const seed = seedR(); let w = walk(pts, legs, seed);
  if (f.pd && w.fvg[0]) { const g = w.fvg[0], r = (g.top + g.bot) / 2; w = walk([...pts, r, r + 0.4], [...legs, rint(2, 3), 1], seed); }
  else w = walk([...pts, top - rnd(.4, .7)], [...legs, 2], seed);
  if (!bull) mirrorW(w, 216);
  const g = w.fvg[0], times = f.kz ? ['8:12 am', '9:47 am', '3:21 am', '10:24 am'] : ['12:38 pm', '5:50 pm', '11:15 pm', '6:40 am'];
  const card = {
    bias: `Daily bias: <b>${(f.bias ? bull : !bull) ? 'Bullish' : 'Bearish'}</b>`,
    time: `Time now: <b>${times[rint(0, 3)]} NY</b>`,
    news: `Calendar: <b>${f.news ? 'no red-folder news today' : ['CPI', 'FOMC statement', 'NFP'][rint(0, 2)] + ' in ' + rint(5, 25) + ' minutes'}</b>`,
    rr: `Planned trade: <b>${f.rr ? (rnd(2.2, 4.5)).toFixed(1) : (rnd(0.8, 1.6)).toFixed(1)} : 1</b> reward to risk`,
  };
  const ann = {lines: [{i0: w.at[3], i1: w.at[5] + 1, y: bull ? L1 : 216 - L1, dash: '3 2', c: '#777', label: bull ? 'old low' : 'old high', la: 'start', below: bull}, {i0: w.at[4], i1: w.at[6], y: bull ? LH : 216 - LH, dash: '4 3', label: bull ? 'last LH' : 'last HL', la: 'start', below: !bull}]};
  if (g) ann.zones = [{i0: g.i, top: g.top, bot: g.bot, label: 'FVG', fill: 'rgba(0,0,0,.08)'}];
  return {w, f, bull, card, ann, dir: bull ? 'long' : 'short'};
}
let TK = null;
ROUTES.take = function () {
  setTop('Should I take it?', back('#practice', 'Practice'), `<span id="tksc">${S.take.right}/${S.take.total}</span>`);
  TK = genTake();
  view.innerHTML = `<p class="sub">A possible <b>${TK.dir}</b> on the 5-minute chart. Tick every checklist item that is actually present, then decide.</p>
    <div class="chart" id="tkc">${chart(TK.w.c, {h: 210, pt: 14, pb: 14, pr: 8}).svg}</div>
    <div class="card">${Object.values(TK.card).map(x => `<div>${x}</div>`).join('')}</div>
    <ul class="checks" id="checks">${CHECK.map(([k, t]) => `<li><label><input type="checkbox" data-k="${k}"> ${t}</label><span class="mark" data-m="${k}"></span></li>`).join('')}</ul>
    <div class="row"><button class="btn ghost" id="skip">Skip it</button><button class="btn" id="takeit" style="margin-left:auto">Take it</button></div>
    <div id="tkres"></div>${FOOT}`;
  $('#skip').onclick = () => decide(false); $('#takeit').onclick = () => decide(true);
};
function decide(take) {
  const f = TK.f, all = CHECK.every(c => f[c[0]]), right = take === all;
  let tickOK = 0;
  view.querySelectorAll('#checks input').forEach(i => { const k = i.dataset.k, ok = i.checked === f[k]; if (ok) tickOK++; i.disabled = true; view.querySelector(`[data-m="${k}"]`).innerHTML = f[k] ? '<b>present</b>' : '<span style="color:var(--bear)">missing</span>'; });
  S.take.total++; if (right) S.take.right++; save();
  $('#tksc').textContent = `${S.take.right}/${S.take.total}`;
  $('#tkc').innerHTML = chart(TK.w.c, Object.assign({h: 210, pt: 14, pb: 14, pr: 8}, TK.ann)).svg;
  $('#skip').disabled = $('#takeit').disabled = true;
  const missing = CHECK.filter(c => !f[c[0]]).map(c => c[1].toLowerCase());
  $('#tkres').innerHTML = `<div class="result ${right ? '' : 'bad'}" id="tkverdict" data-ok="${right ? 1 : 0}"><b>${right ? 'Disciplined call.' : 'Not the disciplined call.'}</b> ${all ? 'Every item lines up. This is a valid A+ setup to take with your normal risk.' : 'Skip it. Missing: ' + missing.join('; ') + '. One missing item is enough to pass on a trade.'}</div>
    <p class="cap">You read ${tickOK}/8 checklist items correctly.</p><button class="btn block" onclick="ROUTES.take()">Next setup</button>`;
}
window.__take = () => TK && TK.f;

/* ---------------- Flashcards (Leitner-style spaced repetition) ---------------- */
const BOX_DAYS = [0, 1, 3, 7, 14, 30, 60];
function fcDue() {
  const t = today(); const due = [], fresh = [];
  GLOSSARY.forEach(g => { const c = S.fc[g[0]]; if (c) { if (c.due <= t) due.push(g[0]); } else fresh.push(g[0]); });
  const newToday = S.fcNew[t] || 0;
  return due.concat(fresh.slice(0, Math.max(0, 15 - newToday)));
}
let FC = null;
ROUTES.flash = function () {
  setTop('Flashcards', back('#practice', 'Practice'), '');
  const q = fcDue();
  const learned = Object.values(S.fc).filter(c => c.box >= 3).length;
  if (!q.length) { view.innerHTML = `<h1>All caught up</h1><p class="sub">No cards due. ${learned} of ${GLOSSARY.length} terms are well learned. Come back tomorrow.</p>${FOOT}`; return; }
  FC = {q, i: 0, flipped: false};
  fcRender();
};
function fcRender() {
  const k = FC.q[FC.i], g = G[k], c = S.fc[k];
  view.innerHTML = `<div class="sub">${FC.q.length - FC.i} left today · ${c ? 'Box ' + c.box : 'New card'}</div>
    <div class="flash" id="card"><div class="fterm">${esc(g[1])}${g[2] ? `<span class="ab">${esc(g[2])}</span>` : ''}</div>${FC.flipped ? `<div class="fdef">${esc(g[3])}</div>` : '<div class="sub">Tap to reveal</div>'}</div>
    ${FC.flipped ? `<div class="row"><button class="btn ghost" data-r="0">Again</button><button class="btn ghost" data-r="1" style="margin-left:auto">Good</button><button class="btn" data-r="2">Easy</button></div>` : '<button class="btn block" id="flip">Show answer</button>'}${FOOT}`;
  const flip = () => { FC.flipped = true; fcRender(); };
  if (!FC.flipped) { $('#card').onclick = flip; $('#flip').onclick = flip; }
  view.querySelectorAll('[data-r]').forEach(b => b.onclick = () => fcGrade(+b.dataset.r));
}
function fcGrade(r) {
  const k = FC.q[FC.i], t = today(), c = S.fc[k] || {box: 0};
  if (!S.fc[k]) S.fcNew[t] = (S.fcNew[t] || 0) + 1;
  c.box = r === 0 ? 0 : Math.min(BOX_DAYS.length - 1, c.box + r);
  c.due = addDays(t, r === 0 ? 0 : BOX_DAYS[c.box]);
  S.fc[k] = c; save();
  if (r === 0) FC.q.push(k); // see it again this session
  FC.i++; FC.flipped = false;
  if (FC.i >= FC.q.length) { view.innerHTML = `<h1>Session done</h1><p class="sub" id="fcdone">Nice work. Cards come back on a schedule: again today, then 1, 3, 7, 14, 30 and 60 days as you get them right.</p><a class="btn" href="#practice">Back to Practice</a>${FOOT}`; return; }
  fcRender();
}

/* ---------------- Tools: position size calculator ---------------- */
const FUT = {ES: [50, .25, 'E-mini S&P 500'], MES: [5, .25, 'Micro E-mini S&P'], NQ: [20, .25, 'E-mini Nasdaq-100'], MNQ: [2, .25, 'Micro E-mini Nasdaq'], YM: [5, 1, 'E-mini Dow'], MYM: [0.5, 1, 'Micro Dow'], RTY: [50, .1, 'E-mini Russell 2000'], M2K: [5, .1, 'Micro Russell'], CL: [1000, .01, 'Crude oil'], MCL: [100, .01, 'Micro crude'], GC: [100, .1, 'Gold'], MGC: [10, .1, 'Micro gold']};
// Pure function so it can be tested. Returns size rounded DOWN so risk never exceeds the limit.
function calcSize(p) {
  const acct = +p.acct, pct = +p.pct, entry = +p.entry, stop = +p.stop;
  if (!(acct > 0 && pct > 0 && entry > 0 && stop > 0) || entry === stop) return {error: 'Enter account, risk %, and different entry and stop prices.'};
  const risk = acct * pct / 100, dist = Math.abs(entry - stop), dir = entry > stop ? 1 : -1;
  let perUnit, size, unit, extra = '';
  if (p.kind === 'futures') {
    const [pv, tick] = FUT[p.inst] || FUT.ES; perUnit = dist * pv; size = Math.floor(risk / perUnit + 1e-9); unit = 'contracts';
    extra = `${(dist / tick).toFixed(0)} ticks × $${(pv * tick).toFixed(2)} per tick = $${perUnit.toFixed(2)} risk per contract`;
  } else if (p.kind === 'forex') {
    const pip = +p.pipSize || 0.0001, pipVal = +p.pipValue || 10, pips = dist / pip; perUnit = pips * pipVal;
    size = Math.floor(risk / perUnit * 100 + 1e-9) / 100; unit = 'lots';
    extra = `${pips.toFixed(1)} pips × $${pipVal} per pip per standard lot = $${perUnit.toFixed(2)} risk per lot`;
  } else if (p.kind === 'crypto') {
    perUnit = dist; size = Math.floor(risk / perUnit * 10000 + 1e-9) / 10000; unit = 'coins';
  } else { perUnit = dist; size = Math.floor(risk / perUnit + 1e-9); unit = 'shares'; }
  const actual = size * perUnit;
  return {risk, dist, perUnit, size, unit, actual, extra, dir, targets: [1, 2, 3].map(R => +(entry + dir * R * dist).toFixed(6))};
}
const money = v => '$' + v.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
function calcHTML() {
  const c = Object.assign({acct: 10000, pct: 1, entry: 5000, stop: 4990, kind: 'futures', inst: 'MES', pipSize: 0.0001, pipValue: 10}, S.calc);
  return `<div class="calc" id="calc">
    <div class="seg" id="ckind">${['futures', 'stocks', 'forex', 'crypto'].map(k => `<button data-k="${k}" class="${c.kind === k ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
    <div class="grid2">
      <label>Account size ($)<input id="c_acct" type="number" inputmode="decimal" value="${c.acct}"></label>
      <label>Risk per trade (%)<input id="c_pct" type="number" inputmode="decimal" step="0.1" value="${c.pct}"></label>
      <label>Entry price<input id="c_entry" type="number" inputmode="decimal" value="${c.entry}"></label>
      <label>Stop price<input id="c_stop" type="number" inputmode="decimal" value="${c.stop}"></label>
      <label class="fut">Contract<select id="c_inst">${Object.entries(FUT).map(([k, v]) => `<option value="${k}" ${c.inst === k ? 'selected' : ''}>${k} · $${v[0]}/pt</option>`).join('')}</select></label>
      <label class="fx">Pip size<select id="c_pipSize"><option value="0.0001" ${c.pipSize == 0.0001 ? 'selected' : ''}>0.0001 (most pairs)</option><option value="0.01" ${c.pipSize == 0.01 ? 'selected' : ''}>0.01 (JPY pairs)</option></select></label>
      <label class="fx">Pip value / std lot ($)<input id="c_pipValue" type="number" value="${c.pipValue}"></label>
    </div><div id="cout" class="cout"></div></div>`;
}
function bindCalc(root) {
  const el = root.querySelector('#calc'); if (!el) return;
  const read = () => ({acct: $('#c_acct').value, pct: $('#c_pct').value, entry: $('#c_entry').value, stop: $('#c_stop').value, kind: el.querySelector('#ckind .on').dataset.k, inst: $('#c_inst').value, pipSize: $('#c_pipSize').value, pipValue: $('#c_pipValue').value});
  const upd = () => {
    const p = read(); S.calc = p; save();
    el.querySelectorAll('.fut').forEach(x => x.style.display = p.kind === 'futures' ? '' : 'none');
    el.querySelectorAll('.fx').forEach(x => x.style.display = p.kind === 'forex' ? '' : 'none');
    const r = calcSize(p);
    $('#cout').innerHTML = r.error ? `<p class="sub">${r.error}</p>` : `<div class="big" id="csize" style="font-size:30px">${r.size} <span style="font-size:14px">${r.unit}</span></div>
      <p class="sub">Max risk ${money(r.risk)} · actual risk at this size <b style="color:var(--fg)">${money(r.actual)}</b> · stop distance ${+r.dist.toFixed(6)}</p>
      ${r.extra ? `<p class="sub">${r.extra}</p>` : ''}${r.size === 0 ? '<p class="sub" style="color:var(--bear)">Stop is too wide for this risk. Use a smaller contract (micros), a tighter valid stop, or skip the trade.</p>' : ''}
      <p class="sub">Targets: 1R ${r.targets[0]} · 2R ${r.targets[1]} · 3R ${r.targets[2]}</p>`;
  };
  el.querySelectorAll('input,select').forEach(i => i.oninput = upd);
  el.querySelectorAll('#ckind button').forEach(b => b.onclick = () => { el.querySelectorAll('#ckind button').forEach(x => x.classList.remove('on')); b.classList.add('on'); upd(); });
  upd();
}
ROUTES.calc = function () {
  setTop('Position size', back('#tools', 'Tools'));
  view.innerHTML = `<h1>Position size calculator</h1><p class="sub">Size = money at risk ÷ risk per unit. Rounded down so you never risk more than your limit.</p>${calcHTML()}${FOOT}`;
  bindCalc(view);
};

/* ---------------- Tools: trading plan builder ---------------- */
const PLAN = [
  ['why', 'Why I trade and my goal', 'e.g. Build a second income over 3 years. Goal this quarter: follow my rules on 90% of trades.'],
  ['markets', 'Markets I trade', 'e.g. NQ and ES futures (micros until consistent). Nothing else.'],
  ['hours', 'When I trade', 'e.g. NY AM killzone 7:00-10:00 am NY only. No trading after 11:00 am.'],
  ['tf', 'Timeframes', 'e.g. Daily and 4H for bias, 15m for structure, 5m/1m for entry.'],
  ['bias', 'How I form bias', 'e.g. Daily draw on liquidity: which old high/low or FVG is price heading to? Bias written before the open.'],
  ['models', 'My setups (max 2)', 'e.g. 1) Silver Bullet 10-11 am. 2) Sweep + MSS + FVG return in NY AM.'],
  ['checklist', 'Entry checklist (all must be true)', 'Bias agrees · liquidity swept · displacement · MSS/CISD · return to PD array · in killzone · no red news in 30 min · at least 2R to target'],
  ['risk', 'Risk per trade', 'e.g. 0.5% of account. Size with the calculator. Never move the stop further away.'],
  ['limits', 'Daily and weekly limits', 'e.g. Max 2 trades a day. Stop after 2 losses or -1% on the day. Stop for the week at -3%.'],
  ['manage', 'Trade management', 'e.g. Partial at 1R or the first liquidity pool, stop to breakeven after the partial, final target at the draw on liquidity.'],
  ['news', 'News rules', 'e.g. Flat 15 minutes before CPI, NFP and FOMC. No new trades until 15 minutes after.'],
  ['routine', 'Daily routine', 'e.g. Sleep 7h+. 6:30 check calendar, mark levels, write bias. After the session: journal every trade with screenshots.'],
  ['review', 'Review process', 'e.g. Every Sunday review the journal: rule breaks, best setup, worst habit. Monthly stats review.'],
  ['nogo', 'I do NOT trade when…', 'e.g. Tired, angry, sick, after 2 losses, during news, or when I have no clear bias.'],
];
function planText() { return 'MY TRADING PLAN\n\n' + PLAN.map(([k, t, ph]) => `${t.toUpperCase()}\n${(S.plan[k] || '').trim() || '(not filled in)'}\n`).join('\n'); }
function planHTML() {
  const filled = PLAN.filter(p => (S.plan[p[0]] || '').trim()).length;
  return `<div id="planf"><p class="sub" id="planprog">${filled}/${PLAN.length} sections filled · saves automatically on this device</p>${PLAN.map(([k, t, ph]) => `<label class="pl">${t}<textarea data-k="${k}" rows="2" placeholder="${esc(ph)}">${esc(S.plan[k] || '')}</textarea></label>`).join('')}
    <div class="row" style="margin-top:8px"><button class="btn ghost" id="pfill">Fill with example</button><button class="btn ghost" id="pcopy" style="margin-left:auto">Copy</button><button class="btn" id="pdl">Download .txt</button></div><p class="sub" id="pmsg"></p></div>`;
}
function bindPlan(root) {
  const el = root.querySelector('#planf'); if (!el) return;
  const prog = () => { $('#planprog').textContent = `${PLAN.filter(p => (S.plan[p[0]] || '').trim()).length}/${PLAN.length} sections filled · saves automatically on this device`; };
  el.querySelectorAll('textarea').forEach(t => t.oninput = () => { S.plan[t.dataset.k] = t.value; save(); prog(); });
  $('#pfill').onclick = () => { el.querySelectorAll('textarea').forEach(t => { if (!t.value.trim()) { t.value = t.placeholder.replace(/^e\.g\. /, ''); S.plan[t.dataset.k] = t.value; } }); save(); prog(); };
  $('#pcopy').onclick = () => { (navigator.clipboard ? navigator.clipboard.writeText(planText()) : Promise.reject()).then(() => $('#pmsg').textContent = 'Copied to clipboard.', () => $('#pmsg').textContent = 'Copy not available here. Use Download instead.'); };
  $('#pdl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([planText()], {type: 'text/plain'})); a.download = 'trading-plan.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
}
ROUTES.plan = function () {
  setTop('Trading plan', back('#tools', 'Tools'));
  view.innerHTML = `<h1>Trading plan builder</h1><p class="sub">A written plan turns trading from guessing into a process. Fill in each section in your own words.</p>${planHTML()}${FOOT}`;
  bindPlan(view);
};
ROUTES.tools = function () {
  setTop('Tools');
  view.innerHTML = `<h1>Tools</h1><ul class="menu" style="margin-top:10px">
    <li><a href="#calc"><div><b>Position size calculator</b><span>Futures, stocks, forex, crypto</span></div><em>›</em></a></li>
    <li><a href="#plan"><div><b>Trading plan builder</b><span>Fill-in template, copy or download</span></div><em>›</em></a></li>
    <li><a href="#clock"><div><b>Killzone clock</b><span>Sessions and Silver Bullet windows</span></div><em>›</em></a></li>
    <li><a href="#search"><div><b>Search</b><span>Lessons, glossary, drills and trades · press / on desktop</span></div><em>›</em></a></li>
    <li><a href="#bookmarks"><div><b>Bookmarks</b><span>Saved lessons, terms, drills and trades</span></div><em>${Object.keys(S.bm).length}</em></a></li>
    <li><a href="#settings"><div><b>Settings</b><span>Appearance, unlock all, placement, reset</span></div><em>›</em></a></li>
    <li><a href="#about"><div><b>About &amp; disclaimer</b><span>Not financial advice · how your data is stored</span></div><em>›</em></a></li></ul>${FOOT}`;
};
ROUTES.settings = function () {
  setTop('Settings', back('#tools', 'Tools'));
  view.innerHTML = `<h1>Settings</h1>
    <ul class="menu" style="margin-top:10px"><li><label class="tog"><div><b>Unlock all levels</b><span>For experienced traders who want to jump around</span></div><input type="checkbox" id="unlockall" ${S.unlockAll ? 'checked' : ''}></label></li>
    <li><a href="#placement"><div><b>Starting level</b><span>Currently ${START_NAMES[S.start] || 'Level ' + S.start} · retake placement</span></div><em>›</em></a></li>
    <li><div class="row" style="padding:10px 0;justify-content:space-between"><div><b style="display:block;font-size:13px">Appearance</b><span class="sub">System follows your device setting</span></div><div class="seg th" id="thseg">${['light', 'dark', 'system'].map(t => `<button data-th="${t}" class="${themePref() === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div></li>
    <li><a href="#about"><div><b>About &amp; disclaimer</b><span>What Chart School is, risks, your data</span></div><em>›</em></a></li>
    <li><a href="#" id="reset"><div><b>Reset all progress</b><span>Quizzes, drills, trades viewed, flashcards, bookmarks, streak</span></div><em>›</em></a></li></ul>
    <p class="sub" style="margin-top:12px">Progress is stored only in this browser on this device.</p>${FOOT}`;
  $('#unlockall').onchange = e => { S.unlockAll = e.target.checked; save(); };
  view.querySelectorAll('#thseg button').forEach(b => b.onclick = () => applyTheme(b.dataset.th));
  $('#reset').onclick = e => { e.preventDefault(); if (confirm('Reset all progress on this device?')) { localStorage.removeItem(KEY); S = load(); save(); location.hash = '#placement'; } };
};

/* ---------------- Lesson widgets ---------------- */
function widget(name) {
  if (name === 'calc') return calcHTML();
  if (name === 'plan') return planHTML();
  if (name === 'take') return '<a class="btn ghost block" href="#take">Practice: Should I take it? →</a>';
  if (name === 'clock') return '<a class="btn ghost block" href="#clock">Open the killzone clock →</a>';
  if (name.startsWith('spot:')) return `<a class="btn ghost block" href="#spot/${name.slice(5)}">Practice in Spot It: ${DRILLS[name.slice(5)].name} →</a>`;
  if (name === 'checklist') return `<ul class="checks live">${CHECK.map(([k, t], i) => `<li><label><input type="checkbox"> ${i + 1}. ${t}</label></li>`).join('')}</ul><p class="sub" id="cl-status">Tick each item as you confirm it. All 8 or no trade.</p>`;
  return '';
}
function bindWidgets(root) {
  bindCalc(root); bindPlan(root);
  const cl = root.querySelector('.checks.live');
  if (cl) cl.querySelectorAll('input').forEach(i => i.onchange = () => { const n = cl.querySelectorAll('input:checked').length; $('#cl-status').innerHTML = n === CHECK.length ? '<b>All 8 confirmed. The setup is valid; size it and follow your plan.</b>' : `${n}/8 confirmed. Not a trade yet.`; });
}

/* ---------------- Popover for glossary terms ---------------- */
let pop = null;
function closePop() { if (pop) { pop.remove(); pop = null; } }
document.addEventListener('click', e => {
  const t = e.target.closest('.term');
  if (!t) { if (!e.target.closest('.pop')) closePop(); return; }
  e.preventDefault(); closePop();
  const g = G[t.dataset.t]; if (!g) return;
  pop = document.createElement('div'); pop.className = 'pop';
  pop.innerHTML = `<b>${esc(g[1])}${g[2] ? ' (' + esc(g[2]) + ')' : ''}</b>${esc(g[3])}`;
  document.body.appendChild(pop);
  const r = t.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), window.innerWidth - pw - 8);
  let top = r.bottom + 6; if (top + ph > window.innerHeight - 60) top = r.top - ph - 6;
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
});
window.addEventListener('scroll', closePop, {passive: true});

/* ---------------- Killzone clock ---------------- */
const NY = 'America/New_York';
const LOCAL = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local';
const SESS = [
  {id: 'asia', name: 'Asian session', s: 20 * 60, e: 24 * 60, col: '#d4d4d4', row: 0},
  {id: 'lokz', name: 'London Open killzone', s: 2 * 60, e: 5 * 60, col: '#8c8c8c', row: 0},
  {id: 'nyam', name: 'New York AM killzone', s: 7 * 60, e: 10 * 60, col: '#555', row: 0},
  {id: 'lc', name: 'London close', s: 10 * 60, e: 12 * 60, col: '#b0b0b0', row: 1},
  {id: 'nypm', name: 'New York PM', s: 13 * 60 + 30, e: 16 * 60, col: '#8c8c8c', row: 1},
  {id: 'sb1', name: 'Silver Bullet (London)', s: 3 * 60, e: 4 * 60, col: '#000', row: 2},
  {id: 'sb2', name: 'Silver Bullet (NY AM)', s: 10 * 60, e: 11 * 60, col: '#000', row: 2},
  {id: 'sb3', name: 'Silver Bullet (NY PM)', s: 14 * 60, e: 15 * 60, col: '#000', row: 2},
];
function nyParts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: NY, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'})
    .formatToParts(d).filter(x => x.type !== 'literal').map(x => [x.type, +x.value]));
  if (p.hour === 24) p.hour = 0;
  return p;
}
function nyOffset(d) { const p = nyParts(d); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000; }
// The real instant at which New York's wall clock reads (y, m, d, minutes). DST-safe.
function nyInstant(y, m, d, mins) {
  const wall = Date.UTC(y, m - 1, d, 0, mins);
  const t1 = wall - nyOffset(new Date(wall)), t2 = wall - nyOffset(new Date(t1));
  // if that wall time doesn't exist (spring-forward gap), t2 lands an hour early; use t1 instead
  return new Date(t2 + nyOffset(new Date(t2)) === wall ? t2 : t1);
}
const fmtT = (d, tz) => new Intl.DateTimeFormat('en-US', {timeZone: tz, hour: 'numeric', minute: '2-digit'}).format(d);
const fmtTS = (d, tz) => new Intl.DateTimeFormat('en-US', {timeZone: tz, hour: 'numeric', minute: '2-digit', second: '2-digit'}).format(d);
const tzAbbr = (d, tz) => (new Intl.DateTimeFormat('en-US', {timeZone: tz, timeZoneName: 'short'}).formatToParts(d).find(p => p.type === 'timeZoneName') || {}).value || '';
function dur(ms) { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return (h ? h + 'h ' : '') + String(m).padStart(h ? 2 : 1, '0') + 'm ' + String(ss).padStart(2, '0') + 's'; }
function sessionState(now) {
  const p = nyParts(now), mins = p.hour * 60 + p.minute + p.second / 60;
  const base = {y: p.year, m: p.month, d: p.day};
  const dayShift = n => { const t = new Date(Date.UTC(base.y, base.m - 1, base.d + n)); return {y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate()}; };
  const list = SESS.map(s => {
    const active = mins >= s.s && mins < s.e;
    const td = dayShift(0), nd = dayShift(1);
    const start = nyInstant(td.y, td.m, td.d, s.s), end = nyInstant(td.y, td.m, td.d, s.e);
    const next = active ? null : (mins < s.s ? start : nyInstant(nd.y, nd.m, nd.d, s.s));
    return {...s, active, start, end, next};
  });
  const upcoming = list.filter(s => !s.active).sort((a, b) => a.next - b.next)[0];
  return {mins, list, upcoming, p};
}
function timelineSVG(st) {
  const W = 360, L = 4, R = 4, top = 4, rh = 12, gap = 5, rows = 3, H = top + rows * (rh + gap) + 18;
  const x = m => L + m / 1440 * (W - L - R);
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">`;
  for (let r = 0; r < rows; r++) s += `<rect x="${L}" y="${top + r * (rh + gap)}" width="${W - L - R}" height="${rh}" fill="#f4f4f4"/>`;
  st.list.forEach(z => s += `<rect x="${x(z.s)}" y="${top + z.row * (rh + gap)}" width="${x(z.e) - x(z.s)}" height="${rh}" fill="${z.col}" ${z.active ? 'stroke="#000" stroke-width="1.2"' : ''}><title>${z.name}</title></rect>`);
  const by = top + rows * (rh + gap) - gap;
  for (let h = 0; h <= 24; h += 3) {
    s += `<line x1="${x(h * 60)}" x2="${x(h * 60)}" y1="${by}" y2="${by + 3}" stroke="#bbb"/>`;
    const lab = h === 0 || h === 24 ? '12a' : h === 12 ? '12p' : h < 12 ? h + 'a' : (h - 12) + 'p';
    s += `<text x="${x(h * 60)}" y="${by + 12}" font-size="8" fill="#8a8a8a" text-anchor="${h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}">${lab}</text>`;
  }
  const nx = x(st.mins);
  s += `<line x1="${nx}" x2="${nx}" y1="0" y2="${by + 2}" stroke="#c0392b" stroke-width="1.4"/><circle cx="${nx}" cy="2" r="2.5" fill="#c0392b"/>`;
  return s + '</svg>';
}
ROUTES.clock = function () {
  setTop('Killzones', '', `<span>${tzAbbr(new Date(), NY)}</span>`);
  view.innerHTML = `<div id="ck"></div>${FOOT}`;
  const tick = () => {
    const now = new Date(), st = sessionState(now), act = st.list.filter(s => s.active);
    const sameTz = new Intl.DateTimeFormat('en-US', {timeZone: LOCAL, hour: 'numeric', minute: 'numeric'}).format(now) === new Intl.DateTimeFormat('en-US', {timeZone: NY, hour: 'numeric', minute: 'numeric'}).format(now);
    const nyDate = new Intl.DateTimeFormat('en-US', {timeZone: NY, weekday: 'short', month: 'short', day: 'numeric'}).format(now);
    const wkend = [0, 6].includes(new Date(Date.UTC(st.p.year, st.p.month - 1, st.p.day)).getUTCDay());
    let h = `<div class="clockbig"><div><div class="tz">New York · ${tzAbbr(now, NY)} · ${nyDate}</div><div class="tm">${fmtTS(now, NY)}</div></div>
      <div class="rt"><div class="tz">Your time · ${tzAbbr(now, LOCAL)}</div><div class="tm">${fmtT(now, LOCAL)}</div></div></div>
      <div class="now"><div class="tz sub" style="font-size:10px;text-transform:uppercase;letter-spacing:.08em">Active now</div>`;
    if (act.length) h += act.map(a => `<div class="st">${a.name}</div><div class="sub">Ends in <span class="cd">${dur(a.end - now)}</span> · at ${fmtT(a.end, NY)} NY</div>`).join('');
    else h += `<div class="st">No killzone</div><div class="sub">Off-hours. A good time to review, not to force trades.</div>`;
    h += `<hr style="margin:8px 0"><div class="sub">Next: <b style="color:var(--fg)">${st.upcoming.name}</b> in <span class="cd">${dur(st.upcoming.next - now)}</span></div>
      ${wkend ? '<div class="sub" style="margin-top:4px">It\'s the weekend in New York: most markets are closed until Sunday evening.</div>' : ''}</div>
      <div class="label">24h · New York time</div><div class="timeline">${timelineSVG(st)}</div>
      <ul class="sess">${st.list.slice().sort((a, b) => a.s - b.s).map(s => `<li class="${s.active ? 'act' : ''}"><span class="sw" style="background:${svVar(s.col)}"></span>${s.name}${s.active ? '<span class="pill">NOW</span>' : ''}
        <span class="tt">${fmtT(s.start, NY)}–${fmtT(s.end, NY)} NY${sameTz ? '' : `<br>${fmtT(s.start, LOCAL)}–${fmtT(s.end, LOCAL)} yours`}</span></li>`).join('')}</ul>
      <p class="sub" style="margin-top:8px">Times follow New York daylight saving automatically. Killzones are tendencies, not rules.</p>`;
    $('#ck').innerHTML = h;
  };
  tick(); timer = setInterval(tick, 1000);
};

/* ---------------- Glossary ---------------- */
ROUTES.glossary = function (arg) {
  setTop('Glossary', '', `<span>${GLOSSARY.length} terms</span>`);
  view.innerHTML = `<input class="search" id="gq" type="search" placeholder="Search ${GLOSSARY.length} terms" autocomplete="off"><ul class="gl" id="gl"></ul>${FOOT}`;
  const list = GLOSSARY.slice().sort((a, b) => a[1].localeCompare(b[1]));
  const render = q => {
    q = q.trim().toLowerCase();
    const f = list.filter(g => !q || (g[1] + ' ' + g[2] + ' ' + g[3]).toLowerCase().includes(q));
    $('#gl').innerHTML = f.length ? f.map(g => `<li id="g-${g[0]}"><div class="gh"><a href="#term/${g[0]}"><b>${esc(g[1])}</b>${g[2] ? `<span class="ab">${esc(g[2])}</span>` : ''}</a>${bmBtn('g:' + g[0], true)}</div><p>${esc(g[3])}</p></li>`).join('') : '<li class="sub">No matching terms.</li>';
  };
  $('#gq').oninput = e => render(e.target.value);
  if (arg) $('#gq').value = arg; render(arg || '');
};

/* ---------------- Bookmarks ----------------
   S.bm keys: 'l:<lessonId>', 'g:<termKey>', 'd:<drillId>', 'w:<walkthroughId>', 'm:<mistakeId>' → timestamp */
const BM_ICON = '<svg viewBox="0 0 24 24"><path d="M7 4h10v16l-5-4-5 4z"/></svg>';
function bmBtn(key, iconOnly) {
  const on = !!S.bm[key];
  return `<button class="bm${on ? ' on' : ''}${iconOnly ? ' ic' : ''}" data-bm="${key}" aria-pressed="${on}" aria-label="${on ? 'Remove bookmark' : 'Bookmark'}">${BM_ICON}${iconOnly ? '' : `<span>${on ? 'Saved' : 'Save'}</span>`}</button>`;
}
function toggleBm(key) {
  if (S.bm[key]) delete S.bm[key]; else S.bm[key] = Date.now();
  save();
  const on = !!S.bm[key];
  document.querySelectorAll(`.bm[data-bm="${key}"]`).forEach(b => {
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.setAttribute('aria-label', on ? 'Remove bookmark' : 'Bookmark');
    const t = b.querySelector('span'); if (t) t.textContent = on ? 'Saved' : 'Save';
  });
}
document.addEventListener('click', e => {
  const b = e.target.closest('.bm'); if (!b) return;
  e.preventDefault(); e.stopPropagation(); toggleBm(b.dataset.bm);
  if (location.hash.startsWith('#bookmarks')) ROUTES.bookmarks();
}, true);
function bmItem(key) {
  const [t, id] = [key.slice(0, 1), key.slice(2)];
  if (t === 'l' && LMAP[id]) { const l = LMAP[id]; return {g: 'Lessons', t: l.t, s: `Level ${l.level} · ${LEVELS.find(L => L.n === l.level).name}`, href: '#lesson/' + id}; }
  if (t === 'g' && G[id]) return {g: 'Glossary', t: G[id][1], s: G[id][3].slice(0, 70) + (G[id][3].length > 70 ? '…' : ''), href: '#term/' + id};
  if (t === 'd' && DMAP[id]) { const d = DMAP[id]; return {g: 'Drills', t: d.t, s: `${DK[d.k][0]} · ${DIFF[d.lv]}`, href: '#drill/' + id}; }
  if (t === 'w' && WMAP[id]) { const w = WMAP[id]; return {g: 'Walkthroughs', t: wName(w), s: wVar(w), href: '#trade/' + id + '/1'}; }
  if (t === 'm' && MMAP[id]) { const x = MMAP[id]; return {g: 'Mistakes', t: x.t, s: TW.cats[x.cat], href: '#mistake/' + id}; }
  return null;
}
ROUTES.bookmarks = function () {
  setTop('Bookmarks', back('#tools', 'Tools'), `<span>${Object.keys(S.bm).length}</span>`);
  const items = Object.entries(S.bm).sort((a, b) => b[1] - a[1]).map(([k]) => [k, bmItem(k)]).filter(x => x[1]);
  let h = '<h1>Bookmarks</h1>';
  if (!items.length) h += '<p class="sub">Nothing saved yet. Tap the bookmark icon on any lesson, glossary term, drill, walkthrough or mistake to keep it here.</p><a class="btn ghost block" href="#search" style="margin-top:10px">Search everything →</a>';
  for (const grp of SGROUPS) {
    const g = items.filter(x => x[1].g === grp); if (!g.length) continue;
    h += `<div class="label">${grp} · ${g.length}</div><ul class="menu bml">${g.map(([k, it]) => `<li><a href="${it.href}"><div><b>${esc(it.t)}</b><span>${esc(it.s)}</span></div></a>${bmBtn(k, true)}</li>`).join('')}</ul>`;
  }
  view.innerHTML = h + FOOT;
};

/* ---------------- Glossary term page ---------------- */
ROUTES.term = function (key) {
  const g = G[key]; if (!g) { location.replace('#glossary'); return; }
  setTop('Glossary', back('#glossary', 'Glossary'));
  const uses = LESSONS.filter(l => [l.intro, l.body, ...l.take, ...l.miss].join(' ').includes('[[' + key));
  view.innerHTML = `<div class="crumb row"><span>Glossary term</span>${bmBtn('g:' + key)}</div><h1>${esc(g[1])}${g[2] ? ` <span class="sub">${esc(g[2])}</span>` : ''}</h1>
    <p class="lead">${esc(g[3])}</p>
    ${uses.length ? `<div class="label">Taught in · ${uses.length}</div><ul class="menu">${uses.slice(0, 12).map(l => `<li><a href="#lesson/${l.id}"><div><b>${esc(l.t)}</b><span>Level ${l.level}</span></div><em>›</em></a></li>`).join('')}</ul>` : ''}
    ${DR.some(d => DK[d.k][1] === key) ? `<a class="btn ghost block" style="margin-top:12px" href="#drills" onclick="S.drf.k='${DR.find(d => DK[d.k][1] === key).k}';save()">Practise in chart drills →</a>` : ''}${FOOT}`;
};

/* ---------------- Chart drills (data from drills.js) ---------------- */
const DR = CS.drillList || [];
const DMAP = Object.fromEntries(DR.map(d => [d.id, d]));
const DK = {liq: ['BSL / SSL', 'bsl'], eq: ['Equal highs/lows', 'eqhl'], fvg: ['Fair value gap', 'fvg'], ob: ['Order block', 'ob'], brk: ['Breaker', 'breaker'],
  ms: ['Structure', 'mss'], disp: ['Displacement', 'displacement'], pd: ['Premium/discount', 'ote'], sweep: ['Sweep & entry', 'sweep'], dol: ['Draw on liquidity', 'dol'],
  kz: ['Killzones', 'killzone'], conf: ['Confirmation', 'checklist']};
const DIFF = {1: 'Beginner', 2: 'Intermediate', 3: 'Advanced'};
const drSolved = () => DR.filter(d => (S.dr[d.id] || {}).best === 100).length;
const drList = () => DR.filter(d => (S.drf.k === 'all' || d.k === S.drf.k) && (!S.drf.lv || d.lv === S.drf.lv));
ROUTES.drills = function () {
  setTop('Drills', '', `<span>${drSolved()}/${DR.length}</span>`);
  if (S.drf.k !== 'all' && !DK[S.drf.k]) S.drf.k = 'all';
  const list = drList(), tries = DR.reduce((a, d) => a + ((S.dr[d.id] || {}).n || 0), 0), rights = DR.reduce((a, d) => a + ((S.dr[d.id] || {}).r || 0), 0);
  const first = list.find(d => (S.dr[d.id] || {}).best !== 100) || list[0];
  view.innerHTML = `<h1>Chart drills</h1><p class="sub">Hand-built charts. Tap the candle, level or zone, or pick an answer.</p>
    <div class="stats"><div><b>${drSolved()}<small style="font-size:11px;color:var(--mute);font-weight:400">/${DR.length}</small></b><span>Solved</span></div><div><b>${tries ? Math.round(rights / tries * 100) + '%' : '–'}</b><span>Accuracy</span></div><div><b>${tries}</b><span>Attempts</span></div></div>
    <div class="label">Concept</div><div class="chips" id="dkf"><button data-k="all" class="${S.drf.k === 'all' ? 'on' : ''}">All</button>${Object.entries(DK).map(([k, v]) => `<button data-k="${k}" class="${S.drf.k === k ? 'on' : ''}">${v[0]}</button>`).join('')}</div>
    <div class="label">Difficulty</div><div class="seg" id="dlf">${[0, 1, 2, 3].map(l => `<button data-l="${l}" class="${S.drf.lv === l ? 'on' : ''}">${l ? DIFF[l] : 'All'}</button>`).join('')}</div>
    ${first ? `<a class="btn block" style="margin-top:12px" id="dstart" href="#drill/${first.id}">Start · ${list.length} drill${list.length === 1 ? '' : 's'}</a>` : ''}
    <ul class="menu drl" style="margin-top:10px">${list.length ? list.map(d => { const st = S.dr[d.id] || {}; return `<li data-id="${d.id}"><a href="#drill/${d.id}"><span class="dm ${st.best === 100 ? 'ok' : st.n ? 'x' : ''}">${st.best === 100 ? '✓' : st.n ? '•' : ''}</span><div><b>${esc(d.t)}</b><span>${DK[d.k][0]} · ${DIFF[d.lv]} · ${{candle: 'Tap a candle', level: 'Tap a level', zone: 'Tap a zone', choice: 'Choose'}[d.type]}</span></div></a>${bmBtn('d:' + d.id, true)}</li>`; }).join('') : '<li class="sub" style="padding:10px 0">No drills match this filter.</li>'}</ul>${FOOT}`;
  view.querySelectorAll('#dkf button').forEach(b => b.onclick = () => { S.drf.k = b.dataset.k; save(); ROUTES.drills(); });
  view.querySelectorAll('#dlf button').forEach(b => b.onclick = () => { S.drf.lv = +b.dataset.l; save(); ROUTES.drills(); });
};
let DS = null;
ROUTES.drill = function (id) {
  const d = DMAP[id]; if (!d) { location.replace('#drills'); return; }
  const list = drList().some(x => x.id === id) ? drList() : DR, pos = list.indexOf(d), nxt = list[(pos + 1) % list.length];
  DS = {d, answered: false, tap: null, ok: null, pick: null};
  setTop(DK[d.k][0], back('#drills', 'Drills'), `<span>${pos + 1}/${list.length}</span>`);
  const st = S.dr[d.id] || {};
  view.innerHTML = `<div class="crumb row"><span>${DK[d.k][0]} · ${DIFF[d.lv]}${st.best === 100 ? ' · solved' : st.n ? ` · ${st.r || 0}/${st.n} right` : ''}</span>${bmBtn('d:' + d.id)}</div>
    <h1>${esc(d.t)}</h1><p class="sub" id="dq" style="color:var(--t3);font-size:13px">${d.q}</p>
    ${d.card ? `<div class="card">${d.card.map(x => `<div>${x}</div>`).join('')}</div>` : ''}
    <div class="chart spot" id="dc"></div>
    ${d.type === 'choice' ? `<div id="dopts" style="margin-top:8px">${d.ans.opts.map((o, i) => `<button class="opt" data-i="${i}">${String.fromCharCode(65 + i)}. ${o}</button>`).join('')}</div>` : `<p class="cap" style="margin-top:4px">${{candle: 'Tap the candle on the chart.', level: 'Tap the price level on the chart.', zone: 'Tap inside the zone on the chart.'}[d.type]}</p>`}
    <div id="dres"></div>
    <div class="row" style="margin-top:6px"><button class="btn ghost" id="dshow">Show answer</button><button class="btn ghost" id="dretry" style="display:none">Try again</button><a class="btn" id="dnext" style="margin-left:auto" href="#drill/${nxt.id}">Next →</a></div>${FOOT}`;
  drawDrill();
  $('#dshow').onclick = () => { if (!DS.answered) drAnswer(null); };
  $('#dretry').onclick = () => ROUTES.drill(id);
  if (d.type === 'choice') view.querySelectorAll('#dopts .opt').forEach(b => b.onclick = () => { if (!DS.answered) drAnswer({pick: +b.dataset.i}); });
};
function drOpts(d, revealed, tap) {
  const o = {h: 230, pt: 18, pb: d.times ? 26 : 16, pr: 8, extra: d.extra, zones: [], lines: [], labels: [], marks: []};
  const add = sp => sp && ['zones', 'lines', 'labels'].forEach(k => (sp[k] || []).forEach(x => o[k].push(Object.assign({}, x))));
  add(d.pre); if (revealed) add(d.show);
  if (d.times) o.marks.push((x, y, sp) => Object.entries(d.times).map(([i, t]) => `<line x1="${x(+i)}" x2="${x(+i)}" y1="${o.h - 20}" y2="${o.h - 16}" stroke="#999"/><text x="${x(+i)}" y="${o.h - 6}" text-anchor="${+i === 0 ? 'start' : 'middle'}" font-size="8.5" fill="#777">${t}</text>`).join(''));
  if (tap) {
    const col = tap.ok ? '#000' : '#c0392b';
    o.marks.push(() => (d.type === 'level' || d.type === 'zone' ? `<line x1="0" x2="360" y1="${tap.y}" y2="${tap.y}" stroke="${col}" stroke-width=".8" stroke-dasharray="2 2"/>` : '') +
      `<circle cx="${tap.x}" cy="${tap.y}" r="7" fill="none" stroke="${col}" stroke-width="1.6"/><circle cx="${tap.x}" cy="${tap.y}" r="1.6" fill="${col}"/>`);
  }
  if (revealed && d.type === 'candle') d.ans.i.forEach(i => o.marks.push((x, y, sp) => { const k = d.c[i]; return `<rect x="${x(i) - sp * .55}" y="${y(k[1]) - 4}" width="${sp * 1.1}" height="${y(k[2]) - y(k[1]) + 8}" fill="none" stroke="#000" stroke-width="1.2" rx="2"/>`; }));
  return o;
}
function drawDrill() {
  const d = DS.d, el = $('#dc');
  DS.ch = chart(d.c.map(k => K(k[0], k[1], k[2], k[3])), drOpts(d, DS.answered, DS.tap));
  el.innerHTML = DS.ch.svg;
  if (d.type === 'choice') return;
  const svg = el.querySelector('svg');
  svg.addEventListener('click', ev => {
    if (DS.answered) return;
    const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM().inverse());
    drAnswer({x: q.x, y: q.y});
  });
}
// Hit test in SVG units. Touch tolerance: at least 14px around levels/zones; candles use the nearest column.
function drHit(d, ch, x, y) {
  const a = d.ans, slack = 14;
  if (d.type === 'candle') { const i = Math.max(0, Math.min(d.c.length - 1, Math.round((x - ch.x(0)) / ch.sp))); return a.i.includes(i); }
  if (d.type === 'level') { const tol = Math.max(slack, Math.abs(ch.y(a.p + (a.tol || 0)) - ch.y(a.p))); return Math.abs(y - ch.y(a.p)) <= tol; }
  if (d.type === 'zone') {
    if (a.i0 != null && x < ch.x(a.i0) - ch.sp * .8) return false;
    if (a.i1 != null && x > ch.x(a.i1) + ch.sp * .8) return false;
    return y >= ch.y(a.top) - slack * .7 && y <= ch.y(a.bot) + slack * .7;
  }
  return false;
}
function drAnswer(res) {
  const d = DS.d; DS.answered = true; $('#dshow').disabled = true;
  let ok = false;
  if (res && d.type === 'choice') ok = res.pick === d.ans.a;
  else if (res) { ok = drHit(d, DS.ch, res.x, res.y); DS.tap = {x: res.x, y: res.y, ok}; }
  if (res) {
    const st = S.dr[d.id] = S.dr[d.id] || {best: 0, n: 0, r: 0};
    st.n++; if (ok) st.r++; st.best = Math.max(st.best, ok ? 100 : 0); st.last = ok ? 1 : 0; save();
  }
  if (d.type === 'choice') view.querySelectorAll('#dopts .opt').forEach(b => { b.disabled = true; const j = +b.dataset.i; if (j === d.ans.a) b.classList.add('right'); else if (res && j === res.pick) b.classList.add('wrong'); });
  drawDrill();
  $('#dres').innerHTML = (res ? (ok ? '<div class="result" id="dverdict" data-ok="1"><b>Correct.</b> +100</div>' : '<div class="result bad" id="dverdict" data-ok="0"><b>Not quite.</b> The answer is marked on the chart.</div>')
    : '<div class="result" id="dverdict" data-ok="-1">Here is the answer.</div>') + `<div class="explain">${inline(d.ex)}${G[DK[d.k][1]] ? ` <span class="sub">Term:</span> <span class="term" data-t="${DK[d.k][1]}">${G[DK[d.k][1]][1]}</span>` : ''}</div>`;
  if (!ok) $('#dretry').style.display = '';
}
// Test hooks: client coordinates of a correct / clearly wrong tap for the current drill.
window.__drill = (wrong) => {
  if (!DS || !DS.ch) return null;
  const d = DS.d, ch = DS.ch, a = d.ans; let x, y;
  if (d.type === 'candle') { let i = a.i[0]; if (wrong) i = [...Array(d.c.length).keys()].find(j => !a.i.includes(j) && Math.abs(j - a.i[0]) > 2); const k = d.c[i]; x = ch.x(i); y = ch.y((k[1] + k[2]) / 2); }
  else if (d.type === 'level') { x = ch.W * .7; y = ch.y(a.p); if (wrong) y = ch.y(a.p) > ch.H / 2 ? 20 : ch.H - 20; }
  else if (d.type === 'zone') { x = a.i0 != null ? Math.min(ch.W - 10, ch.x(a.i0) + ch.sp * 1.5) : ch.W * .75; y = ch.y((a.top + a.bot) / 2); if (wrong) y = ch.y((a.top + a.bot) / 2) > ch.H / 2 ? 20 : ch.H - 20; }
  else return {choice: wrong ? (a.a + 1) % a.opts.length : a.a};
  const svg = $('#dc svg'), m = svg.getScreenCTM();
  return {x: m.a * x + m.e, y: m.d * y + m.f};
};

/* ---------------- Search ---------------- */
const SGROUPS = ['Lessons', 'Walkthroughs', 'Mistakes', 'Glossary', 'Drills'];
let IDX = null;
const plain = s => String(s || '').replace(/\[\[([a-z0-9_]+)(?:\|([^\]]+))?\]\]/g, (m, k, t) => t || (G[k] ? G[k][1] : k)).replace(/\{\{[^}]*\}\}/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ').replace(/(^|\s)#{1,6} /g, '$1').replace(/[*`>]/g, '').replace(/\s+/g, ' ').trim();
function buildIdx() {
  IDX = [
    ...LESSONS.map(l => ({g: 'Lessons', key: 'l:' + l.id, t: l.t, s: `Level ${l.level} · ${l.id.replace('-', '.')}`, body: plain([l.intro, l.body, ...l.take, ...l.miss].join(' ')), href: '#lesson/' + l.id, lock: !unlocked(LEVELS.find(L => L.n === l.level))})),
    ...GLOSSARY.map(g => ({g: 'Glossary', key: 'g:' + g[0], t: g[1] + (g[2] ? ' (' + g[2] + ')' : ''), s: 'Glossary', body: g[3], href: '#term/' + g[0]})),
    ...DR.map(d => ({g: 'Drills', key: 'd:' + d.id, t: d.t, s: `${DK[d.k][0]} · ${DIFF[d.lv]}`, body: plain(d.q + ' ' + d.ex + ' ' + DK[d.k][0]), href: '#drill/' + d.id})),
    ...WT.map(w => ({g: 'Walkthroughs', key: 'w:' + w.id, t: wName(w) + ' · ' + wVar(w), s: 'Walkthrough', body: plain(['Top-down walkthrough', w.m.sum, w.m.x2, w.m.x3, w.m.x4, w.m.zn, ...w.m.terms.map(k => G[k] ? G[k][1] : k)].map(x => tok(x || '', w.v.bear).replace(/\{[A-Z0-9]+\}/g, '')).join(' ')), href: '#trade/' + w.id + '/1'})),
    ...MI.map(x => ({g: 'Mistakes', key: 'm:' + x.id, t: x.t, s: 'Mistake · ' + TW.cats[x.cat], body: plain([x.d, x.what, x.why, x.fix, 'mistake'].join(' ')), href: '#mistake/' + x.id})),
  ];
  IDX.forEach(e => { e.lt = e.t.toLowerCase(); e.lb = e.body.toLowerCase(); });
}
function searchAll(q) {
  if (!IDX) buildIdx();
  const toks = q.toLowerCase().split(/[\s,]+/).filter(Boolean); if (!toks.length) return [];
  const ql = q.trim().toLowerCase(), out = [];
  for (const e of IDX) {
    let sc = 0, ok = true;
    for (const t of toks) { const inT = e.lt.includes(t), inB = !inT && e.lb.includes(t); if (!inT && !inB) { ok = false; break; } sc += inT ? 10 : 1; }
    if (!ok) continue;
    if (e.lt === ql || e.lt.startsWith(ql + ' ') || e.lt.includes('(' + ql + ')')) sc += 40; else if (e.lt.startsWith(ql)) sc += 20;
    out.push({e, sc});
  }
  return out.sort((a, b) => b.sc - a.sc || a.e.t.length - b.e.t.length).map(x => x.e);
}
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function hl(text, toks) {
  if (!toks.length) return esc(text);
  const re = new RegExp('(' + toks.map(reEsc).sort((a, b) => b.length - a.length).join('|') + ')', 'gi');
  return text.split(re).map((p, i) => i % 2 ? `<mark>${esc(p)}</mark>` : esc(p)).join('');
}
function snippet(body, toks) {
  const lb = body.toLowerCase(); let at = -1;
  for (const t of toks) { const i = lb.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return body.slice(0, 110) + (body.length > 110 ? '…' : '');
  let s0 = Math.max(0, at - 40), s1 = Math.min(body.length, at + 90);
  if (s0) { const sp = body.lastIndexOf(' ', s0); s0 = sp < 0 || at - sp > 60 ? s0 : sp + 1; }
  if (s1 < body.length) { const sp = body.indexOf(' ', s1); if (sp > 0 && sp - s1 < 20) s1 = sp; }
  return (s0 ? '…' : '') + body.slice(s0, s1) + (s1 < body.length ? '…' : '');
}
ROUTES.search = function (q0) {
  setTop('Search', back('#home', 'Home'), '', true);
  view.innerHTML = `<input class="search" id="sq" type="search" placeholder="Search lessons, terms, drills, trades" autocomplete="off" enterkeyhint="search">
    <div id="sres"></div>${FOOT}`;
  const inp = $('#sq'), more = {};
  const render = () => {
    const q = inp.value, toks = q.toLowerCase().split(/[\s,]+/).filter(Boolean);
    try { history.replaceState(null, '', '#search' + (q ? '/' + encodeURIComponent(q) : '')); } catch (e) {}
    if (!toks.length) {
      const n = Object.keys(S.bm).length;
      $('#sres').innerHTML = `<p class="sub" style="margin-top:10px">Search ${LESSONS.length} lessons, ${GLOSSARY.length} glossary terms, ${DR.length} chart drills, ${WT.length} trade walkthroughs and ${MI.length} mistakes.${matchMedia('(hover:hover)').matches ? ' Press <code>/</code> anywhere to search.' : ''}</p>
        <div class="label">Try</div><div class="chips">${['FVG', 'order block', 'Silver Bullet', 'OTE', 'breaker', 'revenge', 'stop', 'killzone'].map(t => `<button data-q="${t}">${t}</button>`).join('')}</div>
        <ul class="menu" style="margin-top:14px"><li><a href="#bookmarks"><div><b>Bookmarks</b><span>Your saved lessons, terms, drills and trades</span></div><em>${n}</em></a></li></ul>`;
      $('#sres').querySelectorAll('[data-q]').forEach(b => b.onclick = () => { inp.value = b.dataset.q; render(); });
      return;
    }
    const res = searchAll(q);
    if (!res.length) { $('#sres').innerHTML = `<p class="sub" style="margin-top:12px" id="snone">No results for “${esc(q)}”.</p>`; return; }
    let h = `<p class="sub" style="margin-top:8px" id="scount">${res.length} result${res.length === 1 ? '' : 's'}</p>`;
    for (const grp of SGROUPS) {
      const g = res.filter(e => e.g === grp); if (!g.length) continue;
      const lim = more[grp] ? g.length : 6;
      h += `<div class="label">${grp} · ${g.length}</div><ul class="sr" data-g="${grp}">${g.slice(0, lim).map(e => `<li><a href="${e.href}"><b>${hl(e.t, toks)}</b><span class="tag">${esc(e.s)}${e.lock ? ' · 🔒' : ''}</span><p>${hl(snippet(e.body, toks), toks)}</p></a>${bmBtn(e.key, true)}</li>`).join('')}</ul>`;
      if (g.length > lim) h += `<button class="btn ghost block smore" data-g="${grp}">Show all ${g.length} ${grp.toLowerCase()}</button>`;
    }
    $('#sres').innerHTML = h;
    $('#sres').querySelectorAll('.smore').forEach(b => b.onclick = () => { more[b.dataset.g] = 1; render(); });
  };
  inp.oninput = render;
  inp.value = q0 || ''; render();
  if (!q0 || matchMedia('(hover:hover)').matches) inp.focus();
};
document.addEventListener('keydown', e => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if (document.querySelector('.modal')) return;
  e.preventDefault();
  if (location.hash.startsWith('#search')) $('#sq').focus(); else location.hash = '#search';
});

/* ---------------- About & disclaimer ---------------- */
const ACK = 'chartschool.ack';
const REPO = 'https://github.com/kavdope/chart-school';
const DISCLAIMER = [
  ['Educational only', 'Chart School is for education only. It is not financial, investment, tax or legal advice, and nothing in it is a recommendation to buy or sell anything.'],
  ['Trading is risky', 'Trading stocks, futures, forex, options and crypto involves substantial risk of loss and is not suitable for everyone. You can lose more than you deposit with leveraged products. Only trade money you can afford to lose.'],
  ['No guarantees', 'Past performance, including any example, backtest or chart shown here, is not indicative of future results. Charts in lessons and drills are illustrations, not real trades.'],
  ['Do your own research', 'Do your own research and consider speaking with a licensed financial professional before making any trading decision.'],
  ['Accuracy', 'Content is provided as is, with no guarantee that it is accurate, complete or up to date. Session times and market rules can change.'],
  ['Not affiliated with ICT', 'Chart School is independent. It is not affiliated with, endorsed by or connected to Michael J. Huddleston or The Inner Circle Trader (ICT). ICT concepts and terms are referenced for educational purposes.'],
  ['Your data stays on your device', 'There are no accounts, ads or tracking. Your progress, bookmarks and notes are stored only in this browser on this device (localStorage). Clearing site data or using Reset removes them.'],
];
ROUTES.about = function () {
  setTop('About', S.placed ? back('#tools', 'Tools') : back('#placement', 'Back'));
  const n = LESSONS.length, q = LESSONS.reduce((a, l) => a + l.quiz.length, 0);
  view.innerHTML = `<div class="lesson"><h1>About Chart School</h1>
    <p class="lead">A free, open-source app that teaches trading from your first candle to professional-level ICT concepts.</p>
    <p>It works offline and can be added to your home screen like an app.</p>
    <div class="stats"><div><b>${LEVELS.length}</b><span>Levels</span></div><div><b>${n}</b><span>Lessons</span></div><div><b>${DR.length}</b><span>Drills</span></div></div>
    <h2>Levels</h2><table class="t"><tbody>${LEVELS.map(L => `<tr><td style="width:26px">${L.n}</td><td><b>${esc(L.name)}</b><br><span class="sub">${esc(L.d)}</span></td></tr>`).join('')}</tbody></table>
    <p class="sub">${q} quiz questions, ${GLOSSARY.length} glossary terms, ${DR.length} chart drills, flashcards, a killzone clock, a position-size calculator and a trading plan builder.</p>
    <h2>How your progress is stored</h2><p>Everything (quiz scores, drill results, bookmarks, flashcards, your plan) is saved in this browser on this device only. Nothing is sent to a server. Progress doesn't sync between devices, and clearing your browser data erases it.</p>
    <h2>Open source</h2><p>The code is public: <a href="${REPO}" target="_blank" rel="noopener" id="repolink">github.com/kavdope/chart-school</a></p>
    <h2 id="disclaimer">Disclaimer</h2>${DISCLAIMER.map(([t, d]) => `<p><b>${t}.</b> ${d}</p>`).join('')}
    <p class="sub">${localStorage.getItem(ACK) ? 'You acknowledged this disclaimer on ' + new Date(+localStorage.getItem(ACK) || Date.now()).toLocaleDateString() + '.' : ''}</p></div>${FOOT}`;
};
function maybeAck() {
  let seen = null; try { seen = localStorage.getItem(ACK); } catch (e) { return; }
  if (seen || document.querySelector('.modal')) return;
  const m = document.createElement('div'); m.className = 'modal'; m.id = 'ack';
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ackt"><h1 id="ackt">Before you start</h1>
    <ul>${DISCLAIMER.map(([t, d]) => `<li><b>${t}.</b> ${d}</li>`).join('')}</ul>
    <button class="btn block" id="ackok">I understand</button></div>`;
  document.body.appendChild(m); document.body.classList.add('noscroll');
  $('#ackok').onclick = () => { try { localStorage.setItem(ACK, String(Date.now())); } catch (e) {} m.remove(); document.body.classList.remove('noscroll'); };
}

/* ---------------- Trades: top-down walkthroughs + mistake library (data from trades.js / mistakes.js) ----------------
   S.tv[walkthroughId] = furthest step seen (1-6); S.twAnn = annotations on/off; S.mf = mistake category filter. */
const TW = CS.TW || {models: [], mistakes: [], cats: {}};
const WT = TW.models.flatMap(m => m.variants.map(v => ({id: m.id + '-' + v.key, m, v})));
const WMAP = Object.fromEntries(WT.map(w => [w.id, w]));
const MI = TW.mistakes || [], MMAP = Object.fromEntries(MI.map(x => [x.id, x]));
const tok = (s, bear) => String(s || '').replace(/\{\{([^|}]*)\|([^}]*)\}\}/g, (m, a, b) => bear ? b : a);
const wName = w => tok(w.m.name, w.v.bear);
const wVar = w => (w.m.vname && w.m.vname[w.v.key]) || (w.v.bear ? 'Bearish' : 'Bullish');
const wViewed = id => (S.tv[id] || 0) >= 5;
const f2 = v => (+v).toFixed(2);
const hm = m => { m = ((m % 1440) + 1440) % 1440; const h = Math.floor(m / 60), mm = m % 60; return `${h % 12 || 12}:${String(mm).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; };
const STEPS = ['4H · Bias & draw on liquidity', '15m · Liquidity & structure', '5m · Sweep & shift', 'Entry · Risk & reward', 'Outcome & checklist', 'What NOT to do'];
const STEPS_SHORT = ['HTF', 'ITF', 'LTF', 'Entry', 'Result', 'Don\'t'];
const GRN = '#1f8a4c', RED = '#c0392b';

function wBuild(w) { const B = TW.build(w.m, w.v); return B && !B.err ? B : null; }
// Text placeholders for one walkthrough.
function wVals(w, B) {
  const t = B.trade, lv = B.lv, bear = B.bear, z = B.en.zone3 || B.en.zone, M = B.ltf.length;
  const tm = i => hm(B.t0 + 5 * i);
  return {E: f2(t.E), SL: f2(t.SL), TP: f2(t.TP), TP1: f2(t.TP1), RR: t.rr.toFixed(1), RISK: f2(Math.abs(t.E - t.SL)), REW: f2(Math.abs(t.TP - t.E)),
    POOL: f2(bear ? lv.ITFhigh : lv.ITFlow), TGT: f2(t.TP), DOL: f2(bear ? lv.HTFlow : lv.HTFhigh), LO: f2(lv.HTFlow), HI: f2(lv.HTFhigh),
    SW: f2(B.P[B.ro.SW]), LH: f2(B.P[B.ro.LH]), Z: z ? f2(z.bot) + '–' + f2(z.top) : f2(t.E), EQ: f2(lv.EQ), HF: f2(lv.hfvg.bot) + '–' + f2(lv.hfvg.top),
    OPEN: f2(B.ltf[0].o), WIN: w.v.wname || '', KZN: w.v.kzname || '', FILLT: tm(t.fill), EXITT: tm(t.exit), T0: tm(0), T1: tm(M)};
}
const fill = (s, V, bear) => tok(s, bear).replace(/\{([A-Z0-9]+)\}/g, (m, k) => V[k] != null ? V[k] : m);
function wTexts(w, B) {
  const m = w.m, V = wVals(w, B), b = B.bear, F = s => fill(s, V, b);
  const s1 = F('On the 4H, price is in a {{bullish|bearish}} dealing range from {LO} to {HI}. The **draw on liquidity** is the {{old high (buy-side liquidity)|old low (sell-side liquidity)}} at **{DOL}**. Price has pulled back into **{{discount|premium}}**, {{below|above}} the 50% line at {EQ}, and into a **4H {{bullish|bearish}} FVG** ({HF}). Bias: **{{bullish|bearish}}**, so only look for {{longs|shorts}}.');
  const s2 = F('Drop to the 15m. Mark the liquidity: {{sell|buy}}-side stops rest {{below|above}} the 15m {{low|high}} at **{POOL}**, and the 15m {{high|low}} at **{TGT}** is the first target. Price is trading inside the 4H FVG. Now wait for a run on {POOL} during a killzone.') + (m.x2 ? ' ' + F(m.x2) : '');
  const s3 = F('On the 5m (' + (V.T0) + ' to ' + V.T1 + ' NY), price ran {POOL} to **{SW}** and then shifted structure: displacement closed {{above|below}} the swing at **{LH}**. ') + F(m.x3);
  const s4 = F(m.x4) + F(' Entry **{E}**, stop **{SL}** beyond the sweep {{low|high}}, target **{TP}**. Risk {RISK}, reward {REW}: **R:R 1 : {RR}**. Optional partial at {TP1}, the nearest internal {{high|low}}.');
  const s5 = F('Filled at {FILLT} NY. The target at {TP} was hit at {EXITT}: **+{RR}R**. The stop was never touched.');
  const ck = [F('4H bias {{bullish|bearish}}, draw on liquidity at {DOL}'), F('Price in 4H {{discount|premium}} and inside the 4H FVG ({HF})'), F('15m {{sell|buy}}-side liquidity swept ({POOL} → {SW})'),
    F('Market structure shift: displacement through {LH}'), F('Entry at the ' + m.zn + ' ({Z})'), F('Filled inside a killzone ({FILLT} NY)')];
  if (m.win) ck.push(F('FVG formed inside the {WIN} Silver Bullet window'));
  if (m.smt) ck.push(F('NQ did not confirm the sweep: SMT divergence'));
  if (m.midnight) ck.push(F('{{Below|Above}} the midnight open ({OPEN})'));
  if (m.po3) ck.push(F('Entry on the manipulation side of the 4H open ({OPEN})'));
  ck.push(F('Stop beyond the sweep, R:R 1 : {RR}'));
  return {s1, s2, s3, s4, s5, ck, V};
}
const DONT_TXT = {
  early: ['Entering before the sweep', '{{Bought|Sold}} at {DE} as price approached the 15m {{low|high}}, before any sweep or shift, with the stop at {DSL}. That stop sat inside the liquidity. Price ran it on the way to {SW}, then made the real move without this trade.', 'before-displacement'],
  tight: ['Stop inside the entry zone', 'The entry at {DE} was fine, but the stop at {DSL} was inside the {ZN} instead of beyond the sweep {{low|high}}. A normal retracement deeper into the zone took it out, and then price went to the target.', 'stop-inside-zone'],
  chase: ['Chasing the displacement', '{{Bought|Sold}} {DE} near the end of the displacement with a tight stop at {DSL}. The retracement back into the {ZN} stopped it out before the move continued.', 'chasing'],
  fade: ['{{Selling|Buying}} the sweep', '{{Shorted|Bought}} the break of the 15m {{low|high}} at {DE}. In 4H {{discount|premium}} with an untouched draw on liquidity {{above|below}}, that break was a sweep, not a breakdown. Price reversed through the stop at {DSL}.', 'fade-sweep'],
};

/* Trade box (TradingView style): reward and risk rectangles, entry/SL/TP lines and labels. */
function boxMark(t, i0, i1, o = {}) {
  return (x, y, sp) => {
    const x0 = x(i0) - sp / 2, x1 = x(i1) + sp / 2, w = x1 - x0, slP = t.SL != null ? t.SL : t.showSL;
    const yE = y(t.E), yT = y(t.TP), yS = y(slP), op = o.faint ? .5 : 1;
    let s = `<g class="tbox" opacity="${op}" data-dir="${t.dir}">`;
    s += `<rect class="rw" x="${x0}" y="${Math.min(yE, yT)}" width="${w}" height="${Math.abs(yT - yE)}" fill="rgba(31,138,76,.14)"/>`;
    s += `<rect class="rk" x="${x0}" y="${Math.min(yE, yS)}" width="${w}" height="${Math.abs(yS - yE)}" fill="rgba(192,57,43,.13)"/>`;
    s += `<line x1="${x0}" x2="${x1}" y1="${yT}" y2="${yT}" stroke="${GRN}" stroke-width=".9"/><line x1="${x0}" x2="${x1}" y1="${yS}" y2="${yS}" stroke="${RED}" stroke-width=".9" ${t.SL == null ? 'stroke-dasharray="3 2"' : ''}/>`;
    s += `<line x1="${x0}" x2="${x1}" y1="${yE}" y2="${yE}" stroke="#000" stroke-width="1"/>`;
    const lx = o.lx || 307, up = yT < yE, lab = !o.nolab;
    const sep = (a, b) => b + Math.sign(b - a || 1) * Math.max(0, 9 - Math.abs(b - a)), lT = sep(yE, yT), lS = sep(yE, yS);
    if (lab && x1 < lx - 8) [[yT, GRN], [yE, '#000'], [yS, RED]].forEach(([yy, cl]) => s += `<line x1="${x1}" x2="${lx - 2}" y1="${yy}" y2="${yy}" stroke="${cl}" stroke-width=".5" stroke-dasharray="1 2" opacity=".6"/>`);
    if (lab) s += `<text x="${lx}" y="${lT + 3}" font-size="8" fill="${GRN}" font-weight="600">TP ${f2(t.TP)}</text><text x="${lx}" y="${yE + 3}" font-size="8" fill="#000" font-weight="600">${o.elab || 'Entry'} ${f2(t.E)}</text><text x="${lx}" y="${lS + 3}" font-size="8" fill="${RED}" font-weight="600">${t.SL == null ? 'no stop' : 'SL ' + f2(t.SL)}</text>`;
    if (t.rr != null && !o.norr) { const h = Math.abs(yT - yE), ty = h > 13 ? (yT + yE) / 2 + 3 : (up ? yT - 3 : yT + 9); s += `<text class="rrl" x="${x0 + 3}" y="${ty}" font-size="8.5" fill="${GRN}" font-weight="600">R:R 1 : ${t.rr.toFixed(1)}</text>`; }
    if (o.tag) s += `<text x="${x0 + 1}" y="${up ? yT - 3 : yT + 9}" font-size="8" fill="#555">${esc(o.tag)}</text>`;
    return s + '</g>';
  };
}
const txtMark = (i, p, text, c = '#000', pos = 'above') => (x, y) => `<text x="${x(i)}" y="${y(p) + (pos === 'above' ? -6 : 13)}" text-anchor="middle" font-size="8.5" font-weight="600" fill="${c}">${text}</text>`;
const colMark = (i0, i1, label) => (x, y, sp) => { const a = x(i0) - sp / 2, b = x(i1) + sp / 2; return `<rect x="${a}" y="2" width="${b - a}" height="188" fill="none" stroke="#000" stroke-width=".7" stroke-dasharray="3 2"/><text x="${(a + b) / 2}" y="12" text-anchor="middle" font-size="8" fill="#000">${label}</text>`; };
const timeMark = (t0, n, step) => (x, y, sp) => { let s = ''; for (let i = 0; i < n; i++) { const m = t0 + step * i; if (m % 60 === 0) s += `<line x1="${x(i) - sp / 2}" x2="${x(i) - sp / 2}" y1="194" y2="198" stroke="#bbb"/><text x="${x(i) - sp / 2}" y="207" text-anchor="middle" font-size="7.5" fill="#8a8a8a">${hm(m).replace(':00', '')}</text>`; } return s; };
const shadeT = (i0, i1, label) => (x, y, sp) => { const a = x(i0) - sp / 2, b = x(i1) + sp / 2; return `<rect x="${a}" y="2" width="${b - a}" height="190" fill="rgba(0,0,0,.045)"/><text x="${a + 2}" y="189" font-size="7.5" fill="#555">${label}</text>`; };
function resMark(t, c) {
  if (t.res === 'nofill') return (x, y) => `<text x="${x(c.length - 1)}" y="${y(t.E) - 5}" text-anchor="end" font-size="8.5" font-weight="600" fill="#555">not filled</text>`;
  if (t.res === 'open') { const last = c[c.length - 1].c, r = t.showSL != null ? (last - t.E) * t.dir / Math.abs(t.E - t.showSL) : 0; return txtMark(c.length - 1, last, `${r.toFixed(1)}R, still open`, RED, t.dir > 0 ? 'below' : 'above'); }
  const win = t.res === 'win', p = win ? t.TP : t.SL, below = (t.dir > 0) !== win;
  return txtMark(t.exit, p, win ? `✓ +${t.rr.toFixed(1)}R` : '✗ −1R', win ? GRN : RED, below ? 'below' : 'above');
}

/* Renders one step of a walkthrough. Returns svg html. */
function wChart(w, B, step) {
  const ann = S.twAnn !== false, bear = B.bear, lv = B.lv, ro = B.ro, at = B.at, t = B.trade;
  const pool = bear ? lv.ITFhigh : lv.ITFlow, tgt = t.TP, dol = bear ? lv.HTFlow : lv.HTFhigh, side = bear ? 'BSL' : 'SSL', oside = bear ? 'SSL' : 'BSL';
  const base = {w: 360, h: 212, pt: 16, pb: 22, pl: 6, pr: 56};
  if (step === 1) {
    const V = TW.view(B, 0), c = V.htf, o = Object.assign({}, base, {slots: 28, zones: [], lines: [], labels: [], marks: [], extra: [lv.HTFlow, lv.HTFhigh]});
    if (ann) {
      const disc = bear ? {top: lv.HTFhigh, bot: lv.EQ} : {top: lv.EQ, bot: lv.HTFlow};
      o.zones.push({i0: 0, top: disc.top, bot: disc.bot, fill: 'rgba(0,0,0,.035)', label: bear ? 'Premium' : 'Discount', la: 'start', lb: !bear, lc: '#8a8a8a'});
      o.zones.push({i0: lv.hfvg.i, top: lv.hfvg.top, bot: lv.hfvg.bot, fill: bear ? 'rgba(192,57,43,.12)' : 'rgba(31,138,76,.14)', label: '4H FVG', lb: !bear, lc: '#000'});
      o.lines.push({y: lv.EQ, dash: '4 3', label: 'EQ ' + f2(lv.EQ), out: 1, c: '#555'});
      o.lines.push({y: dol, dash: '2 2', label: oside + ' · DOL', out: 1, sw: 1.1});
      o.lines.push({y: bear ? lv.HTFhigh : lv.HTFlow, dash: '2 2', label: 'range ' + (bear ? 'high' : 'low'), out: 1, c: '#8a8a8a'});
      o.marks.push(colMark(26, 27, '15m ›'));
      o.marks.push(txtMark(13, dol, 'draw ' + (bear ? '↓' : '↑'), '#000', bear ? 'below' : 'above'));
    }
    return chart(c, o).svg;
  }
  if (step === 2) {
    const n = at[ro.La] + 1, V = TW.view(B, n), c = V.itf, pre = B.itfPre.length;
    const o = Object.assign({}, base, {slots: 32, zones: [], lines: [], labels: [], marks: [], extra: [pool, tgt]});
    if (ann) {
      const pf = (w.m.itf.poolFrom || 0); let pi = pf; for (let i = pf; i < pre; i++) if (bear ? c[i].h > c[pi].h : c[i].l < c[pi].l) pi = i;
      let ti = 0; for (let i = 0; i < pre; i++) if (bear ? c[i].l < c[ti].l : c[i].h > c[ti].h) ti = i;
      o.zones.push({i0: 0, top: lv.hfvg.top, bot: lv.hfvg.bot, fill: bear ? 'rgba(192,57,43,.06)' : 'rgba(31,138,76,.07)', label: '4H FVG zone', la: 'start', lb: bear, lc: '#555'});
      o.lines.push({i0: pi, y: pool, dash: '3 2', label: side + ' ' + f2(pool), out: 1});
      o.lines.push({i0: ti, y: tgt, dash: '3 2', label: oside + ' ' + f2(tgt), out: 1, c: GRN});
      o.marks.push(colMark(pre, 31, '5m ›'));
    }
    return chart(c, o).svg;
  }
  const now = B.now, n = step === 3 ? now + 1 : step === 4 ? t.fill + 1 : B.ltf.length;
  const c = B.ltf.slice(0, n), en = B.en, z = en.zone;
  const ex = [t.TP, t.SL, pool]; if (step === 6) B.donts.forEach(d => ex.push(d.SL, d.TP, d.E));
  const o = Object.assign({}, base, {slots: B.ltf.length, zones: [], lines: [], labels: [], marks: [], extra: step >= 4 ? ex : [pool]});
  o.marks.push(timeMark(B.t0, B.ltf.length, 5));
  if (ann) {
    if (w.v.win) o.marks.unshift(shadeT((w.v.win[0] - B.t0) / 5, Math.min(B.ltf.length - 1, (w.v.win[1] - B.t0) / 5 - 1), 'SB ' + w.v.wname));
    if (w.m.midnight || w.m.po3) o.lines.push({y: B.ltf[0].o, dash: '1 2', label: w.m.po3 ? '4H open' : 'midnight open', la: 'start', c: '#555'});
    if (step <= 4 || step === 5) {
      o.lines.push({i0: 0, i1: at[ro.SW], y: pool, dash: '3 2', label: side + ' ' + f2(pool), la: 'start', below: bear ? 0 : 1});
      const mi = c.findIndex((k, i) => i > at[ro.SW] && (bear ? k.c < B.P[ro.LH] : k.c > B.P[ro.LH]));
      o.lines.push({i0: at[ro.LH], i1: mi > 0 ? mi : n - 1, y: B.P[ro.LH], dash: '3 2', label: 'MSS', la: 'start', below: bear ? 1 : 0});
      o.marks.push(txtMark(at[ro.SW], B.P[ro.SW], 'sweep', '#000', bear ? 'above' : 'below'));
      const pz = en.zone3 || en.zone, zz = [en.zone, en.zone2, en.zone3].filter(q => q && q !== pz).concat(pz ? [pz] : []);
      zz.forEach((q, k) => { const last = k === zz.length - 1, i0 = q.i != null ? q.i : at[ro.D]; o.zones.push({i0, top: q.top, bot: q.bot, fill: last ? 'rgba(0,0,0,.14)' : 'rgba(0,0,0,.06)', stroke: last ? '#000' : 'none', dash: 1});
        o.marks.push((x, y, sp) => `<text x="${x(Math.min(i0 + (last ? 3 : 0), n - 1)) - sp / 2 + 2}" y="${bear && last ? y(q.bot) + 9 : y(q.top) - 2}" font-size="${last ? 8.5 : 7.5}" font-weight="${last ? 600 : 400}" fill="${last ? '#000' : '#555'}">${q.label}</text>`); });
      if (en.fib) { const {lo, hi} = en.fib; o.lines.push({i0: at[ro.D], y: hi - .705 * (hi - lo), dash: '1 2', sw: .7, c: '#555'}); }
    }
    if (step === 4) o.marks.push(boxMark(t, t.fill, Math.min(B.ltf.length - 1, t.fill + 12)));
    if (step === 5) { o.marks.push(boxMark(t, t.fill, t.exit)); o.marks.push(resMark(t, B.ltf)); o.lines.push({y: t.TP1, dash: '1 2', sw: .6, label: 'TP1', la: 'start', c: GRN}); }
  }
  return chart(c, o).svg;
}
// SMT companion chart (NQ) for steps 3-5.
function wSmt(B, step) {
  if (!B.smt || step < 3 || step > 5) return '';
  const n = step === 3 ? B.now + 1 : step === 4 ? B.trade.fill + 1 : B.ltf.length, c = B.smt.slice(0, n), ro = B.ro, at = B.at, bear = B.bear, ann = S.twAnn !== false;
  const o = {w: 360, h: 120, pt: 12, pb: 10, pr: 56, slots: B.ltf.length, lines: [], marks: []};
  if (ann) { const p1 = B.P[ro.La]; o.lines.push({i0: at[ro.La], i1: at[ro.SW], y: p1, dash: '3 2', label: bear ? 'prior high' : 'prior low', la: 'start', below: bear ? 0 : 1}); o.marks.push(txtMark(at[ro.SW], B.smtLow, bear ? 'lower high · SMT' : 'higher low · SMT', '#000', bear ? 'above' : 'below')); }
  return `<div class="chart tw-smt">${chart(c, o).svg}</div><p class="cap">NQ, 5m. ES swept its ${bear ? 'high' : 'low'}; NQ did not.</p>`;
}
function dontChart(B, d, wide) {
  const ann = S.twAnn !== false, c = B.ltf;
  const o = {w: 360, h: 212, pt: 16, pb: 22, pr: 56, slots: c.length, extra: [d.SL, d.TP, d.E], marks: [timeMark(B.t0, c.length, 5)], lines: [], zones: []};
  if (ann) { o.marks.push(boxMark(d, d.fill, d.exit != null ? Math.max(d.exit, d.fill + 2) : c.length - 1, {elab: 'Entry'})); o.marks.push(resMark(d, c)); const z = B.en.zone3 || B.en.zone; if (z) o.zones.push({i0: z.i, top: z.top, bot: z.bot, fill: 'rgba(0,0,0,.08)'}); }
  return chart(c, o).svg;
}

let TWS = null;
ROUTES.trades = function () {
  setTop('Trades', '', `<span>${WT.filter(w => wViewed(w.id)).length}/${WT.length}</span>`);
  const seen = WT.filter(w => wViewed(w.id)).length;
  view.innerHTML = `<h1>Trades</h1><p class="sub">Top-down examples: what to mark on the 4H, 15m and 5m, where to enter, and where the stop and target go. Plus what not to do.</p>
    <div class="seg twseg" style="margin-top:10px"><button class="on">Walkthroughs</button><button onclick="location.hash='#mistakes'">Mistake library</button></div>
    <div class="stats"><div><b>${TW.models.length}</b><span>Models</span></div><div><b>${seen}<small style="font-size:11px;color:var(--mute);font-weight:400">/${WT.length}</small></b><span>Viewed</span></div><div><b>${MI.length}</b><span>Mistakes</span></div></div>
    <ul class="menu twl" style="margin-top:12px">${TW.models.map(m => { const ws = WT.filter(w => w.m === m), done = ws.every(w => wViewed(w.id));
      return `<li data-m="${m.id}"><div class="twm"><a href="#trade/${ws[0].id}/1"><span class="dm ${done ? 'ok' : ws.some(w => S.tv[w.id]) ? 'x' : ''}">${done ? '✓' : ''}</span><div><b>${esc(tok(m.name, false).replace(/ Buy Model$/, ' Buy/Sell Model'))}</b><span>${esc(tok(m.sum, false))}</span></div></a>
      <div class="chips twv">${ws.map(w => `<a class="chip${wViewed(w.id) ? ' on' : ''}" href="#trade/${w.id}/1" data-w="${w.id}">${wViewed(w.id) ? '✓ ' : ''}${esc(wVar(w))}</a>`).join('')}</div></div></li>`; }).join('')}</ul>
    <p class="sub" style="margin-top:10px">Charts are built examples, not real market data. Every level is checked: the example trade hits its target and each "don't" version is stopped out on the same candles.</p>${FOOT}`;
};
ROUTES.trade = function (arg) {
  const [id, st] = arg.split('/'), w = WMAP[id]; if (!w) { location.replace('#trades'); return; }
  const B = wBuild(w); if (!B) { view.innerHTML = '<p class="sub">This example could not be built.</p>'; return; }
  const step = Math.min(6, Math.max(1, parseInt(st, 10) || 1));
  S.tv[id] = Math.max(S.tv[id] || 0, step); save();
  const T = wTexts(w, B), list = WT, pos = list.indexOf(w);
  TWS = {id, step, B};
  setTop(wName(w).length > 24 ? wName(w).slice(0, 23) + '…' : wName(w), back('#trades', 'Trades'), `<span>${step}/6</span>`);
  const lesson = LMAP[w.m.lesson];
  let body = '';
  if (step === 1) body = `<p>${inline(T.s1)}</p>`;
  if (step === 2) body = `<p>${inline(T.s2)}</p>`;
  if (step === 3) body = `<p>${inline(T.s3)}</p>`;
  if (step === 4) body = `<p>${inline(T.s4)}</p>`;
  if (step === 5) body = `<p>${inline(T.s5)}</p><div class="label">Checklist</div><ul class="ck">${T.ck.map(c => `<li>${inline(c)}</li>`).join('')}</ul>`;
  let charts = '';
  const caps = {1: '4H chart. The dashed box is where the 15m chart zooms in.', 2: '15m chart. Its last 16 candles are the 5m chart on the next step.', 3: `5m chart, ${T.V.T0} to ${T.V.T1} NY.`, 4: '5m chart at the moment of entry.', 5: '5m chart, full session.'};
  if (step <= 5) charts = `<div class="chart" id="twc">${wChart(w, B, step)}</div>${wSmt(B, step)}<p class="cap">${caps[step]}</p>`;
  else charts = B.donts.map((d, k) => { const [h, txt, mid] = DONT_TXT[d.kind];
      const V = Object.assign({}, T.V, {DE: f2(d.E), DSL: f2(d.SL), ZN: w.m.zn});
      return `<div class="dont" data-kind="${d.kind}"><h2>✗ ${esc(fill(h, V, B.bear))}</h2><div class="chart${k ? '' : '" id="twc'}">${dontChart(B, d)}</div><p>${inline(fill(txt, V, B.bear))}</p><p class="sub">Result: ${d.res === 'loss' ? 'stopped out, −1R' : d.res}. ${MMAP[mid] ? `<a href="#mistake/${mid}">In the mistake library →</a>` : ''}</p></div>`; }).join('') +
    `<div class="callout">Do it instead like step 4: wait for the sweep and the shift, enter at the ${esc(w.m.zn)}, stop beyond the sweep. <a href="#trade/${id}/4">Back to the entry</a></div>`;
  view.innerHTML = `<div class="tw" id="tw" data-step="${step}"><div class="crumb row"><span>${esc(wVar(w))} · ${pos + 1} of ${list.length}</span>${bmBtn('w:' + id)}</div>
    <h1>${esc(wName(w))}</h1>
    <div class="stp" id="stp">${STEPS_SHORT.map((s, i) => `<a href="#trade/${id}/${i + 1}" class="${i + 1 === step ? 'on' : i + 1 < step ? 'past' : ''}${i === 5 ? ' bad' : ''}" data-s="${i + 1}">${s}</a>`).join('')}</div>
    <div class="row twh"><b id="twt">${STEPS[step - 1]}</b><label class="ann"><input type="checkbox" id="twann" ${S.twAnn !== false ? 'checked' : ''}> Marks</label></div>
    <div id="twbody">${charts}${body}</div>
    <div class="row stepnav"><button class="btn ghost" id="twprev" ${step === 1 ? 'disabled' : ''}>‹ Back</button><button class="btn" id="twnext">${step === 6 ? (list[pos + 1] ? 'Next example ›' : 'All trades') : step === 5 ? 'What not to do ›' : 'Next ›'}</button></div>
    <div class="label">Related</div><ul class="menu">${lesson ? `<li><a href="#lesson/${lesson.id}"><div><b>${esc(lesson.t)}</b><span>Lesson ${lesson.id.replace('-', '.')}</span></div><em>›</em></a></li>` : ''}</ul>
    <div class="chips" style="margin-top:8px">${w.m.terms.filter(k => G[k]).map(k => `<a class="chip" href="#term/${k}">${esc(G[k][1])}</a>`).join('')}</div>
    <div class="chips twv" style="margin-top:8px">${WT.filter(x => x.m === w.m).map(x => `<a class="chip${x.id === id ? ' on' : ''}" href="#trade/${x.id}/${step}">${esc(wVar(x))}</a>`).join('')}</div></div>${FOOT}`;
  const go = s => { location.hash = '#trade/' + id + '/' + s; };
  $('#twprev').onclick = () => step > 1 && go(step - 1);
  $('#twnext').onclick = () => step < 6 ? go(step + 1) : (location.hash = list[pos + 1] ? '#trade/' + list[pos + 1].id + '/1' : '#trades');
  $('#twann').onchange = e => { S.twAnn = e.target.checked; save(); ROUTES.trade(arg); };
  const el = $('#twbody'); let sx = null, sy = null;
  el.addEventListener('touchstart', e => { const p = e.touches[0]; sx = p.clientX; sy = p.clientY; }, {passive: true});
  el.addEventListener('touchend', e => { if (sx == null) return; const p = e.changedTouches[0], dx = p.clientX - sx, dy = p.clientY - sy; sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0 && step < 6) go(step + 1); else if (dx > 0 && step > 1) go(step - 1); } }, {passive: true});
};
document.addEventListener('keydown', e => {
  if (!TWS || !location.hash.startsWith('#trade/') || e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowRight' && TWS.step < 6) location.hash = `#trade/${TWS.id}/${TWS.step + 1}`;
  if (e.key === 'ArrowLeft' && TWS.step > 1) location.hash = `#trade/${TWS.id}/${TWS.step - 1}`;
});
window.__tw = () => TWS && {id: TWS.id, step: TWS.step, trade: TWS.B.trade, donts: TWS.B.donts.map(d => ({kind: d.kind, res: d.res})), boxes: document.querySelectorAll('#tw .tbox').length};

/* Mistake charts */
function mChart(x) {
  const sp = x.chart, ann = true;
  if (sp.curve) return curve(sp.curve, {fmt: v => (Math.round(v * 10) / 10) + 'R', legend: sp.legend, h: 170, xlab: 'trades →'});
  if (sp.wt) {
    const w = WMAP[sp.wt], B = w && wBuild(w); if (!B) return '';
    if (sp.dont) { const d = B.donts.find(q => q.kind === sp.dont); return dontChart(B, d); }
    const t = B.trade, c = B.ltf, o = {w: 360, h: 212, pt: 16, pb: 22, pr: 56, slots: c.length, extra: [t.SL, t.TP], marks: [timeMark(B.t0, c.length, 5), boxMark(t, t.fill, t.exit, {elab: 'Skipped'}), resMark(t, c)]};
    return chart(c, o).svg;
  }
  const r = TW.mchart(sp); if (r.err) return '';
  const A = r.A, mp = p => A != null ? A - p : p, c = r.c, trs = r.trades;
  const ex = trs.flatMap(t => [t.E, t.TP, t.SL != null ? t.SL : t.showSL]);
  const o = {w: 360, h: sp.t0 != null ? 212 : 200, pt: 16, pb: sp.t0 != null ? 22 : 12, pr: 56, slots: c.length, extra: ex, zones: [], lines: [], marks: []};
  if (sp.t0 != null) o.marks.push(timeMark(sp.t0, c.length, 5));
  if (sp.window && sp.t0 != null) { const a = (sp.window[0] - sp.t0) / 5, b = (sp.window[1] - sp.t0) / 5 - 1; if (b >= 0) o.marks.unshift(shadeT(Math.max(0, a), Math.min(c.length - 1, b), sp.window[2] + ' ' + hm(sp.window[0]) + '–' + hm(sp.window[1]))); }
  if (sp.shade) o.zones.push({i0: 0, top: Math.max(mp(sp.shade[0]), mp(sp.shade[1])), bot: Math.min(mp(sp.shade[0]), mp(sp.shade[1])), fill: 'rgba(0,0,0,.04)', label: sp.shade[2], la: 'start', lc: '#8a8a8a'});
  (sp.zones || []).forEach(z => o.zones.push({i0: 0, top: Math.max(mp(z.top), mp(z.bot)), bot: Math.min(mp(z.top), mp(z.bot)), label: z.label, la: 'start', fill: 'rgba(0,0,0,.09)', lc: '#555'}));
  (sp.fvgs || []).forEach(([k, l]) => { const f = r.fvg[k]; if (f) { const top = Math.max(mp(f.top), mp(f.bot)), bot = Math.min(mp(f.top), mp(f.bot)); o.zones.push({i0: f.i, top, bot, fill: 'rgba(0,0,0,.1)'}); o.marks.push((x, y, s2) => `<text x="${x(f.i) - s2 / 2 + 1}" y="${y(top) - 3}" font-size="7.5" fill="#555">${esc(l)}</text>`); } });
  (sp.lines || []).forEach(([p, l]) => o.lines.push({y: mp(p), dash: '3 2', label: l, la: 'start', c: '#555'}));
  (sp.labels || []).forEach(([wp, t]) => { const i = r.at[wp], k = c[i], top = Math.abs(k.h - r.P[wp]) < Math.abs(k.l - r.P[wp]); o.marks.push(txtMark(i, top ? k.h : k.l, esc(t), '#000', top ? 'above' : 'below')); });
  trs.forEach(t => { if (t.res === 'nofill') { o.marks.push((x, y, s2) => `<line x1="${x(t.from) - s2 / 2}" x2="${x(c.length - 1) + s2 / 2}" y1="${y(t.E)}" y2="${y(t.E)}" stroke="#000" stroke-dasharray="2 2"/><text x="${x(c.length - 1) + s2 / 2 + 3}" y="${y(t.E) + 3}" font-size="8" fill="#000" font-weight="600">Limit ${f2(t.E)}</text>`); o.marks.push(resMark(t, c)); return; }
    const end = t.res === 'open' ? c.length - 1 : Math.max(t.exit, t.fill + 2); o.marks.push(boxMark(t, t.fill, Math.min(c.length - 1, end), {tag: t.tag, norr: t.SL == null, nolab: t !== trs[trs.length - 1]})); o.marks.push(resMark(t, c)); });
  return chart(c, o).svg;
}
const mCatCount = k => MI.filter(x => x.cat === k).length;
ROUTES.mistakes = function () {
  setTop('Mistakes', back('#trades', 'Trades'), `<span>${MI.length}</span>`);
  const k = S.mf && TW.cats[S.mf] ? S.mf : 'all';
  view.innerHTML = `<h1>Mistake library</h1><p class="sub">${MI.length} common trading mistakes, each with a chart of the bad trade and what happened next.</p>
    <div class="seg twseg" style="margin-top:10px"><button onclick="location.hash='#trades'">Walkthroughs</button><button class="on">Mistake library</button></div>
    <input class="search" id="mq" type="search" placeholder="Filter mistakes" autocomplete="off" style="margin-top:12px">
    <div class="chips" id="mcf" style="margin-top:8px"><button data-k="all" class="${k === 'all' ? 'on' : ''}">All · ${MI.length}</button>${Object.entries(TW.cats).map(([c, n]) => `<button data-k="${c}" class="${k === c ? 'on' : ''}">${n} · ${mCatCount(c)}</button>`).join('')}</div>
    <div id="mlist"></div>${FOOT}`;
  const render = () => {
    const q = $('#mq').value.trim().toLowerCase(), toks = q.split(/\s+/).filter(Boolean);
    const L = MI.filter(x => (k === 'all' || x.cat === k) && toks.every(t => (x.t + ' ' + x.d + ' ' + x.why + ' ' + x.fix + ' ' + TW.cats[x.cat]).toLowerCase().includes(t)));
    let h = `<p class="sub" id="mcount" style="margin-top:10px">${L.length} mistake${L.length === 1 ? '' : 's'}</p>`;
    for (const [c, n] of Object.entries(TW.cats)) { const g = L.filter(x => x.cat === c); if (!g.length) continue;
      h += `<div class="label">${n}</div><ul class="menu mil">${g.map(x => `<li data-id="${x.id}"><a href="#mistake/${x.id}"><div><b>${esc(x.t)}</b><span>${esc(x.d)}</span></div></a>${bmBtn('m:' + x.id, true)}</li>`).join('')}</ul>`; }
    $('#mlist').innerHTML = h;
  };
  $('#mq').oninput = render;
  view.querySelectorAll('#mcf button').forEach(b => b.onclick = () => { S.mf = b.dataset.k; save(); const q = $('#mq').value; ROUTES.mistakes(); $('#mq').value = q; $('#mq').dispatchEvent(new Event('input')); });
  render();
};
ROUTES.mistake = function (id) {
  const x = MMAP[id]; if (!x) { location.replace('#mistakes'); return; }
  const pos = MI.indexOf(x), nxt = MI[(pos + 1) % MI.length], prv = MI[(pos - 1 + MI.length) % MI.length];
  setTop('Mistake', back('#mistakes', 'Mistakes'), `<span>${pos + 1}/${MI.length}</span>`);
  const d = x.chart.wt && x.chart.dont && DONT_TXT[x.chart.dont], w = x.chart.wt && WMAP[x.chart.wt];
  const ls = x.lessons.map(l => LMAP[l]).filter(Boolean);
  view.innerHTML = `<div class="lesson mi"><div class="crumb row"><span>${esc(TW.cats[x.cat])}</span>${bmBtn('m:' + x.id)}</div>
    <h1>${esc(x.t)}</h1><p class="lead">${esc(x.d)}</p>
    <div class="chart" id="mc">${mChart(x)}</div>
    <p class="cap">${x.chart.curve ? 'Equity curve in R (multiples of risk).' : w ? `From the ${esc(wName(w))} walkthrough (${esc(wVar(w))}). <a href="#trade/${w.id}/${x.chart.good ? 4 : 6}">Open it →</a>` : 'Red box: risk. Green box: reward. Built example, not real data.'}</p>
    <h2>What happened</h2><p>${esc(x.what)}</p>
    <h2>Why it happens</h2><p>${esc(x.why)}</p>
    <h2>The fix</h2><div class="callout">${esc(x.fix)}</div>
    <div class="label">Related</div><ul class="menu">${ls.map(l => `<li><a href="#lesson/${l.id}"><div><b>${esc(l.t)}</b><span>Lesson ${l.id.replace('-', '.')}${unlocked(LEVELS.find(L => L.n === l.level)) ? '' : ' · 🔒'}</span></div><em>›</em></a></li>`).join('')}
    ${x.drill && DMAP[x.drill] ? `<li><a href="#drill/${x.drill}"><div><b>Drill: ${esc(DMAP[x.drill].t)}</b><span>${DK[DMAP[x.drill].k][0]} · ${DIFF[DMAP[x.drill].lv]}</span></div><em>›</em></a></li>` : ''}</ul>
    <div class="chips" style="margin-top:8px">${x.terms.filter(k => G[k]).map(k => `<a class="chip" href="#term/${k}">${esc(G[k][1])}</a>`).join('')}</div>
    <div class="row stepnav"><a class="btn ghost" href="#mistake/${prv.id}">‹ Previous</a><a class="btn" href="#mistake/${nxt.id}" id="mnext">Next mistake ›</a></div></div>${FOOT}`;
};

/* ---------------- Boot ---------------- */
if (/^https?:/.test(location.protocol)) {
  const l = document.createElement('link'); l.rel = 'manifest'; l.href = 'manifest.webmanifest'; document.head.appendChild(l);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
route();
maybeAck();
