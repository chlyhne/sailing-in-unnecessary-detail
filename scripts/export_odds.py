"""Export prospective seasonal ranking-model odds from the redress race data.

Requires NumPy/SciPy; use the adjacent Onsdagsbanen Python environment.
The website consumes the JSON and has no Python/server dependency.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import numpy as np
from scipy.special import ndtri, softmax
from scipy.stats import qmc
from ranking_odds import fit, probabilities, probability_interval, ranking_orders


def fleet_probabilities(mean,covariance,eligible):
    result=np.zeros(len(mean))
    if not len(eligible): return result
    if len(eligible)==1: result[eligible[0]]=1.;return result
    sub=covariance[np.ix_(eligible,eligible)]
    # Fixed Sobol integration: reproducible joint-posterior average, not plug-in MAP.
    u=qmc.Sobol(d=len(eligible),scramble=True,seed=4821).random_base2(13)
    z=ndtri(np.clip(u,1e-12,1-1e-12))
    samples=mean[eligible]+z @ np.linalg.cholesky(sub).T
    result[eligible]=softmax(samples,axis=1).mean(axis=0)
    return result


def export(source,target,config):
    with source.open() as handle: rows=[r for r in csv.DictReader(handle) if int(r['year']) in (2025,2026)]
    prior_sd=float(config['prior_sd'])
    groups=[]
    for group in sorted({r['group'] for r in rows}):
        seasons=[]
        for year in sorted({int(r['year']) for r in rows if r['group']==group}):
            subset=[r for r in rows if r['group']==group and int(r['year'])==year]
            names=sorted({r['competitor'] for r in subset});ids={name:i for i,name in enumerate(names)};n=len(names)
            count=np.zeros(n,dtype=int);wins=np.zeros((n,n),dtype=int);meetings=np.zeros((n,n),dtype=int)
            mean=np.zeros(n);races=[];snapshots=[]
            for date in sorted({r['race_date'] for r in subset}):
                day=[r for r in subset if r['race_date']==date]
                if len({r['competitor'] for r in day})!=len(day):raise ValueError('Duplicate boat rows')
                finished=[r for r in day if r['observed'].lower()=='true']
                finish_ids=np.array([ids[r['competitor']] for r in finished],dtype=int)
                times=np.array([float(r['beregnet_seconds']) for r in finished])
                if not np.isfinite(times).all() or np.any(times<=0):raise ValueError('Invalid finish times')
                if len(finish_ids)>=2:races.append(ranking_orders(finish_ids,times))
                count[finish_ids]+=1
                for a,ta in zip(finish_ids,times):
                    for b,tb in zip(finish_ids,times):
                        if a!=b:
                            meetings[a,b]+=1
                            wins[a,b]+=int(ta<tb)
                mean,covariance=fit(races,n,prior_sd,mean)
                p=probabilities(mean,covariance);low,high=probability_interval(mean,covariance)
                eligible=np.flatnonzero(count>=3)
                fleet=fleet_probabilities(mean,covariance,eligible)
                boats=[{'id':ids[r['competitor']], 'finishes':int(count[ids[r['competitor']]]),
                        'status':'FIN' if r['observed'].lower()=='true' else (r['status'] or 'No time')} for r in day]
                snapshots.append({'date':date,'race':day[0]['race_local'],'boats':boats,
                    'pairProbability':np.round(p,8).tolist(),'pairLow':np.round(low,8).tolist(),'pairHigh':np.round(high,8).tolist(),
                    'pairWins':wins.tolist(),'pairMeetings':meetings.tolist(),'fleetProbability':np.round(fleet,8).tolist()})
            seasons.append({'year':year,'names':names,'snapshots':snapshots})
            print(f'Exported {group} {year}',flush=True)
        groups.append({'name':group,'seasons':seasons})
    payload={'version':2,'through':max(r['race_date'] for r in rows),'source':source.name,
        'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
        'model':'Seasonal Plackett–Luce with Normal prior and joint Laplace posterior',
        'priorSd':prior_sd,'tuningYears':config['tuning_years'],'minimumFinishes':3,
        'basis':'Handicap-corrected finishing order; same course; conditional on finishing.',
        'history':'Within-season expanding history. Prior scale selected on 2025; 2026 uses no future results. The 2025 curve is retrospective with respect to tuning.',
        'groups':groups}
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n')
    print(target)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    root=Path(__file__).resolve().parents[1]
    p.add_argument('--source',type=Path,default=root/'_data/odds/results.csv')
    p.add_argument('--config',type=Path,default=root/'odds/model-config.json')
    p.add_argument('--output',type=Path,default=root/'odds/data.json')
    args=p.parse_args();export(args.source,args.output,json.loads(args.config.read_text()))
