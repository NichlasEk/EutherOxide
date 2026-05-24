import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function gitShortSha() {
  try {
    const head = readFileSync(join(root, ".git", "HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) {
      return head.slice(0, 7);
    }
    const ref = head.slice(5);
    return readFileSync(join(root, ".git", ref), "utf8").trim().slice(0, 7);
  } catch {
    return "nogit";
  }
}

function gitDirtySuffix() {
  try {
    execFileSync("git", ["diff", "--quiet"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["diff", "--cached", "--quiet"], { cwd: root, stdio: "ignore" });
    return "";
  } catch {
    return "-dirty";
  }
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
const id = `${stamp}-${gitShortSha()}${gitDirtySuffix()}`;

writeFileSync(
  new URL("../webview/build-info.ts", import.meta.url),
  `export const WEB_BUILD_ID = ${JSON.stringify(id)};\n`,
);

console.log(`[build-info] ${id}`);
