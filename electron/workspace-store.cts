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
import type { SessionHistory } from "./stored-session.cjs";
import { parseStoredSession } from "./stored-session.cjs";
import { safeStoredSession } from "./privacy.cjs";
import { redactDemonstration } from "../shared/recording.js";
export type StoredSession = {
  chat: AgentChat;
  history: SessionHistory;
  codexThreadId?: string;
};
export class WorkspaceStore {
  private pending = Promise.resolve();
  constructor(private root: string) {}
  async load(): Promise<StoredSession[]> {
    const files = await readdir(this.root).catch(() => []);
    const sessions: StoredSession[] = [];
    for (const file of files
      .filter((file) => /^[a-zA-Z0-9_-]{1,80}\.json$/.test(file))
      .sort()) {
      if (sessions.length >= 32) break;
      try {
        const path = join(this.root, file);
        const info = await lstat(path);
        if (!info.isFile() || info.size > 16_000_000) continue;
        let saved = parseStoredSession(
          JSON.parse(await readFile(path, "utf8")),
        );
        if (!saved || saved.chat.id !== file.slice(0, -5)) continue;
        if (saved.chat.demonstration) {
          saved.chat.demonstration = redactDemonstration(
            saved.chat.demonstration,
          );
        }
        if (
          !Number.isFinite(saved.chat.createdAt) ||
          saved.chat.createdAt! <= 0
        ) {
          const journalAt = Array.isArray(saved.chat.journal)
            ? saved.chat.journal
                .map((event) => Date.parse(event?.at ?? ""))
                .find((at) => Number.isFinite(at) && at > 0)
            : undefined;
          saved.chat.createdAt = journalAt ?? info.mtimeMs;
        }
        // Rewrite legacy raw observations too; browser/model state is never restored as authority.
        saved = safeStoredSession(saved);
        await this.save(saved);
        sessions.push(saved);
      } catch {
        /* An interrupted or corrupt file cannot authorize execution. */
      }
    }
    return sessions;
  }
  save(session: StoredSession) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(session.chat.id))
      return Promise.reject(new Error("Invalid session identity."));
    session = safeStoredSession(session);
    const data = JSON.stringify({
      version: 1,
      ...session,
      chat: {
        ...session.chat,
        ...(session.chat.demonstration
          ? { demonstration: redactDemonstration(session.chat.demonstration) }
          : {}),
      },
    });
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
