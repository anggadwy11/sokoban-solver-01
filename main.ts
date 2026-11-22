// Push-optimal Sokoban solver (make.fun sokoban-solver-01). Search over pushes
// (state = box squares + player's reachable region), BFS = push-optimal. Prunes:
// dead squares (reverse pull from goals) and frozen 2x2 blocks. Levels split
// into rooms by cutting the hallway's dead squares from the player's row; each
// room is solved alone (other rooms' boxes as walls) and the optima add up.
// Deterministic: fixed direction order, state budgets, no clock, stdlib only.
import { mkdirSync as M, readdirSync as R, readFileSync as F, writeFileSync as W } from 'node:fs';
import { join as J } from 'node:path';
const I = process.env.MAKEFUN_INPUT_DIR ?? '/input', O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const D = [[0, -1, 'u', 'U'], [0, 1, 'd', 'D'], [-1, 0, 'l', 'L'], [1, 0, 'r', 'R']];
function parse(t) {
  const rows = t.split('\n').filter(r => r.length), h = rows.length, w = Math.max(...rows.map(r => r.length));
  const wall = new Uint8Array(w * h).fill(1), g = [], b = []; let p = -1;
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const c = row[x], i = y * w + x; if (c === '#') continue; wall[i] = 0; if ('.*+'.includes(c)) g.push(i); if ('$*'.includes(c)) b.push(i); if ('@+'.includes(c)) p = i; } });
  for (let x = 0; x < w; x++) { wall[x] = 1; wall[(h - 1) * w + x] = 1; } for (let y = 0; y < h; y++) { wall[y * w] = 1; wall[y * w + w - 1] = 1; }
  b.sort((a, c) => a - c); g.sort((a, c) => a - c); return { w, wall, g, b, p };
}
function live(w, wall, goals) {
  const L = new Uint8Array(wall.length), q = [];
  for (const g of goals) { L[g] = 1; q.push(g); }
  for (let i = 0; i < q.length; i++) { const x = q[i]; for (const [dx, dy] of D) { const d = dy * w + dx, y = x - d; if (y >= 0 && y < wall.length && !wall[y] && !wall[y - d] && !L[y]) { L[y] = 1; q.push(y); } } }
  return L;
}
function flood(w, wall, blk, from, seen, stamp, st) {
  let low = from, n = 0; st[n++] = from; seen[from] = stamp;
  while (n) { const p = st[--n]; if (p < low) low = p; for (const q of [p - w, p + w, p - 1, p + 1]) if (q >= 0 && q < wall.length && !wall[q] && !blk[q] && seen[q] !== stamp) { seen[q] = stamp; st[n++] = q; } }
  return low;
}
function frozen(w, wall, blk, goal, t) {
  const s = i => wall[i] || blk[i], off = i => blk[i] && !goal[i];
  for (const a of [t, t - 1, t - w, t - w - 1]) { const b = a + 1, c = a + w, d = c + 1; if (d < wall.length && s(a) && s(b) && s(c) && s(d) && (off(a) || off(b) || off(c) || off(d))) return true; }
  return false;
}
function walk(w, wall, blk, from, to) {
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1), let2 = new Array(wall.length), q = [from]; prev[from] = from;
  for (let i = 0; i < q.length; i++) { const p = q[i]; if (p === to) break; for (const [dx, dy, c] of D) { const n = p + dy * w + dx; if (n < 0 || n >= wall.length || wall[n] || blk[n] || prev[n] !== -1) continue; prev[n] = p; let2[n] = c; q.push(n); } }
  let s = ''; for (let p = to; p !== from; p = prev[p]) s = let2[p] + s; return s;
}
function bfs(w, wall, goals, boxes0, player0, budget) {
  const size = wall.length, goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const lv = live(w, wall, goals);
  if (boxes0.some(b => !lv[b])) return null;
  const blk = new Uint8Array(size), seen = new Int32Array(size), mark = new Int32Array(size), st = new Int32Array(size);
  let stamp = 0;
  const key = (bs, low) => { let k = low; for (const b of bs) k = k * size + b; return k; };
  const done = bs => bs.every(b => goal[b]);
  const SB = [boxes0.slice()], SP = [player0], PA = [-1], PB = [-1], PD = [-1], vis = new Map();
  for (const b of boxes0) blk[b] = 1;
  vis.set(key(boxes0, flood(w, wall, blk, player0, seen, ++stamp, st)), 0);
  for (const b of boxes0) blk[b] = 0;
  let found = done(boxes0) ? 0 : -1;
  for (let head = 0; head < SB.length && found < 0; head++) {
    const bs = SB[head];
    for (const b of bs) blk[b] = 1;
    flood(w, wall, blk, SP[head], seen, ++stamp, st);
    const reg = stamp;
    for (let bi = 0; bi < bs.length && found < 0; bi++) {
      const b = bs[bi];
      for (let di = 0; di < 4; di++) {
        const d = D[di][1] * w + D[di][0], t = b + d;
        if (seen[b - d] !== reg || wall[t] || blk[t] || !lv[t]) continue;
        blk[b] = 0; blk[t] = 1;
        const fz = frozen(w, wall, blk, goal, t);
        let k = -1, nb = null;
        if (!fz) { nb = bs.slice(); nb[bi] = t; nb.sort((a, c) => a - c); k = key(nb, flood(w, wall, blk, b, mark, ++stamp, st)); }
        blk[t] = 0; blk[b] = 1;
        if (fz || !nb || vis.has(k)) continue;
        if (SB.length >= budget) { for (const x of bs) blk[x] = 0; return null; }
        vis.set(k, SB.length); SB.push(nb); SP.push(b); PA.push(head); PB.push(b); PD.push(di);
        if (done(nb)) found = SB.length - 1;
      }
    }
    for (const b of bs) blk[b] = 0;
  }
  if (found < 0) return null;
  const chain = []; for (let s = found; s > 0; s = PA[s]) chain.push(s); chain.reverse();
  let moves = '', player = player0, bs = boxes0;
  for (const s of chain) {
    const from = PB[s], di = PD[s], d = D[di][1] * w + D[di][0];
    for (const b of bs) blk[b] = 1;
    moves += walk(w, wall, blk, player, from - d);
    for (const b of bs) blk[b] = 0;
    moves += D[di][3]; player = from; bs = SB[s];
  }
  return { n: chain.length, moves };
}
function rooms(L) {
  const { w, wall, g, b, p } = L, lv = live(w, wall, g), rs = Math.floor(p / w) * w, cut = new Uint8Array(wall.length);
  for (let i = rs; i < rs + w; i++) if (!wall[i] && !lv[i]) cut[i] = 1;
  if (b.some(x => cut[x])) return null;
  const part = new Int32Array(wall.length).fill(-1), out = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const sq = [s]; part[s] = out.length;
    for (let i = 0; i < sq.length; i++) for (const [dx, dy] of D) { const q = sq[i] + dy * w + dx; if (q >= 0 && q < wall.length && !wall[q] && !cut[q] && part[q] < 0) { part[q] = out.length; sq.push(q); } }
    out.push({ sq, b: [], g: [], done: false });
  }
  for (const x of b) out[part[x]].b.push(x);
  for (const x of g) { if (part[x] < 0) return null; out[part[x]].g.push(x); }
  if (out.some(r => r.b.length !== r.g.length)) return null;
  return out.filter(r => r.b.length);
}
function solve(L) {
  const rm = rooms(L);
  if (!rm) { const s = bfs(L.w, L.wall, L.g, L.b, L.p, 3e6); return s ? s.moves : ''; }
  let player = L.p, moves = '';
  for (const r of rm) {
    const wall = L.wall.slice();
    for (const o of rm) if (o !== r) for (const x of (o.done ? o.g : o.b)) wall[x] = 1;
    const s = bfs(L.w, wall, r.g, r.b, player, 2e6);
    if (!s) { const w2 = bfs(L.w, L.wall, L.g, L.b, L.p, 3e6); return w2 ? w2.moves : ''; }
    moves += s.moves;
    for (const c of s.moves.toLowerCase()) player += c === 'u' ? -L.w : c === 'd' ? L.w : c === 'l' ? -1 : 1;
    r.done = true;
  }
  return moves;
}
for (const id of R(I).sort()) {
  const moves = solve(parse(F(J(I, id, 'level.txt'), 'utf8')));
  M(J(O, id), { recursive: true });
  W(J(O, id, 'solution.txt'), moves + '\n');
}
