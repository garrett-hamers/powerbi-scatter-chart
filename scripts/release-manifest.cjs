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

function fileMetadata(relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const bytes = fs.readFileSync(filePath);
  return {
    path: relativePath,
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex")
  };
}

const screenshotDirectory = path.join(root, "assets", "screenshots");
const screenshots = fs.existsSync(screenshotDirectory)
  ? fs.readdirSync(screenshotDirectory)
    .filter((entry) => entry.endsWith(".png"))
    .sort()
    .map((entry) => fileMetadata(path.join("assets", "screenshots", entry)))
    .filter(Boolean)
  : [];

const sampleReportRoot = path.join("samples", "AtlynScatterSample");
const sampleReportFiles = [];
(function walk(relativeDirectory) {
  const absolute = path.join(root, relativeDirectory);
  if (!fs.existsSync(absolute)) {
    return;
  }
  for (const entry of fs.readdirSync(absolute).sort()) {
    const next = path.join(relativeDirectory, entry);
    if (fs.statSync(path.join(root, next)).isDirectory()) {
      walk(next);
    } else {
      sampleReportFiles.push(fileMetadata(next));
    }
  }
})(sampleReportRoot);

const releaseManifest = {
  schemaVersion: 3,
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  visual: {
    guid: manifest.visual.guid,
    name: manifest.visual.name,
    version: manifest.visual.version
  },
  submission: {
    supportUrl: manifest.visual.supportUrl,
    privacyPolicyUrl: "https://atlyn.io/legal/privacy",
    authorName: manifest.author.name,
    authorEmail: manifest.author.email,
    eula: fileMetadata("EULA.md"),
    dossier: fileMetadata(path.join("docs", "partner-center-submission.md")),
    appSourceListing: "Free",
    sampleReport: {
      path: sampleReportRoot.split(path.sep).join("/"),
      format: "PBIP",
      files: sampleReportFiles.length,
      pbixStatus: "Open the PBIP in Power BI Desktop, confirm the visual renders with data, refresh only if Desktop reports empty or incomplete tables, then Save as .pbix; no .pbix is committed."
    }
  },
  package: {
    filename: packageName,
    bytes: packageBuffer.length,
    sha256: crypto.createHash("sha256").update(packageBuffer).digest("hex")
  },
  assets: {
    visualIcon: fileMetadata(manifest.assets.icon),
    partnerCenterLogo300x300: fileMetadata(path.join("assets", "partner-center-logo-300x300.png")),
    screenshots1366x768: screenshots
  },
  hashPolicy: "PBIVIZ ZIP entries are sorted and normalized to a fixed UTC-anchored DOS timestamp, DEFLATE level 9, and DOS platform metadata before hashing, so the hash does not depend on the build machine's timezone or platform."
};

fs.writeFileSync(
  path.join(packageDirectory, "release-manifest.json"),
  `${JSON.stringify(releaseManifest, null, 2)}\n`
);
console.log(`Release manifest written for ${packageJson.name} at ${releaseManifest.package.sha256}`);
