const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const iconPath = path.join(root, "assets", "icon.png");
const partnerCenterLogoPath = path.join(root, "assets", "partner-center-logo-300x300.png");
const blockers = [];

function assertPng(filePath, label) {
  if (!fs.existsSync(filePath)) {
    blockers.push(`${label} is missing: ${path.relative(root, filePath)}`);
    return null;
  }

  const buffer = fs.readFileSync(filePath);
  const signature = buffer.subarray(0, 8);
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!signature.equals(pngSignature)) {
    blockers.push(`${label} is not a valid PNG: ${path.relative(root, filePath)}`);
    return null;
  }

  const ihdrName = buffer.subarray(12, 16).toString("ascii");
  if (ihdrName !== "IHDR") {
    blockers.push(`${label} is missing PNG IHDR header: ${path.relative(root, filePath)}`);
    return null;
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return {
    relativePath: path.relative(root, filePath),
    width,
    height,
    bytes: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex")
  };
}

const sourceIcon = assertPng(iconPath, "Source icon");
if (sourceIcon && sourceIcon.width === 1 && sourceIcon.height === 1) {
  blockers.push("Source icon is 1x1 (placeholder). Provide a real source icon before deriving publication assets.");
}

const partnerCenterLogo = assertPng(partnerCenterLogoPath, "Partner Center logo");
if (partnerCenterLogo && (partnerCenterLogo.width !== 300 || partnerCenterLogo.height !== 300)) {
  blockers.push(`Partner Center logo must be exactly 300x300, received ${partnerCenterLogo.width}x${partnerCenterLogo.height}.`);
}

if (blockers.length > 0) {
  throw new Error(`Publication audit failed:\n- ${blockers.join("\n- ")}`);
}

console.log(`Publication audit passed for ${sourceIcon.relativePath} and ${partnerCenterLogo.relativePath}.`);
