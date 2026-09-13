import {
  capabilityPath,
  loadCapability,
  validationState,
} from "./executor.cjs";
import { readdir, readFile, lstat, rm, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  parseCapability,
} from "./tools/capability-write.cjs";
import type { CapabilityRef, SavedCapability } from "../shared/agent.js";
export async function deleteCapabilityArtifacts(
  root: string,
  ref: CapabilityRef,
) {
  const directory = dirname(capabilityPath(root, ref));
  // Do not follow links outside the app-owned capability namespace.
  if (
    !(await lstat(dirname(directory))).isDirectory() ||
    !(await lstat(directory)).isDirectory()
  )
    throw new Error("Invalid capability directory.");
  const versions = (await readdir(directory)).filter((name) =>
    /^v\d+\.json$/.test(name),
  );
  const latest = Math.max(...versions.map((name) => Number(name.slice(1, -5))));
  if (latest !== ref.version)
    throw new Error(
      "This capability changed. Reopen Capabilities before deleting it.",
    );
  await rm(directory, { recursive: true });
  // An empty source folder must not consume a catalog slot forever.
  await rmdir(dirname(directory)).catch(() => {});
}
export async function readCapabilityCatalog(
  root: string,
): Promise<SavedCapability[]> {
  const chats = await readdir(root, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const drafts: SavedCapability[] = [];
  for (const chat of chats
    .filter(
      (item) => item.isDirectory() && /^[a-zA-Z0-9_-]{1,80}$/.test(item.name),
    )
    .slice(0, 100)) {
    const directory = join(root, chat.name);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries
      .filter(
        (item) =>
          item.isDirectory() && /^[a-z][a-z0-9_]{0,59}$/.test(item.name),
      )
      .slice(0, 100)) {
      const versions = (await readdir(join(directory, entry.name)))
        .filter((file) => /^v\d+\.json$/.test(file))
        .sort((a, b) => Number(b.slice(1, -5)) - Number(a.slice(1, -5)));
      if (!versions.length) continue;
      const path = join(directory, entry.name, versions[0]);
      const info = await lstat(path);
      if (!info.isFile() || info.size > 128000) continue;
      try {
        const {
          schema_version,
          version,
          status,
          source_chat_id,
          created_at: _,
          ...data
        } = JSON.parse(await readFile(path, "utf8"));
        const draft = parseCapability(schema_version, data);
        if (
          ![1, 2, 3].includes(schema_version) ||
          status !== "draft" ||
          source_chat_id !== chat.name ||
          draft.id !== entry.name ||
          version !== Number(versions[0].slice(1, -5))
        )
          continue;
        const ref = { id: draft.id, version, sourceChatId: chat.name };
        const loaded = await loadCapability(root, ref);
        const validation = await validationState(loaded.path, loaded.hash);
        drafts.push({
          validation: validation?.status ?? "draft",
          validationCases: validation?.cases.length ?? 0,
          id: draft.id,
          name: draft.name,
          description: draft.description,
          version,
          sourceChatId: chat.name,
          contract: JSON.stringify(
            { ...draft, schema_version, version, status },
            null,
            2,
          ),
        });
      } catch {
        /* Invalid/incomplete local artifacts are not presented as usable drafts. */
      }
    }
  }
  return drafts.sort((a, b) => a.name.localeCompare(b.name));
}
