export {};

declare global {
  interface Window {
    cccDesktop?: {
      isDesktop: true;
      pickFolder: () => Promise<string | null>;
      openPath: (target: string) => Promise<string>;
      copyText: (text: string) => Promise<void>;
    };
  }
}
