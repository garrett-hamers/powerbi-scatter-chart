const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");

const root = path.resolve(__dirname, "..");
const packageDirectory = path.join(root, "dist");
const packageFiles = fs.readdirSync(packageDirectory)
  .filter((entry) => entry.endsWith(".pbiviz"));

if (packageFiles.length !== 1) {
  throw new Error("Package normalization requires exactly one PBIVIZ file in dist.");
}

const packagePath = path.join(packageDirectory, packageFiles[0]);
const fixedDate = new Date(1980, 0, 1, 12, 0, 0);

async function normalize() {
  const source = fs.readFileSync(packagePath);
  const archive = await JSZip.loadAsync(source);
  const normalized = new JSZip();

  for (const entry of Object.values(archive.files).sort((left, right) => (
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  ))) {
    const data = entry.dir ? "" : await entry.async("nodebuffer");
    normalized.file(entry.name, data, {
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
      date: fixedDate,
      dir: entry.dir,
      createFolders: false,
      platform: "DOS"
    });
  }

  const output = await normalized.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "DOS",
    streamFiles: false
  });
  fs.writeFileSync(packagePath, output);
}

normalize().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
