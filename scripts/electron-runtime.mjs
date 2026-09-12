import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import electron from "electron";

export async function prepareElectron() {
  if (process.platform === "darwin") {
    // macOS reads the bundle name before main.cjs can call app.setName().
    // Brand this project's development runtime again after npm reinstalls it.
    const plistPath = join(dirname(electron), "..", "Info.plist");
    const original = await readFile(plistPath, "utf8");
    let plist = original;
    for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
      const entry = new RegExp(
        `(<key>${key}</key>\\s*<string>)[^<]*(</string>)`,
      );
      if (!entry.test(plist))
        throw new Error(`Missing ${key} in Electron's Info.plist`);
      plist = plist.replace(entry, "$1awl$2");
    }
    if (plist !== original) await writeFile(plistPath, plist);
  }
  return electron;
}
