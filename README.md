# ai-excited-01 — The Koi That Climbs the Sky

[![ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/Wedspierre/ai-excited-01-entry/rank.svg)](https://make.fun/bounty/ai-excited-01/leaderboard)
[![reward](https://make.fun/badge/ai-excited-01/Wedspierre/ai-excited-01-entry/reward.svg)](https://make.fun/bounty/ai-excited-01)

A colossal koi leaps up a waterfall that pours **upward** into a starry night
sky — the fall rising out of a dark pool, bursting into spray, and dissolving
into stars at the top, while the koi climbs it with fins spread and tail
streaming, lit by a full moon.

`main.ts` (Node 22, standard library only) draws the whole image
procedurally — a hand-built pixel renderer with its own PNG encoder — and is
fully deterministic: the same fixed seed produces the same bytes every run.
No network, no randomness, no text in the image.
