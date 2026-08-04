const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");
const writeFileAtomic = require("write-file-atomic");

const root = path.resolve(__dirname, "..");
const manifest = readJson("pbiviz.json");
const packageDirectory = path.join(root, "dist");
const packageName = `${manifest.visual.name}.${manifest.visual.version}.pbiviz`;
const packagePath = path.join(packageDirectory, packageName);
// JSZip encodes ZIP timestamps with the Date's *UTC* getters, so this anchor must be built in
// UTC. `new Date(1980, 0, 1)` is local midnight, which encodes a different DOS time on every
// build machine (and a pre-1980, out-of-range DOS date east of UTC), making the package hash
// depend on the builder's timezone.
const fixedDate = new Date(Date.UTC(1980, 0, 1, 0, 0, 0, 0));

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`PBIVIZ normalization failed: ${message}`);
  }
}

function getPackagePath() {
  assert(fs.existsSync(packageDirectory), "dist directory is missing");
  const packages = fs.readdirSync(packageDirectory)
    .filter((entry) => entry.endsWith(".pbiviz"));
  assert(packages.length === 1, "dist must contain exactly one PBIVIZ");
  assert(packages[0] === packageName, `package filename must be ${packageName}`);
  assert(fs.statSync(packagePath).size > 0, "PBIVIZ is empty");
  return packagePath;
}

async function normalizePackage() {
  const source = await JSZip.loadAsync(fs.readFileSync(packagePath));
  const normalized = new JSZip();

  for (const name of Object.keys(source.files).sort()) {
    const entry = source.files[name];
    const data = entry.dir ? null : await entry.async("nodebuffer");
    normalized.file(name, data, {
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
      createFolders: false,
      date: fixedDate,
      dir: entry.dir,
      dosPermissions: entry.dir ? 0x10 : 0x20,
      unixPermissions: entry.dir ? 0o40755 : 0o100644
    });
  }

  const bytes = await normalized.generateAsync({
    comment: "",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "DOS",
    type: "nodebuffer"
  });
  writeFileAtomic.sync(packagePath, bytes, { mode: 0o644 });
  return bytes.length;
}

(async () => {
  getPackagePath();
  const size = await normalizePackage();
  console.log(`Normalized ${packageName} (${size} bytes)`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
