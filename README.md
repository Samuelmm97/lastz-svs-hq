# Last Z — SvS capital HQ slot sign-up

Interactive map of the legal HQ (7-tile) teleport spots around the capital:
tap a dot, type your name, and it is reserved on the shared sheet in real time.

Live page: https://samuelmm97.github.io/lastz-svs-hq/

* outer hexagon = buildable dirt zone (35 tiles from the capital centre)
* inner hexagon = no-build zone (18 tiles)
* each HQ is a centre tile + 6 neighbours = 7 tiles

## Space between HQs

The **space between HQs** buttons choose how many EMPTY tiles sit between two HQ
footprints (the HQ footprint also keeps that gap from the no-build hexagon and the
outer edge, so the usable band moves inwards as the gap grows):

| space | centre distance | spots | rings |
|---|---|---|---|
| 0 (footprints touch) | 3 | 315 | 19–34 |
| 1 (one empty tile)   | 4 | 181 | 20–33 |
| 2                    | 5 | 95 | 21–32 |
| 3                    | 6 | 62 | 22–31 |

Every spot uses whole coordinates (X/Y exactly as the game's pill shows them), and
each spacing keeps its own reservations, so switching never loses anyone's pick.
Share the link with `?pad=N` to open everyone on the same spacing.

The four lists are generated offline (`gen_spots.js`, fixed seed + 150,000
destroy-and-repair iterations per spacing) and embedded in the page, so every visitor
sees the same spots and the same numbers — reservations are keyed by spot number, so
the numbering must never drift. The staggered-row arrangement these use is roughly
2.5x denser than a plain pitch-D sub-lattice.

Reservations are public (anyone with the page can edit them) — it is a sign-up list,
not a secure system. `plan.png` is the spacing-1 layout as a static image, and
`hq_plan_pad0..3.png` / `.csv` (in the plan folder) hold the raw coordinates.

Offline tools: `plan_hq.py [--pad N]` regenerates coordinates for any spacing (or
`--from-csv` to draw/extract an existing list); `gen_spots.js` produces the shipped
lists; `spacing_counts.py` prints the counts above.
