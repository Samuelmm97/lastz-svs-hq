"""Refresh the 2,000-player roster and move Helm into the northwest sector.

Uses the current shared draft, preserving other edits except necessary swaps.
Locations and power are fresh; attendance/shield evidence stays at the last SvS.
Writes a reviewable local proposal; never publishes or calls the live backend.
"""
import argparse
import hashlib
import json
import math
import unicodedata
from collections import Counter
from pathlib import Path
from generate_placement import ALIASES, TOP_TAGS, angular_distance


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def norm(text):
    return ''.join(c for c in unicodedata.normalize('NFKD',text.casefold()) if c.isalnum())


def signature(plan):
    return (plan['planId']+':' if plan.get('planId') else '')+'|'.join(sorted(
        f"{p['id']}@{p['x']},{p['y']}" for p in plan['placements']))


def combat_order(p):
    return (-(p['heroPower'] if p['heroPower'] is not None else -1),
            -(p['totalPower'] if p['totalPower'] is not None else -1),-p['hq'],p['id'])


def historic_attendance(record,event):
    if not record:return 'unknown'
    if record.get('zone')=='capital':return 'inside_capital_area'
    if record.get('zone')=='outside':return 'outside_capital_area'
    # Some original records omitted zone, but retained their SvS coordinates.
    # Only those historical coordinates may fill the classification gap.
    x,y=record.get('x'),record.get('y')
    if isinstance(x,(int,float)) and isinstance(y,(int,float)) and math.isfinite(x) and math.isfinite(y):
        cx,cy=event.get('center',[500,500]);radius=event.get('radius',100)
        return 'inside_capital_area' if math.hypot(x-cx,y-cy)<=radius else 'outside_capital_area'
    return 'unknown'


def propose(atlas,previous,shared,date,refresh_roster_only=False,rear_priority_only=False):
    draft=shared['draft']
    if draft['signature']!=signature(previous):
        raise ValueError('Shared draft and previous base snapshot differ')
    sites={f"{p['x']},{p['y']}":{k:p[k] for k in ('x','y','zone','ring','angle','spot') if k in p}
        for p in previous['placements']}
    before=dict(draft['assignments'])
    if len(before)!=2000 or set(before.values())!=set(sites):
        raise ValueError('Current draft is not a complete legal-site bijection')
    observations={r['id']:r for r in load(atlas/'data/shields.json')}
    event=load(atlas/'data/participation.json')
    attendance={r['id']:r for r in event['records']}
    power=load(atlas/'data/power.json')
    ranked_alliances=sorted(power.get('alliances',{}).values(),key=lambda a:a.get('alliance_power',{}).get('rank',9999))
    top_tags={a['tag'] for a in ranked_alliances[:13] if a.get('tag')}
    own_sections=top_tags|{tag for tag in previous['sections'] if tag!='Other'}
    metrics={p['atlas_id']:p for p in power['players'].values() if p.get('atlas_id') is not None}
    atlas_hqs=load(atlas/'data/hqs.json')
    hqs=[p for p in atlas_hqs if (p.get('current') is not False or p.get('roster_current')) and
         p.get('placement_eligible',True) and
         p.get('hq') is not None and observations.get(p['id'],{}).get('status')!='not_hq']
    hqs.sort(key=lambda p:(-p['hq'],0 if attendance.get(p['id'],{}).get('zone')=='capital' else 1,p['id']))
    selected=[];seen=set()
    for p in hqs:
        key=(norm(ALIASES.get(p['tag'],p['tag'])),norm(p['name']))
        if key in seen:continue
        seen.add(key);selected.append(p)
        if len(selected)==2000:break
    if len(selected)!=2000:
        raise ValueError(f'Only {len(selected)} fresh readable HQs; finish evidence review before generating')
    # The current request puts every readable Helm HQ in this sector, including
    # any small grass supporter below the ordinary 2,000-player cutoff.
    chosen_ids={p['id'] for p in selected}
    required_helm=[p for p in hqs if ALIASES.get(p['tag'],p['tag'])=='Helm' and p['id'] not in chosen_ids]
    for p in required_helm:
        index=next((i for i in range(len(selected)-1,-1,-1) if ALIASES.get(selected[i]['tag'],selected[i]['tag'])!='Helm'),None)
        if index is None:raise ValueError('Helm roster exceeds 2,000')
        selected[index]=p
    ids={p['id'] for p in selected};locks=set(draft['locks'])
    if locks-ids:
        raise ValueError('A manually locked player is outside the refreshed top 2,000: '+str(sorted(locks-ids)))
    players={}
    for p in selected:
        tag=ALIASES.get(p['tag'],p['tag'])
        status=observations.get(p['id'],{}).get('status','unscanned')
        historic=attendance.get(p['id'])
        proxy=historic_attendance(historic,event)
        metric=metrics.get(p['id'],{})
        players[p['id']]={'id':p['id'],'name':p['name'],'hq':p['hq'],'tag':tag,
            'section':tag if tag in own_sections else 'Other','shield':status,'highRisk':status=='unshielded',
            'attendanceProxy':proxy,'priority':2 if status=='unshielded' or proxy=='outside_capital_area' else 0,
            'heroPower':metric.get('total_hero_power',{}).get('value'),
            'totalPower':metric.get('personal_power',{}).get('value'),
            'totalPowerApproximate':bool(metric.get('personal_power',{}).get('approximate')),
            'nameReadingStatus':p.get('name_reading_status','readable'),
            'rosterPhoto':p.get('roster_photo'),
            'powerCaptured':power['captured_date'],'eventCaptured':'2026-09-26','oldX':p['x'],'oldY':p['y'],
            'locationCaptured':p.get('observed_date'),'hqCaptured':p.get('hq_observed_date'),
            'rosterSource':'verified alliance roster' if p.get('roster_status')=='verified_member' else 'map' if p.get('current') is not False else 'leaderboard'}
    assignments={id:key for id,key in before.items() if id in ids}
    vacants=[key for key in sites if key not in assignments.values()]
    for p,key in zip((p for p in selected if p['id'] not in assignments),vacants):
        assignments[p['id']]=key
    holder={site:id for id,site in assignments.items()}
    reserved={assignments[id] for id in locks}
    if refresh_roster_only or rear_priority_only:
        # Publish the collected roster now while the final geography is audited.
        # Retained players keep their shared positions; additions take vacancies.
        for p in players.values():
            if p['id'] in locks or sites[assignments[p['id']]]['zone']!='mud' or p['priority']!=2:continue
            candidates=[q for q in players.values() if q['id'] not in locks and q['priority']!=2 and
                        (q['hq']>=24 or q['tag']!='Helm') and sites[assignments[q['id']]]['zone']=='grass']
            if not candidates:raise ValueError('No safe grass player available to replace a new risk in mud')
            q=min(candidates,key=combat_order)
            assignments[p['id']],assignments[q['id']]=assignments[q['id']],assignments[p['id']]
        rear_report={}
        if rear_priority_only:
            from rear_priority import place_rear
            rear_report=place_rear(players,sites,assignments,locks,draft.get('sections',previous['sections']))
            # Safe, high-level attendees replace any low-level mud supporters
            # displaced by the global rear allocation.
            for p in players.values():
                if p['id'] in locks or sites[assignments[p['id']]]['zone']!='mud' or p['hq']>=24:continue
                candidates=[q for q in players.values() if q['id'] not in locks and q['priority']==0 and
                            q['hq']>=24 and sites[assignments[q['id']]]['zone']=='grass']
                if not candidates:continue
                q=min(candidates,key=combat_order)
                assignments[p['id']],assignments[q['id']]=assignments[q['id']],assignments[p['id']]
        result=[{**p,**sites[assignments[p['id']]]} for p in players.values()]
        sections={tag:{**info,'players':sum(p['section']==tag for p in result)}
                  for tag,info in draft.get('sections',previous['sections']).items()}
        for tag in own_sections-sections.keys():
            sections[tag]={'start':0,'end':2*math.pi,'players':sum(p['section']==tag for p in result)}
        proposed={**previous,'meta':{**previous['meta'],'capturedDate':date,'rosterCaptured':date,
            'powerCaptured':power['captured_date'],'eventCaptured':'2026-09-26',
            'refreshProgress':'October 1 player selection and readings published. Northwest arrangement, alliance roster reconciliation and turret space checks are continuing.',
            'selection':'Highest current readable HQ level, including all readable Helm supporters',
            'selected':2000,'topAlliances':[a['tag'] for a in ranked_alliances[:13] if a.get('tag')]},
            'sections':sections,'placements':result}
        audit_path=atlas/'data/roster-audit.json'
        if audit_path.exists():
            audit=load(audit_path)
            if audit.get('status')=='accounted_for':
                proposed['meta'].update(rosterVerifiedMembers=audit['verified_members'],
                    rosterVerifiedAlliances=len(audit['alliances']),
                    rosterApproximatePowerCount=sum(bool(m.get('personal_power',{}).get('approximate')) for m in power['players'].values()))
        proposed['meta'].update(
            atlasCount=len(atlas_hqs),
            deduplicatedCount=len({(norm(ALIASES.get(p['tag'],p['tag'])),norm(p['name'])) for p in hqs}),
            confirmedCapitalAttendees=sum(p['attendanceProxy']=='inside_capital_area' for p in result),
            priorCapitalSnapshotCount=sum(historic_attendance(r,event)=='inside_capital_area' for r in event['records']),
            attendanceNotRecorded=sum(p['attendanceProxy']=='unknown' for p in result))
        if rear_priority_only:
            proposed['meta'].update(**rear_report,
                confirmedCapitalAttendees=sum(p['attendanceProxy']=='inside_capital_area' for p in result),
                priorCapitalSnapshotCount=sum(historic_attendance(r,event)=='inside_capital_area' for r in event['records']),
                attendanceNotRecorded=sum(p['attendanceProxy']=='unknown' for p in result),
                allianceGrouping='Preferred alliance areas; previous SvS rear priority overrides grouping',
                refreshProgress='October 1 roster and power published. Confirmed prior absences and unshielded players use back grass. Unknown attendance is labeled and has no back penalty. Roster reconciliation and turret checks continue.')
        digest=hashlib.sha256(json.dumps(proposed,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()[:16]
        proposed['planId']='roster-'+date+'-'+digest
        next_draft={**draft,'signature':signature(proposed),'assignments':list(assignments.items())}
        report={'basedOnRevision':shared['revision'],'players':2000,'helm':sum(p['tag']=='Helm' for p in result),
            'rosterAdded':sorted(ids-set(before)),'rosterRemoved':sorted(set(before)-ids),
            'retainedPlayersMoved':sum(before[id]!=key for id,key in assignments.items() if id in before),
            'status':'rear_priority_published' if rear_priority_only else 'roster_checkpoint_layout_pending',**rear_report}
        return proposed,next_draft,report
    strike_ids={p['strike'] for p in draft['pairs']}
    reserve_ids={p['reserve'] for p in draft['pairs']}
    target=315*math.pi/180
    def mud_eligible(p):
        return p['hq']>=24 and not p['highRisk'] and p['attendanceProxy']!='outside_capital_area'
    mud_players=sorted((p for p in players.values() if p['tag']=='Helm' and mud_eligible(p)
                        and p['id'] not in strike_ids and p['id'] not in locks),key=combat_order)
    mud=[(key,s) for key,s in sites.items() if s['zone']=='mud' and key not in reserved]
    if len(mud_players)>len(mud):raise ValueError('Not enough unreserved mud positions for Helm HQ24+')
    by_angle=sorted(mud,key=lambda item:(angular_distance(item[1]['angle'],target),item[1]['ring']))
    # Smallest centered angular envelope that contains enough legal slots.
    cutoff=angular_distance(by_angle[len(mud_players)-1][1]['angle'],target) if mud_players else 0
    sector=[item for item in mud if angular_distance(item[1]['angle'],target)<=cutoff+1e-9]
    chosen=sorted(sector,key=lambda item:(item[1]['ring'],angular_distance(item[1]['angle'],target),item[1]['angle']))[:len(mud_players)]

    def move(id,key):
        other=holder[key];old=assignments[id]
        if other!=id and other in locks:raise ValueError('Target conflicts with a manual lock')
        assignments[id]=key;assignments[other]=old
        holder[key]=id;holder[old]=other

    for p,(key,site) in zip(mud_players,chosen):move(p['id'],key)
    grass_players=sorted((p for p in players.values() if p['tag']=='Helm' and not mud_eligible(p)
                          and p['id'] not in locks and p['id'] not in reserve_ids),
                         key=lambda p:(p['priority'],-p['hq'],p['id']))
    grass=[(key,s) for key,s in sites.items() if s['zone']=='grass' and key not in reserved]
    all_grass=[players[id] for id,key in assignments.items() if sites[key]['zone']=='grass']
    priority_counts=Counter(p['priority'] for p in all_grass)
    rings=sorted(s['ring'] for key,s in grass)
    lower={0:37,1:rings[min(len(rings)-1,priority_counts[0])],
           2:rings[min(len(rings)-1,priority_counts[0]+priority_counts[1])]}
    envelope=max(cutoff,30*math.pi/180)
    occupied=set()
    for p in grass_players:
        choices=[(key,s) for key,s in grass if key not in occupied and
                 angular_distance(s['angle'],target)<=envelope and s['ring']>=lower[p['priority']]]
        if not choices:
            raise ValueError('Northwest grass lacks slots for the previous SvS priority group')
        key,site=min(choices,key=lambda item:(item[1]['ring'],angular_distance(item[1]['angle'],target)))
        move(p['id'],key);occupied.add(key)
    for pair in draft['pairs']:
        if pair['strike'] not in ids or pair['reserve'] not in ids:
            raise ValueError('Swap pair member missing from fresh roster')
        if sites[assignments[pair['strike']]]['zone']!='grass' or sites[assignments[pair['reserve']]]['zone']!='mud':
            raise ValueError('Swap pair terrain would change')
    result=[{**p,**sites[assignments[p['id']]]} for p in players.values()]
    if len(set(assignments.values()))!=2000:raise ValueError('Placement collision')
    for p in result:
        if p['tag']=='Helm' and p['id'] not in locks and p['id'] not in strike_ids|reserve_ids:
            if mud_eligible(p)!=(p['zone']=='mud'):raise ValueError('Helm eligibility/previous SvS terrain rule failed')
    sections={tag:{**info,'players':sum(p['section']==tag for p in result)}
              for tag,info in previous['sections'].items()}
    for tag in top_tags-sections.keys():
        sections[tag]={**previous['sections'].get('Other',{'start':0,'end':2*math.pi}),
                       'players':sum(p['section']==tag for p in result)}
    sections.setdefault('Helm',{})
    sections['Helm'].update(start=target-envelope,end=target+envelope,players=sum(p['tag']=='Helm' for p in result))
    from alliance_layout import align_alliances
    sections=align_alliances(players,sites,assignments,locks,sections,
        [a['tag'] for a in ranked_alliances[:13] if a.get('tag')],combat_order)
    from rear_priority import place_rear
    rear_report=place_rear(players,sites,assignments,locks,sections)
    result=[{**p,**sites[assignments[p['id']]]} for p in players.values()]
    proposed={**previous,'meta':{**previous['meta'],'capturedDate':date,'powerCaptured':power['captured_date'],
        'eventCaptured':'2026-09-26','selected':2000,'helmCenterDegrees':315,
        **rear_report,'allianceGrouping':'Preferred alliance areas; previous SvS rear priority overrides grouping',
        'refreshProgress':'October 1 roster and power published. Confirmed prior absences and unshielded players use back grass. Unknown attendance is labeled and has no back penalty. Roster reconciliation and turret checks continue.',
        'helmMudEnvelopeDegrees':round(cutoff*360/math.pi,2),
        'selection':'Highest fresh readable HQ level, including all readable Helm supporters; previous SvS attendance then stable atlas ID break ties',
        'mudRanking':'Total hero power, personal/total power, HQ level; unknown metrics follow known values',
        'grassRanking':'Previous SvS priority group then HQ level',
        'topAlliances':[a['tag'] for a in ranked_alliances[:13] if a.get('tag')],
        'source':'Fresh State 798 atlas/leaderboards; previous SvS shield and participation snapshot'},
        'sections':sections,'placements':result}
    digest=hashlib.sha256(json.dumps(proposed,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()[:16]
    proposed['planId']='atlas-'+date+'-'+digest
    next_draft={'version':1,'signature':signature(proposed),'assignments':list(assignments.items()),
                'locks':draft['locks'],'pairs':draft['pairs']}
    report={'basedOnRevision':shared['revision'],'players':2000,'helm':sum(p['tag']=='Helm' for p in result),
        'helmMud':sum(p['tag']=='Helm' and p['zone']=='mud' for p in result),
        'helmGrass':sum(p['tag']=='Helm' and p['zone']=='grass' for p in result),
        'rosterAdded':sorted(ids-set(before)),'rosterRemoved':sorted(set(before)-ids),
        'retainedPlayersMoved':sum(before[id]!=key for id,key in assignments.items() if id in before),
        'nonHelmMoved':sum(before.get(p['id'])!=assignments[p['id']] for p in players.values() if p['tag']!='Helm' and p['id'] in before),
        'missingMudHeroPower':[p['name'] for p in result if p['tag']=='Helm' and p['zone']=='mud' and p['heroPower'] is None],
        'helmMudEnvelopeDegrees':proposed['meta']['helmMudEnvelopeDegrees']}
    report['helmBelowCutoffIncluded']=[p['name'] for p in required_helm]
    return proposed,next_draft,report


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--atlas',type=Path,required=True)
    p.add_argument('--previous-plan',type=Path,required=True)
    p.add_argument('--shared',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--date',default='2026-10-01')
    p.add_argument('--refresh-roster-only',action='store_true')
    p.add_argument('--rear-priority-only',action='store_true')
    args=p.parse_args()
    previous=load(args.previous_plan);shared=load(args.shared)
    plan,draft,report=propose(args.atlas,previous,shared,args.date,args.refresh_roster_only,args.rear_priority_only)
    args.output.mkdir(parents=True,exist_ok=True)
    for name,data in [('placement-plan.json',plan),('placement-draft.json',draft),('placement-review.json',report),
        ('migration-request.json',{'baseRevision':shared['revision'],'previousPlan':previous,'plan':plan,'draft':draft,'editor':'Atlas refresh / Helm northwest layout'})]:
        (args.output/name).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))


if __name__=='__main__':main()
