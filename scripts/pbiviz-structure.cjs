// A .pbiviz is a two-entry archive, per generatePbiviz() in powerbi-visuals-webpack-plugin:
//
//   package.json                  manifest: resources[].file, resources[].sourceType 5,
//                                 metadata.pbivizjson.resourceId
//   resources/<GUID>.pbiviz.json  the visual inline: content.js, content.css, iconBase64,
//                                 capabilities, stringResources
//
// A sibling repo shipped a source-tree-shaped archive instead (pbiviz.json, capabilities.json,
// style/visual.less, visual.js, assets/, stringResources/) with no manifest and no resources/
// directory. The host had nothing to resolve, so nothing in it would ever have been read, and
// no existing check noticed: the bundle was present, the stylesheet was non-empty, and the
// icon decoded. Only the container shape was wrong.
//
// This module is pure so the rule can be tested against a deliberately malformed archive
// rather than only against a package that already happens to be correct.

const SOURCE_TREE_MARKERS = [
  "pbiviz.json",
  "capabilities.json",
  "visual.js",
  "style/",
  "assets/",
  "stringResources/",
  "src/",
  "dist/"
];

function isSourceTreeShaped(entry) {
  return SOURCE_TREE_MARKERS.some((marker) =>
    marker.endsWith("/") ? entry.startsWith(marker) : entry === marker);
}

/**
 * @param {object} input
 * @param {string[]} input.entries every zip entry name, directories included
 * @param {string[]} input.fileEntries zip entry names that are files
 * @param {object|undefined} input.manifest parsed package.json, or undefined when absent
 * @param {object|undefined} input.resource parsed resources/<GUID>.pbiviz.json, or undefined
 * @param {string} input.guid expected visual GUID
 * @param {string} input.version expected four-part version
 * @returns {string[]} human-readable problems; empty means the container is loadable
 */
function inspectPackage({ entries, fileEntries, manifest, resource, guid, version }) {
  const problems = [];
  const expectedResourcePath = `resources/${guid}.pbiviz.json`;

  const strays = fileEntries.filter(isSourceTreeShaped);
  if (strays.length > 0) {
    problems.push(
      `archive is source-tree shaped and the host would have nothing to resolve; ` +
      `unexpected entries: ${strays.join(", ")}`
    );
  }

  if (!entries.includes("package.json")) {
    problems.push("package.json manifest entry is missing; the host cannot resolve the visual");
    return problems;
  }
  if (fileEntries.length !== 2) {
    problems.push(
      `expected exactly two file entries (package.json and ${expectedResourcePath}), ` +
      `found ${fileEntries.length}: ${fileEntries.join(", ")}`
    );
  }
  if (manifest === undefined) {
    problems.push("package.json is not valid JSON");
    return problems;
  }

  const resources = Array.isArray(manifest.resources) ? manifest.resources : [];
  if (resources.length !== 1) {
    problems.push(`manifest resources[] must hold exactly one entry, found ${resources.length}`);
    return problems;
  }
  const declared = resources[0];
  if (declared.sourceType !== 5) {
    problems.push(`manifest resources[0].sourceType must be 5, found ${JSON.stringify(declared.sourceType)}`);
  }
  if (declared.file !== expectedResourcePath) {
    problems.push(`manifest resources[0].file must be ${expectedResourcePath}, found ${JSON.stringify(declared.file)}`);
  }
  if (!entries.includes(declared.file)) {
    problems.push(`manifest resources[0].file ${JSON.stringify(declared.file)} does not resolve to a zip entry`);
  }
  const resourceId = manifest.metadata?.pbivizjson?.resourceId;
  if (resourceId === undefined) {
    problems.push("manifest metadata.pbivizjson.resourceId is missing");
  } else if (resourceId !== declared.resourceId) {
    problems.push(
      `manifest metadata.pbivizjson.resourceId ${JSON.stringify(resourceId)} does not match ` +
      `resources[0].resourceId ${JSON.stringify(declared.resourceId)}`
    );
  }
  if (manifest.visual?.guid !== guid) {
    problems.push(`manifest visual.guid must be ${guid}, found ${JSON.stringify(manifest.visual?.guid)}`);
  }
  if (manifest.version !== version) {
    problems.push(`manifest version must be ${version}, found ${JSON.stringify(manifest.version)}`);
  }

  if (resource === undefined) {
    problems.push(`${expectedResourcePath} is missing or not valid JSON`);
    return problems;
  }
  if (typeof resource.content?.js !== "string" || resource.content.js.length === 0) {
    problems.push("inline resource content.js is missing or empty");
  }
  if (typeof resource.content?.css !== "string" || resource.content.css.length === 0) {
    problems.push("inline resource content.css is missing or empty");
  }
  if (!String(resource.content?.iconBase64 ?? "").startsWith("data:image/png;base64,")) {
    problems.push("inline resource content.iconBase64 is not a base64 PNG data URI");
  }
  if (resource.visual?.guid !== guid) {
    problems.push(`inline resource visual.guid must be ${guid}, found ${JSON.stringify(resource.visual?.guid)}`);
  }
  if (resource.capabilities === undefined) {
    problems.push("inline resource capabilities are missing");
  }

  return problems;
}

module.exports = { inspectPackage, isSourceTreeShaped, SOURCE_TREE_MARKERS };
