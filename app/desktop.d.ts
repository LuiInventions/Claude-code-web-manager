export {};

declare global {
  interface Window {
    cccDesktop?: {
      isDesktop: true;
      pickFolder: (title?: string) => Promise<string | null>;
      openPath: (target: string) => Promise<string>;
      copyText: (text: string) => Promise<void>;
    };
  }
}
