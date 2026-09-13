import type { AgentChat } from "../shared/agent";
// Motion states are projections of live session state, never timers in the UI.
export type Phase =
  | "waiting"
  | "human"
  | "ready"
  | "replaying"
  | "finished"
  | "new"
  | "stopped"
  | "error";
export type Agent = {
  id: string;
  name: string;
  phase: Phase;
  live: AgentChat;
  messages: AgentChat["messages"];
};
export function fromChat(chat: AgentChat): Agent {
  return {
    id: chat.id,
    name: chat.name,
    messages: chat.messages,
    live: chat,
    phase:
      chat.status === "running"
        ? "replaying"
        : chat.pending
          ? chat.pending.reason === "demonstration"
            ? "human"
            : "waiting"
          : chat.status === "stopped" || chat.status === "error"
            ? chat.status
            : chat.status === "waiting"
              ? "waiting"
              : chat.status === "completed"
                ? "finished"
                : chat.messages.length
                  ? "ready"
                  : "new",
  };
}
export function blankAgent() {
  return fromChat({
    id: crypto.randomUUID(),
    name: "New agent",
    status: "idle",
    messages: [],
    tools: [],
    error: null,
  });
}
export function phaseLabel(phase: Phase) {
  return {
    waiting: "Needs you",
    human: "You’re in control",
    ready: "Ready",
    replaying: "Working",
    finished: "Completed",
    new: "Not started",
    stopped: "Stopped",
    error: "Failed",
  }[phase];
}
