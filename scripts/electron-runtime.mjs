import { constants } from "node:fs";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

export async function prepareElectron() {
  if (process.platform !== "darwin") return electron;

  const sourceBundle = join(dirname(electron), "..", "..");
  const version = (
    await readFile(join(sourceBundle, "..", "version"), "utf8")
  ).trim();
  const cache = fileURLToPath(
    new URL(
      `../node_modules/.cache/awl/electron-${version}-v1/`,
      import.meta.url,
    ),
  );
  const bundle = join(cache, "awl.app");
  const executable = join(bundle, "Contents", "MacOS", "awl");
  try {
    await readFile(join(cache, "ready"), "utf8");
    return executable;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  // The Dock identifies the native bundle, independently of app.setName().
  // Keep our own named runtime so Electron's package stays reusable and upgrades
  // automatically get a fresh bundle. APFS can clone the files without duplication.
  await mkdir(cache, { recursive: true });
  const staging = join(cache, `staging-${process.pid}.app`);
  try {
    await cp(sourceBundle, staging, {
      recursive: true,
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
    });
    const plistPath = join(staging, "Contents", "Info.plist");
    let plist = await readFile(plistPath, "utf8");
    for (const [key, value] of Object.entries({
      CFBundleName: "awl",
      CFBundleDisplayName: "awl",
      CFBundleIdentifier: "local.awl.desktop",
      CFBundleExecutable: "awl",
    })) {
      const entry = new RegExp(
        `(<key>${key}</key>\\s*<string>)[^<]*(</string>)`,
      );
      if (!entry.test(plist))
        throw new Error(`Missing ${key} in Electron's Info.plist`);
      plist = plist.replace(entry, `$1${value}$2`);
    }
    await writeFile(plistPath, plist);
    await rename(
      join(staging, "Contents", "MacOS", "Electron"),
      join(staging, "Contents", "MacOS", "awl"),
    );
    try {
      await rename(staging, bundle);
    } catch (error) {
      // Another launcher may have prepared the same version concurrently.
      if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
    }
    await writeFile(join(cache, "ready"), version);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return executable;
}

// CI's Linux desktop has no hardware GPU. Keep this out of normal app launches.
export function testElectronArgs(args) {
  return process.platform === "linux" && process.env.CI
    ? [
        ...args,
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ]
    : args;
}
