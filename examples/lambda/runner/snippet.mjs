/**
 * The JavaScript the console opens on (FR-EXM-122) — ordinary submitted code, not part of the
 * runner's contract.
 *
 * DEFAULT_SNIPPET is deliberately trivial: it uses nothing but `console.log` and `return`, so it
 * runs on any build of the runner. MANDELBROT_SNIPPET is the heavy one, kept because it is
 * genuinely CPU-bound — ask for more pixels or iterations and you burn more Lambda seconds,
 * which is what makes the per-second meter legible. It needs a runner that passes `require`.
 */

/**
 * FR-EXM-122 (amended 2026-09-21): the console opens on **thirty real seconds** of Lambda.
 *
 * The old default returned "Hello, world!" in about a millisecond, so the meter never moved and
 * the thing the console exists to demonstrate was invisible. This one burns CPU in one-second
 * slices and prints a line per slice: thirty log lines beside thirty ticks of the meter, and a
 * figure at the end for what thirty seconds of Lambda actually bought. It hashes rather than
 * sleeping on purpose — a subscriber being asked to accept per-second billing should see the
 * seconds doing work, not the clock running on an idle machine.
 *
 * `seconds` is a parameter so the test suite can run one second instead of thirty; the console is
 * always served the default.
 */
export function defaultSnippet(seconds = 30) {
  return `// Runs on real AWS Lambda for ${seconds} seconds. You pay for the seconds this session is open.
const { createHash } = require("node:crypto");

const SECONDS = ${seconds};
const started = Date.now();
let hashes = 0, digest = "elapse";

for (let s = 1; s <= SECONDS; s++) {
  const until = started + s * 1000;
  while (Date.now() < until) {
    for (let i = 0; i < 5000; i++) digest = createHash("sha256").update(digest).digest("hex");
    hashes += 5000;
  }
  console.log(\`\${String(s).padStart(2)}s · \${hashes.toLocaleString()} hashes\`);
}

return { seconds: SECONDS, hashes, digest: digest.slice(0, 16) };
`;
}

export const DEFAULT_SNIPPET = defaultSnippet();

export const MANDELBROT_SNIPPET = `// Renders a Mandelbrot tile on real AWS Lambda and returns it as a PNG.
// More pixels or more iterations means more compute — and more seconds.
const { deflateSync } = require("node:zlib");

const width = 480, height = 360, iterations = 800;

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const rgb = Buffer.alloc(width * height * 3);
const aspect = width / height;
for (let py = 0; py < height; py++) {
  const y0 = ((py / height) * 2 - 1) * 1.2;
  for (let px = 0; px < width; px++) {
    const x0 = -0.5 + ((px / width) * 2 - 1) * 1.2 * aspect;
    let x = 0, y = 0, i = 0;
    while (x * x + y * y <= 4 && i < iterations) {
      const xt = x * x - y * y + x0;
      y = 2 * x * y + y0;
      x = xt; i++;
    }
    const o = (py * width + px) * 3;
    if (i >= iterations) { rgb[o] = rgb[o + 1] = rgb[o + 2] = 0; }
    else {
      const t = i / iterations;
      rgb[o] = Math.round(40 * t);
      rgb[o + 1] = Math.round(255 * Math.sqrt(t));
      rgb[o + 2] = Math.round(120 * t);
    }
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8; ihdr[9] = 2;
const stride = width * 3;
const raw = Buffer.alloc((stride + 1) * height);
for (let y = 0; y < height; y++) {
  raw[y * (stride + 1)] = 0;
  rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 6 })),
  chunk("IEND", Buffer.alloc(0)),
]);

console.log(\`\${width}x\${height} @ \${iterations} iterations, \${png.length} bytes\`);
return "data:image/png;base64," + png.toString("base64");
`;
