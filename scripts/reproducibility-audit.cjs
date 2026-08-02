const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const manifest = readJson("pbiviz.json");
const packageName = `${manifest.visual.name}.${manifest.visual.version}.pbiviz`;
const packageDirectory = path.join(root, "dist");
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "atlyn-scatter-repro-"));
const firstPackagePath = path.join(temporaryDirectory, packageName);
const npmCommand = process.platform === "win32" ? process.env.ComSpec : "npm";
const npmArguments = process.platform === "win32"
  ? ["/d", "/s", "/c", "npm run package"]
  : ["run", "package"];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Reproducibility audit failed: ${message}`);
  }
}

function packagePathForRun() {
  assert(fs.existsSync(packageDirectory), "dist directory is missing");
  const packages = fs.readdirSync(packageDirectory)
    .filter((entry) => entry.endsWith(".pbiviz"));
  assert(packages.length === 1, "dist must contain exactly one PBIVIZ");
  assert(packages[0] === packageName, `package filename must be ${packageName}`);
  const packagePath = path.join(packageDirectory, packageName);
  assert(fs.statSync(packagePath).size > 0, "PBIVIZ is empty");
  return packagePath;
}

function runPackage(runNumber) {
  const result = spawnSync(npmCommand, npmArguments, {
    cwd: root,
    stdio: "inherit"
  });
  assert(result.error === undefined, `package run ${runNumber} could not start`);
  assert(result.status === 0, `package run ${runNumber} exited with ${result.status}`);
  return packagePathForRun();
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

try {
  const firstPackage = fs.readFileSync(runPackage(1));
  fs.writeFileSync(firstPackagePath, firstPackage);
  const secondPackage = fs.readFileSync(runPackage(2));
  const firstHash = sha256(firstPackage);
  const secondHash = sha256(secondPackage);
  assert(firstPackage.equals(secondPackage), `package bytes differ (${firstHash} versus ${secondHash})`);
  console.log(`Reproducibility audit passed for ${packageName}`);
  console.log(`SHA-256: ${firstHash}`);
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
