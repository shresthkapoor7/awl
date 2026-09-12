import { createServer } from "vite";
import { spawn } from "node:child_process";
import electron from "electron";

const server = await createServer();
await server.listen();
const address = server.httpServer.address();
const environment = {
  ...process.env,
  AWL_DEV_URL: `http://127.0.0.1:${address.port}`,
};
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["."], {
  stdio: "inherit",
  env: environment,
});
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (child.exitCode === null) child.kill("SIGTERM");
  await server.close();
  process.exit(code);
}
child.on("exit", (code) => stop(code ?? 0));
child.on("error", (error) => {
  console.error(error);
  stop(1);
});
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
