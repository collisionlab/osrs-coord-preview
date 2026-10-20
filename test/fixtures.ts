import sharp from "sharp";
export async function fixtureFetch(): Promise<typeof fetch> {
  const tiles = new Map<string, Buffer>();
  for (const style of ["standard", "tactical"]) for (let plane = 0; plane < 4; plane++) {
    // North is red, south blue. Green identifies the plane and style.
    const data = Buffer.alloc(256 * 256 * 3);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 3;
      data[i] = y < 128 ? 200 : 20; data[i + 1] = plane * 40 + (style === "tactical" ? 30 : 0); data[i + 2] = y < 128 ? 20 : 200;
    }
    tiles.set(`${style}/${plane}`, await sharp(data, { raw: { width: 256, height: 256, channels: 3 } }).png().toBuffer());
  }
  return async input => {
    const url = String(input);
    if (url.endsWith("/manifest.json")) return Response.json({ layout: "explv-tms-v1", planes: [{}, {}, {}, {}] });
    if (url.endsWith("/index.json")) return Response.json(Object.fromEntries(["", "p1/", "p2/", "p3/"].map(p => [`${p}8/35/31.png`, "fixture"])));
    const plane = Number(/\/p([1-3])\/8\//.exec(url)?.[1] ?? 0);
    const style = url.includes("/standard/") ? "standard" : "tactical";
    if (!url.endsWith("/8/35/31.png")) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(tiles.get(`${style}/${plane}`)!));
  };
}
