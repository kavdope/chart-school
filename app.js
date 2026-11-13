/* Chart School: app engine. Plain JS, no dependencies, works offline. Content lives in content/*.js */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const LEVELS = CS.levels.sort((a, b) => a.n - b.n);
LEVELS.forEach(L => L.lessons.forEach((l, i) => { l.level = L.n; l.idx = i; }));
const LESSONS = LEVELS.flatMap(L => L.lessons);
const LMAP = Object.fromEntries(LESSONS.map(l => [l.id, l]));
const GLOSSARY = CS.glossary;
const G = Object.fromEntries(GLOSSARY.map(g => [g[0], g]));
const FOOT = '<p class="foot">Educational only, not financial advice. Not affiliated with ICT.</p>';

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
  s = Object.assign({q: {}, days: [], spot: {}, take: {right: 0, total: 0}, fc: {}, fcNew: {}, start: 0, placed: false, unlockAll: false, plan: {}, calc: {}}, s || {});
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
  const sp = (W - pl - pr) / c.length, cw = Math.max(2, sp * (o.bw || 0.62));
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
function setTop(title, left = '', right = '') { $('#tt').textContent = title; $('#tl').innerHTML = left; $('#tr').innerHTML = right; }
const back = (href, t) => `<button onclick="location.hash='${href}'">‹ ${t}</button>`;
let timer = null;
const ROUTES = {};
function route() {
  clearInterval(timer); timer = null; closePop();
  const [h, arg] = (location.hash || '#home').slice(1).split('/');
  if (!S.placed && h !== 'placement') { location.replace('#placement'); return; }
  const tabOf = {lesson: 'home', quiz: 'home', level: 'home', placement: 'home', spot: 'practice', take: 'practice', flash: 'practice', calc: 'tools', plan: 'tools', settings: 'tools'};
  const tab = tabOf[h] || h;
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  (ROUTES[h] || ROUTES.home)(arg && decodeURIComponent(arg));
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
  <div class="stats"><div><b>${done}<small style="font-size:11px;color:#8a8a8a;font-weight:400">/${total}</small></b><span>Lessons</span></div><div><b>${streak()} day${streak() === 1 ? '' : 's'}</b><span>Streak</span></div><div><b>${avg}</b><span>Quiz avg</span></div></div>
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
  h += `</ul><p class="sub" style="margin-top:10px">Starting point: ${START_NAMES[S.start] || 'Level ' + S.start}${S.unlockAll ? ' · Unlock all is on' : ''}. <a href="#settings" style="color:#000">Settings</a></p>${FOOT}`;
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
  <div class="crumb">Level ${L.n} · ${L.name} · Lesson ${l.idx + 1} of ${L.lessons.length} · ${l.m || 6} min</div>
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
  setTop('Welcome', S.placed ? back('#settings', 'Settings') : '', '');
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
  view.querySelectorAll('#checks input').forEach(i => { const k = i.dataset.k, ok = i.checked === f[k]; if (ok) tickOK++; i.disabled = true; view.querySelector(`[data-m="${k}"]`).innerHTML = f[k] ? '<b>present</b>' : '<span style="color:#c0392b">missing</span>'; });
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
      <p class="sub">Max risk ${money(r.risk)} · actual risk at this size <b style="color:#000">${money(r.actual)}</b> · stop distance ${+r.dist.toFixed(6)}</p>
      ${r.extra ? `<p class="sub">${r.extra}</p>` : ''}${r.size === 0 ? '<p class="sub" style="color:#c0392b">Stop is too wide for this risk. Use a smaller contract (micros), a tighter valid stop, or skip the trade.</p>' : ''}
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
    <li><a href="#settings"><div><b>Settings</b><span>Unlock all, placement, reset</span></div><em>›</em></a></li></ul>${FOOT}`;
};
ROUTES.settings = function () {
  setTop('Settings', back('#tools', 'Tools'));
  view.innerHTML = `<h1>Settings</h1>
    <ul class="menu" style="margin-top:10px"><li><label class="tog"><div><b>Unlock all levels</b><span>For experienced traders who want to jump around</span></div><input type="checkbox" id="unlockall" ${S.unlockAll ? 'checked' : ''}></label></li>
    <li><a href="#placement"><div><b>Starting level</b><span>Currently ${START_NAMES[S.start] || 'Level ' + S.start} · retake placement</span></div><em>›</em></a></li>
    <li><a href="#" id="reset"><div><b>Reset all progress</b><span>Quizzes, drills, flashcards, streak</span></div><em>›</em></a></li></ul>
    <p class="sub" style="margin-top:12px">Progress is stored only in this browser on this device.</p>${FOOT}`;
  $('#unlockall').onchange = e => { S.unlockAll = e.target.checked; save(); };
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
    h += `<hr style="margin:8px 0"><div class="sub">Next: <b style="color:#000">${st.upcoming.name}</b> in <span class="cd">${dur(st.upcoming.next - now)}</span></div>
      ${wkend ? '<div class="sub" style="margin-top:4px">It\'s the weekend in New York: most markets are closed until Sunday evening.</div>' : ''}</div>
      <div class="label">24h · New York time</div><div class="timeline">${timelineSVG(st)}</div>
      <ul class="sess">${st.list.slice().sort((a, b) => a.s - b.s).map(s => `<li class="${s.active ? 'act' : ''}"><span class="sw" style="background:${s.col}"></span>${s.name}${s.active ? '<span class="pill">NOW</span>' : ''}
        <span class="tt">${fmtT(s.start, NY)}–${fmtT(s.end, NY)} NY${sameTz ? '' : `<br>${fmtT(s.start, LOCAL)}–${fmtT(s.end, LOCAL)} yours`}</span></li>`).join('')}</ul>
      <p class="sub" style="margin-top:8px">Times follow New York daylight saving automatically. Killzones are tendencies, not rules.</p>`;
    $('#ck').innerHTML = h;
  };
  tick(); timer = setInterval(tick, 1000);
};

/* ---------------- Glossary ---------------- */
ROUTES.glossary = function () {
  setTop('Glossary', '', `<span>${GLOSSARY.length} terms</span>`);
  view.innerHTML = `<input class="search" id="gq" type="search" placeholder="Search ${GLOSSARY.length} terms" autocomplete="off"><ul class="gl" id="gl"></ul>${FOOT}`;
  const list = GLOSSARY.slice().sort((a, b) => a[1].localeCompare(b[1]));
  const render = q => {
    q = q.trim().toLowerCase();
    const f = list.filter(g => !q || (g[1] + ' ' + g[2] + ' ' + g[3]).toLowerCase().includes(q));
    $('#gl').innerHTML = f.length ? f.map(g => `<li id="g-${g[0]}"><b>${esc(g[1])}</b>${g[2] ? `<span class="ab">${esc(g[2])}</span>` : ''}<p>${esc(g[3])}</p></li>`).join('') : '<li class="sub">No matching terms.</li>';
  };
  $('#gq').oninput = e => render(e.target.value); render('');
};

/* ---------------- Boot ---------------- */
if (/^https?:/.test(location.protocol)) {
  const l = document.createElement('link'); l.rel = 'manifest'; l.href = 'manifest.webmanifest'; document.head.appendChild(l);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
route();
