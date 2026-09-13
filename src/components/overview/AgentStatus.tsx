import {
  Check,
  CircleDashed,
  Hand,
  LoaderCircle,
  MousePointer2,
  Play,
  Square,
  CircleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Phase } from "../../agents";

const statuses: Record<Phase, { label: string; icon: LucideIcon }> = {
  waiting: { label: "Needs you", icon: Hand },
  human: { label: "You’re in control", icon: MousePointer2 },
  ready: { label: "Ready", icon: Play },
  replaying: { label: "Working", icon: LoaderCircle },
  finished: { label: "Completed", icon: Check },
  new: { label: "Not started", icon: CircleDashed },
  stopped: { label: "Stopped", icon: Square },
  error: { label: "Failed", icon: CircleAlert },
};

export function AgentStatus({ phase, id }: { phase: Phase; id?: string }) {
  const { label, icon: Icon } = statuses[phase];
  return (
    <span id={id} className="office-status" data-phase={phase}>
      <Icon size={13} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
