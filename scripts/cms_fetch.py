#!/usr/bin/env python3
"""Build-time snapshot of the Google Sheets CMS -> data/cms/*.json.
Run by the GitHub Action (hybrid: site also fetches the CSVs live client-side).
Requires the CMS folder shared 'Anyone with the link: Viewer'.
"""
import json, os, csv, io, urllib.request
HERE=os.path.dirname(os.path.abspath(__file__))
DATA=os.path.join(HERE,"..","data")
cms=json.load(open(os.path.join(DATA,"cms.json")))
OUT=os.path.join(DATA,"cms"); os.makedirs(OUT,exist_ok=True)

def fetch_csv(sid):
    url=cms["csv_url_pattern"].format(id=sid)
    req=urllib.request.Request(url,headers={"User-Agent":"seshadri-site"})
    with urllib.request.urlopen(req,timeout=60) as r:
        text=r.read().decode("utf-8","replace")
    rows=list(csv.DictReader(io.StringIO(text)))
    # drop rows explicitly hidden or that are NOTE/example placeholders
    clean=[]
    for row in rows:
        if str(row.get("Show","")).strip().lower()=="no": continue
        if any(str(v).strip().upper()=="NOTE" for v in row.values()): continue
        clean.append({k.strip():(v.strip() if isinstance(v,str) else v) for k,v in row.items()})
    return clean

summary={}
for name,sid in cms["sheets"].items():
    try:
        rows=fetch_csv(sid)
        json.dump(rows,open(os.path.join(OUT,f"{name}.json"),"w"),indent=2,ensure_ascii=False)
        summary[name]=len(rows)
    except Exception as e:
        summary[name]=f"ERROR {e}"
print("CMS snapshot:",json.dumps(summary,indent=2))
