# Last Z — SvS capital HQ slot sign-up

Interactive map of the legal HQ (7-tile) teleport spots around the capital:
tap a dot, type your name, and it is reserved on the shared sheet in real time.

Live page: https://samuelmm97.github.io/lastz-svs-hq/

## Proposed 2,000 player placement

`placement.html` starts from a placement proposal built by `generate_placement.py`
from the State 798 Field Atlas. The script removes exact repeated name-and-alliance
records, then ranks plausible HQ records with readable levels by level. Prior
capital-area location and atlas ID break ties. It uses the 181 published spacing-1 mud spots,
and packs the rest across the grass out to ring 119. Grass HQ centers stay at least
four hex tiles apart. The known top 13 alliance tags get angular sections sized
separately in mud and grass to keep members near each other. Within each section,
higher HQ levels lead each priority group. HQs recorded inside the 100-tile capital
area last time get first placement priority; HQs recorded outside go later in grass.
This location is only a proxy for attendance. Players marked unshielded in the
September 26 atlas scan are assigned last in grass.

The planner lets coordinators lock manual edge placements, set a wedge by clockwise
angles from north, and refill only unlocked positions in that wedge. It supports
grass strike players paired with mud reserve holders; the post-swap preview and CSV
exchange each pair's position. The shared draft is saved to a Cloudflare Worker
and D1 database. Each saved revision records the editor name, time, changed players,
locks, and strike/reserve pairs. The history panel shows these changes and can restore
an earlier snapshot as a new revision. History starts at the current baseline because
older drafts were not retained before this feature. Every edit uses a revision check
so a stale browser cannot silently overwrite another planner's changes. The page refreshes shared changes every 10
seconds. Anyone can view; editing requires the team key. After a valid key is entered,
it stays saved in that browser on that device until the editor uses “Forget key on this
device” or clears browser storage. The key is never committed to this repository.

The draft does not change the separate HQ sign-up reservations. Staging and
post-swap CSV downloads include player, alliance, level, shield reading, proposed
X/Y and prior atlas X/Y for review. OCR readings, shield observations, and section
boundaries need review before anyone teleports. To regenerate the base plan:

```
python generate_placement.py --atlas PATH_TO_FIELD_ATLAS_REPOSITORY
```

The base plan should not be regenerated while a shared draft exists: the draft
references its player IDs and legal sites. Migrate or archive the draft first.
Backend setup and local tests are in `backend/README.md`.

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
