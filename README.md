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
| 0 (footprints touch) | 3 | 254 | 19–34 |
| 1 (one empty tile)   | 4 | 156 | 20–32 |
| 2                    | 5 | 85  | 21–32 |
| 3                    | 6 | 54  | 24–30 |

Every spot uses whole coordinates (X/Y exactly as the game's pill shows them), and
each spacing keeps its own reservations, so switching never loses anyone's pick.
Share the link with `?pad=N` to open everyone on the same spacing.

Reservations are public (anyone with the page can edit them) — it is a sign-up list,
not a secure system. `plan.png` is the spacing-1 layout as a static image, and
`plan_hq.csv` / `plan.json` (in the plan folder) hold the raw spacing-1 coordinates.

Offline tools: `plan_hq.py [--pad N]` regenerates coordinates for any spacing;
`spacing_counts.py` prints the counts above.
