/**
 * Transport shim for the vendored pixel-agents office.
 *
 * Upstream, `office/**` imports a `transport` singleton that bridges to the
 * VS Code extension host (postMessage) or a standalone WebSocket server. This
 * web manager has neither: the Sessions tab drives the office imperatively from
 * our own session model via `useSessionMessages.ts`, so nothing on the wire is
 * needed here.
 *
 * The office only ever calls `transport.send(...)` (e.g. `saveAgentSeats` when a
 * user drags a character to a new seat). We provide a no-op so those calls are
 * harmless and we never open a stray socket. This is the only piece of office
 * "infrastructure" adapted — `office/**` itself is vendored byte-for-byte.
 */

export interface MessageTransport {
  send(message: unknown): void;
  onMessage(handler: (message: unknown) => void): () => void;
  dispose?(): void;
}

const noopTransport: MessageTransport = {
  send() {
    /* no backend in web-manager mode — office state is driven locally */
  },
  onMessage() {
    return () => {};
  },
  dispose() {},
};

/** Singleton transport instance (imported by the vendored office unchanged). */
export const transport: MessageTransport = noopTransport;
