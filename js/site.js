/* Prof. Satyanarayanan Seshadri — site JS
   Static site; all dynamic content renders from /data/*.json
   plus (optionally) the Google Sheets CMS (live CSV with JSON snapshot fallback). */

(function () {
  "use strict";

  /* ---------- shared: nav ---------- */
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }
  // mark current page
  const here = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".site-nav a").forEach(a => {
    if (a.getAttribute("href") === here) a.setAttribute("aria-current", "page");
  });

  /* ---------- shared: subtle reveal ---------- */
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }), { threshold: 0.08 });
    document.querySelectorAll(".reveal").forEach(el => io.observe(el));
  } else {
    document.querySelectorAll(".reveal").forEach(el => el.classList.add("in"));
  }

  /* ---------- data helpers ---------- */
  async function loadJSON(path) {
    try {
      const r = await fetch(path, { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (e) { return null; }
  }

  // Minimal CSV parser (handles quoted fields, commas, newlines in quotes)
  function parseCSV(text) {
    const rows = []; let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return [];
    const head = rows[0].map(h => h.trim());
    return rows.slice(1).map(r => {
      const o = {};
      head.forEach((h, i) => { o[h] = (r[i] || "").trim(); });
      return o;
    });
  }

  // Hybrid CMS fetch: live Google Sheet CSV → fallback committed snapshot
  let cmsConfig = null;
  async function getCmsConfig() {
    if (cmsConfig === null) cmsConfig = (await loadJSON("data/cms.json")) || false;
    return cmsConfig;
  }
  // Fetch a tab of the single CMS spreadsheet by NAME (gviz endpoint), e.g. "Publications", "_Pages".
  // requiredCol guards against gviz silently returning the FIRST tab when the named tab doesn't exist.
  async function cmsTab(tabName, requiredCol) {
    const cfg = await getCmsConfig();
    if (!cfg || !cfg.spreadsheet_id) return null;
    const url = "https://docs.google.com/spreadsheets/d/" + cfg.spreadsheet_id +
      "/gviz/tq?tqx=out:csv&sheet=" + encodeURIComponent(tabName);
    try {
      const r = await fetch(url);
      if (r.ok) {
        const rows = parseCSV(await r.text());
        if (rows.length) {
          if (requiredCol && !(requiredCol in rows[0])) return null; // wrong tab came back
          return rows;
        }
      }
    } catch (e) { /* not available */ }
    return null;
  }
  const TAB_FOR_TYPE = { publications: "Publications", patents: "Patents", consultancy: "Consultancy", talks: "Talks", visits: "Visits", events: "Events", students: "Students", teaching: "Teaching", news: "News" };
  const COL_FOR_TYPE = { publications: "Title", patents: "Number", consultancy: "Client", talks: "Event", students: "Degree", news: "Headline" };
  // raw=true returns every row (incl. Show=No) so callers can use Show=No as a "hide" rule
  async function cmsFetch(type, raw) {
    let rows = null;
    const cfg = await getCmsConfig();
    // 1. single-spreadsheet CMS (v2): tab by name
    if (cfg && cfg.spreadsheet_id) rows = await cmsTab(TAB_FOR_TYPE[type] || type, COL_FOR_TYPE[type]);
    // 2. legacy: one Google Sheet file per type
    if (!rows && cfg && cfg.sheets && cfg.sheets[type]) {
      const url = cfg.csv_url_pattern.replace("{id}", cfg.sheets[type]);
      try {
        const r = await fetch(url);
        if (r.ok) {
          const parsed = parseCSV(await r.text());
          if (parsed.length) rows = parsed;
        }
      } catch (e) { /* fall through to snapshot */ }
    }
    // 3. committed snapshot
    if (!rows) {
      const snap = await loadJSON("data/cms/" + type + ".json");
      if (Array.isArray(snap)) rows = snap;
    }
    if (!rows) return null;
    // drop placeholder/instruction rows
    rows = rows.filter(x => (x.Type || "").toUpperCase() !== "NOTE" && !String(Object.values(x)[0] || "").startsWith("["));
    return raw ? rows : rows.filter(x => (x.Show || "").toLowerCase() !== "no");
  }

  /* ---------- CMS v2 site-wide features: _Pages, _Content, _Assets ---------- */
  function assetURL(v) {
    if (!v) return "";
    if (/^https?:\/\//.test(v)) return v;
    return "https://drive.google.com/thumbnail?id=" + encodeURIComponent(v) + "&sz=w1600";
  }
  async function applyCmsChrome() {
    const cfg = await getCmsConfig();
    if (!cfg || !cfg.spreadsheet_id) return;
    // _Pages → extra nav entries (rendered by page.html?p=Tab)
    cmsTab("_Pages", "Tab").then(rows => {
      if (!rows) return;
      const navList = document.getElementById("nav-list");
      if (!navList) return;
      rows.filter(r => r.Tab && (r.Show || "").toLowerCase() !== "no")
        .sort((a, b) => (+a.Order || 99) - (+b.Order || 99))
        .forEach(r => {
          const li = document.createElement("li");
          const a = document.createElement("a");
          a.href = "index.html?p=" + encodeURIComponent(r.Tab);
          a.textContent = r.NavLabel || r.Title || r.Tab;
          if (new URLSearchParams(location.search).get("p") === r.Tab) a.setAttribute("aria-current", "page");
          li.appendChild(a); navList.appendChild(li);
        });
    });
    const selKey = k => String(k).replace(/["\\\]]/g, "");
    // _Content → replace narrative blocks: Key column matches data-cms="key"
    cmsTab("_Content", "Key").then(rows => {
      if (!rows) return;
      rows.forEach(r => {
        if (!r.Key || !r.Value) return;
        document.querySelectorAll('[data-cms="' + selKey(r.Key) + '"]').forEach(el => { el.innerHTML = r.Value; });
      });
    });
    // _Assets → swap images: Key matches data-asset="key"; Value = Drive file ID or full URL
    cmsTab("_Assets", "Key").then(rows => {
      if (!rows) return;
      rows.forEach(r => {
        const val = r.FileId || r.URL || r.Value || "";
        if (!r.Key || !val) return;
        document.querySelectorAll('[data-asset="' + selKey(r.Key) + '"]').forEach(el => {
          if (el.tagName === "IMG") { el.src = assetURL(val); if (r.Alt) el.alt = r.Alt; }
          else el.style.backgroundImage = "url('" + assetURL(val) + "')";
        });
      });
    });
  }
  applyCmsChrome();

  /* ---------- shared: curated links (_Links tab: Name, URL, Type) ---------- */
  let _linksCache = null;
  async function getLinks() {
    if (_linksCache !== null) return _linksCache;
    const rows = await cmsTab("_Links", "URL");
    _linksCache = {};
    if (rows) rows.forEach(r => { if (r.Name && r.URL) _linksCache[r.Name.trim().toLowerCase()] = r.URL; });
    return _linksCache;
  }
  /* ---------- shared: student/alumni name tokens (to exclude from collaborators) ---------- */
  async function getStudentTokens() {
    let names = [];
    const sheet = await cmsFetch("students");
    if (sheet && sheet.length) names = sheet.map(r => r.Name || "");
    else {
      const d = await loadJSON("data/students.json");
      if (d && d.students) names = d.students.map(s => s.name || "");
    }
    const toks = new Set();
    names.forEach(n => String(n).toLowerCase().split(/[\s,.]+/).forEach(t => { if (t.length > 3) toks.add(t); }));
    return toks;
  }


  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  /* ================= page routers ================= */
  const page = document.body.dataset.page;

  /* ---------- home: latest publications teaser ---------- */
  if (page === "home") {
    cmsFetch("news").then(rows => {
      const box = document.getElementById("home-news");
      if (!box || !rows || !rows.length) return;
      const items = rows.slice().sort((a, b) => String(b.Date || "").localeCompare(String(a.Date || ""))).slice(0, 6);
      box.innerHTML = "<ul>" + items.map(n => {
        const t = n.Headline || n.Title || "";
        const bits = [n.Date, n.Category].filter(Boolean).map(esc).join(" · ");
        return `<li>${n.Link ? `<a href="${esc(n.Link)}" rel="noopener">${esc(t)}</a>` : esc(t)}${bits ? " <span class='muted small'>(" + bits + ")</span>" : ""}</li>`;
      }).join("") + "</ul>";
    });
    loadJSON("data/publications.json").then(d => {
      const box = document.getElementById("latest-pubs");
      if (!box || !d || !d.publications) return;
      const latest = d.publications.filter(p => p.type === "journal")
        .sort((a, b) => (b.year || 0) - (a.year || 0)).slice(0, 4);
      box.innerHTML = "<h3>Recent journal articles</h3><ul>" + latest.map(p => `
        <li>${esc((p.authors || []).join(", "))} (${esc(p.year)}). "<a href="publications.html">${esc(p.title)}</a>". <i>${esc(p.venue)}</i>.</li>`).join("") + "</ul>";
    });
  }

  /* ---------- generic CMS page (any page + ?p=TabName; also page.html) ---------- */
  const cmsParam = new URLSearchParams(location.search).get("p");
  if (cmsParam || page === "cmspage") {
    (async () => {
      const main = document.getElementById("main");
      // take over the article area on whichever page hosts the URL
      if (cmsParam && page !== "cmspage") {
        main.innerHTML = `<h1 class="article-title">Loading…</h1>
          <div class="sitesub">Managed from the website CMS</div>
          <div id="cms-page-body"><p class="placeholder">Loading page from the website CMS…</p></div>`;
      }
      const body = document.getElementById("cms-page-body");
      const tab = cmsParam;
      const cfg = await getCmsConfig();
      if (!tab || !cfg || !cfg.spreadsheet_id) {
        body.innerHTML = "<p class='placeholder'>No page specified, or the CMS spreadsheet is not configured yet (set <code>spreadsheet_id</code> in <code>data/cms.json</code>).</p>";
        return;
      }
      const meta = ((await cmsTab("_Pages", "Tab")) || []).find(r => r.Tab === tab);
      if (!meta) { body.innerHTML = "<p class='placeholder'>This page is not registered in the _Pages tab of the CMS spreadsheet.</p>"; return; }
      const title = meta.Title || tab;
      document.title = title + " — Satyanarayanan Seshadri";
      document.querySelector(".article-title").textContent = title;
      const rows = await cmsTab(tab);
      if (!rows || !rows.length) {
        body.innerHTML = "<p class='placeholder'>No rows found in the “" + esc(tab) + "” tab yet — add rows in the CMS spreadsheet.</p>";
        return;
      }
      const shown = rows.filter(r => (r.Show || "").toLowerCase() !== "no");
      const cols = Object.keys(rows[0]).filter(c => c && c.toLowerCase() !== "show");
      let html = meta.Intro ? "<p>" + meta.Intro + "</p>" : "";
      const layout = (meta.Layout || "table").toLowerCase();
      if (layout === "article") {
        // wiki-style page: each row is a section — Section (heading), Text (HTML allowed),
        // Image (Drive file ID or URL), Caption, Order, Show
        const secs = shown.filter(r => (r.Section || r.Text))
          .sort((a, b) => (+a.Order || 99) - (+b.Order || 99));
        html += secs.map(r => {
          const img = (r.Image || "").trim();
          return (r.Section ? `<h2>${esc(r.Section)}</h2>` : "") +
            (img ? `<div class="thumb"><img src="${esc(assetURL(img))}" alt="${esc(r.Caption || r.Section || "")}" loading="lazy"><div class="cap">${esc(r.Caption || "")}</div></div>` : "") +
            (r.Text ? `<p>${r.Text}</p>` : "");
        }).join("");
        html += '<p class="small muted"><a href="research.html">← Research</a></p>';
      } else if (layout === "cards") {
        html += "<div class='people-grid'>" + shown.map(r => `
          <div class="person">
            <div class="name">${esc(r[cols[0]] || "")}</div>
            ${cols.slice(1).filter(c => r[c]).map(c => `<div class="pos">${esc(r[c])}</div>`).join("")}
          </div>`).join("") + "</div>";
      } else if (layout === "list") {
        html += "<dl>" + shown.map(r => `
          <dt>${esc(r[cols[0]] || "")}</dt>
          <dd>${cols.slice(1).filter(c => r[c]).map(c => esc(r[c])).join(" · ")}</dd>`).join("") + "</dl>";
      } else {
        html += "<div class='table-scroll'><table class='wikitable'><tr>" +
          cols.map(c => "<th>" + esc(c) + "</th>").join("") + "</tr>" +
          shown.map(r => "<tr>" + cols.map(c => "<td>" + esc(r[c] || "") + "</td>").join("") + "</tr>").join("") +
          "</table></div>";
      }
      body.innerHTML = html;
    })();
  }

  /* ---------- publications ---------- */
  if (page === "publications") {
    (async () => {
      const list = document.getElementById("pub-list");
      const d = await loadJSON("data/publications.json");
      if (!d || !d.publications) {
        if (list) list.innerHTML = "<li class='placeholder'>Publications data could not be loaded. Serve the site over HTTP (data/publications.json).</li>";
        return;
      }
      let pubs = d.publications.slice();

      // overrides: {hide:[titles], add:[items], pin:[titles]}
      const ov = await loadJSON("data/publications.overrides.json");
      if (ov) {
        if (Array.isArray(ov.hide)) pubs = pubs.filter(p => !ov.hide.some(t => p.title.toLowerCase() === t.toLowerCase()));
        if (Array.isArray(ov.add)) pubs = pubs.concat(ov.add);
      }
      // CMS sheet: feature / add / hide by Title match (Show=No or Hide=Yes hides the auto item)
      const sheet = await cmsFetch("publications", true);
      const featured = new Set();
      if (sheet) {
        sheet.forEach(row => {
          const t = (row.Title || "").toLowerCase();
          if (!t) return;
          const hide = (row.Hide || "").toLowerCase() === "yes" || (row.Show || "").toLowerCase() === "no";
          const match = pubs.find(p => p.title.toLowerCase() === t);
          if (hide) {
            pubs = pubs.filter(p => p.title.toLowerCase() !== t);
            return;
          }
          if (!match) {
            pubs.push({ type: (row.Type || "journal").toLowerCase(), title: row.Title, authors: (row.Authors || "").split(/[;,]/).map(s => s.trim()).filter(Boolean), venue: row.Venue || "", year: +row.Year || row.Year, impact_factor: row.IF || "", theme: row.Theme || "", summary: row.Summary || "", doi: row.DOI || "" });
          } else {
            // the sheet is authoritative: any filled cell updates the matched item
            if (row.Venue) match.venue = row.Venue;
            if (row.Year) match.year = +row.Year || match.year;
            if (row.Theme) match.theme = row.Theme;
            if (row.Type) match.type = row.Type.toLowerCase();
            if (row.Authors) match.authors = row.Authors.split(/[;,]/).map(s => s.trim()).filter(Boolean);
            if (row["Volume/Pages"]) match.cite = row["Volume/Pages"];
            if (row.IF) match.impact_factor = row.IF;
            // ignore placeholder/seed summaries — keep the real abstract from the data files
            if (row.Summary && !/edit summary here/i.test(row.Summary) &&
                !/(journal article|conference paper|book chapter) in .+\(\d{4}\)\.?$/i.test(row.Summary.trim()))
              match.summary = row.Summary;
            if (row.DOI) match.doi = row.DOI;
          }
          if ((row.Featured || "").toLowerCase() === "yes") featured.add(t);
        });
      }
      pubs.sort((a, b) => {
        const fa = featured.has(String(a.title).toLowerCase()) || a.top20 ? 1 : 0;
        const fb = featured.has(String(b.title).toLowerCase()) || b.top20 ? 1 : 0;
        return (fb - fa) || (b.year || 0) - (a.year || 0) || String(a.title).localeCompare(b.title);
      });

      // toolbar
      const themes = [...new Set(pubs.map(p => p.theme).filter(Boolean))].sort();
      const years = [...new Set(pubs.map(p => p.year).filter(Boolean))].sort((a, b) => b - a);
      const selType = document.getElementById("f-type");
      const selTheme = document.getElementById("f-theme");
      const selYear = document.getElementById("f-year");
      const q = document.getElementById("f-q");
      const count = document.getElementById("pub-count");
      if (selTheme) selTheme.innerHTML = "<option value=''>All themes</option>" + themes.map(t => `<option>${esc(t)}</option>`).join("");
      if (selYear) selYear.innerHTML = "<option value=''>All years</option>" + years.map(y => `<option>${esc(y)}</option>`).join("");

      const typeLabel = { journal: "Journal", conference: "Conference", book: "Book / chapter" };

      function render() {
        const ty = selType ? selType.value : "", th = selTheme ? selTheme.value : "",
          yr = selYear ? selYear.value : "", needle = q ? q.value.toLowerCase() : "";
        const rows = pubs.filter(p =>
          (!ty || p.type === ty) && (!th || p.theme === th) && (!yr || String(p.year) === yr) &&
          (!needle || (p.title + " " + (p.authors || []).join(" ") + " " + (p.venue || "")).toLowerCase().includes(needle)));
        if (count) count.textContent = rows.length + " of " + pubs.length;
        list.innerHTML = rows.map((p, i) => {
          const feat = featured.has(String(p.title).toLowerCase());
          const titleEl = p.doi
            ? `<a href="https://doi.org/${esc(p.doi)}" rel="noopener" data-pop="${i}">${esc(p.title)}</a>`
            : `<button type="button" aria-expanded="false" data-pop="${i}">${esc(p.title)}</button>`;
          return `<li class="pub-item" data-i="${i}">
            <div class="pub-title">${titleEl}
              ${feat ? ' <span class="badge badge-gold">Featured</span>' : ""}
              ${p.top20 ? ' <span class="badge badge-maroon">Selected</span>' : ""}</div>
            <div class="pub-meta"><span class="venue">${esc(p.venue)}</span> · ${esc(p.year)}
              ${p.impact_factor ? " · IF " + esc(p.impact_factor) : ""} · ${typeLabel[p.type] || esc(p.type)}
              ${p.theme ? " · " + esc(p.theme) : ""}</div>
            <div class="pub-authors">${esc((p.authors || []).join(", "))}</div>
          </li>`;
        }).join("") || "<li class='placeholder'>No publications match these filters.</li>";
        wirePopovers(rows);
      }

      let openPop = null; // { btn, pop, pinned }
      function closePop() {
        if (openPop) { openPop.pop.remove(); openPop.btn.setAttribute("aria-expanded", "false"); openPop = null; }
      }
      function showPop(btn, p, pinned) {
        closePop();
        const pop = document.createElement("div");
        pop.className = "popover"; pop.setAttribute("role", "dialog");
        pop.innerHTML = `<button class="close" aria-label="Close">✕</button>
          <p>${esc(p.summary || (p.title + " — " + p.venue + " (" + p.year + ")"))}</p>
          <p class="muted small"><em>${esc(p.venue)}</em> · ${esc(p.year)}
            ${p.impact_factor ? " · Impact factor " + esc(p.impact_factor) : ""}
            ${p.citations ? " · " + esc(p.citations) + " citations" : ""}</p>
          ${(p.coauthors && p.coauthors.length) ? `<p class="coauthors small">Co-authors: ${p.coauthors.map(c => `<a href="collaborators.html#${encodeURIComponent(c)}">${esc(c)}</a>`).join(", ")}</p>` : ""}
          ${p.doi ? `<p class="small"><a href="https://doi.org/${esc(p.doi)}" rel="noopener">DOI: ${esc(p.doi)}</a></p>` : ""}`;
        btn.closest(".pub-item").appendChild(pop);
        btn.setAttribute("aria-expanded", "true");
        openPop = { btn, pop, pinned };
        pop.querySelector(".close").addEventListener("click", closePop);
      }
      function wirePopovers(rows) {
        list.querySelectorAll("[data-pop]").forEach(btn => {
          const p = () => rows[+btn.dataset.pop];
          const isLink = btn.tagName === "A";
          if (!isLink) {
            // no DOI: click / Enter / tap toggles the popover
            btn.addEventListener("click", () => {
              if (openPop && openPop.btn === btn && openPop.pinned) { closePop(); return; }
              showPop(btn, p(), true);
            });
          }
          // hover / keyboard focus: transient popover (title links still navigate to the DOI on click)
          ["mouseenter", "focus"].forEach(ev => btn.addEventListener(ev, () => {
            if (openPop && openPop.pinned) return;
            showPop(btn, p(), false);
          }));
          btn.closest(".pub-item").addEventListener("mouseleave", () => {
            if (openPop && openPop.btn === btn && !openPop.pinned) closePop();
          });
          if (isLink) btn.addEventListener("blur", () => {
            if (openPop && openPop.btn === btn && !openPop.pinned) closePop();
          });
        });
      }
      document.addEventListener("keydown", e => { if (e.key === "Escape") closePop(); });
      document.addEventListener("click", e => {
        if (openPop && !e.target.closest(".popover") && !e.target.closest("[data-pop]")) closePop();
      });

      [selType, selTheme, selYear].forEach(s => s && s.addEventListener("change", render));
      if (q) q.addEventListener("input", render);
      render();
    })();
  }

  /* ---------- collaborators ---------- */
  if (page === "collaborators") {
    (async () => {
      const box = document.getElementById("collab-grid");
      const d = await loadJSON("data/collaborators.json");
      const ovRaw = (await loadJSON("data/collaborators.overrides.json")) || {};
      const ov = {};
      if (Array.isArray(ovRaw.collaborators)) ovRaw.collaborators.forEach(x => { if (x.link_override) ov[x.name] = x.link_override; });
      else Object.entries(ovRaw).forEach(([k, v]) => { if (typeof v === "string" && v) ov[k] = v; });
      if (!d || !d.collaborators) { box.innerHTML = "<p class='placeholder'>Collaborator data could not be loaded.</p>"; return; }
      const links = await getLinks();
      const studentToks = await getStudentTokens();

      function isStudent(name) {
        // collaborator names look like "Vasa NJ" — compare surname-ish tokens against the roster
        return String(name).toLowerCase().split(/[\s,.]+/).some(t => t.length > 3 && studentToks.has(t));
      }

      async function renderAcademic() {
        const rows = d.collaborators.filter(c => !isStudent(c.name));
        const removed = d.collaborators.length - rows.length;
        box.innerHTML = `<div class="table-scroll"><table class="wikitable">
          <tr><th>Collaborator</th><th>Joint papers</th><th>Latest</th><th>Institution / link</th></tr>` +
          rows.map(c => {
            const url = links[c.name.trim().toLowerCase()] || ov[c.name] || c.link_override || c.openalex || c.orcid || "";
            const name = url ? `<a href="${esc(url)}" rel="noopener">${esc(c.name)}</a>` : esc(c.name);
            return `<tr id="${encodeURIComponent(c.name)}"><td>${name}</td><td>${esc(c.joint_papers)}</td><td>${esc(c.latest_year)}</td><td>${esc(c.institution || "")}</td></tr>`;
          }).join("") + "</table></div>" +
          (removed ? `<p class="small muted">${removed} co-author${removed === 1 ? "" : "s"} who appear in the student/alumni roster are listed under <a href="people.html">People</a> instead.</p>` : "");
        if (location.hash) {
          const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
          if (el) el.scrollIntoView({ block: "center" });
        }
      }
      async function renderIndustry() {
        box.innerHTML = "<p class='placeholder'>Loading industry partners…</p>";
        const rows = await cmsFetch("consultancy");
        if (!rows || !rows.length) { box.innerHTML = "<p class='placeholder'>Industry partners are maintained in the website CMS (Consultancy tab).</p>"; return; }
        box.innerHTML = "<div class='people-grid'>" + rows.filter(r => r.Client && !/example/i.test(r.Description || "")).map(r => `
          <div class="person">
            <div class="name">${r.Link ? `<a href="${esc(r.Link)}" rel="noopener">${esc(r.Client)}</a>` : esc(r.Client)}</div>
            <div class="deg">${esc(r.Sector || "")}${r.Period ? " · " + esc(r.Period) : ""}</div>
            ${r["Project / Title"] ? `<div class="pos">${esc(r["Project / Title"])}</div>` : ""}
            ${r.Description ? `<div class="pos">${esc(r.Description)}</div>` : ""}
          </div>`).join("") + "</div>" || "<p class='placeholder'>Add rows to the Consultancy tab to list industry partners.</p>";
      }
      const note = document.getElementById("collab-note");
      document.querySelectorAll(".tab[data-collab]").forEach(t => t.addEventListener("click", () => {
        document.querySelectorAll(".tab[data-collab]").forEach(x => x.setAttribute("aria-selected", "false"));
        t.setAttribute("aria-selected", "true");
        if (t.dataset.collab === "industry") {
          if (note) note.textContent = "Industry partners and consulting clients — managed from the Consultancy tab in the website CMS.";
          renderIndustry();
        } else {
          if (note) note.textContent = "Co-authors across the group's publications, ranked by joint papers. Students and alumni are listed under People.";
          renderAcademic();
        }
      }));
      renderAcademic();
    })();
  }

  /* ---------- sponsors ---------- */
  if (page === "sponsors") {
    (async () => {
      const box = document.getElementById("sponsor-grid");
      let items = null;
      const rows = await cmsTab("Sponsors", "Domain");
      if (rows) items = rows.filter(r => r.Name && (r.Show || "").toLowerCase() !== "no")
        .map(r => ({ name: r.Name, type: r.Type || "", domain: r.Domain || "", link: r.Link || "", details: r.Details || "" }));
      if (!items || !items.length) {
        const d = await loadJSON("data/sponsors.json");
        items = (d && d.sponsors) || [];
      }
      const isV2 = box.classList.contains("cards");
      const logo = s => s.domain
        ? `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(s.domain)}&sz=128" alt="" width="44" height="44" loading="lazy" style="border-radius:6px" onerror="this.remove()">`
        : "";
      if (isV2) {
        box.innerHTML = items.map(s => `
          <div class="cardv2"><div class="card-body">
            <div style="display:flex;align-items:center;gap:.7rem;margin-bottom:.5rem">${logo(s)}<p class="meta" style="margin:0">${esc(s.type)}</p></div>
            <h3>${s.link ? `<a href="${esc(s.link)}" rel="noopener">${esc(s.name)}</a>` : esc(s.name)}</h3>
            <p>${esc(s.details)}</p>
          </div></div>`).join("");
      } else {
        box.innerHTML = items.map(s => `
          <div class="person" style="display:flex;gap:.8rem;align-items:flex-start">
            ${logo(s)}
            <div><div class="name">${s.link ? `<a href="${esc(s.link)}" rel="noopener">${esc(s.name)}</a>` : esc(s.name)}</div>
            <div class="deg">${esc(s.type)}</div>
            <div class="pos">${esc(s.details)}</div></div>
          </div>`).join("");
      }
    })();
  }

  /* ---------- patents ---------- */
  if (page === "patents") {
    (async () => {
      const d = await loadJSON("data/patents.json");
      const box = document.getElementById("patent-list");
      let base = (d && d.patents) ? d.patents : null;
      // CMS v2: the Patents tab, when present and populated, is authoritative
      const cfg = await getCmsConfig();
      if (cfg && cfg.spreadsheet_id) {
        const rows = await cmsTab("Patents", "Number");
        if (rows && rows.length) {
          const shown = rows.filter(r => (r.Show || "").toLowerCase() !== "no" && (r.Title || "").trim());
          if (shown.length) base = shown.map(r => ({
            title: r.Title, number: r.Number || "", year: +r.Year || r.Year || "",
            ptype: r.Type || r.Ptype || "", status: r.Status || "", assignee: r.Assignee || "",
            theme: r.Theme || "", inventors: (r.Inventors || "").split(/[;,]/).map(s => s.trim()).filter(Boolean)
          }));
        }
      }
      if (!base) { box.innerHTML = "<li class='placeholder'>Patent data could not be loaded.</li>"; return; }
      const order = { "Granted": 0, "Filed": 1 };
      const pats = base.slice().sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2) || (b.year || 0) - (a.year || 0));
      box.innerHTML = pats.map(p => `
        <li>
          <div class="row-title">${esc(p.title)}
            <span class="badge ${p.status === "Granted" ? "badge-maroon" : ""}">${esc(p.status)}</span></div>
          <div class="row-sub">${esc(p.number)} · ${esc(p.year)} · ${esc(p.ptype)}${p.assignee ? " · " + esc(p.assignee) : ""}</div>
          <div class="row-sub">${esc((p.inventors || []).join(", "))}${p.theme ? " · <em>" + esc(p.theme) + "</em>" : ""}</div>
        </li>`).join("");
    })();
  }

  /* ---------- people (students) ---------- */
  if (page === "people") {
    (async () => {
      const d = await loadJSON("data/students.json");
      let students = (d && d.students) ? d.students.slice() : [];
      // CMS students sheet takes precedence if it has rows
      const sheet = await cmsFetch("students");
      if (sheet && sheet.length) {
        students = sheet.map(r => ({
          name: r.Name || "", degree: r.Degree || "", status: (r.Status || "").toLowerCase(),
          years: r.Years || "", thesis_title: r["Thesis / Project"] || r.Thesis || r["Thesis Title"] || "",
          current_position: r["Current Position"] || r.Position || "", link: r.Link || r.LinkedIn || ""
        })).filter(s => s.name);
      }
      {
        const links = await getLinks();
        students.forEach(s => { if (!s.link) s.link = links[String(s.name).trim().toLowerCase()] || ""; });
      }
      const grid = document.getElementById("people-grid");
      const tabs = document.querySelectorAll(".tab[data-status]");
      function render(status) {
        const rows = students.filter(s => (s.status || "").includes(status));
        const byDeg = {};
        rows.forEach(s => { (byDeg[s.degree] = byDeg[s.degree] || []).push(s); });
        const degOrder = ["PhD", "MS", "MTech", "Mentee / Recommendation"];
        const degs = Object.keys(byDeg).sort((a, b) => (degOrder.indexOf(a) + 99 * (degOrder.indexOf(a) < 0)) - (degOrder.indexOf(b) + 99 * (degOrder.indexOf(b) < 0)));
        grid.innerHTML = degs.map(deg => `
          <h3 style="grid-column:1/-1;margin:.8rem 0 0">${esc(deg)}</h3>
          ${byDeg[deg].map(s => `
            <div class="person">
              <div class="name">${s.link ? `<a href="${esc(s.link)}" rel="noopener">${esc(s.name)}</a>` : esc(s.name)}</div>
              <div class="deg">${esc(s.degree)}${s.years ? " · " + esc(s.years) : ""}</div>
              ${s.thesis_title ? `<div class="pos">${esc(s.thesis_title)}</div>` : ""}
              ${s.current_position ? `<div class="pos">${esc(s.current_position)}</div>` : ""}
            </div>`).join("")}`).join("") || "<p class='placeholder'>No entries yet.</p>";
      }
      tabs.forEach(t => t.addEventListener("click", () => {
        tabs.forEach(x => x.setAttribute("aria-selected", "false"));
        t.setAttribute("aria-selected", "true");
        render(t.dataset.status);
      }));
      render("current");
    })();
  }

  /* ---------- impact: testimonials ---------- */
  if (page === "impact") {
    (async () => {
      const box = document.getElementById("testimonials");
      if (!box) return;
      let items = null;
      const rows = await cmsTab("Testimonials", "Quote");
      if (rows) items = rows.filter(r => r.Quote && (r.Show || "").toLowerCase() !== "no")
        .map(r => ({ client: r.Client || "", sector: r.Sector || "", quote: r.Quote }));
      if (!items || !items.length) {
        const d = await loadJSON("data/testimonials.json");
        items = (d && d.testimonials) || [];
      }
      box.innerHTML = items.map(t => `
        <div class="mbox" style="margin:.6em 0"><div>“${esc(t.quote)}” — <b>${esc(t.client)}</b>${t.sector ? " <span class='muted small'>(" + esc(t.sector) + ")</span>" : ""}</div></div>`).join("")
        || "<p class='placeholder'>Add rows to a Testimonials tab (Client, Sector, Quote, Show) in the CMS spreadsheet.</p>";
    })();
  }

  /* ---------- research: themes driven by the "Research" CMS tab ---------- */
  if (page === "research") {
    (async () => {
      const cfg = await getCmsConfig();
      if (!cfg || !cfg.spreadsheet_id) return;
      const rows = await cmsTab("Research", "Blurb");
      if (!rows || !rows.length) return;
      const shown = rows.filter(r => (r.Theme || "").trim() && (r.Show || "").toLowerCase() !== "no" && !String(r.Theme).startsWith("["))
        .sort((a, b) => (+a.Order || 99) - (+b.Order || 99));
      if (!shown.length) return;
      const box = document.getElementById("themes-box");
      if (!box) return;
      box.innerHTML = "<dl>" + shown.map(r => {
        const title = r.Page
          ? `<a href="index.html?p=${encodeURIComponent(r.Page)}">${esc(r.Theme)}</a>`
          : esc(r.Theme);
        return `<dt>${title}</dt><dd>${r.Blurb || ""}</dd>`;
      }).join("") + "</dl>";
    })();
  }

  /* ---------- talks & media (CMS-driven extras) ---------- */
  if (page === "talks") {
    (async () => {
      const talks = await cmsFetch("talks");
      const news = await cmsFetch("news");
      const tbox = document.getElementById("cms-talks");
      const nbox = document.getElementById("cms-news");
      if (tbox && talks && talks.length) {
        tbox.innerHTML = "<ul class='row-list'>" + talks.map(t => `
          <li><div class="row-title">${esc(t.Title || t.Talk || "")}</div>
          <div class="row-sub">${esc(t.Venue || t.Event || "")}${t.Date ? " · " + esc(t.Date) : ""}${t.Location ? " · " + esc(t.Location) : ""}</div></li>`).join("") + "</ul>";
        const ph = document.getElementById("talks-placeholder"); if (ph) ph.remove();
      }
      if (nbox && news && news.length) {
        nbox.innerHTML = "<h2 style='margin-top:3rem'>News</h2><ul class='row-list'>" + news.map(n => {
          const title = n.Headline || n.Title || "";
          const sub = [n.Category || n.Outlet, n.Date, n.Details].filter(Boolean).map(esc).join(" · ");
          return `<li><div class="row-title">${n.Link ? `<a href="${esc(n.Link)}" rel="noopener">${esc(title)}</a>` : esc(title)}</div>
          <div class="row-sub">${sub}</div></li>`;
        }).join("") + "</ul>";
      }
    })();
  }
})();
