import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("../webview/server-map-status.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { nodeIsAlerting } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
test("descriptive failure/missing words are not operational alerts", () => {
  assert.equal(nodeIsAlerting({status: "configured", detail: "local checksum timer and desktop failure alert"}), false);
  assert.equal(nodeIsAlerting({status: "unknown", detail: "keeps last validated archive if transient robot export is missing"}), false);
  assert.equal(nodeIsAlerting({detail: "failure offline timeout"}), false);
});
test("explicit failures alert even with reassuring description", () => {
  for (const status of ["failed", "degraded", "offline", "error", " FAILED "])
    assert.equal(nodeIsAlerting({status, detail: "previous archive preserved"}), true);
});
test("healthy and unobserved statuses stay neutral", () => {
  for (const status of ["healthy", "running", "configured", "unknown", "not-failed", ""])
    assert.equal(nodeIsAlerting({status}), false);
});
