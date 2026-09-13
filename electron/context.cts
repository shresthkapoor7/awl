import type OpenAI from "openai";
import type { ResponseInput } from "openai/resources/responses/responses";
export type ContextClient = {
  compact?: (
    body: OpenAI.Responses.ResponseCompactParams,
    options?: { signal: AbortSignal },
  ) => Promise<{ output: OpenAI.Responses.ResponseOutputItem[] }>;
  inputTokens?: {
    count: (
      body: {
        model: string;
        input: ResponseInput;
        instructions: string;
        tools: OpenAI.Responses.Tool[];
      },
      options?: { signal: AbortSignal },
    ) => Promise<{ input_tokens: number }>;
  };
};
export async function budgetContext(
  client: ContextClient,
  input: ResponseInput,
  model: string,
  instructions: string,
  tools: OpenAI.Responses.Tool[],
  signal: AbortSignal,
  threshold = 48000,
) {
  const count = async (history: ResponseInput) =>
    client.inputTokens
      ? (
          await client.inputTokens.count(
            { model, input: history, instructions, tools },
            { signal },
          )
        ).input_tokens
      : Buffer.byteLength(
          JSON.stringify({ input: history, instructions, tools }),
        );
  let tokens = await count(input);
  if (tokens < threshold) return { input, tokens, compacted: false };
  if (!client.compact) throw new Error("CONTEXT_LIMIT");
  const compacted = await client.compact(
    { model, input, instructions },
    { signal },
  );
  signal.throwIfAborted();
  if (
    !compacted.output.length ||
    !compacted.output.some((item) => item.type === "compaction")
  )
    throw new Error("CONTEXT_LIMIT");
  const next = compacted.output as ResponseInput;
  tokens = await count(next);
  if (tokens >= threshold) throw new Error("CONTEXT_LIMIT");
  return { input: next, tokens, compacted: true };
}
export function closeOpenCalls(history: ResponseInput) {
  const answered = new Set(
    history
      .filter((item) => item.type === "function_call_output")
      .map((item) => item.call_id),
  );
  for (const item of [...history])
    if (item.type === "function_call" && !answered.has(item.call_id))
      history.push({
        type: "function_call_output",
        call_id: item.call_id,
        output: JSON.stringify({
          ok: false,
          error:
            "Interrupted; action outcome is uncertain. Inspect before retrying.",
        }),
      });
}
