// Draws the toolbar icon at the three sizes Chrome asks for. A tiny PNG writer beats adding an
// image library for one magnifying glass; run it again if the design changes.
//
//   node apps/extension/scripts/make-icons.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

type Rgba = [number, number, number, number];
const BG: Rgba = [20, 22, 26, 255]; // the popup's dark background
const LENS: Rgba = [30, 33, 39, 255];
const GLASS: Rgba = [232, 234, 238, 255];
const ALERT: Rgba = [255, 138, 128, 255]; // the colour a likely finding is shown in
const CLEAR: Rgba = [0, 0, 0, 0];

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

function png(size: number, pixel: (x: number, y: number) => Rgba): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4); // a leading 0 byte means "no filter" for this scanline
    for (let x = 0; x < size; x++) row.set(pixel(x, y), 1 + x * 4);
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits per channel
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A magnifying glass on a dark tile, with one red mark inside the lens: something was found. */
function icon(size: number) {
  const s = (v: number) => v * size;
  const ring = { x: s(0.44), y: s(0.42), r: s(0.26), w: Math.max(1, s(0.08)) };
  const corner = s(0.22);

  return (x: number, y: number): Rgba => {
    const [px, py] = [x + 0.5, y + 0.5];

    // Rounded corners, so it reads as a tile rather than a block.
    const cx = Math.min(px, size - px);
    const cy = Math.min(py, size - py);
    if (cx < corner && cy < corner && Math.hypot(corner - cx, corner - cy) > corner) return CLEAR;

    const d = Math.hypot(px - ring.x, py - ring.y);
    if (Math.abs(d - ring.r) <= ring.w / 2) return GLASS;

    // The handle, running down and to the right from the ring.
    const hx = px - (ring.x + ring.r * 0.72);
    const hy = py - (ring.y + ring.r * 0.72);
    if (hx > 0 && hy > 0 && Math.abs(hx - hy) <= ring.w / 2 && Math.hypot(hx, hy) <= s(0.3)) return GLASS;

    if (d < ring.r - ring.w / 2) return d < s(0.09) ? ALERT : LENS;
    return BG;
  };
}

const dir = join(import.meta.dirname, "../icons");
await mkdir(dir, { recursive: true });
for (const size of [16, 48, 128]) {
  await writeFile(join(dir, `icon${size}.png`), png(size, icon(size)));
  console.log(`icons/icon${size}.png`);
}
