// Push-optimal Sokoban solver for the make.fun sokoban-solver-01 bounty.
//
// Approach
// --------
// Scoring counts pushes, not steps, so the search runs over pushes: a state is
// the set of box squares plus the region the player can reach without pushing
// (named by its lowest square). Breadth-first search over pushes is optimal by
// construction. Two cheap deadlock prunes keep the frontier small without ever
// cutting a solvable state:
//
//   * dead squares — squares from which a lone box can never be pushed onto a
//     goal (found by pulling boxes backwards from every goal over open floor);
//   * frozen 2x2 blocks — four squares of wall/box with a box off its goal.
//
// Generated levels are a hallway with independent rooms off it: a box pushed
// out of its room can never come back, so the level splits into rooms (cut the
// dead squares of the player's row out of the floor and take the components
// that hold boxes). Each room is solved on its own with the other rooms' boxes
// standing as walls, and the room optima add up to the level optimum. When a
// level does not split cleanly, the same push search runs over the whole board.
//
// Everything is deterministic: fixed direction order, state-count budgets
// instead of clocks, no randomness. Node standard library only.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Per-search state budgets (deterministic work limits, never the clock). */
const ROOM_STATE_BUDGET = 2_000_000;
const WHOLE_STATE_BUDGET = 3_000_000;

/** Directions in a fixed order: [dx, dy, walk letter, push letter]. */
const DIRS: ReadonlyArray<readonly [number, number, string, string]> = [
  [0, -1, 'u', 'U'],
  [0, 1, 'd', 'D'],
  [-1, 0, 'l', 'L'],
  [1, 0, 'r', 'R'],
];

interface Level {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

/** Parse XSB text. Squares outside the text and on the outer frame are walls. */
function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  for (let x = 0; x < w; x++) {
    wall[x] = 1;
    wall[(h - 1) * w + x] = 1;
  }
  for (let y = 0; y < h; y++) {
    wall[y * w] = 1;
    wall[y * w + w - 1] = 1;
  }
  boxes.sort((a, b) => a - b);
  goals.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

/**
 * Squares from which a box can reach some goal, ignoring the other boxes:
 * start from the goals and pull a box backwards — a box can be pulled from
 * square y into square x when both x and the square behind the player are
 * open floor.
 */
function liveSquares(w: number, wall: Uint8Array, goals: number[]): Uint8Array {
  const live = new Uint8Array(wall.length);
  const queue: number[] = [];
  for (const g of goals) {
    live[g] = 1;
    queue.push(g);
  }
  for (let head = 0; head < queue.length; head++) {
    const x = queue[head];
    for (const [dx, dy] of DIRS) {
      const d = dy * w + dx;
      const y = x - d;
      if (y < 0 || y >= wall.length) continue;
      if (!wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/** Flood fill of the player's reachable region; returns its lowest square. */
function floodRegion(
  w: number,
  wall: Uint8Array,
  blocked: Uint8Array,
  from: number,
  seen: Int32Array,
  stamp: number,
  stack: Int32Array,
): number {
  let low = from;
  let n = 0;
  stack[n++] = from;
  seen[from] = stamp;
  while (n > 0) {
    const p = stack[--n];
    if (p < low) low = p;
    const neighbours = [p - w, p + w, p - 1, p + 1];
    for (const q of neighbours) {
      if (q >= 0 && q < wall.length && wall[q] === 0 && blocked[q] === 0 && seen[q] !== stamp) {
        seen[q] = stamp;
        stack[n++] = q;
      }
    }
  }
  return low;
}

/** True when the box just pushed to t froze inside a solid 2x2 of walls/boxes. */
function frozenSquare(
  w: number,
  wall: Uint8Array,
  blocked: Uint8Array,
  goalSet: Uint8Array,
  t: number,
): boolean {
  const solid = (i: number): boolean => wall[i] === 1 || blocked[i] === 1;
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (d >= wall.length) continue;
    if (!solid(a) || !solid(b) || !solid(c) || !solid(d)) continue;
    const offGoal = (i: number): boolean => blocked[i] === 1 && goalSet[i] === 0;
    if (offGoal(a) || offGoal(b) || offGoal(c) || offGoal(d)) return true;
  }
  return false;
}

/** Shortest walk from `from` to `to` avoiding walls and boxes, as walk letters. */
function walkPath(
  w: number,
  wall: Uint8Array,
  blocked: Uint8Array,
  from: number,
  to: number,
): string {
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const letter = new Array<string>(wall.length);
  const queue = [from];
  prev[from] = from;
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    if (p === to) break;
    for (const [dx, dy, walk] of DIRS) {
      const q = p + dy * w + dx;
      if (q < 0 || q >= wall.length) continue;
      if (wall[q] || blocked[q] || prev[q] !== -1) continue;
      prev[q] = p;
      letter[q] = walk;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walkPath: target out of reach');
  let out = '';
  for (let p = to; p !== from; p = prev[p]) out = letter[p] + out;
  return out;
}

interface PushSolution {
  pushes: number;
  moves: string;
}

/**
 * Breadth-first search over pushes on one board (a room, or a whole level).
 * Returns the push-optimal solution, or null when the budget runs out or the
 * board is unsolvable.
 */
function solvePushBfs(
  w: number,
  wall: Uint8Array,
  goals: number[],
  startBoxes: number[],
  startPlayer: number,
  budget: number,
): PushSolution | null {
  const size = wall.length;
  const goalSet = new Uint8Array(size);
  for (const g of goals) goalSet[g] = 1;
  const live = liveSquares(w, wall, goals);
  if (startBoxes.some((b) => !live[b])) return null;

  const blocked = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;

  // Numeric state key: the region's lowest square followed by the sorted box
  // squares, packed in base `size` (exact while size^(boxes+1) < 2^53).
  const packKey = (boxes: number[], low: number): number => {
    let k = low;
    for (const b of boxes) k = k * size + b;
    return k;
  };

  const allOnGoals = (boxes: number[]): boolean => boxes.every((b) => goalSet[b] === 1);

  // State store: parallel arrays; parent + the push that created the state.
  const stateBoxes: number[][] = [startBoxes.slice()];
  const statePlayer: number[] = [startPlayer];
  const stateParent: number[] = [-1];
  const statePushBox: number[] = [-1]; // box square before the push
  const statePushDir: number[] = [-1]; // direction index of the push
  const visited = new Map<number, number>();

  for (const b of startBoxes) blocked[b] = 1;
  const startLow = floodRegion(w, wall, blocked, startPlayer, seen, ++stamp, stack);
  visited.set(packKey(startBoxes, startLow), 0);
  for (const b of startBoxes) blocked[b] = 0;

  let found = allOnGoals(startBoxes) ? 0 : -1;
  for (let head = 0; head < stateBoxes.length && found < 0; head++) {
    const boxes = stateBoxes[head];
    for (const b of boxes) blocked[b] = 1;
    floodRegion(w, wall, blocked, statePlayer[head], seen, ++stamp, stack);
    const regionStamp = stamp;

    for (let bi = 0; bi < boxes.length && found < 0; bi++) {
      const b = boxes[bi];
      for (let di = 0; di < 4; di++) {
        const [dx, dy] = DIRS[di];
        const d = dy * w + dx;
        const target = b + d;
        const stand = b - d;
        if (seen[stand] !== regionStamp) continue; // player cannot stand there
        if (wall[target] || blocked[target] || !live[target]) continue;

        blocked[b] = 0;
        blocked[target] = 1;
        const frozen = frozenSquare(w, wall, blocked, goalSet, target);
        let key = -1;
        let nextBoxes: number[] | null = null;
        if (!frozen) {
          nextBoxes = boxes.slice();
          nextBoxes[bi] = target;
          nextBoxes.sort((a, c) => a - c);
          const low = floodRegion(w, wall, blocked, b, mark, ++stamp, stack);
          key = packKey(nextBoxes, low);
        }
        blocked[target] = 0;
        blocked[b] = 1;
        if (frozen || nextBoxes === null || visited.has(key)) continue;
        if (stateBoxes.length >= budget) {
          for (const x of boxes) blocked[x] = 0;
          return null;
        }
        const id = stateBoxes.length;
        visited.set(key, id);
        stateBoxes.push(nextBoxes);
        statePlayer.push(b); // after the push the player stands on the box's old square
        stateParent.push(head);
        statePushBox.push(b);
        statePushDir.push(di);
        if (allOnGoals(nextBoxes)) found = id;
      }
    }
    for (const b of boxes) blocked[b] = 0;
  }
  if (found < 0) return null;

  // Rebuild the move string: walk to each push position, then push.
  const chain: number[] = [];
  for (let s = found; s > 0; s = stateParent[s]) chain.push(s);
  chain.reverse();
  let moves = '';
  let player = startPlayer;
  let boxes = startBoxes;
  for (const s of chain) {
    const from = statePushBox[s];
    const di = statePushDir[s];
    const [dx, dy, , pushLetter] = DIRS[di];
    const d = dy * w + dx;
    for (const b of boxes) blocked[b] = 1;
    moves += walkPath(w, wall, blocked, player, from - d);
    for (const b of boxes) blocked[b] = 0;
    moves += pushLetter;
    player = from;
    boxes = stateBoxes[s];
  }
  return { pushes: chain.length, moves };
}

interface Room {
  squares: number[];
  boxes: number[];
  goals: number[];
  done: boolean;
}

/**
 * Split a level into its rooms: cut the dead squares of the player's row (the
 * hallway) out of the floor; each remaining component that holds a box is a
 * room. Null when the split is not clean (a goal in the hallway, or a component
 * whose boxes and goals do not balance).
 */
function splitRooms(level: Level): Room[] | null {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSquares(w, wall, goals);
  const rowStart = Math.floor(player / w) * w;
  const cut = new Uint8Array(wall.length);
  for (let i = rowStart; i < rowStart + w; i++) {
    if (!wall[i] && !live[i]) cut[i] = 1;
  }
  if (boxes.some((b) => cut[b] === 1)) return null;

  const part = new Int32Array(wall.length).fill(-1);
  const rooms: Room[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const [dx, dy] of DIRS) {
        const q = squares[i] + dy * w + dx;
        if (q < 0 || q >= wall.length) continue;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [], done: false });
  }
  for (const b of boxes) rooms[part[b]].boxes.push(b);
  for (const g of goals) {
    if (part[g] < 0) return null;
    rooms[part[g]].goals.push(g);
  }
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/** The square the player ends on after playing `moves` from `from`. */
function endSquare(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) {
    p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  }
  return p;
}

/** Solve one level: room by room when it splits, whole-board otherwise. */
function solveLevel(level: Level): string {
  const rooms = splitRooms(level);
  if (rooms === null) {
    const whole = solvePushBfs(level.w, level.wall, level.goals, level.boxes, level.player, WHOLE_STATE_BUDGET);
    return whole === null ? '' : whole.moves;
  }
  let player = level.player;
  let moves = '';
  for (const room of rooms) {
    // Other rooms' boxes stand as walls: untouched ones on their start
    // squares, finished ones on their goals.
    const wall = level.wall.slice();
    for (const other of rooms) {
      if (other === room) continue;
      for (const b of other.done ? other.goals : other.boxes) wall[b] = 1;
    }
    const solved = solvePushBfs(level.w, wall, room.goals, room.boxes, player, ROOM_STATE_BUDGET);
    if (solved === null) {
      // Fall back to the whole board rather than leave the level unanswered.
      const whole = solvePushBfs(level.w, level.wall, level.goals, level.boxes, level.player, WHOLE_STATE_BUDGET);
      return whole === null ? '' : whole.moves;
    }
    moves += solved.moves;
    player = endSquare(level.w, player, solved.moves);
    room.done = true;
  }
  return moves;
}

for (const id of readdirSync(INPUT_DIR).sort()) {
  const level = parseLevel(readFileSync(join(INPUT_DIR, id, 'level.txt'), 'utf8'));
  const moves = solveLevel(level);
  mkdirSync(join(OUTPUT_DIR, id), { recursive: true });
  writeFileSync(join(OUTPUT_DIR, id, 'solution.txt'), `${moves}\n`);
}
