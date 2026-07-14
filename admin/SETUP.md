# Site Studio — one-time setup (≈10 minutes)

Site Studio edits your website's Google Sheet CMS. To enable editing, it needs a
(free) Google OAuth Client ID so you can sign in with your own Google account.
No servers, no passwords stored — only Google accounts that already have edit
access to the spreadsheet can make changes.

## Steps

1. Go to https://console.cloud.google.com/ and sign in with the Google account
   that owns the CMS spreadsheet.
2. Create a project (top bar → project picker → "New project"). Name: `site-studio`.
3. Enable the Sheets API: menu → "APIs & Services" → "Library" → search
   "Google Sheets API" → Enable.
4. Configure the consent screen: "APIs & Services" → "OAuth consent screen" →
   - User type: External → Create
   - App name: `Site Studio`, your email in both email fields → Save
   - Audience → "Publish app" (or add your own Google account under Test users)
5. Create the client: "APIs & Services" → "Credentials" → "+ Create credentials"
   → "OAuth client ID" →
   - Application type: **Web application**
   - Name: `site-studio`
   - Authorized JavaScript origins: `https://satyaseshadri.github.io`
   - Create → copy the **Client ID** (ends in `.apps.googleusercontent.com`)
6. Paste it into `admin/config.js` (`CLIENT_ID: "…"`), commit/push (or ask
   Claude to do it), then open https://satyaseshadri.github.io/admin/ and
   click "Sign in with Google".

## Notes
- Edits appear on the live site within ~1–5 minutes (Google caches the feeds).
- "Publications": the base list also lives in the site's data files — hide a
  paper with its SHOWN/HIDDEN toggle rather than deleting the row.
- Pages view: creating a page makes a new tab with the right columns and
  registers it in _Pages; "article" layout = wiki-style sections with images.
