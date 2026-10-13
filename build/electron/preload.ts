import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("cccDesktop", {
  isDesktop: true,
  pickFolder: (title?: string): Promise<string | null> => ipcRenderer.invoke("ccc:pick-folder", title),
  openPath: (target: string): Promise<string> => ipcRenderer.invoke("ccc:open-path", target),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke("ccc:copy-text", text),
});
