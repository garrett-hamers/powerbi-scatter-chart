import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const sourceDirectory = path.resolve(__dirname, "..", "..", "src");
const source = fs.readdirSync(sourceDirectory)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => fs.readFileSync(path.join(sourceDirectory, name), "utf8"))
  .join("\n");

test("contains no network, external-asset, or unsafe dynamic DOM APIs", () => {
  for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "innerHTML", "outerHTML", "eval(", "new Function("]) {
    assert.equal(source.includes(forbidden), false, `forbidden API found: ${forbidden}`);
  }
});
