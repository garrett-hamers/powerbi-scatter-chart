const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const packageDirectory = path.join(root, "dist");
const packageFiles = fs.readdirSync(packageDirectory)
  .filter((entry) => entry.endsWith(".pbiviz"));

if (packageFiles.length !== 1) {
  throw new Error("Release manifest requires exactly one PBIVIZ file in dist.");
}

const packageName = packageFiles[0];
const packagePath = path.join(packageDirectory, packageName);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
const packageBuffer = fs.readFileSync(packagePath);
const expectedPackageName = `${manifest.visual.name}.${manifest.visual.version}.pbiviz`;
if (packageName !== expectedPackageName) {
  throw new Error(`Release manifest package filename must be ${expectedPackageName}.`);
}
const releaseManifest = {
  schemaVersion: 1,
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  visual: {
    guid: manifest.visual.guid,
    name: manifest.visual.name,
    version: manifest.visual.version
  },
  package: {
    filename: packageName,
    bytes: packageBuffer.length,
    sha256: crypto.createHash("sha256").update(packageBuffer).digest("hex")
  },
  hashPolicy: "PBIVIZ ZIP entries are sorted and normalized to fixed DOS timestamps, DEFLATE level 9, and DOS platform metadata before hashing."
};

fs.writeFileSync(
  path.join(packageDirectory, "release-manifest.json"),
  `${JSON.stringify(releaseManifest, null, 2)}\n`
);
console.log(`Release manifest written for ${packageJson.name} at ${releaseManifest.package.sha256}`);
