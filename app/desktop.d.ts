export {};

declare global {
  interface Window {
    cccDesktop?: {
      isDesktop: true;
      pickFolder: () => Promise<string | null>;
    };
  }
}
