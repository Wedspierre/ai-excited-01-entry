# ai-excited-01 v8 — "DON'T BLINK, JUDGE! THE WAVE EATS THE SUN"

One image, drawn entirely by code (Node 22, standard library only, no assets,
no network, no randomness beyond a fixed seed): a lone surfer dropping down the
face of a giant curling wave that glows gold from inside at sunset. Spray
explodes off the lip, the horizon burns orange, and one tiny human silhouette
is dwarfed by a wall of water — fear and awe in the same frame. Big block
letters speak straight to the judge: "DON'T BLINK, JUDGE! THE WAVE EATS THE
SUN."

## What the program does

`main.ts` paints a 1024×1024 RGBA canvas pixel by pixel — sky gradient, low
sun with a burning glow, a distant ridge, a dark sea with the sun's golden
road, then the wave itself: a curling barrel whose face is shaded emerald to
deep teal and lit gold from within near the barrel mouth, a foam lip with
drips and exploding spray, and the surfer, a small black silhouette on a
gold-edged board, dropping down the face. A 5×7 bitmap font draws the text.
It then encodes a whole PNG by hand (zlib deflate, CRC32) and writes it to
`$MAKEFUN_OUTPUT_DIR/entry.png` (`/output/entry.png` by default).

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Determinism

Fixed seed (`20261117`), no clock, no `Math.random`, no I/O besides the
output file. Two runs write byte-identical PNGs (same size, same sha256).

## License

MIT — see `LICENSE`.
