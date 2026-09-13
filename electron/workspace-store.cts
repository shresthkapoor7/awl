import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rename,
  unlink,
  lstat,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentChat } from "../shared/agent.js";
import type { ResponseInput } from "openai/resources/responses/responses";
export type StoredSession = { chat: AgentChat; history: ResponseInput };
export class WorkspaceStore {
  private pending = Promise.resolve();
  constructor(private root: string) {}
  async load(): Promise<StoredSession[]> {
    const files = await readdir(this.root).catch(() => []);
    const sessions: StoredSession[] = [];
    for (const file of files
      .filter((file) => /^[a-zA-Z0-9_-]{1,80}\.json$/.test(file))
      .slice(0, 32)) {
      try {
        const path = join(this.root, file);
        const info = await lstat(path);
        if (!info.isFile() || info.size > 16_000_000) continue;
        const value = JSON.parse(await readFile(path, "utf8"));
        if (
          value.version !== 1 ||
          value.chat?.id !== file.slice(0, -5) ||
          !Array.isArray(value.chat.messages) ||
          !Array.isArray(value.chat.tools) ||
          !Array.isArray(value.history)
        )
          continue;
        sessions.push({ chat: value.chat, history: value.history });
      } catch {
        /* An interrupted or corrupt file cannot authorize execution. */
      }
    }
    return sessions;
  }
  save(session: StoredSession) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(session.chat.id))
      return Promise.reject(new Error("Invalid session identity."));
    const data = JSON.stringify({ version: 1, ...session });
    if (Buffer.byteLength(data) > 16_000_000)
      return Promise.reject(new Error("Session storage limit reached."));
    const id = session.chat.id;
    const operation = this.pending
      .catch(() => {})
      .then(async () => {
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        const tmp = join(this.root, `.${randomUUID()}.tmp`);
        try {
          await writeFile(tmp, data, { flag: "wx", mode: 0o600 });
          await rename(tmp, join(this.root, `${id}.json`));
        } finally {
          await unlink(tmp).catch(() => {});
        }
      });
    this.pending = operation;
    return operation;
  }
  remove(id: string) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id))
      return Promise.reject(new Error("Invalid session identity."));
    this.pending = this.pending
      .catch(() => {})
      .then(() =>
        unlink(join(this.root, `${id}.json`)).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        }),
      );
    return this.pending;
  }
  flush() {
    return this.pending;
  }
}
