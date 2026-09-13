import type { Demonstration, RunEvent } from "./recording.js";
export type PendingQuestion = {
  id: string;
  reason:
    "authentication" | "clarification" | "demonstration" | "unexpected_state";
  question: string;
  choices: string[];
  expected_text: string | null;
};
export type SessionControl = {
  owner: "human" | "agent";
  capture: "private" | "observe" | "recording";
  generation: number;
};
export type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};
export type ToolActivity = {
  id: string;
  name: string;
  state: "running" | "done" | "error";
  detail?: string;
};
export type AgentChat = {
  id: string;
  createdAt?: number;
  name: string;
  status: "idle" | "running" | "waiting" | "completed" | "error" | "stopped";
  control?: SessionControl;
  pending?: PendingQuestion | null;
  demonstration?: Demonstration;
  execution?: ExecutionState;
  mode?: "discovery" | "execution" | "repair";
  journal?: RunEvent[];
  contextTokens?: number;
  messages: AgentMessage[];
  tools: ToolActivity[];
  error: string | null;
};
export type CapabilityRef = {
  id: string;
  sourceChatId: string;
  version: number;
};
export type ExecutionState = CapabilityRef & {
  step: number;
  total: number;
  status: "running" | "paused" | "completed";
  validation: boolean;
  inputs: Record<string, string | number | boolean>;
  outputs: Record<string, string>;
  error: string | null;
  uncertain: boolean;
};
export type SavedCapability = {
  validation?: "draft" | "validated" | "failed";
  validationCases?: number;
  id: string;
  name: string;
  description: string;
  version: number;
  sourceChatId: string;
  contract: string;
};
export type AgentBridge = {
  deleteSession: (id: string) => Promise<{ error?: string }>;
  create: (id: string) => Promise<{ chat?: AgentChat; error?: string }>;
  capabilities: () => Promise<{ drafts: SavedCapability[]; error?: string }>;
  state: () => Promise<{ enabled: boolean; model: string; chats: AgentChat[] }>;
  send: (id: string, text: string) => Promise<{ error?: string }>;
  stop: (id: string) => Promise<void>;
  takeover: (id: string) => Promise<{ error?: string }>;
  resume: (
    id: string,
    requestId: string,
    answer: string,
  ) => Promise<{ error?: string }>;
  launch: (
    ref: CapabilityRef,
    inputs: Record<string, unknown>,
    validation: boolean,
  ) => Promise<{ chat?: AgentChat; error?: string }>;
  repair: (id: string) => Promise<{ error?: string }>;
  record: (
    id: string,
    action: "start" | "pause" | "stop" | "remove" | "teach" | "reset",
    stepId?: string,
    parameters?: Record<string, string>,
  ) => Promise<{ error?: string }>;
  subscribe: (listener: (chat: AgentChat) => void) => () => void;
};
