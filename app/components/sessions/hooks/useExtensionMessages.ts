/**
 * Compatibility shim.
 *
 * The vendored `office/components/ToolOverlay.tsx` type-imports `SubagentCharacter`
 * from `../../hooks/useExtensionMessages.js`. In this web manager the real hook is
 * `useSessionMessages.ts` (sourced from our session model, not the VS Code
 * extension transport), so we re-export the type from there to keep `office/**`
 * byte-identical to upstream.
 */
export type { SubagentCharacter } from "../useSessionMessages";
