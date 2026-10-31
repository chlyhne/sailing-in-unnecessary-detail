"""Low-frequency Manage2Sail polling. Standard library only; no model fitting.

Default: Wednesday evening in Copenhagen, configured event year only. --force
is a manual override for the time window, cooldown and two-check settling rule.
Candidates go to an ignored cache; production source/data are never edited here.
"""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import unicodedata
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
FIELDS=['year','group','race_date','race_local','competitor','observed','status','beregnet_seconds']
NON_FINISH={'DNF','DNS','DNC','DSQ','DNE','RET','OCS','UFD','BFD','NSC','RDG'}


def normal(value):
    s=unicodedata.normalize('NFKD',str(value))
    return re.sub(r'[^a-z0-9]+',' ',''.join(c for c in s if not unicodedata.combining(c)).lower()).strip()


def permitted(now,config):
    local=now.astimezone(ZoneInfo(config['timezone']))
    return (local.year==config['year'] and local.weekday()==config['weekday']
            and config['start_hour']<=local.hour<config['end_hour'])


def read_json(path,default):
    return json.loads(path.read_text()) if path.exists() else default


def save_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');tmp.replace(path)


class CachedHTTP:
    def __init__(self,cache):self.cache=cache
    def get(self,url):
        old=self.cache.get(url,{})
        headers={'User-Agent':'SailingInUnnecessaryDetail-Odds/1.0','Accept':'application/json,text/html'}
        if old.get('etag'):headers['If-None-Match']=old['etag']
        if old.get('modified'):headers['If-Modified-Since']=old['modified']
        try:
            with urlopen(Request(url,headers=headers),timeout=30) as response:
                body=response.read().decode('utf-8')
                self.cache[url]={'body':body,'etag':response.headers.get('ETag'),'modified':response.headers.get('Last-Modified')}
                return body
        except HTTPError as error:
            if error.code==304 and 'body' in old:return old['body']
            raise


def discover(config,get):
    html=get(config['event_url'].split('#',1)[0])
    event=re.search(r"window\.SailingInfo\.eventId\s*=\s*'([^']+)'",html)
    boot=re.search(r'window\.boostrapedResourceData\s*=\s*(\{[\s\S]*?\})\s*;\s*</script>',html,re.I)
    if not event or not boot:raise ValueError('Manage2Sail event bootstrap changed')
    entries=json.loads(boot[1]).get('Regatta',[])
    classes={normal(r.get('Name','')):r['Id'] for r in entries if r.get('Id')}
    result={}
    for names in config['groups'].values():
        for name in names:
            if normal(name) not in classes:raise ValueError(f'Missing configured class: {name}')
            result[name]=f"https://www.manage2sail.com/api/event/{event[1]}/regattaresult/{classes[normal(name)]}"
    return result


def seconds(result):
    raw=result.get('CorrectedTimeMs')
    if isinstance(raw,(int,float)) and not isinstance(raw,bool):
        value=raw/1000
    else:
        raw=str(result.get('CorrectedTime') or '')
        m=re.fullmatch(r'(\d+):(\d{2}):(\d{2})(?:\.(\d+))?',raw.strip())
        if not m:return None
        value=int(m[1])*3600+int(m[2])*60+int(m[3])+float('0.'+(m[4] or '0'))
    return value if math.isfinite(value) and value>0 else None


def csv_text(rows):
    rows=sorted(rows,key=lambda r:(int(r['year']),r['group'],r['race_date'],r['race_local'],r['competitor']))
    out=io.StringIO();w=csv.DictWriter(out,fieldnames=FIELDS,lineterminator='\n');w.writeheader();w.writerows(rows)
    return out.getvalue()


def parse_payloads(payloads,config,previous,now,identity_map):
    year=config['year'];today=now.astimezone(ZoneInfo(config['timezone'])).date().isoformat()
    aliases={}
    for row in previous:
        if int(row['year'])==year:
            key=(row['group'],normal(row['competitor']))
            if key in aliases and aliases[key]!=row['competitor']:raise ValueError('Ambiguous existing competitor identity')
            aliases[key]=row['competitor']
    output=[]
    for group,classes in config['groups'].items():
        dates={};by_class={}
        for name in classes:
            payload=payloads[name]
            if not isinstance(payload.get('EntryResults'),list) or not isinstance(payload.get('RaceInfos'),list):
                raise ValueError(f'Incomplete class payload: {name}')
            for info in payload['RaceInfos']:
                index=info.get('RaceIndex');raw=str(info.get('StartDate') or '')[:10]
                if not raw:
                    text=str(info.get('StartDateWithTime') or '')
                    try:raw=datetime.strptime(text,'%m/%d/%Y %H:%M:%S').date().isoformat()
                    except ValueError:continue
                try:parsed=datetime.fromisoformat(raw)
                except ValueError:raise ValueError('Invalid race date')
                if not isinstance(index,int) or parsed.year!=year or raw>today:continue
                if index in dates and dates[index]!=raw:raise ValueError('Class race dates disagree')
                dates[index]=raw
            entries=[]
            for entry in payload['EntryResults']:
                if not isinstance(entry,dict) or not entry.get('TeamName'):raise ValueError('Missing competitor name')
                original=entry['TeamName'].strip()
                identity=f"{year}:{group}:{entry.get('Id') or normal(original)}"
                competitor=identity_map.get(identity) or aliases.get((group,normal(original))) or original
                identity_map[identity]=competitor
                raw=entry.get('EntryRaceResults')
                if not isinstance(raw,list):raise ValueError('Missing entry results')
                results={r['OverallRaceIndex']:r for r in raw if isinstance(r,dict) and isinstance(r.get('OverallRaceIndex'),int)}
                entries.append((competitor,results))
            by_class[name]=entries
        for index,date in sorted(dates.items()):
            race=[];complete=True
            for name in classes:
                if not by_class[name]:complete=False
                for competitor,results in by_class[name]:
                    result=results.get(index)
                    if result is None and results and index<min(results):
                        # A later entrant has no records before their first race.
                        result={'RaceStatusCode':'DNC'}
                    if result is None:complete=False;continue
                    status=str(result.get('RaceStatusCode') or '').upper().strip()
                    value=seconds(result)
                    if value is None and not status:complete=False;continue
                    observed=value is not None and status not in NON_FINISH
                    race.append(dict(year=str(year),group=group,race_date=date,race_local=f'R{index}',competitor=competitor,
                        observed=str(observed),status=status,beregnet_seconds=str(float(value)) if observed else ''))
            # Entire course-race must be entered across all configured classes.
            if complete and any(r['observed']=='True' for r in race):output.extend(race)
    keys=[(r['group'],r['race_local'],r['competitor']) for r in output]
    if len(set(keys))!=len(keys):raise ValueError('Duplicate competitor in combined course')
    old_races={(r['group'],r['race_local'],r['race_date']) for r in previous if int(r['year'])==year}
    new_races={(r['group'],r['race_local'],r['race_date']) for r in output}
    if old_races-new_races:raise ValueError(f'Refusing incomplete/regressed results: previously published races are missing: {sorted(old_races-new_races)}')
    if not output:raise ValueError('No complete finished races found')
    return [r for r in previous if int(r['year'])!=year]+output


def refresh(config,source,cache_dir,now,force=False,get=None):
    if not force and not permitted(now,config):return {'changed':False,'reason':'outside Wednesday evening / configured year'}
    state_path=cache_dir/'state.json';state=read_json(state_path,{})
    fingerprint=hashlib.sha256(json.dumps(config,sort_keys=True).encode()).hexdigest()
    if state.get('config')!=fingerprint:state={'config':fingerprint,'http':{},'identities':{}}
    if not force and state.get('checked'):
        age=(now-datetime.fromisoformat(state['checked'])).total_seconds()
        if age<config['minimum_interval_minutes']*60:return {'changed':False,'reason':'cooldown'}
    state.setdefault('identities',{}).update(read_json(source.parent/'identities.json',{}))
    http=CachedHTTP(state.setdefault('http',{}));fetch=get or http.get
    # Refresh class IDs once per local week; reuse them between checks.
    week=now.astimezone(ZoneInfo(config['timezone'])).strftime('%G-%V')
    if state.get('discovery_week')!=week:
        state['urls']=discover(config,fetch);state['discovery_week']=week
    try:
        payloads={name:json.loads(fetch(url)) for name,url in state['urls'].items()}
        with source.open() as handle:previous=list(csv.DictReader(handle))
        rows=parse_payloads(payloads,config,previous,now,state.setdefault('identities',{}))
    except Exception:
        state['checked']=now.isoformat()
        state['stable']=0
        save_json(state_path,state)
        raise
    candidate=csv_text(rows);digest=hashlib.sha256(candidate.encode()).hexdigest()
    unchanged=candidate==csv_text(previous)
    checks=state.get('stable',0)+1 if state.get('candidate')==digest else 1
    state.update(checked=now.isoformat(),candidate=digest,stable=checks)
    save_json(state_path,state)
    if unchanged:return {'changed':False,'reason':'results unchanged'}
    if not force and checks<config['stable_checks']:return {'changed':False,'reason':'waiting for second stable check'}
    candidate_path=cache_dir/'candidate.csv';candidate_path.write_text(candidate)
    save_json(cache_dir/'candidate-identities.json',state['identities'])
    return {'changed':True,'reason':'new or corrected results','candidate':str(candidate_path)}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config',type=Path,default=ROOT/'_data/odds/update-config.json')
    p.add_argument('--source',type=Path,default=ROOT/'_data/odds/results.csv')
    p.add_argument('--cache-dir',type=Path,default=ROOT/'.cache/odds')
    p.add_argument('--force',action='store_true')
    p.add_argument('--window-only',action='store_true')
    args=p.parse_args();config=read_json(args.config,{})
    if config.get('year') not in (2025,2026):raise ValueError('This odds model is restricted to 2025 and 2026')
    now=datetime.now(timezone.utc)
    if args.window_only:result={'allowed':args.force or permitted(now,config)}
    else:result=refresh(config,args.source,args.cache_dir,now,args.force)
    print(json.dumps(result))
    if os.getenv('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'],'a') as output:
            for key,value in result.items():
                output.write(f'{key}={str(value).lower() if isinstance(value,bool) else value}\n')


if __name__=='__main__':main()
