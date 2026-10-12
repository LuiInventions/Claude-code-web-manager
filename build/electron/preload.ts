import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("cccDesktop", {
  isDesktop: true,
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("ccc:pick-folder"),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke("ccc:copy-text", text),
});
