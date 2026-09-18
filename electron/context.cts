import type { SessionHistory } from "./stored-session.cjs";

// Migration support for interrupted legacy SDK sessions.
export function closeOpenCalls(history: SessionHistory) {
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
