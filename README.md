# Website Build — site, data & auto-update

## The site (rebuilt July 2026 — Wikipedia-style design)

A complete multi-page static site lives at this folder's root — no build step, no backend. Design: encyclopedic/Wikipedia-inspired — white article pages, right-hand infobox, Contents box, wikitables, footnote references; IITM maroon as the fine accent.

- **Pages:** `index` (biography article) · `research` · `publications` · `patents` · `collaborators` (academic + industry tabs) · `ventures` · `leadership` · `impact` · `people` (students/alumni) · `talks-media` · `contact` · plus CMS-defined pages at `index.html?p=TabName`
- **Behaviour:** `js/site.js` — publications with hover/tap summary popovers (hover previews, click pins), filters and search; patents; collaborators; student tabs; all from `data/*.json`, curated/extended by the Google Sheets CMS.
- **Assets:** `assets/headshot.jpg` (from YuvaSSB DSC_9897).

### CMS v2 — ONE spreadsheet, dynamic tabs (upgrade path)
`data/Satya_Website_CMS_v2.xlsx` is a ready-made consolidated workbook: the 9 existing content tabs (data migrated) **plus** three special tabs:
- **_Pages** — each row turns a tab into a website page (Tab, Title, NavLabel, Order, Layout: table/list/cards, Intro, Show). Add a new tab + one _Pages row → new page appears in the site menu automatically.
- **_Content** — edit the narrative text of existing pages (Key ↔ `data-cms` blocks; leave Value empty to keep built-in text).
- **_Assets** — swap images without code (Key ↔ `data-asset`; paste a Google Drive image file ID).

**To activate:** upload the xlsx to Google Drive → open → File → *Save as Google Sheets* → Share: "Anyone with the link: Viewer" → copy the spreadsheet ID from its URL into `spreadsheet_id` in `data/cms.json`. Until then the site keeps using the legacy 9-sheet CMS + snapshots.

**Note:** CMS-created pages render via `index.html?p=TabName` — no extra file needed. (OneDrive blocks creating new files at this folder's root, so the separate `page.html` was dropped; the renderer is built into every page.)

### Preview locally
```
cd "Website Build" && python3 -m http.server 8000
```
then open http://localhost:8000. (Opening index.html directly via file:// won't load the JSON data — browsers block fetch on file URLs.)

### Deploy
Push this folder to a GitHub repo → enable GitHub Pages (or drag the folder into Netlify). Then copy `github-workflow--refresh-data.yml` to `.github/workflows/` for the daily OpenAlex refresh.

### Remaining to-dos for the owner
1. ~~Set ORCID / OpenAlex author ID~~ Done (ORCID 0000-0002-4851-302X → OpenAlex A5009732639). **CAUTION:** the OpenAlex record conflates him with S.K. Seshadri (IITM metallurgy) — do not enable the auto-refresh Action until that record is disambiguated (see `openalex_warning` in `data/config.json`).
2. Share the Google Drive "Satya Website CMS" folder as **Anyone with the link: Viewer** (live CMS currently returns 401, so the site uses fallbacks).
3. Enrich `data/students.json` (positions, links) and `data/collaborators.overrides.json` (LinkedIn URLs).
4. Optional: add institutional logos (IIT Madras, Shell, Kotak, Coal India, Deakin) to `assets/` and a "featured in" band on the homepage.

---

This folder holds the structured data that drives the dynamic parts of the site (publications, collaborators, patents, students) plus the script + GitHub Action that keep it current.

```
Website Build/
├─ data/
│  ├─ config.json                     # author IDs + settings (SET OpenAlex/ORCID id here)
│  ├─ publications.json               # AUTO — seeded from your records, refreshed from OpenAlex
│  ├─ publications.overrides.json     # MANUAL — pin/add/hide items (optional)
│  ├─ collaborators.json              # AUTO — co-authors aggregated from publications
│  ├─ collaborators.overrides.json    # MANUAL — paste LinkedIn/homepage per person (optional)
│  ├─ patents.json                    # from your records
│  └─ students.json                   # MANUAL — seeded from folders 07 & 08; enrich by hand
├─ scripts/
│  └─ refresh_data.py                 # fetches OpenAlex → rewrites publications/collaborators
└─ github-workflow--refresh-data.yml  # copy to .github/workflows/refresh-data.yml in your repo
```

## How the "auto-update" works
1. The site reads the JSON files in `data/` — no live API calls in the browser.
2. `scripts/refresh_data.py` pulls the latest works from **OpenAlex** (free, no key), rebuilds `publications.json` and `collaborators.json`, reconstructs abstracts for the **hover summaries**, and prints anything NEW since the last run.
3. The **GitHub Action** (`refresh-data.yml`) runs it on a **daily schedule** and commits changes → your site rebuilds automatically. There's also a manual "Run workflow" button.

### One-time setup
- Put your **OpenAlex author ID** (or **ORCID**) into `data/config.json` (`openalex_author_id` / `orcid`). If left as `CONFIRM`, the script will try to resolve it by name + "Madras" affiliation, but setting it explicitly is safer. Find it at `https://api.openalex.org/authors?search=Satyanarayanan%20Seshadri`.
- Copy `github-workflow--refresh-data.yml` to `.github/workflows/refresh-data.yml` in the site repo.

## Why not Google Scholar directly?
Google Scholar has **no public API and blocks automated access**, so it can't be pulled server-side reliably or from the browser. Your Scholar profile (`trCkcp4AAAAJ`) is shown as a link. If you ever need an exact Scholar mirror, the only reliable route is the **paid SerpAPI Google Scholar API** — drop the key in the Action as a secret and swap the fetch source.

## Google Sheets CMS (edit content without code)
A live CMS lives in Google Drive → folder **"Satya Website CMS"** (`data/cms.json` has the IDs):
`01 Publications · 02 Patents · 03 Consultancy · 04 Talks · 05 Visits · 06 Events · 07 Students · 08 Teaching · 09 News`.

- **Edit a sheet → the site updates** (live on refresh; daily snapshot as fallback).
- **One-time:** share the CMS folder as **"Anyone with the link: Viewer"** so the site can read it.
- **Hybrid fetch:** the site reads each sheet live via `https://docs.google.com/spreadsheets/d/{id}/export?format=csv`; the daily Action also runs `scripts/cms_fetch.py` → `data/cms/*.json` as an offline/SEO fallback.
- **Merge:** OpenAlex publications are the base; the Publications sheet can feature/add/hide. Students `Status` column drives Current vs Alumni.

## Notes on the seed data (today)
- `publications.json` currently holds **74 items** (40 journals, 30 conference papers, 4 book chapters) parsed from `Master_Publications_List.xlsx`. Once you set the OpenAlex ID and the Action runs, it will be replaced/augmented with live data incl. citation counts and real abstracts.
- `collaborators.json` — **83 co-authors** ranked by joint papers (top: Vasa NJ, Banerjee N, Koundinya S, Sankaralingam RK, Surendran A, Tropea C …). Institution/ORCID/LinkedIn fields are blank — fill LinkedIn via `collaborators.overrides.json`; academic links get auto-filled by OpenAlex on refresh.
- `students.json` — **40 students** seeded from folders `07 Students & Theses` (current & graduated PhD/MS/MTech) and `08 Recommendation & Support Letters` (BTech/project mentees). `co_author: true` marks names that also appear as publication co-authors (a strong "research student" signal — 4 matched so far). **Verify roles and add position/photo/LinkedIn manually** — these can't be scraped from LinkedIn.
