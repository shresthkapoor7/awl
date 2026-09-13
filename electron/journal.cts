import { redactText, redactData } from "./privacy.cjs";
import type { RunEvent } from "../shared/recording.js";

export class Journal {
  private events = new Map<string, RunEvent[]>();

  list(id: string) {
    return structuredClone(this.events.get(id) ?? []);
  }
  remove(id: string) {
    this.events.delete(id);
  }
  add(id: string, actor: RunEvent["actor"], kind: string, label: string) {
    const events = this.events.get(id) ?? [];
    const event: RunEvent = {
      sequence: (events.at(-1)?.sequence ?? 0) + 1,
      at: new Date().toISOString(),
      actor,
      kind,
      label: redactText(label, id).slice(0, 1000),
    };
    events.push(event);
    if (events.length > 2000) events.shift();
    this.events.set(id, events);
    return event;
  }
  evidence(id: string, sequence: number) {
    const event = this.events
      .get(id)
      ?.find((item) => item.sequence === sequence);
    return event?.data === undefined ? null : structuredClone(event.data);
  }
  attach(id: string, sequence: number, data: unknown, image?: string) {
    const events = this.events.get(id) ?? [];
    const event = events.find((item) => item.sequence === sequence);
    if (!event) return;
    if (JSON.stringify(data).length <= 64000) event.data = redactData(data, id);
    if (image?.startsWith("data:image/png;base64,") && image.length < 2_000_000)
      event.image = image;
    let evidence = 0,
      images = 0;
    for (const item of [...events].reverse()) {
      if (item.data !== undefined && ++evidence > 20) delete item.data;
      if (item.image && ++images > 4) delete item.image;
    }
  }
  restore(id: string, events: RunEvent[]) {
    this.events.set(id, structuredClone(events.slice(-2000)));
  }
}
