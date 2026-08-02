const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = readJson("package.json");
const manifest = readJson("pbiviz.json");
const capabilities = readJson(manifest.capabilities);
const packageDirectory = path.join(root, "dist");
const packageName = `${manifest.visual.name}.${manifest.visual.version}.pbiviz`;
const packagePath = path.join(packageDirectory, packageName);

function readJson(relativePath) {
  const filePath = path.join(root, relativePath);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Certification audit failed: ${message}`);
  }
}

function sameVisualMetadata(source, generated) {
  for (const key of [
    "name",
    "displayName",
    "guid",
    "visualClassName",
    "version",
    "description",
    "supportUrl",
    "gitHubUrl"
  ]) {
    assert(generated[key] === source[key], `generated visual metadata differs at ${key}`);
  }
}

assert(manifest.visual.version === `${packageJson.version}.0`, "pbiviz version must match package version");
assert(manifest.visual.name === manifest.visual.guid, "visual name and GUID must match");
assert(manifest.dependencies === null, "external visual dependencies must be absent");
assert(Array.isArray(capabilities.privileges) && capabilities.privileges.length === 0, "visual privileges must be empty");
assert(fs.existsSync(path.join(root, manifest.capabilities)), "capabilities file is missing");
assert(fs.existsSync(path.join(root, manifest.style)), "style file is missing");
assert(fs.existsSync(path.join(root, manifest.assets.icon)), "icon asset is missing");

const packages = fs.readdirSync(packageDirectory)
  .filter((entry) => entry.endsWith(".pbiviz"));
assert(packages.length === 1, "dist must contain exactly one freshly generated PBIVIZ");
assert(packages[0] === packageName, `package filename must be ${packageName}`);
assert(fs.existsSync(packagePath) && fs.statSync(packagePath).size > 0, "generated PBIVIZ is empty or missing");

const generatedMetadata = readJson(path.join("dist", "package.json"));
assert(generatedMetadata.version === manifest.visual.version, "generated package version differs from source");
sameVisualMetadata(manifest.visual, generatedMetadata.visual);
assert(generatedMetadata.author?.name === manifest.author.name, "generated author differs from source");
assert(generatedMetadata.author?.email === manifest.author.email, "generated author email differs from source");

console.log(`Certification audit passed for ${packageName}`);
