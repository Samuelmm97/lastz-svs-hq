#!/usr/bin/env python3
"""Build a reproducible SvS placement proposal from the Field Atlas snapshot."""
import argparse
import csv
import json
import math
import random
from collections import Counter
from pathlib import Path

CENTER = 500
TOP_TAGS = ('Helm', 'SWT', 'WRtH', 'mERC', 'aTam', '4NG', 'UpS', 'Ayaa',
            'E45Y', '7cie', 'SHSN', 'movR', 'ULD')
ALIASES = {'HeIm': 'Helm', '7cle': '7cie', '7cIe': '7cie'}
GRASS_OUTER = 120
GRASS_DISTANCE = 4


def radius(i, j):
    return max(abs(i), abs(j), abs(i + j))


def angle(i, j):
    return (math.atan2(i + j / 2, -j) + 2 * math.pi) % (2 * math.pi)


def spot(i, j, zone, number=None):
    result = {'x': CENTER + i + j // 2, 'y': CENTER + j,
              'ring': radius(i, j), 'angle': angle(i, j), 'zone': zone}
    if number is not None:
        result['spot'] = number
    return result


def grass_spots(count):
    """Deterministic maximal packing, then uniform thinning across the grass."""
    tiles = [(i, j) for j in range(-GRASS_OUTER + 1, GRASS_OUTER, 2)
             for i in range(-GRASS_OUTER + 1, GRASS_OUTER)
             if 37 <= radius(i, j) <= GRASS_OUTER - 1]
    random.Random(798).shuffle(tiles)
    offsets = [(di, dj) for dj in range(-GRASS_DISTANCE + 1, GRASS_DISTANCE)
               for di in range(-GRASS_DISTANCE + 1, GRASS_DISTANCE)
               if radius(di, dj) < GRASS_DISTANCE]
    blocked, packed = set(), []
    for i, j in tiles:
        if (i, j) in blocked:
            continue
        packed.append((i, j))
        blocked.update((i + di, j + dj) for di, dj in offsets)
    if len(packed) < count:
        raise ValueError(f'Grass capacity {len(packed)} is below {count}')
    # Packing order was shuffled before placement; rotating selection avoids an
    # inner-ring bias while keeping the selected sites spread around the area.
    return [spot(i, j, 'grass') for i, j in packed[:count]]


def section_layout(players):
    counts = Counter(p['section'] for p in players)
    sections = [tag for tag in TOP_TAGS if counts[tag]] + ['Other']
    total = len(players)
    cursor = 0.0
    out = {}
    for tag in sections:
        share = counts[tag] / total * 2 * math.pi
        out[tag] = {'start': cursor, 'end': cursor + share, 'players': counts[tag]}
        cursor += share
    return out


def angular_distance(a, b):
    delta = abs(a - b) % (2 * math.pi)
    return min(delta, 2 * math.pi - delta)


def assign_zone(players, sites, sections):
    available = list(sites)
    result = []
    # Fill each alliance's wedge first. A shortage spills into the nearest
    # remaining wedge only after every group has claimed its own sites.
    waiting = []
    for tag, section in sections.items():
        group = [p for p in players if p['section'] == tag]
        candidates = [s for s in available if section['start'] <= s['angle'] < section['end']]
        candidates.sort(key=lambda s: (s['ring'], angular_distance(s['angle'],
                         (section['start'] + section['end']) / 2)))
        for player, site in zip(group, candidates):
            result.append({**player, **site})
            available.remove(site)
        waiting.extend(group[len(candidates):])
    for player in waiting:
        section = sections[player['section']]
        target = (section['start'] + section['end']) / 2
        site = min(available, key=lambda s: (s['ring'], angular_distance(s['angle'], target)))
        result.append({**player, **site})
        available.remove(site)
    # Spillover sites can be nearer than a section's final in-wedge site. Keep
    # each alliance's assigned sites, but give the nearer ones to higher HQs.
    for tag in sections:
        group = sorted((row for row in result if row['section'] == tag),
                       key=lambda row: -row['hq'])
        while True:
            inversion = next(((a, b) for a, b in zip(group, group[1:])
                              if a['hq'] > b['hq'] and a['ring'] > b['ring']), None)
            if inversion is None:
                break
            a, b = inversion
            for field in ('x', 'y', 'ring', 'angle'):
                a[field], b[field] = b[field], a[field]
            if 'spot' in a:
                a['spot'], b['spot'] = b['spot'], a['spot']
    return result


def assign(players, mud, grass, sections):
    attendees = [p for p in players if p['priority'] == 0]
    no_shows = [p for p in players if p['priority'] == 1]
    risky = [p for p in players if p['priority'] == 2]
    # Mud uses the existing spacing-1 reservation coordinates. Grass is assigned
    # only after mud; previously unshielded players are assigned last in grass.
    mud_players = attendees[:len(mud)]
    grass_attendees = attendees[len(mud):]
    mud_sections = section_layout(mud_players)
    grass_sorted = sorted(grass, key=lambda s: (s['ring'], s['angle']))
    cut1 = len(grass_attendees)
    cut2 = cut1 + len(no_shows)
    stages = ((grass_attendees, grass_sorted[:cut1]),
              (no_shows, grass_sorted[cut1:cut2]),
              (risky, grass_sorted[cut2:]))
    result = assign_zone(mud_players, mud, mud_sections)
    grass_sections = {}
    for index, (group, sites) in enumerate(stages):
        layout = section_layout(group)
        grass_sections[str(index)] = layout
        result += assign_zone(group, sites, layout)
    return result, mud_sections, grass_sections


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--atlas', type=Path, required=True,
                        help='Field Atlas repository (with data/hqs.json and data/shields.json)')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    hqs = json.loads((args.atlas / 'data/hqs.json').read_text(encoding='utf-8'))
    shields = {row['id']: row for row in json.loads((args.atlas / 'data/shields.json').read_text(encoding='utf-8'))}
    hqs = [p for p in hqs if p['hq'] is not None and shields.get(p['id'], {}).get('status') != 'not_hq']
    hqs.sort(key=lambda p: (-p['hq'], 0 if p.get('zone') == 'capital' else 1, p['id']))
    deduplicated = []
    seen_names = set()
    for p in hqs:
        key = (p['name'].strip().casefold(), ALIASES.get(p['tag'], p['tag']).casefold())
        if key in seen_names:
            continue
        seen_names.add(key)
        deduplicated.append(p)
    players = []
    for p in deduplicated[:2000]:
        tag = ALIASES.get(p['tag'], p['tag'])
        status = shields.get(p['id'], {}).get('status', 'unscanned')
        attendance = 'inside_capital_area' if p.get('zone') == 'capital' else 'outside_capital_area'
        priority = 2 if status == 'unshielded' else (0 if attendance == 'inside_capital_area' else 1)
        players.append({'id': p['id'], 'name': p['name'], 'hq': p['hq'],
                        'tag': tag, 'section': tag if tag in TOP_TAGS else 'Other',
                        'shield': status, 'highRisk': status == 'unshielded',
                        'attendanceProxy': attendance, 'priority': priority,
                        'oldX': p['x'], 'oldY': p['y']})
    sections = section_layout(players)
    # The published pad-1 list has stable spot numbers used by reservations.
    # Keep its original geometry and numbering unchanged.
    mud_source = json.loads((root / 'mud-spots.json').read_text(encoding='utf-8'))
    mud = [spot(row['x'] - CENTER - (row['y'] - CENTER) // 2,
                row['y'] - CENTER, 'mud', row['n']) for row in mud_source]
    grass = grass_spots(len(players) - len(mud))
    result, mud_sections, grass_sections = assign(players, mud, grass, sections)
    out = {'meta': {'atlasCount': len(hqs), 'deduplicatedCount': len(deduplicated),
                    'selected': len(players),
                    'selection': 'Highest readable HQ level after exact name and alliance deduplication; prior capital-area location then atlas ID break ties',
                    'mudSpots': len(mud), 'grassSpots': len(grass),
                    'grassOuterRing': GRASS_OUTER, 'grassMinDistance': GRASS_DISTANCE,
                    'source': 'State 798 Field Atlas, September 2026 shield scan',
                    'warning': 'Prior capital-area location is only a proxy for attendance. Atlas OCR and shield readings need player review before teleporting.'},
           'sections': sections, 'mudSections': mud_sections,
           'grassSections': grass_sections, 'placements': result}
    (root / 'placement-plan.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    with (root / 'placement-plan.csv').open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['id', 'name', 'tag', 'hq', 'shield', 'highRisk',
                                                'attendanceProxy', 'priority',
                                                'section', 'zone', 'spot', 'x', 'y', 'ring', 'oldX', 'oldY'])
        writer.writeheader()
        for row in result:
            writer.writerow({key: row.get(key, '') for key in writer.fieldnames})
    print(f"{len(result)} placements: {len(mud)} mud, {len(grass)} grass; "
          f"{sum(p['highRisk'] for p in result)} previously unshielded in grass")


if __name__ == '__main__':
    main()
