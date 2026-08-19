const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("taskAPI", {
  load: () => ipcRenderer.invoke("data:load"),
  save: (data) => ipcRenderer.invoke("data:save", data),
  listBackups: () => ipcRenderer.invoke("backups:list"),
  pushBackup: (data) => ipcRenderer.invoke("backups:push", data),
});