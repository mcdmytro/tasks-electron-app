# Tasks (Electron app, auto file storage)

A real desktop app — not a wrapped webpage. It keeps a `tasks-data.json`
file right next to `main.js`, created automatically the first time you run
it, read automatically every time after. No file pickers, no prompts.

## 1. Install and run

```bash
cd tasks-electron-app
npm install
npm start
```

The first launch creates `tasks-data.json` and `tasks-backups.json` in this
same folder — empty, with default "Life"/"Work" pages. Every change you
make in the app writes straight to `tasks-data.json` immediately.

## 2. Bring over your existing tasks (one-time)

If you have tasks already saved in the old browser-based version, export
that data and paste it in here before your first `npm start`:

1. Open the old `tasks-app.html` in Chrome.
2. Open DevTools (Cmd+Option+I) → Console tab.
3. Run: `copy(localStorage.getItem('tasks_default'))` (or `'tasks'` if you
   never renamed it) — this copies the raw task array to your clipboard.
4. Also grab pages: `copy(localStorage.getItem('pages_default'))`.
5. Open `tasks-data.json` in this folder in a text editor and paste your
   tasks array into the `"tasks"` field, and your pages array into
   `"pages"`, so the file looks like:
   ```json
   {
     "tasks": [ /* paste your tasks array here */ ],
     "pages": [ /* paste your pages array here, or leave the default */ ],
     "currentPageId": "life"
   }
   ```
6. Save the file, then `npm start`.

## 3. Packaging as a real, double-clickable `.app`

This has to be run **on your Mac**, not anywhere else — `electron-builder`
needs to run on the actual target OS to produce a working mac build.

```bash
npm run dist
```

This creates a `dist/` folder containing `Tasks.app` (plus a `.dmg` and
`.zip`). Drag `Tasks.app` into `/Applications`. From then on it shows up in
Spotlight, Launchpad, and the Applications folder like any normal app.

**First launch will be blocked by Gatekeeper** (the app isn't
code-signed/notarized) — right-click `Tasks.app` → **Open** once to bypass
this. After that first approval, it opens normally forever, including via
double-click or Spotlight.

### Important: where your data lives changes once packaged

In dev mode (`npm start`), `tasks-data.json` sits right next to `main.js` —
easy to find. Once packaged, the `.app` bundle itself is read-only, so the
app automatically switches to macOS's standard per-user data folder:

```
~/Library/Application Support/Tasks/tasks-data.json
~/Library/Application Support/Tasks/tasks-backups.json
```

To find it in Finder: **Go → Go to Folder…** (Cmd+Shift+G), paste
`~/Library/Application Support/Tasks`, hit Enter.

**If you'd already been using `npm start` and have real tasks in the dev
copy**, copy those two files into the folder above (create the `Tasks`
folder if it doesn't exist yet — run the packaged app once first so it
creates it) before you start relying on the packaged app, or that data
won't carry over automatically.

### Updating the app later

Whenever I hand you an updated `renderer/app.js` (or you edit it
yourself), just re-run `npm run dist` and replace `Tasks.app` in
`/Applications` with the new build — your data file is untouched since it
lives outside the app bundle entirely.

## 4. Sharing this with someone else

**Dev mode**: copy the whole `tasks-electron-app` folder (minus
`tasks-data.json`/`tasks-backups.json`, which are yours) to them; their
first `npm start` creates a fresh, empty data file of their own.

**Packaged app**: just send them `Tasks.app` (or have them run `npm run
dist` themselves). Since packaged data lives in each person's own
`~/Library/Application Support/Tasks/`, two separate people running the
same `Tasks.app` on two separate Macs automatically get two separate data
files — no shared-storage risk at all.

## How it differs from the old version

- No `localStorage`, no browser storage quirks, no shared-origin bug —
  the file is the single source of truth, managed by a small Node.js
  backend (`main.js`) with real filesystem access.
- No Export/Import buttons — the `.json` file itself already is your
  portable backup. Copy it, back it up, or open it in a text editor
  anytime.
- The "Backups" button and automatic snapshots still work exactly as
  before (on new task / delete / edit-save), just stored in
  `tasks-backups.json` instead of browser storage.
