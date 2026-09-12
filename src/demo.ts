export type Phase =
  "waiting" | "human" | "ready" | "replaying" | "finished" | "new";
export type Message = { id: string; role: "user" | "assistant"; text: string };
export type Agent = {
  id: string;
  name: string;
  description: string;
  kind: "onboarding" | "statement";
  phase: Phase;
  verified: boolean;
  messages: Message[];
};

export const initialAgents: Agent[] = [
  {
    id: "onboarding",
    name: "Member onboarding",
    description: "Prepare a savings account",
    kind: "onboarding",
    phase: "waiting",
    verified: false,
    messages: [],
  },
  {
    id: "statement",
    name: "Statement lookup",
    description: "Find the latest statement",
    kind: "statement",
    phase: "finished",
    verified: true,
    messages: [],
  },
];

export function phaseLabel(phase: Phase) {
  return {
    waiting: "Needs you",
    human: "You’re in control",
    ready: "Ready to replay",
    replaying: "Replaying",
    finished: "Completed",
    new: "New session",
  }[phase];
}

export function capabilityCode(kind: Agent["kind"]) {
  const name =
    kind === "onboarding" ? "prepare_savings_account" : "find_latest_statement";
  return `capability: ${name}\nversion: 1\n\ninputs:\n  member_id: string\n\nsteps:\n  - find_member: $member_id\n  - verify: member_profile\n  - ${kind === "onboarding" ? "prepare: savings_account\n  - checkpoint: review_screen" : "open: statements\n  - checkpoint: latest_statement"}\n\noutputs:\n  member_id: string\n  status: ${kind === "onboarding" ? "ready_for_review" : "statement_found"}\n\non_unknown_state: pause_for_human`;
}
