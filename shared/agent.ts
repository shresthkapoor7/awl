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
  name: string;
  status: "idle" | "running" | "error" | "stopped";
  messages: AgentMessage[];
  tools: ToolActivity[];
  error: string | null;
};
export type SavedCapability = {
  id: string;
  name: string;
  description: string;
  version: number;
  sourceChatId: string;
  contract: string;
};
export type AgentBridge = {
  create: (id: string) => Promise<{ chat?: AgentChat; error?: string }>;
  capabilities: () => Promise<{ drafts: SavedCapability[]; error?: string }>;
  state: () => Promise<{ enabled: boolean; model: string; chats: AgentChat[] }>;
  send: (id: string, text: string) => Promise<{ error?: string }>;
  stop: (id: string) => Promise<void>;
  subscribe: (listener: (chat: AgentChat) => void) => () => void;
};
