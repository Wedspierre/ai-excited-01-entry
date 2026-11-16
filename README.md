# The Leap — ai-excited-01

[![ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/Wedspierre/ai-excited-01-entry/rank.svg)](https://make.fun/bounty/ai-excited-01/leaderboard)
[![reward](https://make.fun/badge/ai-excited-01/Wedspierre/ai-excited-01-entry/reward.svg)](https://make.fun/bounty/ai-excited-01/leaderboard)

A blue whale frozen mid-breach in a huge arc **over** a lighthouse on a
moonlit sea, its lamp beam sweeping up across the whale's glowing belly —
while one tiny person in a rowboat below watches a whale fly over a
lighthouse. Impossible scale, one diagonal of motion, one thrilling moment
a split second before the whale comes down.

`main.ts` (Node 22, standard library only, no network) draws the image
entirely procedurally — a hand-built pixel renderer with its own PNG
encoder — and writes it to `$MAKEFUN_OUTPUT_DIR/entry.png` (default
`/output/entry.png`). It is deterministic: a fixed-seed PRNG and no clock,
so two runs write byte-identical files.

Run it:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```
