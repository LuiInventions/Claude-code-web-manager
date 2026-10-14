export {};

declare global {
  interface Window {
    cccDesktop?: {
      isDesktop: true;
      pickFolder: (title?: string) => Promise<string | null>;
      /** Real disk path for a file or folder dropped onto the window. Empty when the file has none. */
      pathForFile: (file: File) => string;
      /** Paths captured from the latest drop. Clears them. */
      takeDropPaths: () => string[];
      openPath: (target: string) => Promise<string>;
      copyText: (text: string) => Promise<void>;
    };
  }
}
