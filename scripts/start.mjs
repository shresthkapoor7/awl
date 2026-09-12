import { spawn } from "node:child_process";
import electron from "electron";

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.AWL_DEV_URL;
const child = spawn(electron, ["."], { stdio: "inherit", env: environment });
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
process.on("SIGINT", () => child.kill("SIGTERM"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
