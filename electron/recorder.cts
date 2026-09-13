import { randomUUID } from "node:crypto";
import type { BrowserAccess } from "./tools/core.cjs";
import { toolSignal, abortable } from "./tools/core.cjs";
import {
  frames,
  inPage,
  cdp,
  observable,
  pageIsSensitive,
} from "./tools/page.cjs";
import {
  installTargeting,
  frameIdentity,
  type TargetingRuntime,
} from "./targeting.cjs";
import type { Demonstration, RecordedStep } from "../shared/recording.js";
import type { Target } from "../shared/target.js";

// Runs in the isolated tool world. No listeners exist until the user selects Record.
function installRecorder(generation: string) {
  const g = globalThis as typeof globalThis & {
    __awlTargeting: TargetingRuntime;
    __awlSensitive: () => boolean;
    __awlRecorder?: {
      generation: string;
      queue: Partial<RecordedStep>[];
      stop: () => void;
      private: boolean;
    };
  };
  if (g.__awlRecorder?.generation === generation) return;
  g.__awlRecorder?.stop();
  const state = {
    generation,
    queue: [] as Partial<RecordedStep>[],
    private: false,
    stop: () => {},
  };
  const capture = (event: Event) => {
    if (!event.isTrusted || state.private) return;
    if (g.__awlSensitive()) {
      state.queue = [];
      state.private = true;
      return;
    }
    const raw = event.composedPath().find((item) => item instanceof Element) as
      Element | undefined;
    const el = raw?.closest(
      'input,textarea,select,button,a,[role="button"],[role="textbox"],[contenteditable="true"]',
    );
    if (!el) return;
    const target = g.__awlTargeting.describe(el) as Target | null;
    let operation: RecordedStep["operation"];
    let value: string | null = null;
    if (event.type === "input" || event.type === "change") {
      if (el.matches('input[type="checkbox"],input[type="radio"]')) return;
      operation = el.tagName === "SELECT" ? "select" : "fill";
      value = (
        (el as HTMLInputElement).value ??
        (el as HTMLElement).innerText ??
        ""
      ).slice(0, 1000);
    } else if (event.type === "keydown") {
      if ((event as KeyboardEvent).key !== "Enter") return;
      operation = "press";
      value = "Enter";
    } else {
      if (
        el.matches(
          'input:not([type="checkbox"]):not([type="radio"]):not([type="submit"]),textarea,select,[contenteditable="true"]',
        )
      )
        return;
      operation = "click";
    }
    const step = {
      operation,
      target,
      value,
      at: new Date().toISOString(),
      outcome: "Observed human action; result not yet verified.",
    };
    const last = state.queue.at(-1);
    if (
      (operation === "fill" || operation === "select") &&
      last?.operation === operation &&
      JSON.stringify(last.target) === JSON.stringify(target)
    )
      state.queue[state.queue.length - 1] = step;
    else state.queue.push(step);
    if (state.queue.length > 100) {
      state.queue = [];
      state.private = true;
    }
  };
  const events = ["click", "input", "change", "keydown"];
  events.forEach((name) => document.addEventListener(name, capture, true));
  state.stop = () => {
    events.forEach((name) => document.removeEventListener(name, capture, true));
    state.queue = [];
  };
  g.__awlRecorder = state;
}
export class Recorder {
  state: Demonstration = { mode: "off", steps: [], notice: null };
  private generation = randomUUID();
  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private clearing = Promise.resolve();
  private running?: Promise<void>;
  private visited = new Map<string, string>();
  constructor(
    private browser: BrowserAccess,
    private id: string,
    private changed: (state: Demonstration) => void,
  ) {}
  private publish() {
    this.changed(structuredClone(this.state));
  }
  async start() {
    if (this.state.mode === "recording") return;
    await this.clearing;
    const tabs = this.browser.tabs(this.id, "list", null).tabs;
    if (!tabs.some((tab) => tab.url !== "about:blank"))
      throw new Error("Open a website before recording.");
    const signal = AbortSignal.timeout(10000);
    await toolSignal.run(signal, async () => {
      for (const tab of tabs)
        if (tab.url !== "about:blank")
          await abortable(
            observable(this.browser.target(this.id, tab.id)),
            signal,
          );
    });
    this.generation = randomUUID();
    this.state.mode = "recording";
    this.state.notice = null;
    this.publish();
    await this.runTick();
  }
  pause(notice = "Private interval. Capture is off.") {
    this.controller?.abort();
    if (this.timer) clearTimeout(this.timer);
    if (this.state.mode === "recording")
      this.state.steps.push({
        id: randomUUID(),
        at: new Date().toISOString(),
        operation: "gap",
        target: null,
        value: null,
        url: null,
        tab: 0,
        outcome: "Private interval — no actions retained.",
      });
    this.state.mode = "paused";
    this.state.notice = notice;
    this.generation = randomUUID();
    this.publish();
    this.clearing = this.clear();
  }
  async stop() {
    if (this.timer) clearTimeout(this.timer);
    await this.running;
    if (this.state.mode === "recording") await this.runTick();
    if (this.timer) clearTimeout(this.timer);
    this.generation = randomUUID();
    this.controller?.abort();
    this.state.mode = "review";
    this.state.notice = "Review the recorded actions before using them.";
    this.clearing = this.clear();
    await this.clearing;
    this.publish();
  }
  async reset() {
    await this.stop();
    this.visited.clear();
    this.state = { mode: "off", steps: [], notice: null };
    this.publish();
  }
  remove(stepId: string) {
    if (this.state.mode === "recording")
      throw new Error("Stop recording before editing.");
    this.state.steps = this.state.steps.filter((step) => step.id !== stepId);
    this.publish();
  }
  close() {
    this.controller?.abort();
    if (this.timer) clearTimeout(this.timer);
    void this.clear();
  }
  private async clear() {
    try {
      for (const tab of this.browser.tabs(this.id, "list", null).tabs) {
        const wc = this.browser.target(this.id, tab.id);
        for (const frame of await frames(wc))
          await inPage(
            wc,
            frame.id,
            () => {
              const g = globalThis as any;
              g.__awlRecorder?.stop();
              delete g.__awlRecorder;
            },
            null,
          ).catch(() => {});
      }
    } catch {
      /* A closed tab has already discarded its listeners. */
    }
  }
  private runTick() {
    return (this.running = this.tick());
  }
  private async tick() {
    const generation = this.generation;
    const before = JSON.stringify(this.state.steps);
    const controller = (this.controller = new AbortController());
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(10000),
    ]);
    try {
      await toolSignal.run(signal, async () => {
        const tabs = this.browser.tabs(this.id, "list", null).tabs;
        // Check every participating tab before draining any captured values.
        for (const tab of tabs)
          if (tab.url !== "about:blank")
            await abortable(
              observable(this.browser.target(this.id, tab.id)),
              signal,
            );
        for (const [tabIndex, tab] of tabs.entries()) {
          if (tab.url === "about:blank") continue;
          const wc = this.browser.target(this.id, tab.id);
          const url = frameIdentity(tab.url);
          if (this.visited.get(tab.id) !== url) {
            if (this.visited.has(tab.id))
              this.state.steps.push({
                id: randomUUID(),
                at: new Date().toISOString(),
                operation: "gap",
                target: null,
                value: null,
                url: null,
                tab: tabIndex,
                outcome:
                  "Navigation boundary. The initiating action may not have been captured; review before using this evidence.",
              });
            this.state.steps.push({
              id: randomUUID(),
              at: new Date().toISOString(),
              operation: "navigate",
              target: null,
              value: null,
              url,
              tab: tabIndex,
              outcome: "Observed navigation; query and fragment omitted.",
            });
            this.visited.set(tab.id, url);
          }
          const list = await frames(wc);
          for (const frame of list) {
            await installTargeting(wc, frame.id);
            const { executionContextId } = await cdp(
              wc,
              "Page.createIsolatedWorld",
              { frameId: frame.id, worldName: "awl-tools" },
            );
            await cdp(wc, "Runtime.evaluate", {
              contextId: executionContextId,
              expression: `globalThis.__awlSensitive = (${pageIsSensitive.toString()});`,
            });
            await inPage(wc, frame.id, installRecorder, generation);
            const result = await inPage(
              wc,
              frame.id,
              () => {
                const g = globalThis as any;
                if (g.__awlSensitive() || g.__awlRecorder.private) {
                  g.__awlRecorder.stop();
                  return { private: true, steps: [] };
                }
                return {
                  private: false,
                  steps: g.__awlRecorder.queue.splice(
                    0,
                  ) as Partial<RecordedStep>[],
                };
              },
              null,
            );
            signal.throwIfAborted();
            if (generation !== this.generation) return;
            if (result.private) throw new Error("Private page");
            for (const item of result.steps) {
              const target = item.target
                ? {
                    ...item.target,
                    frame:
                      frame === list[0]
                        ? null
                        : {
                            url: frameIdentity(frame.url),
                            name: frame.name || "",
                          },
                  }
                : null;
              const step = {
                ...item,
                target,
                id: randomUUID(),
                tab: tabIndex,
                url: null,
              } as RecordedStep;
              const last = this.state.steps.at(-1);
              if (
                step.operation === "fill" &&
                last?.operation === "fill" &&
                last.tab === step.tab &&
                JSON.stringify(last.target) === JSON.stringify(step.target)
              )
                this.state.steps[this.state.steps.length - 1] = step;
              else this.state.steps.push(step);
            }
          }
        }
        if (this.state.steps.length > 200) throw new Error("Recording limit");
      });
      if (
        generation === this.generation &&
        before !== JSON.stringify(this.state.steps)
      )
        this.publish();
    } catch {
      if (generation === this.generation)
        this.pause(
          "Capture paused: private input, page change, or capture limit. Check the page before recording again.",
        );
    } finally {
      if (generation === this.generation && this.state.mode === "recording")
        this.timer = setTimeout(() => void this.runTick(), 250);
    }
  }
}
