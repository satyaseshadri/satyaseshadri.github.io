/* Site Studio — edits the website's Google Sheets CMS via the Sheets API.
   Sign in with a Google account that has EDIT access to the spreadsheet.
   Without a CLIENT_ID (or before sign-in) the app runs read-only via the public CSV feeds. */
(function () {
  "use strict";
  const CFG = window.ADMIN_CONFIG || {};
  const SID = CFG.SPREADSHEET_ID;
  const API = "https://sheets.googleapis.com/v4/spreadsheets/" + SID;

  let token = null;            // OAuth access token
  let tokenClient = null;
  let sheetsMeta = [];         // [{sheetId, title}]
  let current = null;          // current tab title or special view
  let grid = { header: [], rows: [] }; // current tab data
  let dirty = {};              // "r:c" -> value

  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const status = t => { $("#status").textContent = t; };
  const msg = (kind, text) => {
    const el = document.createElement("div");
    el.className = "msg " + kind; el.textContent = text;
    $("#main").prepend(el); setTimeout(() => el.remove(), 5000);
  };

  /* ---------------- auth ---------------- */
  window.__gisReady = function () {
    if (!CFG.CLIENT_ID) return;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.CLIENT_ID,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      callback: r => {
        if (r.access_token) {
          token = r.access_token;
          $("#auth-btn").hidden = true;
          status("signed in — editing enabled");
          boot(true);
        }
      }
    });
    $("#auth-btn").hidden = false;
    $("#auth-btn").onclick = () => tokenClient.requestAccessToken();
  };

  async function api(path, opts = {}) {
    const r = await fetch(API + path, {
      ...opts,
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json", ...(opts.headers || {}) }
    });
    if (r.status === 401) { token = null; status("session expired — sign in again"); $("#auth-btn").hidden = false; throw new Error("unauthorized"); }
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || "API error");
    return d;
  }

  /* ---------------- known optional tabs (creatable from Studio) ---------------- */
  const KNOWN_TABS = {
    "Sponsors":     { headers: ["Name", "Type", "Domain", "Details", "Link", "Show"], seed: "../data/sponsors.json", seedKey: "sponsors", map: s => [s.name, s.type, s.domain, s.details, s.link, "Yes"] },
    "Testimonials": { headers: ["Client", "Sector", "Quote", "Show"], seed: "../data/testimonials.json", seedKey: "testimonials", map: t => [t.client, t.sector, t.quote, "Yes"] },
    "Research":     { headers: ["Theme", "Blurb", "Page", "Order", "Show"] },
    "_Links":       { headers: ["Name", "URL", "Type"] },
  };

  /* ---------------- data loading ---------------- */
  function parseCSV(text) {
    const rows = []; let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i+1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i+1] === "\n") i++; row.push(f); f = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = []; }
      else f += c;
    }
    if (f !== "" || row.length) { row.push(f); rows.push(row); }
    return rows;
  }

  async function loadTabsList() {
    if (token) {
      const d = await api("?fields=sheets(properties(sheetId,title,index))");
      sheetsMeta = d.sheets.map(s => s.properties).sort((a, b) => a.index - b.index);
      Object.keys(KNOWN_TABS).forEach(t => {
        if (!t.startsWith("_") && !sheetsMeta.find(s => s.title === t)) sheetsMeta.push({ title: t, sheetId: null, creatable: true });
      });
    } else {
      // read-only: we can't enumerate tabs without auth; use the known set + _Pages
      sheetsMeta = ["Publications","Patents","Consultancy","Talks","Visits","Events","Students","Teaching","News","Research","Sponsors","_Pages","_Content","_Assets","_Links"].map(t => ({ title: t, sheetId: null }));
    }
  }

  let firstTabSig = null;
  async function loadTab(title) {
    if (token) {
      if (!sheetsMeta.find(s => s.title === title)) return { missing: true, header: [], rows: [] };
      const d = await api("/values/" + encodeURIComponent("'" + title + "'!A1:AZ1000"));
      const v = d.values || [];
      return { header: v[0] || [], rows: v.slice(1) };
    }
    if (firstTabSig === null) {
      const r0 = await fetch("https://docs.google.com/spreadsheets/d/" + SID + "/gviz/tq?tqx=out:csv");
      const rows0 = parseCSV(await r0.text());
      firstTabSig = { sig: (rows0[0] || []).join("|"), title: null };
    }
    const r = await fetch("https://docs.google.com/spreadsheets/d/" + SID + "/gviz/tq?tqx=out:csv&sheet=" + encodeURIComponent(title));
    const rows = parseCSV(await r.text());
    const header = rows[0] || [];
    // Google returns the FIRST tab when the named tab doesn't exist — detect that
    if (header.join("|") === firstTabSig.sig && title !== "Publications") {
      if (firstTabSig.title === null) firstTabSig.title = title; // first caller matching sig might BE the first tab
      else if (firstTabSig.title !== title) return { missing: true, header: [], rows: [] };
      // ambiguous: treat any non-Publications tab matching the Publications-like signature as missing
      if ((header[0] || "") === "Type" && header.includes("Venue")) return { missing: true, header: [], rows: [] };
    }
    return { header, rows: rows.slice(1) };
  }

  /* ---------------- sidebar / routing ---------------- */
  function renderSide() {
    const content = sheetsMeta.filter(s => !s.title.startsWith("_"));
    const special = sheetsMeta.filter(s => s.title.startsWith("_"));
    $("#side").innerHTML =
      "<h2>Content tabs</h2>" +
      content.map(s => `<a href="#tab=${encodeURIComponent(s.title)}" data-view="tab:${esc(s.title)}">${esc(s.title)}</a>`).join("") +
      "<h2>Site controls</h2>" +
      `<a href="#view=content" data-view="content">Text & blurbs</a>` +
      `<a href="#view=pages" data-view="pages">Pages</a>` +
      `<a href="#view=assets" data-view="assets">Images</a>` +
      `<a href="#view=review" data-view="review">Review queue</a>` +
      "<h2>Help</h2><a href='SETUP.md' target='_blank'>Setup guide ↗</a>";
    document.querySelectorAll("#side a[data-view]").forEach(a => a.addEventListener("click", e => {
      document.querySelectorAll("#side a").forEach(x => x.classList.remove("active"));
      a.classList.add("active");
    }));
  }

  function route() {
    const h = location.hash;
    const mTab = h.match(/#tab=([^&]+)/), mView = h.match(/#view=(\w+)/);
    if (mView) return showView(mView[1]);
    if (mTab) return showTab(decodeURIComponent(mTab[1]));
    showTab("News");
  }
  window.addEventListener("hashchange", route);

  /* ---------------- grid view (any tab) ---------------- */
  async function showTab(title) {
    current = title; dirty = {}; updateSavebar();
    $("#main").innerHTML = "<p>Loading “" + esc(title) + "”…</p>";
    try { grid = await loadTab(title); } catch (e) { $("#main").innerHTML = "<div class='msg err'>Could not load: " + esc(e.message) + "</div>"; return; }
    if (grid.missing) {
      const known = KNOWN_TABS[title];
      $("#main").innerHTML = `
        <div class="toolbar"><h2 style="margin:0;font-size:1.2rem">${esc(title)}</h2></div>
        <div class="msg warn">This tab doesn't exist in the spreadsheet yet${known ? "" : " — create it in Google Sheets"}.</div>
        ${known ? `<div class="card"><h3>Create the “${esc(title)}” tab</h3>
          <p style="font-size:.9rem;color:var(--soft)">Creates the tab with the right columns${known.seed ? " and fills it with the site's current data so you can edit from here" : ""}.</p>
          <button class="primary" id="create-known" ${token ? "" : "disabled"}>Create tab${known.seed ? " with current data" : ""}</button>
          ${token ? "" : "<p class='hint' style='font-size:.8rem;color:var(--soft)'>Sign in to create it.</p>"}</div>` : ""}`;
      const btn = $("#create-known");
      if (btn) btn.onclick = async () => {
        try {
          const add = await api(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }) });
          const values = [known.headers];
          if (known.seed) {
            try {
              const d = await (await fetch(known.seed)).json();
              (d[known.seedKey] || []).forEach(x => values.push(known.map(x)));
            } catch (e) {}
          }
          await api("/values/" + encodeURIComponent("'" + title + "'!A1") + "?valueInputOption=USER_ENTERED",
            { method: "PUT", body: JSON.stringify({ values }) });
          sheetsMeta = sheetsMeta.filter(s => s.title !== title);
          sheetsMeta.push({ title, sheetId: add.replies[0].addSheet.properties.sheetId });
          renderSide(); msg("ok", "Tab created."); showTab(title);
        } catch (e) { msg("err", e.message); }
      };
      return;
    }
    const canEdit = !!token;
    const showCol = grid.header.findIndex(c => c.trim().toLowerCase() === "show");
    const note = title === "Publications"
      ? "<div class='msg warn'>The base publication list also lives in the site's data files — to remove a paper from the site, set its Show to No (don't delete the row).</div>" : "";
    $("#main").innerHTML = `
      <div class="toolbar">
        <h2 style="margin:0;font-size:1.2rem">${esc(title)}</h2>
        <button id="add-row" ${canEdit ? "" : "disabled"}>+ Add row</button>
        <button id="reload">Reload</button>
        <span class="hint">${canEdit ? "Click a cell to edit. Changes queue until you press Save." : "Read-only — sign in to edit."}</span>
      </div>
      ${note}
      <table class="grid"><thead><tr>
        ${grid.header.map(hc => "<th>" + esc(hc) + "</th>").join("")}<th></th>
      </tr></thead><tbody id="tbody"></tbody></table>`;
    renderRows(canEdit, showCol);
    $("#add-row").onclick = addRow;
    $("#reload").onclick = () => showTab(title);
  }

  function renderRows(canEdit, showCol) {
    const tb = $("#tbody");
    tb.innerHTML = grid.rows.map((row, r) => {
      const cells = grid.header.map((_, c) => {
        const val = row[c] || "";
        if (c === showCol && canEdit) {
          const on = val.trim().toLowerCase() !== "no";
          return `<td><span class="pill ${on ? "on" : "off"}" data-r="${r}" data-c="${c}" role="button" tabindex="0">${on ? "SHOWN" : "HIDDEN"}</span></td>`;
        }
        return `<td data-r="${r}" data-c="${c}"><div class="cell" ${canEdit ? 'contenteditable="plaintext-only"' : ""}>${esc(val)}</div></td>`;
      }).join("");
      const ctl = canEdit ? `<td class="rowctl"><button class="rowbtn" title="Delete row" data-del="${r}">✕</button></td>` : "<td class='rowctl'></td>";
      return `<tr>${cells}${ctl}</tr>`;
    }).join("");
    if (!grid.rows.length) tb.innerHTML = "<tr><td colspan='99' style='padding:.8rem'>No rows yet.</td></tr>";

    tb.querySelectorAll(".cell[contenteditable]").forEach(cell => {
      cell.addEventListener("input", () => {
        const td = cell.parentElement;
        const key = td.dataset.r + ":" + td.dataset.c;
        dirty[key] = cell.textContent;
        td.classList.add("dirty");
        updateSavebar();
      });
    });
    tb.querySelectorAll(".pill").forEach(p => {
      const flip = async () => {
        const r = +p.dataset.r, c = +p.dataset.c;
        const on = p.classList.contains("on");
        const nv = on ? "No" : "Yes";
        try {
          await writeCell(r, c, nv);
          grid.rows[r][c] = nv;
          p.classList.toggle("on"); p.classList.toggle("off");
          p.textContent = on ? "HIDDEN" : "SHOWN";
          msg("ok", "Saved — the site updates within a few minutes.");
        } catch (e) { msg("err", e.message); }
      };
      p.addEventListener("click", flip);
      p.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
    });
    tb.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
      const r = +b.dataset.del;
      const label = (grid.rows[r] || []).slice(0, 2).join(" · ") || "this row";
      if (!confirm("Delete row: " + label + "?")) return;
      try {
        const meta = sheetsMeta.find(s => s.title === current);
        await api(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: meta.sheetId, dimension: "ROWS", startIndex: r + 1, endIndex: r + 2 } } }] }) });
        msg("ok", "Row deleted."); showTab(current);
      } catch (e) { msg("err", e.message); }
    }));
  }

  function colLetter(n) { let s = ""; n++; while (n) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); } return s; }

  async function writeCell(r, c, value) {
    const range = "'" + current + "'!" + colLetter(c) + (r + 2);
    await api("/values/" + encodeURIComponent(range) + "?valueInputOption=USER_ENTERED",
      { method: "PUT", body: JSON.stringify({ values: [[value]] }) });
  }

  async function addRow() {
    const blank = grid.header.map(hc => hc.trim().toLowerCase() === "show" ? "Yes" : "");
    try {
      await api("/values/" + encodeURIComponent("'" + current + "'!A1") + ":append?valueInputOption=USER_ENTERED",
        { method: "POST", body: JSON.stringify({ values: [blank] }) });
      showTab(current);
    } catch (e) { msg("err", e.message); }
  }

  /* ---------------- save bar ---------------- */
  function updateSavebar() {
    const n = Object.keys(dirty).length;
    $("#savebar").classList.toggle("show", n > 0);
    $("#save-count").textContent = n + " unsaved change" + (n === 1 ? "" : "s");
  }
  $("#save-btn").addEventListener("click", async () => {
    const entries = Object.entries(dirty);
    try {
      const data = entries.map(([k, v]) => {
        const [r, c] = k.split(":").map(Number);
        return { range: "'" + current + "'!" + colLetter(c) + (r + 2), values: [[v]] };
      });
      await api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }) });
      entries.forEach(([k, v]) => { const [r, c] = k.split(":").map(Number); grid.rows[r] = grid.rows[r] || []; grid.rows[r][c] = v; });
      dirty = {}; updateSavebar();
      document.querySelectorAll("td.dirty").forEach(td => td.classList.remove("dirty"));
      msg("ok", "Saved — the live site updates within a few minutes.");
    } catch (e) { msg("err", "Save failed: " + e.message); }
  });
  $("#discard-btn").addEventListener("click", () => showTab(current));

  /* ---------------- special views ---------------- */
  async function showView(view) {
    current = null; dirty = {}; updateSavebar();
    if (view === "content") return showContent();
    if (view === "pages") return showPages();
    if (view === "assets") return showAssets();
    if (view === "review") return showReview();
  }

  async function showContent() {
    $("#main").innerHTML = "<p>Loading text &amp; blurbs…</p>";
    const g = await loadTab("_Content");
    const iK = g.header.indexOf("Key"), iV = g.header.indexOf("Value"), iW = g.header.indexOf("Where it appears");
    $("#main").innerHTML = `
      <div class="toolbar"><h2 style="margin:0;font-size:1.2rem">Text &amp; blurbs</h2>
      <span class="hint">Every editable paragraph on the site. Empty = keep the built-in text. Basic HTML (&lt;b&gt;, &lt;i&gt;, &lt;a&gt;) allowed.</span></div>
      <div id="content-list"></div>`;
    $("#content-list").innerHTML = g.rows.filter(r => r[iK]).map((r, i) => `
      <div class="content-item">
        <span class="key">${esc(r[iK])}</span><span class="where">${esc(r[iW] || "")}</span>
        <textarea data-row="${i}">${esc(r[iV] || "")}</textarea>
        <div class="row"><button class="primary save-one" data-row="${i}" ${token ? "" : "disabled"}>Save</button>
        <button class="link-one" data-row="${i}">Insert link</button>
        <span style="font-size:.75rem;color:var(--soft)">Select text first, then Insert link. HTML like &lt;b&gt; and &lt;a href&gt; is allowed.</span></div>
      </div>`).join("");
    document.querySelectorAll(".link-one").forEach(b => b.addEventListener("click", () => {
      const ta = document.querySelector(`textarea[data-row="${b.dataset.row}"]`);
      const url = prompt("Link URL (https://…):", "https://");
      if (!url || url === "https://") return;
      const s = ta.selectionStart, e = ta.selectionEnd;
      const sel = ta.value.slice(s, e) || prompt("Link text:", "") || url;
      ta.value = ta.value.slice(0, s) + '<a href="' + url + '" rel="noopener">' + sel + "</a>" + ta.value.slice(e);
      ta.focus();
    }));
    document.querySelectorAll(".save-one").forEach(b => b.addEventListener("click", async () => {
      const i = +b.dataset.row;
      const v = document.querySelector(`textarea[data-row="${i}"]`).value;
      try {
        current = "_Content";
        await writeCell(i, iV, v);
        current = null;
        msg("ok", "Saved “" + g.rows[i][iK] + "” — live within a few minutes.");
      } catch (e) { msg("err", e.message); }
    }));
  }

  const LAYOUT_HEADERS = {
    article: ["Section", "Text", "Image", "Caption", "Order", "Show"],
    table:   ["Title", "Details", "Date", "Link", "Show"],
    list:    ["Title", "Details", "Date", "Link", "Show"],
    cards:   ["Title", "Subtitle", "Details", "Link", "Show"],
  };

  async function showPages() {
    $("#main").innerHTML = "<p>Loading pages…</p>";
    const g = await loadTab("_Pages");
    const idx = n => g.header.indexOf(n);
    const rowsHtml = g.rows.filter(r => r[idx("Tab")]).map((r, i) => `
      <tr>
        <td style="padding:.45rem .6rem"><b>${esc(r[idx("Tab")])}</b></td>
        <td style="padding:.45rem .6rem">${esc(r[idx("Title")] || "")}</td>
        <td style="padding:.45rem .6rem">${esc(r[idx("Layout")] || "table")}</td>
        <td style="padding:.45rem .6rem">${(r[idx("Show")] || "").toLowerCase() === "no" ? "hidden from menu" : "in menu"}</td>
        <td style="padding:.45rem .6rem"><a href="../index.html?p=${encodeURIComponent(r[idx("Tab")])}" target="_blank">view ↗</a></td>
        <td class="rowctl"><button class="rowbtn" data-delpage="${i}" title="Remove page">✕</button></td>
      </tr>`).join("");
    $("#main").innerHTML = `
      <div class="toolbar"><h2 style="margin:0;font-size:1.2rem">Pages</h2>
      <span class="hint">Each page is a spreadsheet tab plus a row here. Edit rows in the _Pages tab for fine control.</span></div>
      <table class="grid"><thead><tr><th>Tab</th><th>Page title</th><th>Layout</th><th>Menu</th><th></th><th></th></tr></thead>
      <tbody>${rowsHtml || "<tr><td colspan='6' style='padding:.8rem'>No pages yet.</td></tr>"}</tbody></table>
      <div class="card" style="margin-top:1.4rem">
        <h3>Add a new page</h3>
        <div class="formgrid">
          <label>Tab / page name</label><input id="np-name" placeholder="e.g. Awards">
          <label>Page title</label><input id="np-title" placeholder="e.g. Awards & honours">
          <label>Menu label</label><input id="np-nav" placeholder="e.g. Awards">
          <label>Layout</label><select id="np-layout"><option>article</option><option>table</option><option>list</option><option>cards</option></select>
          <label>Show in menu</label><select id="np-show"><option>Yes</option><option>No</option></select>
        </div>
        <p class="hint" style="font-size:.8rem;color:var(--soft)">Creates the tab with the right columns and registers it. “article” = wiki-style sections with text and images.</p>
        <button class="primary" id="np-create" ${token ? "" : "disabled"}>Create page</button>
      </div>`;
    $("#np-create").onclick = async () => {
      const name = $("#np-name").value.trim();
      if (!name) return msg("warn", "Give the page a name.");
      if (name.startsWith("_")) return msg("warn", "Names starting with _ are reserved.");
      const layout = $("#np-layout").value;
      try {
        const add = await api(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: name } } }] }) });
        const headers = LAYOUT_HEADERS[layout] || LAYOUT_HEADERS.table;
        await api("/values/" + encodeURIComponent("'" + name + "'!A1") + "?valueInputOption=USER_ENTERED",
          { method: "PUT", body: JSON.stringify({ values: [headers] }) });
        await api("/values/" + encodeURIComponent("'_Pages'!A1") + ":append?valueInputOption=USER_ENTERED",
          { method: "POST", body: JSON.stringify({ values: [[name, $("#np-title").value || name, $("#np-nav").value || name, "", layout, "", $("#np-show").value]] }) });
        sheetsMeta.push({ title: name, sheetId: add.replies[0].addSheet.properties.sheetId });
        renderSide();
        msg("ok", "Page created. Add rows to the “" + name + "” tab to fill it.");
        showPages();
      } catch (e) { msg("err", e.message); }
    };
    document.querySelectorAll("[data-delpage]").forEach(b => b.addEventListener("click", async () => {
      const i = +b.dataset.delpage;
      const tab = g.rows[i][idx("Tab")];
      if (!confirm("Remove page “" + tab + "”? This deletes its tab and all its rows.")) return;
      try {
        const meta = sheetsMeta.find(s => s.title === tab);
        const reqs = [{ deleteDimension: { range: { sheetId: sheetsMeta.find(s => s.title === "_Pages").sheetId, dimension: "ROWS", startIndex: i + 1, endIndex: i + 2 } } }];
        if (meta && meta.sheetId != null) reqs.push({ deleteSheet: { sheetId: meta.sheetId } });
        await api(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: reqs }) });
        sheetsMeta = sheetsMeta.filter(s => s.title !== tab);
        renderSide(); msg("ok", "Page removed."); showPages();
      } catch (e) { msg("err", e.message); }
    }));
  }

  async function showAssets() {
    $("#main").innerHTML = "<p>Loading images…</p>";
    const g = await loadTab("_Assets");
    const iK = g.header.indexOf("Key"), iF = g.header.indexOf("FileId"), iA = g.header.indexOf("Alt");
    $("#main").innerHTML = `
      <div class="toolbar"><h2 style="margin:0;font-size:1.2rem">Images</h2>
      <span class="hint">Paste a Google Drive image file ID (share the image “Anyone with link”, copy the code between /d/ and /view). Empty = the bundled photo.</span></div>
      <div id="asset-list"></div>`;
    $("#asset-list").innerHTML = g.rows.filter(r => r[iK]).map((r, i) => `
      <div class="content-item">
        <span class="key">${esc(r[iK])}</span><span class="where">${esc(r[iA] || "")}</span>
        <div class="row">
          <input style="flex:1;font:inherit;padding:.4rem .6rem;border:1px solid var(--line);border-radius:5px" data-row="${i}" value="${esc(r[iF] || "")}" placeholder="Drive file ID or full image URL">
          <button class="primary save-asset" data-row="${i}" ${token ? "" : "disabled"}>Save</button>
          ${r[iF] ? `<a href="https://drive.google.com/thumbnail?id=${esc(r[iF])}&sz=w400" target="_blank">preview ↗</a>` : ""}
        </div>
      </div>`).join("");
    document.querySelectorAll(".save-asset").forEach(b => b.addEventListener("click", async () => {
      const i = +b.dataset.row;
      const v = document.querySelector(`input[data-row="${i}"]`).value.trim();
      try { current = "_Assets"; await writeCell(i, iF, v); current = null; msg("ok", "Saved."); }
      catch (e) { msg("err", e.message); }
    }));
  }

  /* ---------------- review queue ---------------- */
  async function ensureLinksTab() {
    if (!sheetsMeta.find(s => s.title === "_Links")) {
      const add = await api(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: "_Links" } } }] }) });
      await api("/values/" + encodeURIComponent("'_Links'!A1") + "?valueInputOption=USER_ENTERED",
        { method: "PUT", body: JSON.stringify({ values: [["Name", "URL", "Type"]] }) });
      sheetsMeta.push({ title: "_Links", sheetId: add.replies[0].addSheet.properties.sheetId });
      renderSide();
    }
  }
  async function saveLink(name, url, type) {
    await ensureLinksTab();
    await api("/values/" + encodeURIComponent("'_Links'!A1") + ":append?valueInputOption=USER_ENTERED",
      { method: "POST", body: JSON.stringify({ values: [[name, url, type]] }) });
  }
  async function showReview() {
    $("#main").innerHTML = "<p>Loading review queue…</p>";
    let data = null;
    try { const r = await fetch("../data/review.json?t=" + Date.now()); data = await r.json(); } catch (e) {}
    const items = (data && data.items) || [];
    // already-resolved names (in _Links) drop out of the queue
    let resolved = {};
    try { const rows = await loadTab("_Links"); const iN = rows.header.indexOf("Name");
      rows.rows.forEach(r => { if (r[iN]) resolved[r[iN].trim().toLowerCase()] = true; }); } catch (e) {}
    const open = items.filter(it => !resolved[it.name.trim().toLowerCase()]);
    $("#main").innerHTML = `
      <div class="toolbar"><h2 style="margin:0;font-size:1.2rem">Review queue</h2>
      <span class="hint">Ambiguous or missing links found during enrichment. Pick the right one — it's saved to the _Links tab and used by the site.</span></div>
      <div id="review-list"></div>`;
    if (!open.length) { $("#review-list").innerHTML = "<div class='msg ok'>Nothing to review 🎉</div>"; return; }
    $("#review-list").innerHTML = open.map((it, i) => `
      <div class="card">
        <h3>${esc(it.name)} <span style="font-size:.75rem;color:var(--soft);font-weight:400">· ${esc(it.type)}</span></h3>
        <p style="font-size:.88rem;color:var(--soft)">${esc(it.note || "")}</p>
        ${(it.candidates || []).map((c, j) => `
          <div style="display:flex;gap:.6rem;align-items:center;margin:.3rem 0">
            <button class="pick" data-i="${i}" data-url="${esc(c.url)}" ${token ? "" : "disabled"}>Use this</button>
            <a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.label || c.url)} ↗</a>
          </div>`).join("")}
        ${it.suggest ? `<div class="msg warn" style="margin:.5rem 0">Suggested: mark as <b>${esc(it.suggest.status)}</b>${it.suggest.position ? ", position: “" + esc(it.suggest.position) + "”" : ""}
          <button class="apply-status" data-i="${i}" style="margin-left:.6rem" ${token ? "" : "disabled"}>Apply to Students tab</button></div>` : ""}
        <div style="display:flex;gap:.6rem;margin-top:.6rem">
          <input style="flex:1;font:inherit;padding:.4rem .6rem;border:1px solid var(--line);border-radius:5px" data-custom="${i}" placeholder="…or paste the correct URL">
          <button class="pick-custom" data-i="${i}" ${token ? "" : "disabled"}>Save</button>
          <button class="dismiss" data-i="${i}" ${token ? "" : "disabled"}>Not applicable</button>
        </div>
      </div>`).join("");
    const doSave = async (i, url) => {
      try { await saveLink(open[i].name, url, open[i].type); msg("ok", "Saved “" + open[i].name + "” — live within a few minutes."); showReview(); }
      catch (e) { msg("err", e.message); }
    };
    document.querySelectorAll(".pick").forEach(b => b.addEventListener("click", () => doSave(+b.dataset.i, b.dataset.url)));
    document.querySelectorAll(".pick-custom").forEach(b => b.addEventListener("click", () => {
      const v = document.querySelector(`input[data-custom="${b.dataset.i}"]`).value.trim();
      if (v) doSave(+b.dataset.i, v);
    }));
    document.querySelectorAll(".dismiss").forEach(b => b.addEventListener("click", () => doSave(+b.dataset.i, "-")));
    document.querySelectorAll(".apply-status").forEach(b => b.addEventListener("click", async () => {
      const it = open[+b.dataset.i];
      try {
        const g = await loadTab("Students");
        const iN = g.header.indexOf("Name"), iS = g.header.indexOf("Status"),
              iP = g.header.indexOf("Current Position"), iL = g.header.indexOf("Link");
        const needle = it.name.toLowerCase();
        const ri = g.rows.findIndex(r => {
          const n = (r[iN] || "").toLowerCase();
          return n === needle || n.includes(needle) || needle.includes(n);
        });
        if (ri < 0) { msg("err", "Couldn't find “" + it.name + "” in the Students tab."); return; }
        const data = [];
        const cell = (c, v) => data.push({ range: "'Students'!" + colLetter(c) + (ri + 2), values: [[v]] });
        if (it.suggest.status && iS >= 0) cell(iS, it.suggest.status);
        if (it.suggest.position && iP >= 0) cell(iP, it.suggest.position);
        if (it.candidates && it.candidates.length === 1 && iL >= 0) cell(iL, it.candidates[0].url);
        await api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }) });
        await saveLink(it.name, (it.candidates[0] || {}).url || "-", it.type);
        msg("ok", "Updated “" + (g.rows[ri][iN] || it.name) + "” in Students — live within a few minutes.");
        showReview();
      } catch (e) { msg("err", e.message); }
    }));
  }

  /* ---------------- boot ---------------- */
  async function boot(authed) {
    if (!SID) { $("#main").innerHTML = "<div class='msg err'>No SPREADSHEET_ID in config.js</div>"; return; }
    status(authed ? "signed in — editing enabled" : (CFG.CLIENT_ID ? "read-only — sign in to edit" : "read-only — finish setup (see Setup guide) to enable editing"));
    await loadTabsList();
    renderSide();
    route();
  }
  boot(false);
})();
