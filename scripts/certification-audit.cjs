const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");

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

(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(packagePath));
  const resourceName = Object.keys(zip.files)
    .find((entry) => entry.startsWith("resources/") && entry.endsWith(".json"));
  assert(resourceName !== undefined, "packaged resource descriptor is missing");

  const resource = JSON.parse(await zip.files[resourceName].async("string"));
  assert(typeof resource.content?.js === "string" && resource.content.js.length > 0, "packaged bundle is empty");
  assert(
    typeof resource.content?.css === "string" && resource.content.css.includes(".atlyn-scatter"),
    "compiled stylesheet is missing from the package; src/visual.ts must import style/visual.less"
  );

  const iconBase64 = String(resource.content?.iconBase64 ?? "");
  assert(iconBase64.startsWith("data:image/png;base64,"), "packaged icon is not a base64 PNG data URI");
  const icon = Buffer.from(iconBase64.slice("data:image/png;base64,".length), "base64");
  assert(icon.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "packaged icon is not a PNG");
  assert(
    icon.readUInt32BE(16) === 20 && icon.readUInt32BE(20) === 20,
    `packaged icon must be 20x20, received ${icon.readUInt32BE(16)}x${icon.readUInt32BE(20)}`
  );

  console.log(`Certification audit passed for ${packageName}`);
})().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
