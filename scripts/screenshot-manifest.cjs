// Binds each committed screenshot to the capture run that asserted it.
//
// The capture-time assertions in scripts/screenshot-assertions.cjs prove a scene rendered
// correctly *when the file was written*, and then they are gone: printed to stdout and never
// recorded. That leaves a second hole next to the one they close. A screenshot that is
// hand-edited, reverted, or swapped afterwards still passes every remaining gate, because
// nothing ties a committed PNG back to the run that vouched for it.
//
// So the capture writes this manifest, and the audits that already read the committed files
// verify the bytes still hash to what capture recorded. The recorded values are the measured
// numbers rather than a pass flag, because "the table rendered 180px tall with 8 of 26 rows in
// view" is reviewable months later and "assertions passed" is not.
//
// This is emphatically *not* pixel-diffing. It is a SHA-256 comparison of a file against its
// own recorded hash, so it is dependency-free and cannot flake on Chrome versions, font
// availability or rasteriser changes the way a golden-image diff would. It detects exactly one
// thing: a committed screenshot changing without the capture that vouches for it being re-run.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
// Not inside assets/screenshots: the publication audit requires that directory to hold PNGs
// and nothing else, which is a rule worth keeping rather than loosening for a sidecar file.
const manifestPath = path.join(root, "assets", "screenshot-manifest.json");
const screenshotDirectory = path.join(root, "assets", "screenshots");

const SCREENSHOT_WIDTH = 1366;
const SCREENSHOT_HEIGHT = 768;
const MAX_SCREENSHOT_BYTES = 1024 * 1024;

const MANIFEST_NOTE =
  "Written by scripts/generate-screenshots.cjs. Each scene records the values its capture-time " +
  "assertions measured and the SHA-256 of the PNG that capture wrote. The audits re-hash the " +
  "committed files against these values, which detects a screenshot being changed without the " +
  "capture that vouches for it being re-run. This is a hash comparison, not a pixel diff. " +
  "Re-capturing on the same platform reproduces these bytes exactly.";

function relative(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function buildManifest(capture, scenes) {
  return {
    generatedBy: "scripts/generate-screenshots.cjs",
    note: MANIFEST_NOTE,
    visual: capture.visual,
    capture: {
      tile: { width: SCREENSHOT_WIDTH, height: SCREENSHOT_HEIGHT },
      bundle: capture.bundle,
      bundleSha256: capture.bundleSha256,
      bundleOrigin: capture.bundleOrigin,
      bundleJsBytes: capture.bundleJsBytes,
      bundleCssBytes: capture.bundleCssBytes
    },
    scenes
  };
}

function writeManifest(manifest) {
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) {
    return { problems: [`${relative(manifestPath)} is missing. Run "npm run screenshots".`] };
  }
  try {
    return { manifest: JSON.parse(fs.readFileSync(manifestPath, "utf8")) };
  } catch (error) {
    return { problems: [`${relative(manifestPath)} is not valid JSON: ${error.message}`] };
  }
}

// Returns human-readable problems rather than throwing, so the caller decides whether it is
// reporting a screenshot generation failure or an AppSource publication blocker.
function verifyCommittedScreenshots() {
  const { manifest, problems } = readManifest();
  if (problems) {
    return problems;
  }
  const found = [];

  if (!Array.isArray(manifest.scenes) || manifest.scenes.length === 0) {
    return [`${relative(manifestPath)} records no scenes. Run "npm run screenshots".`];
  }

  const committed = fs.existsSync(screenshotDirectory)
    ? fs.readdirSync(screenshotDirectory).filter((entry) => entry.endsWith(".png")).sort()
    : [];
  const recorded = new Set();

  for (const scene of manifest.scenes) {
    const label = scene.file ?? "<unnamed scene>";
    recorded.add(scene.file);
    if (!Array.isArray(scene.assertions) || scene.assertions.length === 0) {
      found.push(`${relative(manifestPath)} records no assertions for ${label}; the entry vouches for nothing.`);
    } else {
      // A record with a missing measurement is a record that proves nothing, and would let a
      // hollow manifest satisfy the hash check while claiming the scene was verified.
      const hollow = scene.assertions.filter((entry) => entry.measured === undefined || entry.measured === null);
      if (hollow.length > 0) {
        found.push(
          `${relative(manifestPath)} records ${hollow.length} assertion(s) for ${label} with no measured value ` +
          `(${hollow.slice(0, 3).map((entry) => entry.metric).join(", ")}).`
        );
      }
    }

    const png = scene.png ?? {};
    if (png.width !== SCREENSHOT_WIDTH || png.height !== SCREENSHOT_HEIGHT) {
      found.push(`${relative(manifestPath)} records ${label} as ${png.width}x${png.height}, expected ${SCREENSHOT_WIDTH}x${SCREENSHOT_HEIGHT}.`);
    }
    if (typeof png.bytes !== "number" || png.bytes > MAX_SCREENSHOT_BYTES) {
      found.push(`${relative(manifestPath)} records ${label} as ${png.bytes} bytes, above the ${MAX_SCREENSHOT_BYTES} byte AppSource limit.`);
    }

    const filePath = path.join(screenshotDirectory, scene.file ?? "");
    if (!scene.file || !fs.existsSync(filePath)) {
      found.push(`${relative(manifestPath)} vouches for ${label}, but assets/screenshots/${label} does not exist.`);
      continue;
    }
    const buffer = fs.readFileSync(filePath);
    const digest = sha256(buffer);
    if (digest !== png.sha256) {
      found.push(
        `${relative(filePath)} does not match the capture that vouched for it: recorded sha256 ${png.sha256}, ` +
        `found ${digest}. The image changed without the capture being re-run. ` +
        `Run "npm run screenshots" to re-capture and re-assert it, or restore the committed file.`
      );
    }
    if (buffer.length !== png.bytes) {
      found.push(`${relative(filePath)} is ${buffer.length} bytes, but the manifest recorded ${png.bytes}.`);
    }
  }

  for (const name of committed) {
    if (!recorded.has(name)) {
      found.push(
        `assets/screenshots/${name} is committed but no scene in ${relative(manifestPath)} vouches for it. ` +
        `Every published screenshot must come from an asserted capture.`
      );
    }
  }

  return found;
}

module.exports = {
  manifestPath,
  screenshotDirectory,
  relative,
  sha256,
  buildManifest,
  writeManifest,
  readManifest,
  verifyCommittedScreenshots
};
