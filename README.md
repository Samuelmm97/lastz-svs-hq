# Last Z — SvS capital HQ slot sign-up

Interactive map of the legal HQ (7-tile) teleport spots around the capital:
tap a dot, type your name, and it is reserved on the shared sheet in real time.

Live page: https://samuelmm97.github.io/lastz-svs-hq/

## Managing alliance zones and memberships

In **Edit plan → Manage alliances**, choose a State 798 alliance from the current
Sheets snapshot or enter a custom tag, then **Add alliance zone**. Set its angles
and save the area. Existing players with that tag join the zone; adding a zone
never creates or deletes player records. Choose any saved zone in **Zone to remove**, including tags missing from the
current Sheet. **Remove selected alliance zone** moves
its players to waiting, releases their reservations and affected swap pairs, and
preserves their tags and all other zones. Both operations enable draft planning.

**Preview membership refresh from Sheets** matches the existing roster by player
ID. Changed memberships move to waiting and release reservations and affected
pairs; unmatched players stay unchanged. Review the match/change counts, then
**Apply preview** or **Cancel preview**. Refreshed members whose alliance has no
zone appear under Other until a zone is added. New people outside the base roster
require a separate roster migration. The snapshot date is shown beside the controls.

The private Sheet roster is stored in D1 and read through the access-controlled
`/api/placement/alliance-roster` route. Do not publish the raw Sheet rows as static
site assets. Deploy `backend/migrations/006_alliance_roster.sql` before this Worker.
The `placement_alliance_rosters` row with id `state-798` stores a JSON payload with
`state`, `source` (`url`, `observedAt`), `alliances` (`tag`, `name`, `members`,
`allianceId`) and `players` (`uid`, `tag`, `name`, `allianceId`); refresh that snapshot
from verified Sheets reads when its capture changes. Importing the source snapshot
does not itself alter shared placements; applying the preview saves a normal,
revision-checked history entry. Drafts store optional `allianceTags` pairs of local
player ID and current tag. Older history remains restorable.

Regression checks: `node alliance-management.test.mjs` and
`node alliance-management-browser.test.cjs`. The browser test supports `QA_ENGINE=webkit`,
`QA_PLAN`, `QA_SHARED`, and `QA_ALLIANCE_ROSTER` for isolated tests against private
snapshots; it never writes to production.

## Planning in phases

Editors can use **Move everyone to waiting** to clear both mud and grass,
including reservations and swap pairs, while preserving saved alliance zones.
The full reset also clears old survey HQ squares and their occupancy blockers from
the draft; prior survey data remains in revision history and the Atlas source.
This enables **Draft planning: allow temporary teleport gaps**, a shared setting
saved with the draft. Adjust and save each alliance zone, then use **Preview all
alliance wedges** and **Apply preview** to fill the saved zones.

During draft planning, gaps remain visible and the footprint test remains
available, but temporary openings do not block manual moves, previews or server
saves. Collision, terrain, turret and placement rules still apply. Footprint
blocking continues to guide the packing algorithm. Turn draft planning off when
finished; this checks all alliances with **Block every enemy teleport footprint**
enabled and refuses to finish until their internal openings are closed.
Existing drafts retain their previous enforcement until draft planning is enabled.

Deploy the Worker and frontend together (Worker first); both understand the
optional boolean `planningMode` draft field. Regression checks:
`node planning-workflow.test.mjs` and `node planning-browser.test.cjs` (Playwright).

## Hard teleport validation and shared observations

**Test every hex and HQ loss** checks the full seven-cell footprint at every legal
integer center inside the selected formation's convex hull and alliance wedge.
Flood fill groups valid landing centers into connected holes. Open edges outside
the occupied formation are shown separately; the check does not claim to occupy the
entire empty wedge. All assigned HQs, observed unknown HQs and turret restrictions
participate in collision checks.

**Block every enemy teleport footprint** makes zero internal landings a hard save
requirement. Both manual moves and the Worker reject openings; unsafe layout previews
cannot be applied. One empty tile remains a spacing preference: around irregular held
HQs, touching placements can be needed to close an enemy footprint. Held positions
are preserved. Select a member and **Simulate selected HQ destroyed** to see newly
exposed footprints and a pair of disjoint enemy footprints when two can fit. A current
zero-gap result does not mean every single-HQ loss is safe.

Power reads the Atlas projection of **Last Z States 792–815 — Alliances and Player Power**
through `shared-state.js`, joined by UID; personal and hero component dates remain
separate. Observed coordinates read the same Atlas `data/hqs.json`. Proposed coordinates
remain in the shared draft. Visible pages refresh observations every minute without
moving assignments or changing Bear's saved ordering.

Regression: `node placement-defence.test.cjs`; existing planner, controls, survey,
Worker validation and isolated desktop/mobile browser tests remain applicable.

## Manual placement, front spacing, and grass groups

In **Edit plan**, select an alliance. Choose **Touching front rows** and the
number of **Empty tiles behind front**, then **Preview alliance layout**.
The front rows touch; the selected gap separates the body from the front and
spaces the body HQs. Preview shows waiting players and reserved positions outside
the wedge. **Apply preview** saves; **Cancel preview** restores the shared layout.

**Keep grass inside this alliance’s wedge** prevents spillover, including prior
SvS risks. **Keep grass together (preserve player order)** makes a connected grass
group, including lower HQs, using the current position order instead of reranking
power. This is selected by default for Helm. **Preview grass grouping only** keeps
all mud fixed. Each member connects to the block at normal
one-empty-tile spacing; eight-tile chains do not count as a tight group. Blocking
unreserved grass HQs can be relocated into their own alliance wedge; **Other**
HQs use legal shared grass outside the selected wedge,
with their count shown in preview. The original grass order is saved so repeating
the grouping does not rerank players. **Preview all alliance wedges** can reclaim
cross-alliance grass space together using saved boundaries. Shared alliance areas
arrange as one group; reserved positions and swap pairs remain fixed. A shortage
goes to waiting, never silently outside the wedge.

For a manual move, select a player in the list or with the map’s **Select player**
mode. Switch to **Choose target tile**, tap the map, or enter exact X/Y and choose
**Check tile**. The X/Y buttons nudge the target one tile. **Place and reserve**
becomes available for a legal target; occupied targets explain the proposed swap.
Footprint collisions, turret buffers, no-build terrain, and wedge violations are
rejected. New legal tiles are saved with the shared draft and revision history.

Editors can also drag an HQ on the map. Dropping it on an empty tile reserves that tile
straight away. Dropping it on a tile another HQ holds offers **Swap positions** or
**Move occupant to the unplaced list**; each choice is offered only when the planner
accepts it, and the panel names the tile, the occupant, and why a refused choice fails.
While dragging, amber outlines show every teleport-sized gap the drop would open, and the
same collision, spacing, anchor, turret and teleport-opening checks run before the move is
saved, so an unsafe drag never reaches the shared plan.

Before saving a manual move, amber HQ outlines and a warning identify newly
exposed spaces where a seven-tile HQ could teleport. The warning remains after
the move in that browser session. Detection checks actual hex footprint clearance
(center distance 3), including grass, rather than treating every visual gap as a
landing spot. An occupied-for-occupied swap creates no gap. The **Teleport gaps**
map checkbox toggles the outlines.

The overlay also scans existing legal landing spaces inside and immediately along
the selected formation, even before a manual move. It checks every alliance's
occupied footprints. Nearby other-alliance HQs remain visible as faint dots while
the roster is filtered, so a hidden neighbor is not mistaken for an empty spot.
Zoom in to see each HQ's seven-tile footprint. Amber footprints are example
landings; the tile count can include multiple alternatives within one opening.

Regression checks: `node placement-controls.test.cjs`, `node planner.test.cjs`,
`node backend/test-validation.mjs`, and `node backend/test-api.mjs` against a local
Worker. `node placement-browser.test.cjs` uses Playwright and an isolated in-memory
QA server with the production frontend and Worker validation. `QA_PLAN`,
`QA_SHARED`, and `QA_OUTPUT` optionally select a real shared snapshot and screenshot
directory; no QA save touches the production database. Deploy the Worker before
the frontend because exact coordinates require the updated draft validation.

## Proposed 2,000 player placement

`placement.html` starts from a placement proposal built by `generate_placement.py`
from the State 798 Field Atlas. The script removes exact repeated name-and-alliance
records, then ranks plausible HQ records with readable levels by level. Prior
capital-area location and atlas ID break ties. It uses the 181 published spacing-1 mud spots,
and packs the rest across the grass out to ring 119. Grass HQ centers stay at least
four hex tiles apart. The known top 13 alliance tags get angular sections sized
separately in mud and grass to keep members near each other. Within each section,
higher HQ levels lead each grass priority group. Mud refill orders total hero
power, personal/total power, then HQ level; missing metrics follow known values.
HQs recorded inside the 100-tile capital
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

Use `generate_helm_layout.py` for the reviewed northwest Helm refresh. It starts
from the latest shared assignments, keeps manual locks and strike/reserve pairs,
places eligible Helm HQ24+ in northwest mud by combat power, and groups other HQs in the
grass using the previous SvS priority groups. The normal highest-HQ roster also
includes all readable Helm supporters. `helm-layout.html` shows numbered mud
and grass maps with names, powers, and teleport coordinates from the shared draft.
Previous SvS shield failures stay last in grass, including higher HQs; confirmed
previous absences also stay in their grass priority group. New players with unknown
attendance are not treated as confirmed absences.

Map and leaderboard dates are separate from shield/attendance dates. A fresh
leaderboard can confirm a roster member whose current map location was not
captured. Their old location remains dated, or unknown; it does not become a new
SvS attendance observation. Old records not seen in the scan or leaderboard are
excluded from the refreshed roster without treating them as confirmed quitters.

Each refreshed base has a unique `planId`. Use the authenticated
`/api/placement/migrate` route to archive the old and new metadata and update the
draft atomically at its expected revision. The frontend loads the matching base
from the database when the shared draft belongs to another roster version. Old
history keeps old names and can be restored as a new revision.
Backend setup and local tests are in `backend/README.md`.

* outer hexagon = buildable dirt zone (35 tiles from the capital centre)
* inner hexagon = no-build zone (18 tiles)
* each HQ is a centre tile + 6 neighbours = 7 tiles

## Space between HQs

The shared editor supports a companion map survey in `draft.survey`. Observed
roster HQs held in place are locked at their exact coordinates; observed HQs
outside held areas retain their source coordinates separately from proposed
relocations. Current names and alliances follow the matched player identity.
Additional observed HQs outside the roster remain occupied obstacles. Survey
times are shown in the editor and the current map can be downloaded as CSV.
White squares identify held in-game positions; chat exports mark them `stay` and
mark observed relocations `move`. Existing touching grass HQs are accepted when
both are surveyed anchors, while new placements retain the normal spacing.
Run `node placement-survey.test.cjs` for survey validation and fixed-position QA.

Teleport openings distinguish internal landing tiles from open edges. The
default overlay shows internal openings; **Open edges** includes the perimeter.
Fixed HQs can leave unavoidable holes, which remain visible during replanning.

The shared planner now follows the October 1 leadership sketch. Mud placement
stays inside each alliance's assigned area. Helm and SWT use the shipped
spacing-0 coordinates where they fit alongside neighboring footprints; other
areas retain spacing-1 coordinates. Hero power, total power, then HQ choose the
mud players, including lower tiers where needed. Overflow goes to nearby grass.
Known prior absences and shield risks stay in back grass; unmatched attendance
is neutral and labeled unknown.

`leadership-layout.cjs PREVIOUS_PLAN SHARED_DRAFT OUTPUT_DIRECTORY` creates a
reviewable migration using the current roster, preserved locks/waiting/swap pairs,
shared alliance labels, and the compact catalog. After a roster refresh, apply
this step to its local proposal before publishing; the older northwest generator
alone does not implement the current leadership layout. Check the shared revision
again before applying the migration.

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

### Manual placement from the map

In Edit plan, enable editing and open **Players to place** on the map. Search by
name or filter by alliance; **Waiting players only** shows unplaced members.
Drag a player name to a map tile, or select a name then tap a tile on a phone.
Occupied tiles offer the existing swap or move-to-waiting choices. Placement
checks and reservations apply to both paths. The panel starts collapsed on phones.

If a save or history restore loses its response, the editor checks the shared
revision before retrying. It recognizes an already committed change and reloads
a concurrent edit rather than overwriting it. Persistent outages report that the
save could not be confirmed and ask the planner to reconnect and refresh.

Regression checks: placement-roster-browser.test.cjs (desktop drag and iPhone
tap, filters, persistence) and placement-save-recovery.test.cjs (transient failure,
lost response after commit, concurrent edit).

Unconfirmed identities are excluded from the draggable player list and its waiting
count. A separate Unconfirmed roster records section lists them for review; the
full player table labels their status. The planner retains identity validation.
Regression: node placement-roster-identity.test.cjs (with Playwright available).
