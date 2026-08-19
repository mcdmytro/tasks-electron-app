const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

// In dev (npm start), keep the data file right next to main.js — easy to find and inspect.
// Once packaged into a real .app, the app bundle itself is read-only, so we must use
// the standard per-user app-data folder instead (~/Library/Application Support/Tasks on macOS).
const DATA_DIR = app.isPackaged ? app.getPath("userData") : __dirname;
const DATA_FILE = path.join(DATA_DIR, "tasks-data.json");
const BACKUPS_FILE = path.join(DATA_DIR, "tasks-backups.json");
const MAX_BACKUPS = 40;

function defaultData() {
  return {
    tasks: [],
    pages: [{ id: "life", name: "Life" }, { id: "work", name: "Work" }],
    currentPageId: "life",
  };
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const data = defaultData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    return data;
  }
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!Array.isArray(data.tasks)) throw new Error("malformed");
    if (!Array.isArray(data.pages) || !data.pages.length) data.pages = defaultData().pages;
    if (!data.currentPageId) data.currentPageId = data.pages[0].id;
    return data;
  } catch (e) {
    // Don't ever silently wipe a file we can't parse — preserve it and start fresh.
    const backupPath = DATA_FILE + ".unreadable-" + Date.now();
    fs.copyFileSync(DATA_FILE, backupPath);
    const data = defaultData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    return data;
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function loadBackups() {
  if (!fs.existsSync(BACKUPS_FILE)) return [];
  try {
    const backups = JSON.parse(fs.readFileSync(BACKUPS_FILE, "utf8"));
    return Array.isArray(backups) ? backups : [];
  } catch (e) {
    return [];
  }
}

function pushBackup(data) {
  const backups = loadBackups();
  backups.push({ timestamp: Date.now(), tasks: data.tasks, pages: data.pages });
  while (backups.length > MAX_BACKUPS) backups.shift();
  fs.writeFileSync(BACKUPS_FILE, JSON.stringify(backups, null, 2));
}

ipcMain.handle("data:load", () => loadData());
ipcMain.handle("data:save", (_event, data) => {
  saveData(data);
  return true;
});
ipcMain.handle("backups:list", () => loadBackups());
ipcMain.handle("backups:push", (_event, data) => {
  pushBackup(data);
  return true;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    title: "Tasks",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});