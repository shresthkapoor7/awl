/** awl owns sessions and tools; providers own their model conversation. */
export type ToolCall = { id: string; name: string; arguments: string };
export type ToolReply = {
  success: boolean;
  text: string;
  image?: string;
  /** A handoff/completion ends this turn before another tool may execute. */
  stop?: boolean;
};
export type AgentTurn = {
  sessionId: string;
  threadId?: string;
  model: string;
  instructions: string;
  input: string;
  signal: AbortSignal;
  tools: { name: string; description: string; parameters: unknown }[];
  onThread: (id: string) => void;
  onAccepted: () => void;
  onMessage: (id: string, text: string) => void;
  onTokens: (tokens: number) => void;
  onCompacted: () => void;
  callTool: (call: ToolCall, signal: AbortSignal) => Promise<ToolReply>;
};
export interface AgentProvider {
  run(turn: AgentTurn): Promise<void>;
  close(): void;
}
export class ProviderError extends Error {}
