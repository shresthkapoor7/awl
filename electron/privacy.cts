import type { StoredSession } from "./workspace-store.cjs";
import { redactDemonstration } from "../shared/recording.js";
import type { WebContents } from "electron";
import { ToolError } from "./tools/core.cjs";
type PrivateRegistry = {
  values: Set<string>;
  sorted?: string[];
  saturated: boolean;
};
const registries = new Map<string, PrivateRegistry>();
const browserSessions = new WeakMap<WebContents, string>();
export function attachPrivacy(wc: WebContents, sessionId: string) {
  browserSessions.set(wc, sessionId);
}
export function privacySession(wc: WebContents): string {
  const id = browserSessions.get(wc);
  if (!id)
    throw new ToolError(
      "PRIVACY_SESSION",
      "Browser privacy session is unavailable.",
    );
  return id;
}
export function forgetPrivate(sessionId: string) {
  registries.delete(sessionId);
}
const patterns = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /(?<!\w)(?:\+1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g,
  /\b(?:\d[ -]?){13,19}\b/g,
  /\b(?:sk-[a-zA-Z0-9_-]{12,}|Bearer\s+[a-zA-Z0-9._~-]+)\b/g,
  /\b(password|passwd|secret|api[_ -]?key|access[_ -]?token|otp)\s*[:=]\s*[^\s,;]+/gi,
];
export function rememberPrivate(values: string[], sessionId: string) {
  let registry = registries.get(sessionId);
  if (!registry) {
    registry = { values: new Set(), saturated: false };
    registries.set(sessionId, registry);
  }
  const limit = () =>
    new ToolError(
      "PRIVACY_LIMIT",
      "This chat reached its privacy observation limit. Start a new chat to continue; other chats remain available.",
    );
  if (registry.saturated) throw limit();
  for (const value of values) {
    const normalized = value.trim();
    if (
      normalized.length < 3 ||
      normalized.length > 2000 ||
      registry.values.has(normalized)
    )
      continue;
    // Never evict live values or let one chat exhaust every session's budget.
    if (registry.values.size >= 20000) {
      registry.saturated = true;
      throw limit();
    }
    registry.values.add(normalized);
    registry.sorted = undefined;
  }
}
export function redactText(value: string, sessionId: string): string {
  let result = value;
  const registry = registries.get(sessionId);
  if (registry && !registry.sorted)
    registry.sorted = [...registry.values].sort((a, b) => b.length - a.length);
  for (const privateValue of registry?.sorted ?? [])
    result = result
      .split(privateValue)
      .join("[private]")
      .split(JSON.stringify(privateValue).slice(1, -1))
      .join("[private]");
  for (const pattern of patterns) result = result.replace(pattern, "[private]");
  return result;
}
export function redactData<T>(value: T, sessionId: string): T {
  const walk = (item: unknown): unknown => {
    if (typeof item === "string")
      return item.startsWith("data:image/")
        ? "[image omitted]"
        : redactText(item, sessionId);
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .filter(([key]) => !["image", "encrypted_content"].includes(key))
          .map(([key, data]) => [key, walk(data)]),
      );
    return item;
  };
  return walk(value) as T;
}
export function assertPublicArtifact(value: unknown, sessionId: string) {
  if (
    JSON.stringify(value).includes("[private]") ||
    JSON.stringify(value) !== JSON.stringify(redactData(value, sessionId))
  )
    throw new Error(
      "The capability contains private data. Replace private literals with input bindings and safe structural targets.",
    );
}
export function safeStoredSession(session: StoredSession): StoredSession {
  const chat = redactData(structuredClone(session.chat), session.chat.id);
  if (chat.demonstration)
    chat.demonstration = redactDemonstration(chat.demonstration);
  if (chat.execution) {
    chat.execution.inputs = Object.fromEntries(
      Object.keys(chat.execution.inputs).map((key) => [key, "[private]"]),
    );
    chat.execution.outputs = {};
    if (chat.execution.result?.kind === "success")
      chat.execution.result.outputs = {};
    if (chat.execution.result?.kind === "failure")
      chat.execution.result.observed = "Observation retained in memory only.";
  }
  // Raw observations and opaque model summaries cannot be reliably inspected/redacted.
  // Preserve only redacted chat text here. Codex owns its separate thread context.
  chat.journal = chat.journal?.map(({ data: _, image: __, ...event }) => event);
  return {
    codexThreadId: session.codexThreadId,
    chat,
    history: chat.messages.map((message) => ({
      role: message.role,
      content: message.text,
    })),
  };
}
// Self-contained, executed in an isolated world. Collect only explicitly identified
// personal fields and table cells; do not send these values back as evidence.
export function privatePageValues(selectors: string[]): string[] {
  const values = new Set<string>();
  const privateLabel =
    /\b(registered name|full name|first name|last name|mailing address|street address|telephone|phone|e-?mail|social security|date of birth|ssn)\b/i;
  const visible = (el: Element) =>
    el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== "hidden";
  const add = (el: Element | null) => {
    if (!el || !visible(el)) return;
    const text = (
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ? el.value
        : (el as HTMLElement).innerText || el.textContent || ""
    ).trim();
    if (text.length >= 3 && text.length <= 2000) values.add(text);
  };
  // Shadow content is rendered into screenshots too. Inspect each open root
  // with its own label/selector scope, including nested web components.
  const roots: (Document | ShadowRoot)[] = [document];
  for (let index = 0; index < roots.length; index++) {
    const root = roots[index];
    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) roots.push(el.shadowRoot);
    });
    for (const selector of selectors) {
      try {
        root.querySelectorAll(selector).forEach(add);
      } catch {
        throw new Error("Invalid privacy selector");
      }
    }
    root.querySelectorAll("input,textarea").forEach((el) => {
      const hints = [
        el.getAttribute("name"),
        el.getAttribute("autocomplete"),
        el.getAttribute("aria-label"),
        ...(el.getAttribute("aria-labelledby") ?? "")
          .split(/\s+/)
          .filter(Boolean)
          .map((id) => root.getElementById(id)?.textContent),
        ...Array.from(
          (el as HTMLInputElement).labels ?? [],
          (label) => label.textContent,
        ),
      ]
        .join(" ")
        .replace(/[_-]/g, " ");
      if (
        privateLabel.test(hints) ||
        /^(name|given-name|family-name|street-address|email|tel|bday)$/.test(
          el.getAttribute("autocomplete") ?? "",
        )
      )
        add(el);
    });
    root.querySelectorAll("table").forEach((table) => {
      const rows = Array.from(table.rows);
      const headers = rows[0] ? Array.from(rows[0].cells) : [];
      for (const row of rows) {
        const cells = Array.from(row.cells);
        if (cells.length === 2 && privateLabel.test(cells[0].textContent ?? ""))
          add(cells[1]);
        if (row !== rows[0])
          headers.forEach((header, index) => {
            if (
              header.tagName === "TH" &&
              privateLabel.test(header.textContent ?? "")
            )
              add(cells[index] ?? null);
          });
      }
    });
  }
  return [...values];
}
