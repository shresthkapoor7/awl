import type { WebContents } from "electron";
import { ToolError } from "./core.cjs";
const snapshots = new WeakMap<WebContents, Map<string, string>>();
export function consumeSnapshot(wc: WebContents, frame: string, id: string) {
  if (snapshots.get(wc)?.get(frame) !== id)
    throw new ToolError(
      "STALE_ELEMENT",
      "Take a fresh DOM snapshot before acting.",
    );
  snapshots.get(wc)!.delete(frame);
}
export type PageSnapshot = {
  id: string;
  url: string;
  nodes: Map<string, { element: Element; signature: string }>;
  signature: (element: Element) => string;
};
export function registerSnapshot(
  wc: WebContents,
  frameId: string,
  snapshotId: string,
) {
  const current = snapshots.get(wc) ?? new Map<string, string>();
  current.set(frameId, snapshotId);
  snapshots.set(wc, current);
}
