const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { buildAssets, decodePng } = require("./generate-brand-assets.cjs");

const root = path.resolve(__dirname, "..");
const screenshotDirectory = path.join(root, "assets", "screenshots");
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SCREENSHOT_WIDTH = 1366;
const SCREENSHOT_HEIGHT = 768;
const MAX_SCREENSHOT_BYTES = 1024 * 1024;
const MIN_SCREENSHOTS = 1;
const MAX_SCREENSHOTS = 5;
const PRIVACY_POLICY_URL = "https://atlyn.io/legal/privacy";
// RFC 2606 and RFC 6761 reserved names are never deliverable and are rejected by Partner Center.
const RESERVED_EMAIL_SUFFIXES = [
  ".example",
  ".invalid",
  ".test",
  ".localhost",
  "@example.com",
  "@example.org",
  "@example.net"
];

const blockers = [];

function relative(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function readPngHeader(filePath, label) {
  if (!fs.existsSync(filePath)) {
    blockers.push(`${label} is missing: ${relative(filePath)}`);
    return null;
  }

  const buffer = fs.readFileSync(filePath);
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    blockers.push(`${label} is not a valid PNG: ${relative(filePath)}`);
    return null;
  }

  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    blockers.push(`${label} is missing PNG IHDR header: ${relative(filePath)}`);
    return null;
  }

  return {
    relativePath: relative(filePath),
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bytes: buffer.length,
    buffer,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex")
  };
}

function auditBrandAsset(asset) {
  const label = asset.expectedWidth === 300 ? "Partner Center logo" : "Source icon";
  const header = readPngHeader(path.join(root, asset.relativePath), label);
  if (!header) {
    return null;
  }

  if (header.width === 1 && header.height === 1) {
    blockers.push(`${label} is 1x1 (placeholder): ${header.relativePath}`);
    return header;
  }

  if (header.width !== asset.expectedWidth || header.height !== asset.expectedHeight) {
    blockers.push(
      `${label} must be exactly ${asset.expectedWidth}x${asset.expectedHeight}, ` +
      `received ${header.width}x${header.height}.`
    );
    return header;
  }

  // Compare decoded pixels rather than file bytes so the check survives zlib differences
  // between Node versions while still proving the committed file matches the generator.
  let decoded;
  try {
    decoded = decodePng(header.buffer);
  } catch (error) {
    blockers.push(`${label} could not be decoded: ${error.message}`);
    return header;
  }

  if (decoded.rgba.length !== asset.rgba.length) {
    blockers.push(`${label} pixel buffer length differs from the generator output.`);
    return header;
  }

  for (let index = 0; index < decoded.rgba.length; index++) {
    if (decoded.rgba[index] !== asset.rgba[index]) {
      blockers.push(
        `${label} does not match scripts/generate-brand-assets.cjs output ` +
        `(first difference at byte ${index}). Run "npm run generate-brand-assets".`
      );
      return header;
    }
  }

  return header;
}

function auditScreenshots() {
  if (!fs.existsSync(screenshotDirectory)) {
    blockers.push("Screenshot directory is missing: assets/screenshots");
    return [];
  }

  const entries = fs.readdirSync(screenshotDirectory).sort();
  const unexpected = entries.filter((entry) => !entry.endsWith(".png"));
  if (unexpected.length > 0) {
    blockers.push(`assets/screenshots must contain only PNG files, found: ${unexpected.join(", ")}`);
  }

  const names = entries.filter((entry) => entry.endsWith(".png"));
  if (names.length < MIN_SCREENSHOTS || names.length > MAX_SCREENSHOTS) {
    blockers.push(
      `AppSource requires ${MIN_SCREENSHOTS} to ${MAX_SCREENSHOTS} screenshots, found ${names.length}.`
    );
  }

  const results = [];
  for (const name of names) {
    const header = readPngHeader(path.join(screenshotDirectory, name), `Screenshot ${name}`);
    if (!header) {
      continue;
    }
    if (header.width !== SCREENSHOT_WIDTH || header.height !== SCREENSHOT_HEIGHT) {
      blockers.push(
        `Screenshot ${name} must be exactly ${SCREENSHOT_WIDTH}x${SCREENSHOT_HEIGHT}, ` +
        `received ${header.width}x${header.height}.`
      );
    }
    if (header.bytes > MAX_SCREENSHOT_BYTES) {
      blockers.push(
        `Screenshot ${name} is ${header.bytes} bytes, above the ${MAX_SCREENSHOT_BYTES} byte AppSource limit.`
      );
    }
    results.push(header);
  }
  return results;
}

function auditManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
  const requiredVisualFields = [
    "name",
    "displayName",
    "guid",
    "visualClassName",
    "version",
    "description",
    "supportUrl"
  ];
  for (const field of requiredVisualFields) {
    const value = manifest.visual?.[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      blockers.push(`pbiviz.json visual.${field} is required for AppSource submission.`);
    }
  }

  for (const field of ["name", "email"]) {
    const value = manifest.author?.[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      blockers.push(`pbiviz.json author.${field} is required for AppSource submission.`);
    }
  }

  const version = manifest.visual?.version;
  if (typeof version === "string" && !/^\d+\.\d+\.\d+\.\d+$/.test(version)) {
    blockers.push(`pbiviz.json visual.version must be four digits (x.x.x.x), received ${version}.`);
  }

  const description = manifest.visual?.description;
  if (typeof description === "string" && description.trim().length < 40) {
    blockers.push("pbiviz.json visual.description must be a meaningful listing description.");
  }

  const supportUrl = manifest.visual?.supportUrl;
  if (typeof supportUrl === "string" && !supportUrl.startsWith("https://")) {
    blockers.push(`pbiviz.json visual.supportUrl must start with https://, received ${supportUrl}.`);
  }

  const email = manifest.author?.email;
  if (typeof email === "string") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      blockers.push(`pbiviz.json author.email is not a valid address: ${email}.`);
    }
    const lowered = email.toLowerCase();
    for (const suffix of RESERVED_EMAIL_SUFFIXES) {
      if (lowered.endsWith(suffix)) {
        blockers.push(`pbiviz.json author.email uses the reserved domain "${suffix}" and will be rejected: ${email}.`);
        break;
      }
    }
  }

  if (manifest.assets?.icon !== "assets/icon.png") {
    blockers.push('pbiviz.json assets.icon must point at "assets/icon.png".');
  }

  return manifest;
}

function auditSubmissionDocuments() {
  const eulaPath = path.join(root, "EULA.md");
  if (!fs.existsSync(eulaPath) || fs.statSync(eulaPath).size === 0) {
    blockers.push("EULA.md is required for AppSource submission and must not be empty.");
  }

  if (!PRIVACY_POLICY_URL.startsWith("https://")) {
    blockers.push("The privacy policy URL must start with https://.");
  }

  const dossierPath = path.join(root, "docs", "partner-center-submission.md");
  if (!fs.existsSync(dossierPath)) {
    blockers.push("docs/partner-center-submission.md is missing.");
    return;
  }

  const dossier = fs.readFileSync(dossierPath, "utf8");
  if (!dossier.includes(PRIVACY_POLICY_URL)) {
    blockers.push(`docs/partner-center-submission.md must record the privacy policy URL ${PRIVACY_POLICY_URL}.`);
  }
}

function auditSampleReport() {
  const manifestJson = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
  const guid = manifestJson.visual.guid;
  const sampleRoot = path.join(root, "samples", "AtlynScatterSample");
  const reportRoot = path.join(sampleRoot, "AtlynScatterSample.Report");
  const tablePath = path.join(
    sampleRoot,
    "AtlynScatterSample.SemanticModel",
    "definition",
    "tables",
    "ProductPerformance.tmdl"
  );

  const required = [
    path.join(sampleRoot, "AtlynScatterSample.pbip"),
    path.join(reportRoot, "definition", "report.json"),
    path.join(reportRoot, "definition", "pages", "pages.json"),
    path.join(reportRoot, "CustomVisuals", guid, "package.json"),
    path.join(reportRoot, "CustomVisuals", guid, "resources", `${guid}.pbiviz.json`),
    tablePath
  ];
  for (const filePath of required) {
    if (!fs.existsSync(filePath)) {
      blockers.push(`Sample report is incomplete, missing ${relative(filePath)}.`);
      return null;
    }
  }

  const report = JSON.parse(fs.readFileSync(path.join(reportRoot, "definition", "report.json"), "utf8"));
  if ("publicCustomVisuals" in report) {
    blockers.push("Sample report uses publicCustomVisuals, which resolves from AppSource and is not offline.");
  }
  const custom = (report.resourcePackages ?? []).find((entry) => entry.type === "CustomVisual");
  if (!custom || custom.name !== guid) {
    blockers.push(`Sample report must embed the visual through a CustomVisual resource package named ${guid}.`);
  }

  const embedded = JSON.parse(
    fs.readFileSync(path.join(reportRoot, "CustomVisuals", guid, "resources", `${guid}.pbiviz.json`), "utf8")
  );
  if (embedded.visual?.guid !== guid) {
    blockers.push("Sample report embeds a different visual GUID than pbiviz.json.");
  }
  if (embedded.visual?.version !== manifestJson.visual.version) {
    blockers.push(
      `Sample report embeds visual version ${embedded.visual?.version}, expected ${manifestJson.visual.version}. ` +
      'Run "npm run package" then "npm run generate-sample-report".'
    );
  }

  const tmdl = fs.readFileSync(tablePath, "utf8");
  if (!tmdl.includes("#table(")) {
    blockers.push("Sample report data must come from an inline table literal so it works offline.");
  }
  for (const connector of [
    "Sql.Database",
    "Web.Contents",
    "File.Contents",
    "Excel.Workbook",
    "Csv.Document",
    "OData.Feed",
    "Odbc.DataSource",
    "SharePoint.",
    "AzureStorage.",
    "http://",
    "https://"
  ]) {
    if (tmdl.includes(connector)) {
      blockers.push(`Sample report data source uses ${connector}, which requires an external connection.`);
    }
  }

  return { relativePath: relative(sampleRoot), embeddedVersion: embedded.visual?.version };
}

const manifest = auditManifest();
const brandAssets = buildAssets().map(auditBrandAsset).filter(Boolean);
const screenshots = auditScreenshots();
const sampleReport = auditSampleReport();
auditSubmissionDocuments();

if (blockers.length > 0) {
  throw new Error(`Publication audit failed:\n- ${blockers.join("\n- ")}`);
}

console.log("Publication audit passed.");
for (const asset of [...brandAssets, ...screenshots]) {
  console.log(`  ${asset.relativePath} ${asset.width}x${asset.height} ${asset.bytes} bytes sha256=${asset.sha256}`);
}
console.log(`  sample report ${sampleReport.relativePath} embedding visual ${sampleReport.embeddedVersion}`);
console.log(`  support URL ${manifest.visual.supportUrl}`);
console.log(`  privacy policy URL ${PRIVACY_POLICY_URL}`);
console.log(`  author ${manifest.author.name} <${manifest.author.email}>`);
