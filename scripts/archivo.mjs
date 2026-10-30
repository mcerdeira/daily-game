// Builds the archive of past puzzles: one static page per finished day in archivo/,
// an index at archivo/index.html and the sitemap. Runs every day from .github/workflows/archivo.yml.
//
// The generator and the piece drawings are taken straight from index.html, so the archive
// always shows exactly the board everyone played. No dependencies: `node scripts/archivo.mjs`.
// Options: --hasta YYYY-MM-DD (last date to publish; default: the last day already over everywhere).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'archivo');
const NOTES = join(OUT, '_notas'); // optional hand-written comments, archivo/_notas/YYYY-MM-DD.txt
const FIRST = '2026-09-30';

// ---- pull the game code out of index.html ----
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const between = (a, b) => {
  const i = html.indexOf(a), j = html.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error(`index.html changed: could not find "${a}" ... "${b}"`);
  return html.slice(i, j);
};
const core = between('const SITE_URL', '\n(function () {');
const pieces = between('const ctr = c =>', 'function render()');
const G = new Function(`
  ${core}
  const team = null, MATE_KIT = ['plain', 'var(--mate)'], RIVAL_KIT = ['plain', 'var(--rival)'];
  const rivalKit = () => RIVAL_KIT;
  ${pieces}
  return { SITE_URL, N, CELLS, ORTHO, generate, findPerfect, mouth, goalWalls, dayNumber,
           ctr, fig, cone, mate, ball, goalIcon, spot };
`)();
const { N, CELLS, ORTHO } = G;

// ---- dates ----
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const parse = k => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const key = dt => dt.toISOString().slice(0, 10);
const addDays = (k, n) => { const dt = parse(k); dt.setUTCDate(dt.getUTCDate() + n); return key(dt); };
const longDate = k => { const dt = parse(k); return `${dt.getUTCDate()} de ${MONTHS[dt.getUTCMonth()]} de ${dt.getUTCFullYear()}`; };

// A day is published once it is over in every time zone (UTC-12 is the last one).
function lastFinished() {
  const i = process.argv.indexOf('--hasta');
  if (i > 0) return process.argv[i + 1];
  return addDays(key(new Date(Date.now() - 12 * 3600e3)), -1);
}

// ---- words ----
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NUM = ['cero', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez'];
const ORD = ['primer', 'segundo', 'tercer', 'cuarto', 'quinto'];
const cap = s => s[0].toUpperCase() + s.slice(1);
const count = (n, one, many) => `${n <= 10 ? NUM[n] : n} ${n === 1 ? one : many}`;
const rc = c => [Math.floor(c / N), c % N];

// Where a cell is, in plain words (rows top to bottom, columns left to right, from 1).
function where(c) {
  const [r, k] = rc(c);
  const top = r === 0, bot = r === N - 1, left = k === 0, right = k === N - 1;
  if ((top || bot) && (left || right)) return `la esquina de ${top ? 'arriba' : 'abajo'} a la ${left ? 'izquierda' : 'derecha'}`;
  if (c === (CELLS - 1) / 2) return 'el centro';
  if (top || bot) return `el borde de ${top ? 'arriba' : 'abajo'}, en la columna ${k + 1}`;
  if (left || right) return `el borde ${left ? 'izquierdo' : 'derecho'}, en la fila ${r + 1}`;
  return `la fila ${r + 1}, columna ${k + 1}`;
}
const de = s => (s.startsWith('el ') ? 'del ' + s.slice(3) : 'de ' + s);
const list = xs => xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1];
const DIR = { [-N]: ['arriba', 'hacia arriba'], [N]: ['abajo', 'hacia abajo'], [-1]: ['izquierda', 'a la izquierda'], [1]: ['derecha', 'a la derecha'] };

// Same seed for the same date, so the wording never changes between runs.
function pick(dateKey, salt, list) {
  let h = 0; for (const ch of dateKey + salt) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

// ---- solving helpers (only for the text; the game code is untouched) ----
function bfs(from, walls) {
  const d = new Array(CELLS).fill(-1); d[from] = 0;
  const q = [from];
  for (let h = 0; h < q.length; h++) for (const n of ORTHO[q[h]]) if (!walls[n] && d[n] < 0) { d[n] = d[q[h]] + 1; q.push(n); }
  return d;
}

// Shortest walk S -> every station -> mouth when cells may be reused, with the route itself.
function shortcut(P) {
  const M = G.mouth(P.E), walls = G.goalWalls(P.blocked, P.E);
  const full = (1 << P.stations.length) - 1, W = full + 1;
  const bit = new Array(CELLS).fill(0); P.stations.forEach((s, i) => (bit[s] = 1 << i));
  const prev = new Map(), start = P.S * W + bit[P.S];
  prev.set(start, -1);
  const q = [start];
  for (let h = 0; h < q.length; h++) {
    const cur = q[h], c = Math.floor(cur / W), m = cur % W;
    if (c === M && m === full) {
      const route = []; for (let s = cur; s >= 0; s = prev.get(s)) route.push(Math.floor(s / W));
      return route.reverse().concat(P.E);
    }
    for (const n of ORTHO[c]) {
      if (walls[n]) continue;
      const ns = n * W + (m | bit[n]);
      if (!prev.has(ns)) { prev.set(ns, cur); q.push(ns); }
    }
  }
  return null;
}

function visits(path) { const v = new Array(CELLS).fill(0); path.forEach(c => v[c]++); return v; }

// ---- drawing (mirrors render() in index.html, without the HUD) ----
function board(P, path, { label, gold = false } = {}) {
  const v = visits(path), hd = path[path.length - 1];
  let s = '';
  for (let c = 0; c < CELLS; c++) {
    const x = (c % N) * 100, y = Math.floor(c / N) * 100;
    s += `<rect x="${x}" y="${y}" width="100" height="100" fill="${(c % N) % 2 ? 'var(--pitch2)' : 'var(--pitch1)'}" stroke="var(--lines)" stroke-width="2"/>`;
  }
  { const [cx, cy] = G.ctr(P.S); s += G.spot(cx, cy); }
  s += G.goalIcon((P.E % N) * 100, Math.floor(P.E / N) * 100);
  for (let c = 0; c < CELLS; c++) if (P.blocked[c]) {
    const x = (c % N) * 100, y = Math.floor(c / N) * 100;
    s += ((c + P.S + P.E) % 2) ? G.cone(x, y) : G.fig(x, y, ['plain', 'var(--rival)']);
  }
  if (path.length > 1) {
    const pts = path.map(c => G.ctr(c).join(',')).join(' ');
    s += `<polyline points="${pts}" fill="none" stroke="rgba(0,0,0,.3)" stroke-width="15" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="0 22" transform="translate(0,2.5)"/>`;
    s += `<polyline points="${pts}" fill="none" stroke="${gold ? '#ffd54a' : '#fff'}" stroke-width="11" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="0 22"/>`;
  }
  P.stations.forEach(c => s += G.mate((c % N) * 100, Math.floor(c / N) * 100, v[c] > 0));
  v.forEach((n, c) => {
    if (n > 1) { const [cx, cy] = G.ctr(c);
      s += `<circle cx="${cx}" cy="${cy}" r="20" fill="var(--bad)" stroke="#fff" stroke-width="4"/><path d="M${cx-8},${cy-8} L${cx+8},${cy+8} M${cx+8},${cy-8} L${cx-8},${cy+8}" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`; }
  });
  if (hd === P.E) { const [cx, cy] = G.ctr(P.E); s += G.ball(cx, cy + 6, 15); }
  else { const [cx, cy] = G.ctr(hd); s += G.ball(cx, cy, 21); }
  return `<svg class="board" viewBox="0 0 500 500" role="img" aria-label="${esc(label)}">${s}</svg>`;
}

// ---- one day ----
function analyse(dateKey) {
  const dt = parse(dateKey);
  const num = G.dayNumber(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
  const P = G.generate(dateKey, dt.getUTCDay(), num);
  const M = G.mouth(P.E), walls = G.goalWalls(P.blocked, P.E);
  const sol = G.findPerfect(P.S, M, P.stations, walls).concat(P.E);
  const short = shortcut(P);
  return { dateKey, num, P, sol, short };
}

// Step list: runs in one direction, cut wherever the ball reaches a teammate.
function steps(P, sol) {
  const isSt = new Set(P.stations), out = [];
  let got = 0, i = 0;
  const body = sol.slice(0, -1); // the last move is the shot
  while (i < body.length - 1) {
    const d = body[i + 1] - body[i];
    let j = i + 1;
    while (!isSt.has(body[j]) && j + 1 < body.length && body[j + 1] - body[j] === d) j++;
    const n = j - i, [dir, toward] = DIR[d];
    let t = `${cap(count(n, 'casilla', 'casillas'))} ${toward}`;
    if (isSt.has(body[j])) t += `, hasta el ${ORD[got++]} compañero (${where(body[j])})`;
    else if (j === body.length - 1) t += ', hasta la casilla de arriba del arco';
    out.push(t + '.');
    i = j;
  }
  out.push('Pelota al arco: se patea hacia abajo, de frente.');
  return out;
}

// First teammate where "go to the nearest one still pending" disagrees with the perfect order.
function nearestTrap(P, sol) {
  const walls = G.goalWalls(P.blocked, P.E);
  const order = sol.filter(c => P.stations.includes(c));
  let from = P.S, pending = P.stations.slice();
  for (let k = 0; k < order.length; k++) {
    const d = bfs(from, walls);
    const best = pending.reduce((a, b) => (d[b] < d[a] ? b : a));
    if (d[best] < d[order[k]]) return { k, from, near: best, right: order[k], dNear: d[best], dRight: d[order[k]] };
    pending = pending.filter(s => s !== order[k]);
    from = order[k];
  }
  return null;
}

function page(day, prevKey, nextKey) {
  const { dateKey, num, P, sol, short } = day;
  const dt = parse(dateKey), date = longDate(dateKey), wd = WEEKDAYS[dt.getUTCDay()];
  const nBlocked = P.blocked.filter(Boolean).length;
  const free = CELLS - nBlocked - 1; // the goal is not a cell you walk on
  const solCells = sol.length - 1, unused = free - solCells;
  const shortV = visits(short);
  const repeated = shortV.map((n, c) => (n > 1 ? c : -1)).filter(c => c >= 0);
  const crossings = shortV.reduce((a, n) => a + Math.max(0, n - 1), 0);
  const shortScore = Math.max(0, 100 - 10 * crossings);
  const trap = nearestTrap(P, sol);
  const notesFile = join(NOTES, dateKey + '.txt');
  const notes = existsSync(notesFile) ? readFileSync(notesFile, 'utf8').trim().split(/\n\s*\n/).filter(Boolean) : [];

  const mates = P.stations.map(where);
  const intro = pick(dateKey, 'intro', [
    `El ${wd} ${date} salió el puzzle Nº ${num} de Gol. Acá está el tablero de ese día, el camino corto que tentaba y una jugada perfecta explicada paso a paso.`,
    `Este es el puzzle Nº ${num} de Gol, el del ${wd} ${date}. Si te quedaste con las ganas de verlo resuelto, acá va la solución, con la trampa que tenía el tablero.`,
    `Gol Nº ${num}, del ${wd} ${date}: el tablero completo, por qué el camino más corto no servía y cómo se llegaba al arco con 100 puntos.`,
  ]);

  let trapText;
  if (trap) {
    const who = trap.k === 0 ? 'Desde la salida' : `Después del ${ORD[trap.k - 1]} compañero`;
    trapText = `${who}, lo natural es ir al compañero más cercano, el ${de(where(trap.near))}, a ${count(trap.dNear, 'paso', 'pasos')}. Ese es el error: la jugada perfecta va antes al ${de(where(trap.right))}, que está a ${count(trap.dRight, 'paso', 'pasos')}, y deja el otro para más tarde.`;
  } else {
    trapText = `Esta vez, ir siempre al compañero más cercano da el orden correcto. La dificultad está en el recorrido entre uno y otro: hay que elegir por dónde pasar para no quedar encerrado contra un borde o contra los bloqueos.`;
  }

  const S = [];
  S.push(`<p>${intro}</p>`);
  S.push(`<figure>${board(P, [P.S], { label: `Tablero del puzzle Nº ${num}, antes de empezar.` })}
    <figcaption>El tablero del Nº ${num}. La pelota sale ${de(where(P.S))}, y el arco está en ${where(P.E)}, con la boca hacia arriba. Hay ${count(P.stations.length, 'compañero', 'compañeros')}: en ${mates.slice(0, -1).join('; en ')}; y en ${mates[mates.length - 1]}. ${cap(count(nBlocked, 'casilla está bloqueada', 'casillas están bloqueadas'))} por conos o rivales.</figcaption>
  </figure>`);
  S.push(`<p class="small muted">Las filas se cuentan de arriba hacia abajo y las columnas de izquierda a derecha, del 1 al ${N}.</p>`);

  S.push(`<h2>La trampa</h2>`);
  S.push(`<p>Si se pudiera repetir casillas, a la casilla de arriba del arco se llegaría en ${count(short.length - 2, 'paso', 'pasos')}, pasando por todos los compañeros. Pero ese camino pisa dos veces ${list(repeated.map(where))}, y cada cruce resta 10: con ese atajo se termina con ${shortScore} puntos. La jugada perfecta necesita ${count(sol.length - 2, 'paso', 'pasos')}.</p>`);
  S.push(`<figure>${board(P, short, { label: `El camino corto del Nº ${num}, con ${count(crossings, 'cruce', 'cruces')}.` })}
    <figcaption>El camino más corto, con ${count(crossings, 'cruce', 'cruces')} (${crossings === 1 ? 'la cruz roja' : 'las cruces rojas'}).</figcaption>
  </figure>`);
  S.push(`<p>${trapText}</p>`);

  S.push(`<h2>Una jugada perfecta</h2>`);
  S.push(`<ol>${steps(P, sol).map(t => `<li>${t}</li>`).join('')}</ol>`);
  S.push(`<figure>${board(P, sol, { label: `Una jugada perfecta del Nº ${num}.`, gold: true })}
    <figcaption>El recorrido completo, sin cruces: 100 puntos.</figcaption>
  </figure>`);

  S.push(`<h2>En números</h2>`);
  S.push(`<ul>
    <li>${cap(count(sol.length - 2, 'paso', 'pasos'))} hasta la casilla de arriba del arco, más el remate.</li>
    <li>La jugada perfecta pisa ${solCells} de las ${free} casillas libres${unused > 0 ? ` y deja ${count(unused, 'sin usar', 'sin usar')}` : ': no sobra ninguna'}.</li>
    <li>El camino corto ahorra ${count(sol.length - short.length, 'paso', 'pasos')}, pero cuesta ${100 - shortScore} puntos.</li>
  </ul>`);

  if (notes.length) S.push(`<h2>Comentario</h2>` + notes.map(p => `<p>${esc(p.replace(/\s+/g, ' '))}</p>`).join(''));

  S.push(`<nav class="days small">
    ${prevKey ? `<a href="${prevKey}.html">← Nº ${num - 1}</a>` : '<span></span>'}
    <a href="./">Todos</a>
    ${nextKey ? `<a href="${nextKey}.html">Nº ${num + 1} →</a>` : '<span></span>'}
  </nav>`);
  S.push(`<p><a href="../">Jugar el puzzle de hoy</a></p>`);

  return shell({
    title: `Gol Nº ${num}, solución del ${date}`,
    h1: `Gol Nº ${num}: solución del ${date}`,
    description: `Solución del puzzle Nº ${num} de Gol (${date}): el tablero, la trampa del camino corto y una jugada perfecta paso a paso.`,
    path: `archivo/${dateKey}.html`,
    body: S.join('\n  '),
  });
}

function indexPage(days) {
  const items = days.slice().reverse().map(d =>
    `<li><a href="${d.dateKey}.html">Nº ${d.num}</a> <span class="muted">· ${WEEKDAYS[parse(d.dateKey).getUTCDay()]} ${longDate(d.dateKey)}</span></li>`).join('\n    ');
  return shell({
    title: 'Archivo de soluciones · Gol',
    h1: 'Archivo de soluciones',
    description: 'Todos los puzzles anteriores de Gol, el puzzle diario de fútbol, con el tablero, la trampa de cada día y una jugada perfecta paso a paso.',
    path: 'archivo/',
    body: `<p>Cada día hay un puzzle nuevo de Gol y es el mismo para todos. Cuando el día termina, su solución aparece acá: el tablero, el camino corto que tentaba y una jugada perfecta paso a paso.</p>
  <p>El puzzle de hoy no está en el archivo: se agrega cuando termina el día, para no arruinárselo a nadie.</p>
  <ul class="list">
    ${items}
  </ul>
  <p><a href="../">Jugar el puzzle de hoy</a></p>`,
  });
}

// Page frame: same tokens, theme script and footer as the other static pages.
const strategy = readFileSync(join(ROOT, 'estrategia.html'), 'utf8');
const tokens = strategy.slice(strategy.indexOf(':root{'), strategy.indexOf('*,*::before'));
const themeScript = strategy.slice(strategy.indexOf('<script>'), strategy.indexOf('</script>') + 9);
const adsense = (strategy.match(/<script async src="https:\/\/pagead2[^>]*><\/script>/) || [''])[0];

function shell({ title, h1, description, path, body }) {
  const url = `${G.SITE_URL}/${path}`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<!-- Generated by scripts/archivo.mjs: do not edit by hand. -->
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${G.SITE_URL}/og.png">
<meta name="theme-color" id="themeColor" content="#151515">
${themeScript}
<style>
${tokens}*,*::before,*::after{box-sizing:inherit}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;justify-content:center;min-height:100vh}
main{width:min(100%,440px);padding:16px 16px 48px;display:flex;flex-direction:column;gap:16px}
p,ul,ol{margin:0}
ul,ol{padding-left:20px;display:flex;flex-direction:column;gap:8px}
ul.list{gap:4px}
h1,h2{font-weight:800;line-height:1.2;letter-spacing:-.02em;margin:0}
h1{font-size:22px}
h2{font-size:16px;margin-top:8px}
a{color:inherit}
.small{font-size:14px}
.muted{color:var(--muted)}
footer{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:16px}
nav.days{display:flex;justify-content:space-between;gap:16px;margin-top:8px}
figure{margin:0;display:flex;flex-direction:column;gap:8px}
figcaption{font-size:14px;color:var(--muted)}
svg.board{display:block;width:100%;height:auto;border-radius:var(--r);background:var(--pitch1)}
.defs{position:absolute;width:0;height:0}
</style>
${adsense}
</head>
<body>
<svg class="defs" aria-hidden="true"><defs><clipPath id="jersey"><path d="M24,82 C24,58 36,52 50,52 C64,52 76,58 76,82 Z"/></clipPath></defs></svg>
<main>
  <p class="small"><a href="../">← Volver al juego</a></p>
  <h1>${esc(h1)}</h1>
  ${body}
  <footer class="small muted">
    <a href="../como-se-juega.html">Cómo se juega</a>
    <a href="../estrategia.html">Estrategia</a>
    <a href="./">Archivo</a>
    <a href="../acerca.html">Acerca de</a>
    <a href="../privacidad.html">Privacidad</a>
  </footer>
</main>
</body>
</html>
`;
}

// ---- write everything ----
const last = lastFinished();
const days = [];
for (let k = FIRST; k <= last; k = addDays(k, 1)) days.push(analyse(k));
mkdirSync(OUT, { recursive: true });
days.forEach((d, i) => writeFileSync(join(OUT, d.dateKey + '.html'),
  page(d, days[i - 1]?.dateKey, days[i + 1]?.dateKey)));
writeFileSync(join(OUT, 'index.html'), indexPage(days));

const STATIC = ['', 'como-se-juega.html', 'estrategia.html', 'acerca.html', 'privacidad.html', 'archivo/'];
const urls = STATIC.concat(days.slice().reverse().map(d => `archivo/${d.dateKey}.html`));
writeFileSync(join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${G.SITE_URL}/${u}</loc></url>`).join('\n')}
</urlset>
`);
console.log(`archivo: ${days.length} días, del ${FIRST} al ${last}`);
