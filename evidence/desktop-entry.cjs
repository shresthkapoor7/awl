// Launch the real application with an isolated reviewer profile.
const { app } = require("electron");
const path = require("node:path");
const profile = process.env.AWL_EVIDENCE_PROFILE;
if (!profile || !path.isAbsolute(profile)) {
  throw new Error("Start this entry through evidence/launch.mjs.");
}
const root = path.resolve(__dirname, "..");
app.setPath("userData", profile);
app.setAppPath(root);
require(path.join(root, "electron/main.cjs"));
app.on("window-all-closed", () => app.quit());
