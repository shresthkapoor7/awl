import type { Target } from "./target.js";
export type RecordedStep = {
  id: string;
  at: string;
  operation: "navigate" | "click" | "fill" | "select" | "press" | "gap";
  target: Target | null;
  value: string | null;
  url: string | null;
  tab: number;
  outcome: string;
};
export type Demonstration = {
  mode: "off" | "recording" | "paused" | "review";
  steps: RecordedStep[];
  notice: string | null;
};
export type RunEvent = {
  sequence: number;
  at: string;
  actor: "agent" | "human" | "runtime";
  kind: string;
  label: string;
  data?: unknown;
  image?: string;
};
