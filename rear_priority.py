"""Previous SvS risk overrides alliance grouping: reserve the farthest grass."""
from generate_placement import angular_distance


def rear_player(player):
    return player['highRisk'] or player['attendanceProxy']=='outside_capital_area'


def place_rear(players,sites,assignments,locks,sections):
    people=sorted((p for id,p in players.items() if id not in locks and rear_player(p)),
                  key=lambda p:(-p['hq'],p['id']))
    reserved={assignments[id] for id in locks}
    grass=sorted(((key,s) for key,s in sites.items() if s['zone']=='grass' and key not in reserved),
                 key=lambda item:(-item[1]['ring'],item[1]['angle']))
    if len(grass)<len(people):raise ValueError('Not enough unreserved rear grass spots')
    rear=dict(grass[:len(people)])
    holder={key:id for id,key in assignments.items()}
    for p in people:
        area=sections.get(p['section'],{'start':0,'end':0})
        center=(area['start']+area['end'])/2
        key=min(rear,key=lambda key:(rear[key]['ring'],angular_distance(rear[key]['angle'],center)))
        old=assignments[p['id']];other=holder[key]
        assignments[p['id']]=key;assignments[other]=old
        holder[key]=p['id'];holder[old]=other
        rear.pop(key)
    rings=[sites[assignments[p['id']]]['ring'] for p in people]
    return {'rearPlayers':len(people),'rearGrassMinRing':min(rings) if rings else None,
            'manualRearOverrides':[id for id in locks if rear_player(players[id])]}
