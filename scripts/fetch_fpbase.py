#!/usr/bin/env python3
"""Create an FPbase-backed static cache for the personal fluorescence workbench.

Requires only Python stdlib. Sources: https://www.fpbase.org/graphql/
Stores a metadata/search index and exact, attributed curves for a curated set of
common dyes/proteins. Does not make up any spectral values. Run weekly in Actions.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data' / 'fpbase-cache.json'
SEEDS = ROOT / 'data' / 'seed-probes.txt'
URL = 'https://www.fpbase.org/graphql/'
HEADER = {'Accept':'application/json','User-Agent':'fluorescence-personal-library/1.0 (+https://github.com/vubio/fluorescence)'}


def slug(text: str) -> str:
    return re.sub(r'[^\w]+', '-', text.strip().lower(), flags=re.UNICODE).strip('-')


def query(q: str) -> dict:
    params = urllib.parse.urlencode({'query':q})
    endpoint = URL + '?' + params
    if len(endpoint) < 2000:
        req = urllib.request.Request(endpoint, headers=HEADER)
    else:
        req = urllib.request.Request(URL, data=json.dumps({'query':q}).encode(), headers={**HEADER, 'Content-Type':'application/json'}, method='POST')
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=85) as res:
                raw = json.load(res)
            if raw.get('errors'):
                raise RuntimeError('; '.join(e.get('message','GraphQL error') for e in raw['errors']))
            if not raw.get('data'):
                raise RuntimeError('FPbase returned no data')
            return raw['data']
        except urllib.error.HTTPError as ex:
            if ex.code in (429,502,503,504) and attempt<3:
                delay = min(50,int(ex.headers.get('Retry-After') or (3*2**attempt)))
                print(f'FPbase HTTP {ex.code}, retrying after {delay} seconds', file=sys.stderr)
                time.sleep(delay)
                continue
            raise
        except (TimeoutError, urllib.error.URLError) as ex:
            if attempt<3:
                time.sleep(2**attempt * 3)
                continue
            raise
    raise RuntimeError('API retries exhausted')


def build_index():
    print('Fetching FPbase spectrum index…', flush=True)
    # Exact fields used in FPbase's own spectra viewer: id, category, subtype, owner.
    rows = []
    for category in ('D','P'):
        gql = '{ spectra(category: "' + category + '") { id category subtype owner { id name slug } } }'
        rows.extend(query(gql)['spectra'])
    names={}
    for row in rows:
        if row.get('category') not in ('P','D'): continue
        owner=row.get('owner') or {}
        name=owner.get('name')
        if not name: continue
        subtype=str(row.get('subtype','')).upper().replace('A_2P','2P')
        if subtype not in ('EX','AB','EM'): continue
        uid=slug(name)
        if uid not in names:
            names[uid]={'name':name,'uid':uid,'category':row['category'],'spectra':[]}
        names[uid]['spectra'].append({'id':str(row['id']), 'subtype':subtype})
    return sorted(names.values(), key=lambda d:d['name'].lower())


def get_curves(sp_ids: list[str]) -> dict[str,dict]:
    if not sp_ids:return {}
    # Keep batches modest for reliable GraphQL response sizes and FPbase rate limits.
    spectrum_fields='id data category subtype owner { name id slug ... on FluorophoreInterface { qy extCoeff exMax emMax } }'
    block=' '.join('s'+str(i)+': spectrum(id: '+str(int(sid))+') { '+spectrum_fields+' }' for i,sid in enumerate(sp_ids))
    data=query('query BatchedSpectra { '+block+' }')
    return {str(v['id']):v for v in data.values() if isinstance(v,dict) and v.get('id') is not None}


def clean(data):
    if not isinstance(data,list):return []
    pts=[]
    for pair in data:
        try:
            x=float(pair[0]);y=float(pair[1])
            if not (float('-inf')<x<float('inf') and float('-inf')<y<float('inf')):continue
            pts.append([round(x,4),round(y,7)])
        except (TypeError,ValueError,IndexError):continue
    pts.sort()
    # Keep original FPbase y values, the UI will independently normalize each curve.
    return pts


def main():
    catalog=build_index()
    print(f'Found {len(catalog)} fluorophores with spectrum metadata',flush=True)
    by_name={x['name'].casefold():x for x in catalog}
    seeds=[s.strip() for s in SEEDS.read_text().splitlines() if s.strip() and not s.startswith('#')]
    selected=[];missing=[];seen=set()
    for name in seeds:
        item=by_name.get(name.casefold())
        if item and item['uid'] not in seen:
            seen.add(item['uid']);selected.append(item)
        else: missing.append(name)
    print(f'{len(selected)} seed matches, {len(missing)} unmatched labels.',flush=True)
    all_ids=[]
    selection=[]
    for entry in selected:
        ids={}
        for sp in entry['spectra']:
            subtype=sp['subtype']
            if subtype=='EX' and 'EX' not in ids:ids['EX']=sp['id']
            if subtype=='EM' and 'EM' not in ids:ids['EM']=sp['id']
        selection.append((entry,ids))
        all_ids.extend(ids.values())
    # Deduplicate, preserving ordering
    all_ids=list(dict.fromkeys(all_ids))
    lookup={}
    for start in range(0,len(all_ids),6):
        batch=all_ids[start:start+6]
        lookup.update(get_curves(batch))
        print(f'Cached {min(start+6,len(all_ids))}/{len(all_ids)} spectral records',flush=True)
        time.sleep(.4)
    probes=[]
    for entry,ids in selection:
        rows={k:lookup.get(v) for k,v in ids.items()}
        curves={k:clean((rows.get(k) or {}).get('data')) for k in ('EX','EM')}
        if not curves.get('EX') and not curves.get('EM'):continue
        owner=next((row.get('owner') for row in rows.values() if row and row.get('owner')), {})
        probe={**entry,'curves':curves,'source':'FPbase','sourceUrl':'https://www.fpbase.org/spectra/',
               'exMax':owner.get('exMax'),'emMax':owner.get('emMax'),
               'qy':owner.get('qy'),'extCoeff':owner.get('extCoeff')}
        probes.append(probe)
    payload={'generatedAt':datetime.now(timezone.utc).isoformat(),'source':'FPbase GraphQL https://www.fpbase.org/graphql/',
             'licenseNote':'Retain attribution to FPbase and original data contributors.','catalog':catalog,'probes':probes,
             'unmatchedSeedNames':missing}
    OUT.parent.mkdir(exist_ok=True,parents=True)
    tmp=OUT.with_suffix('.tmp')
    tmp.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    os.replace(tmp,OUT)
    print(f'Wrote {OUT} ({OUT.stat().st_size/1048576:.2f} MB, {len(probes)} curated probes)',flush=True)
    if not probes:
        raise RuntimeError('FPbase returned no real spectra; refusing to pass a fake cache')

if __name__=='__main__':main()
