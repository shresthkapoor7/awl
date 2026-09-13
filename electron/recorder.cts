import { privatePageValues } from "./privacy.cjs";
import { policyFor } from "./policy.cjs";
import type { WebContents } from "electron";
import { randomUUID } from "node:crypto";
import type { BrowserAccess } from "./tools/core.cjs";
import { toolSignal, ToolError } from "./tools/core.cjs";
import { frames, inPage, cdp, pageIsSensitive } from "./tools/page.cjs";
import {
  targetingRuntime,
  frameIdentity,
  type TargetingRuntime,
} from "./targeting.cjs";
import type { Demonstration, RecordedStep } from "../shared/recording.js";
import type { Target } from "../shared/target.js";

// Runs in the isolated tool world. No listeners exist until the user selects Record.
function installRecorder({
  generation,
  binding,
}: {
  generation: string;
  binding: string;
}) {
  const g = globalThis as typeof globalThis & {
    __awlTargeting: TargetingRuntime;
    __awlSensitive: () => boolean;
    __awlPrivate: () => string[];
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
  const documentId = Math.random().toString(36).slice(2);
  let sequence = 0;
  const capture = (event: Event) => {
    if (!event.isTrusted) return;
    if (g.__awlSensitive()) {
      state.queue = [];
      if (!state.private && typeof (globalThis as any)[binding] === "function")
        (globalThis as any)[binding](
          JSON.stringify({ generation, private: true }),
        );
      state.private = true;
      return;
    }
    state.private = false;
    const raw = event.composedPath().find((item) => item instanceof Element) as
      Element | undefined;
    const el = raw?.closest(
      'input,textarea,select,button,a,[role="button"],[role="textbox"],[contenteditable="true"]',
    );
    if (!el) return;
    const described = g.__awlTargeting.describe(el) as Target | null;
    const target =
      described?.kind === "text" &&
      el.matches('input,textarea,select,[contenteditable="true"]')
        ? null
        : described;
    let operation: RecordedStep["operation"];
    let value: string | null = null;
    if (event.type === "input" || event.type === "change") {
      if (el.matches('input[type="checkbox"],input[type="radio"]')) return;
      operation = el.tagName === "SELECT" ? "select" : "fill";
      // Record that this control changed, never its entry. Parameters are
      // supplied at execution time, including when metadata misses a secret.
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
    const frame =
      window === window.top
        ? null
        : {
            url: location.origin + location.pathname,
            name: window.name.slice(0, 200),
          };
    const step = {
      id: `${generation}:${documentId}:${++sequence}`,
      operation,
      target: target ? { ...target, frame } : null,
      value,
      at: new Date().toISOString(),
      outcome: "Observed human action; result not yet verified.",
    };
    if (step.target && g.__awlPrivate().some((value) => JSON.stringify(step.target).includes(JSON.stringify(value).slice(1, -1)))) {
      step.target = null;
      step.outcome = "Private target text omitted; inspect a structural or parameterized target before replay.";
    }
    // Deliver before navigation can destroy this document. The queue is a
    // fallback if the native binding is briefly unavailable.
    const deliver = (globalThis as any)[binding];
    if (typeof deliver === "function") {
      deliver(JSON.stringify({ generation, step }));
      return;
    }
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
  private seen = new Set<string>();
  private dirty = false;
  private hooks = new Map<
    WebContents,
    {
      binding: string;
      script?: string;
      navigate: (
        event: Electron.Event,
        url: string,
        main?: boolean | number,
      ) => void;
      listener: (event: Electron.Event, method: string, params: any) => void;
    }
  >();
  constructor(
    private browser: BrowserAccess,
    private id: string,
    private changed: (state: Demonstration) => void,
  ) {}
  private publish() {
    this.dirty = false;
    this.changed(structuredClone(this.state));
  }
  async start() {
    if (this.state.mode === "recording") return;
    await this.running;
    await this.clearing;
    if (this.state.mode === "review") {
      this.state.steps = [];
      this.visited.clear();
      this.seen.clear();
    }
    this.generation = randomUUID();
    this.state.mode = "recording";
    this.state.notice = null;
    this.publish();
    await this.runTick();
  }
  private gap(outcome: string, tab = 0) {
    const last = this.state.steps.at(-1);
    if (
      last?.operation === "gap" &&
      last.outcome === outcome &&
      last.tab === tab
    )
      return;
    this.state.steps.push({
      id: randomUUID(),
      at: new Date().toISOString(),
      operation: "gap",
      target: null,
      value: null,
      url: null,
      tab,
      outcome,
    });
    this.dirty = true;
  }
  pause(notice = "Private interval. Capture is off.") {
    if (this.state.mode !== "recording") return;
    this.controller?.abort();
    if (this.timer) clearTimeout(this.timer);
    if (this.state.mode === "recording")
      this.gap("Private interval — no actions retained.");
    this.state.mode = "paused";
    this.state.notice = notice;
    this.generation = randomUUID();
    this.publish();
    this.clearing = this.clear();
  }
  async stop() {
    if (this.timer) clearTimeout(this.timer);
    await this.running;
    await this.clearing;
    if (this.state.mode === "recording") await this.runTick();
    if (this.timer) clearTimeout(this.timer);
    this.generation = randomUUID();
    this.controller?.abort();
    this.state.mode = "review";
    this.state.notice = null;
    this.clearing = this.clear();
    await this.clearing;
    this.publish();
  }
  async reset() {
    await this.stop();
    this.visited.clear();
    this.seen.clear();
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
    this.generation = randomUUID();
    this.controller?.abort();
    if (this.timer) clearTimeout(this.timer);
    void this.clear();
  }
  private append(item: Partial<RecordedStep>, tab: number) {
    if (!item.id || this.seen.has(item.id)) return;
    this.seen.add(item.id);
    if (this.seen.size > 2000)
      this.seen.delete(this.seen.values().next().value!);
    const step = {
      ...item,
      tab,
      url: null,
      value: ["fill", "select"].includes(item.operation ?? "")
        ? null
        : item.value,
    } as RecordedStep;
    const last = this.state.steps.at(-1);
    if (
      (step.operation === "fill" || step.operation === "select") &&
      last?.operation === step.operation &&
      last.tab === tab &&
      JSON.stringify(last.target) === JSON.stringify(step.target)
    )
      this.state.steps[this.state.steps.length - 1] = step;
    else this.state.steps.push(step);
    this.dirty = true;
    if (this.state.steps.length >= 500)
      this.pause(
        "Recording reached 500 steps. Stop to build this capability, or start a shorter demonstration.",
      );
  }
  private navigation(tabId: string, tab: number, raw: string) {
    if (!/^https?:/.test(raw)) return;
    const url = frameIdentity(raw);
    if (this.visited.get(tabId) === url) return;
    this.state.steps.push({
      id: randomUUID(),
      at: new Date().toISOString(),
      operation: "navigate",
      target: null,
      value: null,
      url,
      tab,
      outcome:
        "Observed page URL; query and fragment omitted. This observation is not an instruction to repeat navigation after a captured click or key.",
    });
    this.visited.set(tabId, url);
    this.dirty = true;
  }
  private async attach(wc: WebContents, tab: number, tabId: string) {
    if (this.hooks.has(wc)) return;
    const generation = this.generation;
    const binding = `awl_record_${generation.replaceAll("-", "")}`;
    const listener = (_event: Electron.Event, method: string, params: any) => {
      if (
        method !== "Runtime.bindingCalled" ||
        params.name !== binding ||
        generation !== this.generation ||
        this.state.mode !== "recording"
      )
        return;
      try {
        if (typeof params.payload !== "string" || params.payload.length > 16000)
          return;
        const data = JSON.parse(params.payload);
        if (data.generation === generation && data.private === true) {
          this.gap(
            "Private fields skipped; no input values captured in this frame.",
            tab,
          );
          return;
        }
        if (
          data.generation !== generation ||
          !data.step ||
          !["click", "fill", "select", "press"].includes(data.step.operation)
        )
          return;
        this.append(data.step, tab);
      } catch {
        /* Invalid or late events do not enter the demonstration. */
      }
    };
    const navigate = (
      _event: Electron.Event,
      url: string,
      main?: boolean | number,
    ) => {
      if (
        main === false ||
        generation !== this.generation ||
        this.state.mode !== "recording"
      )
        return;
      this.navigation(tabId, tab, url);
    };
    const hook: {
      binding: string;
      script?: string;
      listener: typeof listener;
      navigate: typeof navigate;
    } = { binding, listener, navigate };
    this.hooks.set(wc, hook);
    wc.debugger.on("message", listener);
    wc.on("did-navigate", navigate);
    wc.on("did-navigate-in-page", navigate);
    try {
      await cdp(wc, "Page.enable");
      await cdp(wc, "Runtime.enable");
      await cdp(wc, "Runtime.addBinding", {
        name: binding,
        executionContextName: "awl-tools",
      });
      const source = `globalThis.__awlTargeting = (${targetingRuntime.toString()})(); globalThis.__awlSensitive = (${pageIsSensitive.toString()}); globalThis.__awlPrivate = () => (${privatePageValues.toString()})(${JSON.stringify(policyFor(wc)?.config.sensitiveSelectors ?? [])}); (${installRecorder.toString()})(${JSON.stringify({ generation, binding })});`;
      // Retain the identifier even when Stop arrives while CDP is responding,
      // so a late registration can always be removed.
      const result = await wc.debugger.sendCommand(
        "Page.addScriptToEvaluateOnNewDocument",
        {
          source,
          worldName: "awl-tools",
          runImmediately: true,
        },
      );
      hook.script = result.identifier;
      if (generation !== this.generation || this.state.mode !== "recording")
        throw new Error("Recording ended during installation.");
    } catch (error) {
      wc.debugger.off("message", listener);
      wc.off("did-navigate", navigate);
      wc.off("did-navigate-in-page", navigate);
      this.hooks.delete(wc);
      if (!wc.isDestroyed() && wc.debugger.isAttached())
        await Promise.allSettled([
          wc.debugger.sendCommand("Runtime.removeBinding", { name: binding }),
          ...(hook.script
            ? [
                wc.debugger.sendCommand(
                  "Page.removeScriptToEvaluateOnNewDocument",
                  { identifier: hook.script },
                ),
              ]
            : []),
        ]);
      throw error;
    }
  }
  private async clear() {
    const hooks = [...this.hooks];
    this.hooks.clear();
    for (const [wc, hook] of hooks) {
      wc.debugger.off("message", hook.listener);
      wc.off("did-navigate", hook.navigate);
      wc.off("did-navigate-in-page", hook.navigate);
      if (wc.isDestroyed() || !wc.debugger.isAttached()) continue;
      await Promise.allSettled([
        wc.debugger.sendCommand("Runtime.removeBinding", {
          name: hook.binding,
        }),
        ...(hook.script
          ? [
              wc.debugger.sendCommand(
                "Page.removeScriptToEvaluateOnNewDocument",
                { identifier: hook.script },
              ),
            ]
          : []),
      ]);
      try {
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
      } catch {
        /* Closed documents have already discarded their listeners. */
      }
    }
  }
  private runTick() {
    return (this.running = this.tick());
  }
  private async tick() {
    const generation = this.generation;
    const controller = (this.controller = new AbortController());
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(10000),
    ]);
    try {
      await toolSignal.run(signal, async () => {
        const tabs = this.browser.tabs(this.id, "list", null).tabs;
        for (const [tabIndex, tab] of tabs.entries()) {
          signal.throwIfAborted();
          if (generation !== this.generation) return;
          const wc = this.browser.target(this.id, tab.id);
          // Hooks are installed in new documents before page scripts run. A
          // navigation no longer erases the click/key that initiated it.
          await this.attach(wc, tabIndex, tab.id);
          if (!/^https?:/.test(tab.url)) continue;
          this.navigation(tab.id, tabIndex, tab.url);
          const list = await frames(wc);
          for (const frame of list.slice(0, 30)) {
            try {
              const result = await inPage(
                wc,
                frame.id,
                () => {
                  const g = globalThis as any;
                  if (!g.__awlRecorder)
                    return { missing: true, private: false, steps: [] };
                  if (g.__awlSensitive()) {
                    g.__awlRecorder.queue = [];
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
              if (result.private) {
                this.gap(
                  "Private fields skipped; no input values captured in this frame.",
                  tabIndex,
                );
                continue;
              }
              for (const item of result.steps) this.append(item, tabIndex);
            } catch (error) {
              if (signal.aborted) throw error;
              // Dynamic/advertising frames can disappear independently of the
              // page being demonstrated. Retry next tick without stopping it.
              if (!(error instanceof ToolError)) throw error;
            }
          }
        }
      });
      if (generation === this.generation && this.state.steps.length >= 500)
        this.pause(
          "Recording reached 500 steps. Stop to build this capability.",
        );
      if (generation === this.generation) {
        if (this.state.notice) {
          this.state.notice = null;
          this.dirty = true;
        }
        if (this.dirty) this.publish();
      }
    } catch {
      if (generation === this.generation) {
        this.state.notice = "Recording is reconnecting to the page…";
        this.publish();
      }
    } finally {
      if (generation === this.generation && this.state.mode === "recording")
        this.timer = setTimeout(() => void this.runTick(), 250);
    }
  }
}
