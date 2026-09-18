import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";
import {
  type AgentProvider,
  type AgentTurn,
  ProviderError,
} from "./agent-provider.cjs";

type RpcId = string | number;
type RpcMessage = {
  id?: RpcId;
  method?: string;
  params?: any;
  result?: any;
  error?: unknown;
};
// These overrides affect only the child process. Never rewrite the user's Codex config.
const restrictions: Record<string, unknown> = {
  "features.shell_tool": false,
  "features.unified_exec": false,
  "features.apply_patch_freeform": false,
  "features.js_repl": false,
  "features.code_mode": false,
  "features.code_mode_only": false,
  "features.code_mode_host": false,
  "features.apps": false,
  "features.connectors": false,
  "features.plugins": false,
  "features.remote_plugin": false,
  "features.recommended_plugins": false,
  "features.hooks": false,
  "features.codex_hooks": false,
  "features.plugin_hooks": false,
  "features.multi_agent": false,
  "features.multi_agent_v2": false,
  "features.memories": false,
  "features.memory_tool": false,
  "features.browser_use": false,
  "features.browser_use_external": false,
  "features.in_app_browser": false,
  "features.computer_use": false,
  "features.image_generation": false,
  "features.imagegenext": false,
  "features.view_image": false,
  "features.skill_mcp_dependency_install": false,
  "features.skip_host_skill_discovery": true,
  "skills.include_instructions": false,
  "skills.bundled.enabled": false,
  project_doc_max_bytes: 0,
  web_search: "disabled",
  approval_policy: "never",
  sandbox_mode: "read-only",
};

/** Newline-delimited JSON-RPC; bounded requests and process lifetime, no shell. */
class Connection {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private pending = new Map<
    RpcId,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  private buffer = "";
  private ended = false;
  readonly lifetime = new AbortController();
  onNotification: (message: RpcMessage) => void = () => {};
  onRequest: (message: RpcMessage) => Promise<unknown> = async () => {
    throw new Error("Unsupported request");
  };
  constructor(binary: string, cwd: string, home?: string) {
    const env = { ...process.env };
    // Finder-launched Electron may not inherit the interactive shell's PATH.
    env.PATH = [
      env.PATH,
      "/opt/homebrew/bin",
      "/usr/local/bin",
      join(homedir(), ".local/bin"),
    ]
      .filter(Boolean)
      .join(delimiter);
    if (home) env.CODEX_HOME = home;
    delete env.OPENAI_API_KEY;
    delete env.CODEX_API_KEY;
    const args = ["app-server", "--listen", "stdio://"];
    for (const [key, value] of Object.entries(restrictions))
      args.push("-c", `${key}=${JSON.stringify(value)}`);
    this.child = spawn(binary, args, {
      cwd,
      env,
      stdio: "pipe",
      windowsHide: true,
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.read(chunk));
    // Drain stderr without copying account details or tool observations into app logs.
    this.child.stderr.resume();
    this.child.stdin.on("error", () =>
      this.fail(
        new ProviderError(
          "Codex disconnected. Check the page before continuing.",
        ),
      ),
    );
    this.child.on("error", () =>
      this.fail(
        new ProviderError(
          "Could not start Codex. Install Codex CLI 0.155.0 or newer, or set AWL_CODEX_BINARY to its path.",
        ),
      ),
    );
    this.child.on("exit", () =>
      this.fail(
        new ProviderError(
          "Codex exited. Check your Codex installation and sign in with codex login.",
        ),
      ),
    );
  }
  private read(chunk: string) {
    if (this.ended) return;
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > 24 * 1024 * 1024) {
      this.fail(new ProviderError("Codex returned an oversized response."));
      return;
    }
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message: RpcMessage;
      try {
        message = JSON.parse(line);
      } catch {
        this.fail(
          new ProviderError("Codex returned an invalid protocol message."),
        );
        return;
      }
      if (!message || typeof message !== "object") continue;
      if (message.method && message.id !== undefined) {
        void this.onRequest(message)
          .then(
            (result) => this.write({ id: message.id, result }),
            () =>
              this.write({
                id: message.id,
                error: {
                  code: -32601,
                  message:
                    "This request is not available in awl. Use awl tools.",
                },
              }),
          )
          .catch(() => {});
      } else if (message.method) {
        try {
          this.onNotification(message);
        } catch {
          this.fail(
            new ProviderError(
              "Codex returned an incompatible event. Update Codex and try again.",
            ),
          );
        }
      } else if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        if (message.error)
          pending.reject(
            new ProviderError(
              "Codex rejected the request. Check your login, model access, and CLI version. No action was automatically retried.",
            ),
          );
        else pending.resolve(message.result);
      }
    }
  }
  private write(message: RpcMessage) {
    if (this.ended) throw new ProviderError("Codex is disconnected.");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }
  notify(method: string, params?: unknown) {
    this.write({ method, params });
  }
  request(method: string, params: unknown, signal: AbortSignal): Promise<any> {
    signal.throwIfAborted();
    if (this.ended) return Promise.reject(this.lifetime.signal.reason);
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const deadline = setTimeout(
        () =>
          done(
            new ProviderError(
              `Codex ${method} timed out. Check the page before continuing.`,
            ),
          ),
        30000,
      );
      const aborted = () => done(signal.reason);
      const cleanup = () => {
        clearTimeout(deadline);
        signal.removeEventListener("abort", aborted);
        this.pending.delete(id);
      };
      const done = (error: Error) => {
        cleanup();
        reject(error);
      };
      this.pending.set(id, {
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: done,
      });
      signal.addEventListener("abort", aborted, { once: true });
      try {
        this.write({ id, method, params });
      } catch (error) {
        done(error as Error);
      }
    });
  }
  private fail(error: Error) {
    if (this.ended) return;
    this.ended = true;
    this.lifetime.abort(error);
    for (const request of [...this.pending.values()]) request.reject(error);
    this.pending.clear();
    this.child.kill();
    const child = this.child;
    const kill = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 1500);
    kill.unref();
    child.once("exit", () => clearTimeout(kill));
  }
  close() {
    this.fail(new ProviderError("Codex connection closed."));
  }
}

export class CodexProvider implements AgentProvider {
  private connections = new Set<Connection>();
  private sessions = new Set<string>();
  constructor(
    private options: { directory: string; binary?: string; home?: string },
  ) {}
  close() {
    for (const connection of this.connections) connection.close();
  }
  async run(turn: AgentTurn) {
    if (this.sessions.has(turn.sessionId))
      throw new ProviderError("This Codex chat is already running.");
    this.sessions.add(turn.sessionId);
    let connection: Connection | undefined;
    let toolQueue: Promise<unknown> = Promise.resolve();
    try {
      turn.signal.throwIfAborted();
      const cwd = join(this.options.directory, turn.sessionId);
      await mkdir(cwd, { recursive: true, mode: 0o700 });
      turn.signal.throwIfAborted();
      const rpc = (connection = new Connection(
        this.options.binary || "codex",
        cwd,
        this.options.home,
      ));
      this.connections.add(rpc);
      const signal = AbortSignal.any([turn.signal, rpc.lifetime.signal]);
      await rpc.request(
        "initialize",
        {
          clientInfo: { name: "awl", title: "awl", version: "0.1.0" },
          capabilities: { experimentalApi: true },
        },
        signal,
      );
      rpc.notify("initialized");
      const account = await rpc.request(
        "account/read",
        { refreshToken: false },
        signal,
      );
      if (!account.account && account.requiresOpenaiAuth !== false)
        throw new ProviderError(
          "Sign in with codex login in your terminal, then send your message again.",
        );
      // Disable inherited MCP servers by name; an empty table alone would merge
      // with the user's table rather than reliably removing its entries.
      const config = await rpc.request(
        "config/read",
        { includeLayers: false },
        signal,
      );
      if (!config.config || typeof config.config !== "object")
        throw new ProviderError(
          "Could not read Codex configuration safely. Update Codex and try again.",
        );
      const overrides = { ...restrictions };
      for (const name of Object.keys(config.config.mcp_servers ?? {}))
        overrides[`mcp_servers.${JSON.stringify(name)}.enabled`] = false;
      const common = {
        model: turn.model,
        cwd,
        approvalPolicy: "never",
        sandbox: "read-only",
        baseInstructions: turn.instructions,
        developerInstructions:
          "Only awl's supplied tools may interact with the browser or save capabilities.",
        config: overrides,
      };
      const started = turn.threadId
        ? await rpc.request(
            "thread/resume",
            { ...common, threadId: turn.threadId, excludeTurns: true },
            signal,
          )
        : await rpc.request(
            "thread/start",
            {
              ...common,
              ephemeral: false,
              environments: [],
              dynamicTools: turn.tools.map((tool) => ({
                type: "function",
                name: tool.name,
                description: tool.description,
                inputSchema: tool.parameters,
              })),
            },
            signal,
          );
      const threadId = started.thread?.id;
      if (
        typeof threadId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,160}$/.test(threadId) ||
        (turn.threadId && threadId !== turn.threadId)
      )
        throw new ProviderError(
          "Codex returned an unexpected thread. No tools were dispatched.",
        );
      let turnId: string | undefined;
      let acceptancePersisted = false;
      let stopping = false;
      let resolveDone!: () => void;
      let rejectDone!: (error: Error) => void;
      const done = new Promise<void>((resolve, reject) => {
        resolveDone = resolve;
        rejectDone = reject;
      });
      // The turn can fail before turn/start returns; attach the rejection handler now.
      void done.catch(() => {});
      let interruptTimer: ReturnType<typeof setTimeout> | undefined;
      const interrupt = () => {
        if (interruptTimer) return;
        stopping = true;
        if (turnId)
          void rpc
            .request(
              "turn/interrupt",
              { threadId, turnId },
              AbortSignal.timeout(1500),
            )
            .catch(() => {});
        interruptTimer = setTimeout(() => {
          if (turn.signal.aborted) rejectDone(turn.signal.reason);
          else resolveDone();
          rpc.close();
        }, 1800);
      };
      const onAbort = () => {
        if (rpc.lifetime.signal.aborted) rejectDone(rpc.lifetime.signal.reason);
        else interrupt();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      const buffered: RpcMessage[] = [];
      const seenMessages = new Set<string>();
      const seenCalls = new Set<string>();
      const handleEvent = (message: RpcMessage) => {
        const p = message.params;
        if (!p || p.threadId !== threadId) return;
        if (!turnId || !acceptancePersisted) {
          buffered.push(message);
          return;
        }
        if ((p.turnId ?? p.turn?.id) !== turnId) return;
        if (message.method === "turn/completed") {
          if (turn.signal.aborted) rejectDone(turn.signal.reason);
          else if (stopping || p.turn?.status === "completed") resolveDone();
          else
            rejectDone(
              new ProviderError(
                "Codex could not finish this turn. Check model access and the current page before continuing.",
              ),
            );
        } else if (!stopping && message.method === "item/completed") {
          if (
            p.item?.type === "agentMessage" &&
            typeof p.item.text === "string" &&
            !seenMessages.has(p.item.id)
          ) {
            seenMessages.add(p.item.id);
            turn.onMessage(p.item.id, p.item.text);
          }
          if (p.item?.type === "contextCompaction") turn.onCompacted();
        } else if (message.method === "thread/tokenUsage/updated") {
          const tokens = p.tokenUsage?.last?.inputTokens;
          if (
            typeof tokens === "number" &&
            Number.isFinite(tokens) &&
            tokens >= 0
          )
            turn.onTokens(tokens);
        }
      };
      rpc.onNotification = handleEvent;
      let accept!: () => void;
      const accepted = new Promise<void>((resolve) => {
        accept = resolve;
      });
      rpc.onRequest = async (message) => {
        // Refuse built-in command/file/permission requests, not merely in the prompt.
        if (message.method !== "item/tool/call")
          throw new Error("Unsupported request");
        const call = message.params;
        const result = toolQueue.then(async () => {
          await accepted;
          if (
            signal.aborted ||
            stopping ||
            call?.threadId !== threadId ||
            call?.turnId !== turnId ||
            typeof call.callId !== "string" ||
            seenCalls.has(call.callId)
          )
            return {
              success: false,
              contentItems: [
                {
                  type: "inputText",
                  text: "Turn is no longer active or tool call identity is invalid. No action executed.",
                },
              ],
            };
          seenCalls.add(call.callId);
          const reply = await turn.callTool(
            {
              id: call.callId,
              name: call.tool,
              arguments: JSON.stringify(call.arguments) ?? "null",
            },
            signal,
          );
          signal.throwIfAborted();
          if (reply.stop) {
            stopping = true;
            setImmediate(interrupt);
          }
          return {
            success: reply.success,
            contentItems: [
              { type: "inputText", text: reply.text },
              ...(reply.image
                ? [{ type: "inputImage", imageUrl: reply.image }]
                : []),
            ],
          };
        });
        toolQueue = result.catch((error) => {
          rejectDone(error);
          interrupt();
        });
        return result;
      };
      try {
        const response = await rpc.request(
          "turn/start",
          {
            threadId,
            model: turn.model,
            effort: "medium",
            environments: [],
            input: [{ type: "text", text: turn.input, text_elements: [] }],
          },
          signal,
        );
        turnId = response.turn?.id;
        if (!turnId)
          throw new ProviderError("Codex did not return a turn identity.");
        turn.onThread(threadId);
        await turn.onAccepted();
        acceptancePersisted = true;
        accept();
        for (const message of buffered) handleEvent(message);
        if (signal.aborted) onAbort();
        await done;
      } finally {
        stopping = true;
        accept();
        signal.removeEventListener("abort", onAbort);
        if (interruptTimer) clearTimeout(interruptTimer);
      }
    } finally {
      connection?.close();
      // Closing aborts dispatch before the runtime releases browser ownership.
      await toolQueue.catch(() => {});
      if (connection) this.connections.delete(connection);
      this.sessions.delete(turn.sessionId);
    }
  }
}
