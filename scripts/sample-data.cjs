// Shared offline sample data.
//
// Used by scripts/generate-screenshots.cjs (listing screenshots) and
// scripts/generate-sample-report.cjs (the AppSource sample report), so the published
// screenshots and the shipped sample report always show the same numbers.
//
// Every value is a literal. Nothing here is fetched, generated randomly, or derived
// at runtime, so both generators are deterministic.

// Flat dataset - one row per product, used by the single-series scenarios.
const flatRows = [
  ["Aurora Analytics", 41.2, 18.4, 8200000],
  ["Aurora Mobile", 33.8, 24.1, 4100000],
  ["Beacon Reporting", 28.5, 6.2, 5600000],
  ["Cascade Data Prep", 22.4, -3.8, 2400000],
  ["Compass Planning", 36.9, 11.7, 6300000],
  ["Delta Forecasting", 18.2, -9.4, 1500000],
  ["Everest Governance", 44.6, 27.3, 3300000],
  ["Foundry Connectors", 26.1, 2.9, 2100000],
  ["Harbor Streaming", 31.5, 16.2, 3700000],
  ["Ironwood Archive", 16.9, -1.3, 1100000],
  ["Juniper Alerts", 20.9, 5.7, 1000000],
  ["Kestrel Notebooks", 38.4, 14.6, 6900000],
  ["Lantern Catalog", 24.7, 4.1, 4300000],
  ["Meridian Modeling", 47.1, 21.9, 2800000],
  ["Northwind Gateway", 19.8, -6.5, 1900000],
  ["Orchard Lineage", 34.2, 9.8, 5100000],
  ["Pinnacle Semantics", 15.6, -12.1, 1200000],
  ["Quarry Ingest", 29.3, 7.4, 2600000],
  ["Redwood Retention", 27.9, 31.6, 2900000],
  ["Summit Scorecards", 21.3, 12.8, 3100000],
  ["Trellis Workflow", 30.7, 19.4, 3900000],
  ["Umber Masking", 12.4, -4.7, 900000],
  ["Vantage Benchmarks", 42.8, 34.2, 2200000],
  ["Willow Sharing", 25.6, 15.1, 1800000],
  ["Yardstick Metrics", 35.1, 26.8, 3400000],
  ["Zephyr Refresh", 11.7, -14.2, 600000]
];

// Full product-by-region matrix. Every category/series combination carries a value so
// no rows are dropped when the visual groups by series.
const matrixRegions = ["Asia Pacific", "Europe", "Latin America", "North America"];
const matrixProducts = [
  "Aurora Analytics",
  "Beacon Reporting",
  "Cascade Data Prep",
  "Compass Planning",
  "Everest Governance",
  "Foundry Connectors",
  "Harbor Streaming",
  "Juniper Alerts"
];
const matrixCells = {
  "Asia Pacific": [
    [27.9, 31.6, 2900000], [21.3, 12.8, 3100000], [12.4, -4.7, 900000], [30.7, 19.4, 3900000],
    [42.8, 34.2, 2200000], [25.6, 15.1, 1800000], [35.1, 26.8, 3400000], [16.9, -1.3, 1100000]
  ],
  Europe: [
    [38.4, 14.6, 6900000], [24.7, 4.1, 4300000], [19.8, -6.5, 1900000], [34.2, 9.8, 5100000],
    [47.1, 21.9, 2800000], [29.3, 7.4, 2600000], [31.5, 16.2, 3700000], [15.6, -12.1, 1200000]
  ],
  "Latin America": [
    [23.4, 22.7, 1400000], [17.8, 8.3, 1700000], [14.2, -8.9, 800000], [26.8, 13.5, 2000000],
    [39.4, 29.1, 1300000], [20.4, 3.6, 1150000], [28.2, 20.6, 1600000], [11.7, -14.2, 600000]
  ],
  "North America": [
    [41.2, 18.4, 8200000], [28.5, 6.2, 5600000], [22.4, -3.8, 2400000], [36.9, 11.7, 6300000],
    [44.6, 27.3, 3300000], [26.1, 2.9, 2100000], [33.8, 24.1, 4100000], [18.2, -9.4, 1500000]
  ]
};

// Long-form projection of the matrix: one row per product and region.
function matrixRows() {
  const rows = [];
  for (const region of matrixRegions) {
    matrixProducts.forEach((product, index) => {
      const [margin, growth, revenue] = matrixCells[region][index];
      rows.push({ product, region, margin, growth, revenue });
    });
  }
  return rows;
}

module.exports = { flatRows, matrixRegions, matrixProducts, matrixCells, matrixRows };
