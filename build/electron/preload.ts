import { contextBridge, ipcRenderer, webUtils } from "electron";

let lastDropPaths: string[] = [];

// Capture the real disk paths while the drop event is still valid. Reading them
// later, after the File has crossed into the page, loses the folder.
window.addEventListener(
  "drop",
  (event) => {
    const files = event.dataTransfer ? Array.from(event.dataTransfer.files) : [];
    const paths: string[] = [];
    for (const file of files) {
      try {
        const found = webUtils.getPathForFile(file);
        if (found) paths.push(found);
      } catch {
        // Not a file from this PC.
      }
    }
    lastDropPaths = paths;
  },
  true,
);

contextBridge.exposeInMainWorld("cccDesktop", {
  isDesktop: true,
  pickFolder: (title?: string): Promise<string | null> => ipcRenderer.invoke("ccc:pick-folder", title),
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  takeDropPaths: (): string[] => {
    const paths = lastDropPaths;
    lastDropPaths = [];
    return paths;
  },
  openPath: (target: string): Promise<string> => ipcRenderer.invoke("ccc:open-path", target),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke("ccc:copy-text", text),
});
