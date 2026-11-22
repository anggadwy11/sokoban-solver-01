# Sokoban solver — push-optimal, room by room

Reads `<id>/level.txt` (XSB) from `MAKEFUN_INPUT_DIR`, writes moves to
`MAKEFUN_OUTPUT_DIR/<id>/solution.txt`. BFS over pushes (state = box squares +
player's reachable region) with dead-square and frozen-2x2 pruning; levels
split into hallway rooms, each solved alone, optima add up. Deterministic,
Node stdlib only. MIT — see `LICENSE`.

Run: `MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts`
