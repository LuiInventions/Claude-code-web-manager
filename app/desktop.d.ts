export {};

declare global {
  interface Window {
    cccDesktop?: {
      isDesktop: true;
      pickFolder: () => Promise<string | null>;
      copyText: (text: string) => Promise<void>;
    };
  }
}
