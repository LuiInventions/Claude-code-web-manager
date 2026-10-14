import { enqueueUiCommand, type UiSectionId } from "../../ui-commands";
import { ActionError } from "../errors";

/** Ask the open window to put `target` on the clipboard. The path is also returned. */
export function queueCopy(section: UiSectionId, target: string) {
  const text = target.trim();
  if (!text) throw new ActionError("path is required.");
  const command = enqueueUiCommand(section, { kind: "copy-text", text });
  return {
    path: text,
    copied: true,
    commandId: command.id,
    note: "The open window copies this path to the clipboard. The path is in this result either way.",
  };
}

/** Ask the file list in that section to reload after an upload. */
export function queueReload(section: UiSectionId): number {
  return enqueueUiCommand(section, { kind: "reload-files" }).id;
}
