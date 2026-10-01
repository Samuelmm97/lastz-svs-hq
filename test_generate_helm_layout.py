import json
import math
from pathlib import Path
import tempfile
import unittest
from generate_helm_layout import propose, signature


class LayoutTests(unittest.TestCase):
    def test_new_roster_keeps_geometry_and_event_evidence(self):
        previous=json.loads(Path(__file__).with_name('placement-plan.json').read_text(encoding='utf-8'))
        shared={'revision':11,'draft':{'signature':signature(previous),
            'assignments':[[p['id'],f"{p['x']},{p['y']}"] for p in previous['placements']],
            'locks':[],'pairs':[]}}
        with tempfile.TemporaryDirectory() as folder:
            atlas=Path(folder);(atlas/'data').mkdir()
            hqs=[{**p,'x':800,'y':800,'current':True} for p in previous['placements']]
            added=[{'id':10000+i,'name':f'Fresh Helm {i}','tag':'Helm','hq':27,
                    'x':100,'y':100,'current':True} for i in range(15)]
            hqs.extend(added)
            event={'captured_date':'2026-09-26','records':[
                {'id':p['id'],'zone':'capital' if p['priority']==0 else 'outside'} for p in previous['placements']
                if p['priority']==0 or p['attendanceProxy']=='outside_capital_area']}
            shields=[{'id':p['id'],'status':p['shield']} for p in previous['placements']]
            power={'captured_date':'2026-10-01','players':{
                str(p['id']):{'atlas_id':p['id'],'total_hero_power':{'value':10000000-i},
                    'personal_power':{'value':100000000-i}} for i,p in enumerate(added)}}
            for name,data in [('hqs',hqs),('shields',shields),('participation',event),('power',power)]:
                (atlas/'data'/f'{name}.json').write_text(json.dumps(data),encoding='utf-8')
            plan,draft,report=propose(atlas,previous,shared,'2026-10-01')
            self.assertEqual(len(plan['placements']),2000)
            self.assertEqual(len(set(site for id,site in draft['assignments'])),2000)
            self.assertEqual(set(site for id,site in shared['draft']['assignments']),
                             set(site for id,site in draft['assignments']))
            by_id={p['id']:p for p in plan['placements']}
            for p in added:
                self.assertEqual(by_id[p['id']]['zone'],'mud')
                self.assertEqual(by_id[p['id']]['attendanceProxy'],'unknown')
            for p in previous['placements']:
                if p['id'] in by_id:
                    self.assertEqual(by_id[p['id']]['highRisk'],p['highRisk'])
                    if p['tag']=='Helm' and p['highRisk']:
                        self.assertEqual(by_id[p['id']]['zone'],'grass')
            known=sorted((by_id[p['id']] for p in added),key=lambda p:-p['heroPower'])
            self.assertEqual([p['ring'] for p in known],sorted(p['ring'] for p in known))
            self.assertTrue(plan['planId'].startswith('atlas-2026-10-01-'))
            self.assertEqual(draft['signature'],signature(plan))
            self.assertEqual(report['basedOnRevision'],11)
            rear=[p for p in plan['placements'] if p['highRisk'] or p['attendanceProxy']=='outside_capital_area']
            ordinary=[p for p in plan['placements'] if p['zone']=='grass' and p not in rear]
            self.assertTrue(all(p['zone']=='grass' for p in rear))
            self.assertGreaterEqual(min(p['ring'] for p in rear),max(p['ring'] for p in ordinary))


if __name__=='__main__':unittest.main()
