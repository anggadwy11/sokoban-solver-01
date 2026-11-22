# Sokoban Solver — push-optimal, room by room

A Sokoban solver written for make.fun's "Build the best Sokoban solver,
21 November 2026" bounty. It reads every level in `MAKEFUN_INPUT_DIR`
(`<id>/level.txt`, XSB format) and writes the player's moves to
`MAKEFUN_OUTPUT_DIR/<id>/solution.txt` (`u`/`d`/`l`/`r`, upper case = push).

## How it works

Scoring counts **pushes**, so the search runs over pushes, not steps: a state
is the set of box squares plus the region the player can reach without
pushing. Breadth-first search over pushes is push-optimal by construction.
Two deadlock prunes keep the frontier small without ever cutting a solvable
state:

- **Dead squares** — squares from which a lone box can never reach a goal,
  found by pulling boxes backwards from the goals over open floor.
- **Frozen 2×2 blocks** — four squares of wall/box with a box off its goal.

Generated levels are a one-square-wide hallway with independent rooms off
it, and a box pushed out of its room can never come back. The solver cuts the
dead squares of the player's row (the hallway) out of the floor and solves
each remaining room on its own, with the other rooms' boxes standing as
walls; the room optima add up to the level's optimum. Levels that do not
split cleanly are searched whole.

The solver is deterministic (fixed direction order, state-count budgets
instead of clocks, no randomness) and uses only the Node standard library.

## Run it

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

MIT licensed — see `LICENSE`.
