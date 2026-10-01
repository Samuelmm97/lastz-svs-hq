"""Keep each alliance's mud and grass in one shared angular area."""
import math
from collections import Counter
from generate_placement import angular_distance


def align_alliances(players, sites, assignments, locks, sections, ranked_tags, combat_order):
    """Helm's approved NW area stays fixed; other areas follow clockwise.

    Area widths reserve enough grass slots for each whole alliance. Smaller
    alliances share the remaining open spots. Explicit reservations stay put.
    """
    tau=2*math.pi
    helm=sections['Helm'];start=helm['end'];span=tau-(helm['end']-helm['start'])
    reserved={assignments[id] for id in locks}
    helm_sites={key for id,key in assignments.items() if players[id]['tag']=='Helm'}
    pool={key:site for key,site in sites.items() if key not in reserved|helm_sites}
    grass=sorted(((key,site) for key,site in pool.items() if site['zone']=='grass' and
                  0<(site['angle']-start)%tau<span),key=lambda item:(item[1]['angle']-start)%tau)
    tags=[tag for tag in ranked_tags if tag!='Helm' and any(p['section']==tag for p in players.values())]
    tags += [tag for tag in sections if tag not in tags and tag not in ('Helm','Other') and
             any(p['section']==tag for p in players.values())]
    counts=Counter(p['section'] for id,p in players.items() if id not in locks)
    need=sum(counts[tag] for tag in tags)
    if need>len(grass):raise ValueError(f'Alliance areas need {need} grass sites; {len(grass)} available outside Helm')
    cursor=0;edge=start
    for tag in tags:
        count=counts[tag]
        cursor+=count
        angle=(grass[cursor-1][1]['angle']-start)%tau if count else edge-start
        next_angle=(grass[cursor][1]['angle']-start)%tau if cursor<len(grass) else span
        end=start+(angle+next_angle)/2
        sections[tag]={'start':edge,'end':end,'players':sum(p['section']==tag for p in players.values())}
        edge=end
    sections['Other']={'start':edge,'end':start+span,'players':sum(p['section']=='Other' for p in players.values()),
                       'sharedOpenSpots':True}
    mutable=[p for id,p in players.items() if id not in locks and p['tag']!='Helm']
    for p in mutable:assignments[p['id']]=None
    def inside(site,section):
        return (site['angle']-section['start'])%tau<=section['end']-section['start']+1e-9
    def mud_ok(p):return p['hq']>=24 and not p['highRisk'] and p['attendanceProxy']=='inside_capital_area'
    # Allocate each named alliance within the same area in both terrain bands.
    for tag in tags:
        people=[p for p in mutable if p['section']==tag]
        area=sections[tag];center=(area['start']+area['end'])/2
        mud=sorted(((key,s) for key,s in pool.items() if s['zone']=='mud' and inside(s,area)),
                   key=lambda item:(item[1]['ring'],angular_distance(item[1]['angle'],center)))
        strong=sorted((p for p in people if mud_ok(p)),key=combat_order)
        for p,(key,s) in zip(strong,mud):assignments[p['id']]=key;pool.pop(key)
        remaining=sorted((p for p in people if assignments[p['id']] is None),
                         key=lambda p:(p['priority'],-p['hq'],p['id']))
        choices=sorted(((key,s) for key,s in pool.items() if s['zone']=='grass' and inside(s,area)),
                       key=lambda item:(item[1]['ring'],angular_distance(item[1]['angle'],center)))
        if len(choices)<len(remaining):raise ValueError(f'{tag} area cannot fit its grass members')
        for p,(key,s) in zip(remaining,choices):assignments[p['id']]=key;pool.pop(key)
    others=[p for p in mutable if p['section']=='Other']
    mud=sorted(((key,s) for key,s in pool.items() if s['zone']=='mud'),key=lambda item:(item[1]['ring'],item[1]['angle']))
    for p,(key,s) in zip(sorted((p for p in others if mud_ok(p)),key=combat_order),mud):
        assignments[p['id']]=key;pool.pop(key)
    remaining=sorted((p for p in others if assignments[p['id']] is None),key=lambda p:(p['priority'],-p['hq'],p['id']))
    grass=sorted(((key,s) for key,s in pool.items() if s['zone']=='grass'),key=lambda item:(item[1]['ring'],item[1]['angle']))
    for p,(key,s) in zip(remaining,grass):assignments[p['id']]=key;pool.pop(key)
    # Fill unused mud with the best remaining low-level supporters only when
    # necessary to retain a complete draft; old risk/absence always stays grass.
    waiting=[p for p in others if assignments[p['id']] is None]
    for p in waiting:
        choices=[(key,s) for key,s in pool.items() if s['zone']=='mud' and not p['highRisk'] and p['attendanceProxy']=='inside_capital_area']
        if not choices:
            # Shared open spots may use safe supporters from shared grass.
            # Named alliances always stay within their own boundaries.
            empty=[(key,s) for key,s in pool.items() if s['zone']=='mud']
            candidates=[q for q in mutable if assignments[q['id']] and
                        sites[assignments[q['id']]]['zone']=='grass' and not q['highRisk'] and
                        q['attendanceProxy']=='inside_capital_area']
            if not empty or not candidates:raise ValueError('No eligible player for remaining mud capacity')
            q,(key,s)=min(((q,item) for q in candidates for item in empty),
                key=lambda pair:(angular_distance(pair[1][1]['angle'],
                    (sections[pair[0]['section']]['start']+sections[pair[0]['section']]['end'])/2),
                    combat_order(pair[0]),pair[1][1]['ring']))
            assignments[p['id']]=assignments[q['id']];assignments[q['id']]=key;pool.pop(key)
            continue
        key,s=min(choices,key=lambda item:item[1]['ring']);assignments[p['id']]=key;pool.pop(key)
    return sections
