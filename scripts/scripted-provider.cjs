// CI-only adapter for the existing scripted model transcripts. This is NOT an
// alternate app backend; production only receives AgentProvider implementations.
const {
  AgentRuntime: Runtime,
} = require("../dist-electron/electron/agent-runtime.cjs");
const { randomUUID } = require("node:crypto");
function scriptedProvider(responses) {
  const histories = new Map();
  return {
    close() {},
    async run(turn) {
      turn.signal.throwIfAborted();
      const threadId = turn.threadId || randomUUID();
      const input = histories.get(threadId) || [];
      input.push(...JSON.parse(turn.input));
      histories.set(threadId, input);
      turn.onThread(threadId);
      await turn.onAccepted();
      turn.signal.throwIfAborted();
      for (let n = 0; n < 65; n++) {
        const result = await responses.create(
          {
            model: turn.model,
            instructions: turn.instructions,
            input,
            tools: turn.tools,
          },
          { signal: turn.signal },
        );
        turn.signal.throwIfAborted();
        if (result.status !== "completed")
          throw new Error("INCOMPLETE_RESPONSE");
        if (result.output_text) {
          turn.onMessage(randomUUID(), result.output_text);
          input.push({ role: "assistant", content: result.output_text });
        }
        const calls = result.output.filter(
          (item) => item.type === "function_call",
        );
        if (!calls.length) return;
        for (const call of calls) {
          const reply = await turn.callTool(
            { id: call.call_id, name: call.name, arguments: call.arguments },
            turn.signal,
          );
          input.push(call, {
            type: "function_call_output",
            call_id: call.call_id,
            output: [{ type: "input_text", text: reply.text }],
          });
          if (reply.stop) return;
        }
      }
      throw new Error("TOOL_BUDGET");
    },
  };
}
class AgentRuntime extends Runtime {
  constructor(options) {
    super({
      ...options,
      client: options.client?.responses
        ? scriptedProvider(options.client.responses)
        : options.client,
    });
  }
}
module.exports = { AgentRuntime, scriptedProvider };
