import type { Target } from "./target.js";
const parameter = /\{\{([a-z][a-z0-9_]{0,59})\}\}/g;
export function parameterNames(text: string): string[] {
  return Array.from(text.matchAll(parameter), (match) => match[1]);
}
export function bindText(text: string, inputs: Record<string, string | number | boolean>, css = false): string {
  return text.replace(parameter, (_, name: string) => {
    if (!Object.hasOwn(inputs, name) || String(inputs[name]).length === 0)
      throw new Error(`Missing target parameter: ${name}`);
    const value = String(inputs[name]);
    // Every codepoint is escaped, so a value cannot add CSS selectors or break quotes.
    return css ? Array.from(value, (char) => `\\${char.codePointAt(0)!.toString(16)} `).join("") : value;
  });
}
export function bindTarget(target: Target, inputs: Record<string, string | number | boolean>): Target {
  return {
    ...target,
    value: bindText(target.value, inputs, target.kind === "css"),
    within: target.within ? bindText(target.within, inputs, true) : null,
    shadow: target.shadow.map((selector) => bindText(selector, inputs, true)),
  };
}
