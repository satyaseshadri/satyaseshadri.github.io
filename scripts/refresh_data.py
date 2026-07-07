#!/usr/bin/env python3
"""Refresh publications.json + collaborators.json from OpenAlex.
Runs on a schedule via GitHub Actions (see .github/workflows/refresh-data.yml).
No API key needed. Respects a polite mailto. Merges manual overrides.
"""
import json, os, sys, time, urllib.request, urllib.parse
from collections import defaultdict

HERE=os.path.dirname(os.path.abspath(__file__))
DATA=os.path.join(HERE,"..","data")
cfg=json.load(open(os.path.join(DATA,"config.json")))
MAILTO=cfg.get("mailto","satya@iitm.ac.in")

def api(url):
    req=urllib.request.Request(url,headers={"User-Agent":f"seshadri-site (mailto:{MAILTO})"})
    with urllib.request.urlopen(req,timeout=60) as r:
        return json.load(r)

def resolve_author():
    aid=cfg.get("openalex_author_id","")
    if aid and aid!="CONFIRM" and aid.startswith("A"): return aid
    orcid=cfg.get("orcid","")
    if orcid and orcid!="CONFIRM":
        d=api(f"https://api.openalex.org/authors/https://orcid.org/{orcid}")
        return d["id"].split("/")[-1]
    # fallback: search by name, pick IITM affiliation
    q=urllib.parse.quote(cfg["name"])
    d=api(f"https://api.openalex.org/authors?search={q}&mailto={MAILTO}")
    for a in d.get("results",[]):
        inst=(a.get("last_known_institutions") or [{}])
        if any("madras" in (i.get("display_name","").lower()) for i in inst):
            return a["id"].split("/")[-1]
    return d["results"][0]["id"].split("/")[-1] if d.get("results") else None

def abstract(inv):
    if not inv: return ""
    pos={}
    for w,idxs in inv.items():
        for i in idxs: pos[i]=w
    words=[pos[i] for i in sorted(pos)]
    s=" ".join(words)
    return (s[:240]+"…") if len(s)>240 else s

def main():
    aid=resolve_author()
    if not aid:
        print("Could not resolve OpenAlex author id; set it in config.json"); sys.exit(1)
    print("OpenAlex author:",aid)
    pubs=[]; cursor="*"
    while cursor:
        url=(f"https://api.openalex.org/works?filter=author.id:{aid}"
             f"&per-page=200&cursor={urllib.parse.quote(cursor)}&mailto={MAILTO}")
        d=api(url);
        for w in d["results"]:
            authors=[a["author"]["display_name"] for a in w.get("authorships",[])]
            co=[a for a in authors if "seshadri" not in a.lower()]
            pubs.append({"id":w["id"].split("/")[-1],"type":w.get("type","article"),
                "title":w.get("title") or "","authors":authors,"coauthors":co,
                "venue":(w.get("primary_location") or {}).get("source",{}).get("display_name","") if w.get("primary_location") else "",
                "year":w.get("publication_year"),"cite":w.get("cited_by_count"),
                "doi":w.get("doi") or "","summary":abstract(w.get("abstract_inverted_index")),
                "openalex":w["id"]})
        cursor=d["meta"].get("next_cursor"); time.sleep(0.2)
    pubs.sort(key=lambda p:(-(p["year"] or 0)))

    # collaborators
    col=defaultdict(lambda:{"papers":0,"years":[],"name":"","orcid":"","inst":"","oa":""})
    # need authorships detail for orcid/inst — refetch light map from authorships in works above is limited;
    # here we aggregate names; enrichment (orcid/inst) can be a second pass per author id.
    for p in pubs:
        for a in p["coauthors"]:
            k=a.lower().strip(); col[k]["papers"]+=1; col[k]["name"]=a
            if p["year"]: col[k]["years"].append(p["year"])
    collab=[]
    for k,v in col.items():
        yrs=[y for y in v["years"] if isinstance(y,int)]
        collab.append({"name":v["name"],"joint_papers":v["papers"],
            "latest_year":max(yrs) if yrs else None,"institution":"","orcid":"","openalex":"","link_override":""})
    collab.sort(key=lambda x:(-x["joint_papers"],-(x["latest_year"] or 0)))

    # merge overrides
    def load(fn):
        p=os.path.join(DATA,fn); return json.load(open(p)) if os.path.exists(p) else {}
    ov_pub=load("publications.overrides.json"); ov_col=load("collaborators.overrides.json")
    hide=set(ov_pub.get("hide",[]));
    pubs=[p for p in pubs if p["id"] not in hide]+ov_pub.get("add",[])
    link_by_name={c["name"].lower():c.get("link_override","") for c in ov_col.get("collaborators",[])}
    for c in collab:
        if c["name"].lower() in link_by_name: c["link_override"]=link_by_name[c["name"].lower()]

    # detect new since last run
    prev=load("publications.json").get("publications",[])
    prev_ids={p.get("id") for p in prev}
    new=[p for p in pubs if p["id"] not in prev_ids]
    json.dump({"generated_from":"OpenAlex","author":aid,"count":len(pubs),"publications":pubs},
              open(os.path.join(DATA,"publications.json"),"w"),indent=2,ensure_ascii=False)
    json.dump({"count":len(collab),"collaborators":collab},
              open(os.path.join(DATA,"collaborators.json"),"w"),indent=2,ensure_ascii=False)
    print(f"pubs={len(pubs)} collaborators={len(collab)} NEW_THIS_RUN={len(new)}")
    for p in new[:20]: print("  NEW:",p["year"],p["title"][:80])

if __name__=="__main__":
    main()
