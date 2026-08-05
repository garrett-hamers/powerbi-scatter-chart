// Every file a PBIR report definition claims to ship must actually exist on disk.
//
// A sibling repo's sample report declared a `SharedResources` resource package whose item
// pointed at `BaseThemes/CY24SU10.json` — a file that exists nowhere in `samples/`, because
// CY24SU10 is a base theme built into Power BI Desktop. Naming it under `themeCollection` is
// a *reference* to something the product already has; declaring it under `resourcePackages`
// is a claim that the file ships inside the report. Desktop resolves the path, finds nothing,
// and refuses to open the report with "Issues were found".
//
// Every one of the ten sample JSON files in that investigation validated against its declared
// $schema before *and* after the fix. A schema constrains shape, not existence: a path to a
// missing file is perfectly schema-valid. Only resolving the reference against disk catches it.
//
// This module is pure — it takes a listing of what exists rather than touching the filesystem —
// so the rule can be driven with deliberately broken definitions instead of only ever seeing a
// report that already happens to be correct.

// A CustomVisual package named N with item path P is unpacked to
// CustomVisuals/<N>/resources/<P>, relative to the .Report folder.
function customVisualItemPath(packageName, itemPath) {
  return `CustomVisuals/${packageName}/resources/${itemPath}`;
}

/**
 * @param {object} input
 * @param {object} input.report parsed definition/report.json
 * @param {(relativePath: string) => boolean} input.exists resolves a path relative to the
 *   .Report folder and reports whether it is present on disk
 * @returns {string[]} human-readable problems; empty means every reference resolves
 */
function inspectReportReferences({ report, exists }) {
  const problems = [];

  const theme = report?.themeCollection?.baseTheme;
  if (!theme) {
    problems.push("report.json is missing themeCollection.baseTheme, which the report schema requires");
  } else if (!theme.name) {
    problems.push("themeCollection.baseTheme has no name");
  }

  const packages = Array.isArray(report?.resourcePackages) ? report.resourcePackages : [];
  if (packages.length === 0) {
    problems.push("report.json declares no resourcePackages, so the visual is not embedded");
    return problems;
  }

  for (const entry of packages) {
    const items = Array.isArray(entry?.items) ? entry.items : [];

    if (entry?.type === "CustomVisual") {
      if (items.length === 0) {
        problems.push(`CustomVisual resource package "${entry.name}" declares no items`);
      }
      for (const item of items) {
        const relative = customVisualItemPath(entry.name, item.path);
        if (!exists(relative)) {
          problems.push(
            `resourcePackages "${entry.name}" claims to ship ${item.path}, but ${relative} ` +
            `does not exist; Power BI Desktop resolves this path and fails to open the report`
          );
        }
      }
      continue;
    }

    // The exact failure that broke two sibling repos. The base theme is built into Desktop,
    // so it is referenced through themeCollection and must never be declared as a shipped file.
    const shipsABaseTheme = entry?.type === "SharedResources" ||
      items.some((item) => item?.type === "BaseTheme" || /^BaseThemes\//.test(String(item?.path ?? "")));
    if (shipsABaseTheme) {
      const paths = items.map((item) => item?.path).filter(Boolean).join(", ");
      problems.push(
        `resourcePackages declares a "${entry?.type}" package (${paths || "no items"}) claiming a ` +
        `base theme ships inside the report. Base themes are built into Power BI Desktop and are ` +
        `referenced through themeCollection; declaring one here points at a file that does not ` +
        `exist and Desktop refuses to open the report`
      );
      continue;
    }

    // An unrecognised package type is reported rather than passed over: this module does not
    // know how Desktop resolves it, and silently assuming it is fine is how the original
    // defect survived every existing check.
    problems.push(
      `resourcePackages contains an unrecognised package type ${JSON.stringify(entry?.type)}; ` +
      `its references cannot be resolved, so it must be reviewed by hand`
    );
  }

  return problems;
}

module.exports = { inspectReportReferences, customVisualItemPath };
