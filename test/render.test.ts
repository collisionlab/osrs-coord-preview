import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { parseCoordinateItems } from "../src/input.js";
import { renderBatch, resolveTileCoordinate } from "../src/render.js";
import { fixtureFetch } from "./fixtures.js";

test("explv origin, square centres, boundaries and TMS rows", () => {
  assert.deepEqual(resolveTileCoordinate(960,1216), { tileX:0,tileY:0,pixelX:2,pixelY:254 });
  assert.deepEqual(resolveTileCoordinate(3263,3263), { tileX:35,tileY:31,pixelX:254,pixelY:2 });
  assert.deepEqual(resolveTileCoordinate(3264,3264), { tileX:36,tileY:32,pixelX:2,pixelY:254 });
  assert.deepEqual(resolveTileCoordinate(0,0), { tileX:-15,tileY:-19,pixelX:2,pixelY:254 });
  for (const n of [-1,16384,NaN,1.5]) assert.throws(() => resolveTileCoordinate(n,3200));
});

test("both styles and all planes match golden pixels and preserve 48-square extent", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),"preview-test-"));
  try {
    for (const style of ["standard","tactical"] as const) for (let plane=0;plane<4;plane++) {
      const items = parseCoordinateItems(JSON.stringify([{coordinate:`3232/3232/${plane}`,id:"centre"}]));
      const result = await renderBatch(items,{outputDir:dir,style,fetchImpl:await fixtureFetch()});
      assert.equal(result.failedCount,0,JSON.stringify(result));
      const image = await fs.readFile(path.join(dir,"centre.png"));
      const raw = await sharp(image).removeAlpha().raw().toBuffer({resolveWithObject:true});
      assert.equal(raw.info.width,384);
      assert.deepEqual([...raw.data.subarray((20*384+20)*3,(20*384+20)*3+3)], [200,plane*40+(style==="tactical"?30:0),20]);
      assert.deepEqual([...raw.data.subarray((360*384+20)*3,(360*384+20)*3+3)], [20,plane*40+(style==="tactical"?30:0),200]);
      const golden = path.join(import.meta.dirname,"golden",`${style}-${plane}.png`);
      if (process.env.UPDATE_GOLDEN) await fs.writeFile(golden,image);
      assert.deepEqual(await sharp(image).raw().toBuffer(),await sharp(await fs.readFile(golden)).raw().toBuffer());
    }
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test("listed missing tiles fail per item; absent upper plane never falls back", async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"preview-test-"));
  try {
    const fixtures=await fixtureFetch();
    const items=parseCoordinateItems('[{"coordinate":"3232/3232/0"},{"coordinate":"3232/3232/1"},{"coordinate":"3296/3232/2"}]');
    const result=await renderBatch(items,{outputDir:dir,fetchImpl:async (url,init)=> /\/standard\/[^/]+\/p1\//.test(String(url)) ? new Response(null,{status:404}) : fixtures(url,init)});
    assert.equal(result.renderCount,1);assert.equal(result.failedCount,2);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test("pinned CollisionLab Lumbridge map square on all four planes matches real-image goldens", async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"preview-real-"));
  try {
    const sources=JSON.parse(await fs.readFile(path.join(import.meta.dirname,"source/sources.json"),"utf8"));
    const {createHash}=await import("node:crypto");
    for (const style of ["standard","tactical"] as const) for(let plane=0;plane<4;plane++) {
      const source=await fs.readFile(path.join(import.meta.dirname,`source/${style}-${plane}.png`));
      assert.equal(createHash("sha256").update(source).digest("hex"),sources[`${style}-${plane}.png`].sha256);
      const fetchImpl:typeof fetch=async input=>{
        const url=String(input);
        if(url.endsWith('/manifest.json')) return Response.json({layout:"explv-tms-v1",planes:[{},{},{},{}]});
        if(url.endsWith('/index.json')) return Response.json({[`${plane ? `p${plane}/` : ''}8/35/31.png`]:'fixture'});
        assert.ok(url.endsWith('/8/35/31.png'));return new Response(new Uint8Array(source));
      };
      const result=await renderBatch(parseCoordinateItems(`[{"coordinate":"3232/3232/${plane}","id":"real"}]`),{outputDir:dir,style,fetchImpl});
      assert.equal(result.failedCount,0,JSON.stringify(result));
      const image=await fs.readFile(path.join(dir,'real.png'));
      const golden=path.join(import.meta.dirname,`golden/real-${style}-${plane}.png`);
      if(process.env.UPDATE_GOLDEN) await fs.writeFile(golden,image);
      assert.deepEqual(await sharp(image).raw().toBuffer(),await sharp(await fs.readFile(golden)).raw().toBuffer());
    }
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test("crop at a map-square corner composes northern TMS rows above southern rows", async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"preview-corner-"));
  try {
    const fixture=await fixtureFetch();const seen:string[]=[];
    const result=await renderBatch(parseCoordinateItems('[{"coordinate":"3200/3200/0","id":"corner"}]'),{outputDir:dir,fetchImpl:async(input,init)=>{
      const url=String(input);if(url.endsWith('.json')){
        if(url.endsWith('index.json'))return Response.json(Object.fromEntries([34,35,36].flatMap(x=>[30,31,32].map(y=>[`8/${x}/${y}.png`,'fixture']))));
        return fixture(input,init);
      }
      seen.push(url);const match=/\/8\/(\d+)\/(\d+)\.png$/.exec(url)!;
      const rgb={r:Number(match[1])*5,g:Number(match[2])*5,b:0};
      return new Response(new Uint8Array(await sharp({create:{width:256,height:256,channels:3,background:rgb}}).png().toBuffer()));
    }});
    assert.equal(result.failedCount,0);assert.equal(seen.length,4);
    const {data,info}=await sharp(path.join(dir,'corner.png')).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const pixel=(x:number,y:number)=>[...data.subarray((y*info.width+x)*3,(y*info.width+x)*3+3)];
    assert.deepEqual(pixel(20,20),[170,155,0]);assert.deepEqual(pixel(360,20),[175,155,0]);
    assert.deepEqual(pixel(20,360),[170,150,0]);assert.deepEqual(pixel(360,360),[175,150,0]);
    // The 8px game-square outline is centred at (192,192), away from tile seams.
    assert.notDeepEqual(pixel(188,192),pixel(180,192));
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
