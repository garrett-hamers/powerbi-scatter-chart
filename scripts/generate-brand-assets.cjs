const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SUPERSAMPLE = 4;

const palette = {
  brand: "#0b3b63",
  card: "#ffffff",
  axis: "#605e5c",
  regression: "#333333",
  quadrantUpperLeft: "#deecf9",
  quadrantUpperRight: "#dff6dd",
  quadrantLowerLeft: "#fce4ec",
  quadrantLowerRight: "#fff4ce",
  series: ["#0078d4", "#8764b8", "#107c10", "#d83b01"]
};

let crcTable = null;

function crc32(buffer) {
  if (crcTable === null) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let index = 0; index < buffer.length; index++) {
    crc = crcTable[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, checksum]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}

function decodePng(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Not a PNG file.");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) {
        throw new Error(`Unsupported PNG bit depth ${data[8]}.`);
      }
      if (data[9] === 6) {
        channels = 4;
      } else if (data[9] === 2) {
        channels = 3;
      } else {
        throw new Error(`Unsupported PNG colour type ${data[9]}.`);
      }
      if (data[12] !== 0) {
        throw new Error("Interlaced PNG files are not supported.");
      }
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)];
    const line = inflated.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) {
        value += left;
      } else if (filter === 2) {
        value += up;
      } else if (filter === 3) {
        value += Math.floor((left + up) / 2);
      } else if (filter === 4) {
        value += paethPredictor(left, up, upLeft);
      } else if (filter !== 0) {
        throw new Error(`Unsupported PNG filter ${filter}.`);
      }
      pixels[y * stride + x] = value & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    rgba[index * 4] = pixels[index * channels];
    rgba[index * 4 + 1] = pixels[index * channels + 1];
    rgba[index * 4 + 2] = pixels[index * channels + 2];
    rgba[index * 4 + 3] = channels === 4 ? pixels[index * channels + 3] : 255;
  }
  return { width, height, rgba };
}

function parseColor(value) {
  return [
    parseInt(value.slice(1, 3), 16) / 255,
    parseInt(value.slice(3, 5), 16) / 255,
    parseInt(value.slice(5, 7), 16) / 255
  ];
}

class Raster {
  constructor(width, height, scale) {
    this.userWidth = width;
    this.userHeight = height;
    this.scale = scale;
    this.width = width * scale;
    this.height = height * scale;
    this.pixels = new Float64Array(this.width * this.height * 4);
  }

  blend(x, y, color, alpha) {
    if (alpha <= 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return;
    }
    const index = (y * this.width + x) * 4;
    const dstA = this.pixels[index + 3];
    const outA = alpha + dstA * (1 - alpha);
    if (outA <= 0) {
      return;
    }
    for (let channel = 0; channel < 3; channel++) {
      const src = color[channel] * alpha;
      const dst = this.pixels[index + channel] * dstA * (1 - alpha);
      this.pixels[index + channel] = (src + dst) / outA;
    }
    this.pixels[index + 3] = outA;
  }

  paint(bounds, color, alpha, inside) {
    const rgb = parseColor(color);
    const minX = Math.max(0, Math.floor(bounds[0] * this.scale));
    const minY = Math.max(0, Math.floor(bounds[1] * this.scale));
    const maxX = Math.min(this.width - 1, Math.ceil(bounds[2] * this.scale));
    const maxY = Math.min(this.height - 1, Math.ceil(bounds[3] * this.scale));
    for (let y = minY; y <= maxY; y++) {
      const py = (y + 0.5) / this.scale;
      for (let x = minX; x <= maxX; x++) {
        const px = (x + 0.5) / this.scale;
        if (inside(px, py)) {
          this.blend(x, y, rgb, alpha);
        }
      }
    }
  }

  fillRoundedRect(x, y, width, height, radius, color, alpha = 1) {
    const r = Math.min(radius, width / 2, height / 2);
    this.paint([x, y, x + width, y + height], color, alpha, (px, py) => {
      if (px < x || px > x + width || py < y || py > y + height) {
        return false;
      }
      const dx = Math.max(x + r - px, 0, px - (x + width - r));
      const dy = Math.max(y + r - py, 0, py - (y + height - r));
      return dx * dx + dy * dy <= r * r;
    });
  }

  fillRect(x, y, width, height, color, alpha = 1) {
    this.fillRoundedRect(x, y, width, height, 0, color, alpha);
  }

  fillCircle(cx, cy, radius, color, alpha = 1) {
    this.paint([cx - radius, cy - radius, cx + radius, cy + radius], color, alpha, (px, py) => {
      const dx = px - cx;
      const dy = py - cy;
      return dx * dx + dy * dy <= radius * radius;
    });
  }

  strokeCircle(cx, cy, radius, strokeWidth, color, alpha = 1) {
    const outer = radius + strokeWidth / 2;
    const inner = radius - strokeWidth / 2;
    this.paint([cx - outer, cy - outer, cx + outer, cy + outer], color, alpha, (px, py) => {
      const dx = px - cx;
      const dy = py - cy;
      const squared = dx * dx + dy * dy;
      return squared <= outer * outer && squared >= inner * inner;
    });
  }

  strokeSegment(x1, y1, x2, y2, strokeWidth, color, alpha = 1) {
    const half = strokeWidth / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    const bounds = [
      Math.min(x1, x2) - half,
      Math.min(y1, y2) - half,
      Math.max(x1, x2) + half,
      Math.max(y1, y2) + half
    ];
    this.paint(bounds, color, alpha, (px, py) => {
      let t = lengthSquared === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
      t = Math.min(1, Math.max(0, t));
      const cx = x1 + t * dx - px;
      const cy = y1 + t * dy - py;
      return cx * cx + cy * cy <= half * half;
    });
  }

  strokeDashedSegment(x1, y1, x2, y2, strokeWidth, dash, gap, color, alpha = 1) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
      return;
    }
    const step = dash + gap;
    for (let start = 0; start < length; start += step) {
      const end = Math.min(start + dash, length);
      this.strokeSegment(
        x1 + (dx * start) / length,
        y1 + (dy * start) / length,
        x1 + (dx * end) / length,
        y1 + (dy * end) / length,
        strokeWidth,
        color,
        alpha
      );
    }
  }

  toRgba() {
    const output = new Uint8Array(this.userWidth * this.userHeight * 4);
    const samples = this.scale * this.scale;
    for (let y = 0; y < this.userHeight; y++) {
      for (let x = 0; x < this.userWidth; x++) {
        let sumA = 0;
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        for (let sy = 0; sy < this.scale; sy++) {
          for (let sx = 0; sx < this.scale; sx++) {
            const index = ((y * this.scale + sy) * this.width + x * this.scale + sx) * 4;
            const alpha = this.pixels[index + 3];
            sumA += alpha;
            sumR += this.pixels[index] * alpha;
            sumG += this.pixels[index + 1] * alpha;
            sumB += this.pixels[index + 2] * alpha;
          }
        }
        const alpha = sumA / samples;
        const target = (y * this.userWidth + x) * 4;
        output[target] = alpha === 0 ? 0 : Math.round(Math.min(1, sumR / samples / alpha) * 255);
        output[target + 1] = alpha === 0 ? 0 : Math.round(Math.min(1, sumG / samples / alpha) * 255);
        output[target + 2] = alpha === 0 ? 0 : Math.round(Math.min(1, sumB / samples / alpha) * 255);
        output[target + 3] = Math.round(alpha * 255);
      }
    }
    return output;
  }
}

// Normalized plot coordinates (0..1 on both axes) shared by the icon and the logo so
// both assets show the same quadrant story at different levels of detail.
const thresholdX = 0.46;
const thresholdY = 0.52;
const logoPoints = [
  { x: 0.08, y: 0.22, weight: 0.34, series: 3 },
  { x: 0.16, y: 0.7, weight: 0.42, series: 0 },
  { x: 0.19, y: 0.36, weight: 0.3, series: 3 },
  { x: 0.28, y: 0.16, weight: 0.52, series: 3 },
  { x: 0.3, y: 0.82, weight: 0.6, series: 0 },
  { x: 0.38, y: 0.5, weight: 0.36, series: 1 },
  { x: 0.42, y: 0.28, weight: 0.44, series: 1 },
  { x: 0.55, y: 0.63, weight: 0.5, series: 2 },
  { x: 0.58, y: 0.34, weight: 0.7, series: 1 },
  { x: 0.66, y: 0.86, weight: 0.62, series: 2 },
  { x: 0.71, y: 0.58, weight: 0.9, series: 2 },
  { x: 0.78, y: 0.24, weight: 0.4, series: 1 },
  { x: 0.84, y: 0.74, weight: 0.55, series: 2 },
  { x: 0.92, y: 0.9, weight: 0.78, series: 2 }
];
const iconPoints = [
  { x: 0.2, y: 0.74, series: 0 },
  { x: 0.24, y: 0.24, series: 3 },
  { x: 0.74, y: 0.3, series: 1 },
  { x: 0.8, y: 0.8, series: 2 }
];

function drawPlot(raster, area, options) {
  const { left, top, width, height } = area;
  const toX = (value) => left + value * width;
  const toY = (value) => top + (1 - value) * height;
  const crossX = toX(thresholdX);
  const crossY = toY(thresholdY);

  if (options.quadrants) {
    raster.fillRect(left, top, crossX - left, crossY - top, palette.quadrantUpperLeft);
    raster.fillRect(crossX, top, left + width - crossX, crossY - top, palette.quadrantUpperRight);
    raster.fillRect(left, crossY, crossX - left, top + height - crossY, palette.quadrantLowerLeft);
    raster.fillRect(crossX, crossY, left + width - crossX, top + height - crossY, palette.quadrantLowerRight);
  }

  raster.strokeSegment(
    toX(0.04),
    toY(0.12),
    toX(0.96),
    toY(0.84),
    options.regressionWidth,
    palette.regression,
    0.72
  );

  raster.strokeDashedSegment(
    crossX,
    top,
    crossX,
    top + height,
    options.axisWidth,
    options.dash,
    options.dash * 0.75,
    palette.axis,
    0.9
  );
  raster.strokeDashedSegment(
    left,
    crossY,
    left + width,
    crossY,
    options.axisWidth,
    options.dash,
    options.dash * 0.75,
    palette.axis,
    0.9
  );

  for (const point of options.points) {
    const radius = options.minRadius + (point.weight ?? 1) * (options.maxRadius - options.minRadius);
    const cx = toX(point.x);
    const cy = toY(point.y);
    if (options.markerStroke > 0) {
      raster.fillCircle(cx, cy, radius + options.markerStroke, palette.card, 0.95);
    }
    raster.fillCircle(cx, cy, radius, palette.series[point.series], 0.94);
  }
}

function buildLogo() {
  const size = 300;
  const raster = new Raster(size, size, SUPERSAMPLE);
  raster.fillRoundedRect(0, 0, size, size, 64, palette.brand);
  raster.fillRoundedRect(30, 30, size - 60, size - 60, 26, palette.card);
  drawPlot(raster, { left: 48, top: 48, width: size - 96, height: size - 96 }, {
    quadrants: true,
    points: logoPoints,
    minRadius: 5,
    maxRadius: 12,
    markerStroke: 1.6,
    axisWidth: 2.6,
    regressionWidth: 3,
    dash: 9
  });
  return { width: size, height: size, rgba: raster.toRgba() };
}

function buildIcon() {
  const size = 20;
  const raster = new Raster(size, size, SUPERSAMPLE);
  raster.fillRoundedRect(0.5, 0.5, size - 1, size - 1, 4, palette.brand, 0.08);
  drawPlot(raster, { left: 2, top: 2, width: size - 4, height: size - 4 }, {
    quadrants: true,
    points: iconPoints,
    minRadius: 2.2,
    maxRadius: 2.2,
    markerStroke: 0.55,
    axisWidth: 1,
    regressionWidth: 1,
    dash: 2
  });
  return { width: size, height: size, rgba: raster.toRgba() };
}

function buildAssets() {
  const icon = buildIcon();
  const logo = buildLogo();
  return [
    {
      relativePath: path.join("assets", "icon.png"),
      expectedWidth: 20,
      expectedHeight: 20,
      ...icon,
      png: encodePng(icon.width, icon.height, icon.rgba)
    },
    {
      relativePath: path.join("assets", "partner-center-logo-300x300.png"),
      expectedWidth: 300,
      expectedHeight: 300,
      ...logo,
      png: encodePng(logo.width, logo.height, logo.rgba)
    }
  ];
}

module.exports = { buildAssets, decodePng, encodePng };

if (require.main === module) {
  for (const asset of buildAssets()) {
    const target = path.join(root, asset.relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, asset.png);
    console.log(`Wrote ${asset.relativePath} (${asset.width}x${asset.height}, ${asset.png.length} bytes)`);
  }
}
