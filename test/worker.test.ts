import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { handleRenderRequest } from "../src/service.js";
import { fixtureFetch } from "./fixtures.js";

test("Worker R2 miss -> renderer -> publication -> hit and immutable PNG retrieval", async () => {
  let renders=0;
  const fixture=await fixtureFetch();
  const mf=new Miniflare({ modules:true, scriptPath:"worker-dist/worker.js", compatibilityDate:"2026-06-01",
    bindings:{ORIGIN_URL:"https://renderer.invalid/render",ORIGIN_TOKEN:"test-secret"},r2Buckets:["IMAGES"],
    ratelimits:{RATE_LIMITER:{namespace_id:"1",simple:{limit:100,period:60}}},
    outboundService:async (request: Request)=>{
      assert.equal(request.headers.get("authorization"),"Bearer test-secret"); renders++;
      const bucket=await mf.getR2Bucket("IMAGES");
      const response=await handleRenderRequest(await request.text(),{
        has:async key=>!!await bucket.head(key),put:async(key,bytes)=>{await bucket.put(key,bytes);}
      },{fetchImpl:fixture});
      return new Response(JSON.stringify(response));
    }
  });
  try {
    const post=(body:string)=>mf.dispatchFetch("https://tiles.test/previews/v1/render",{method:"POST",headers:{"content-type":"application/json"},body});
    const response=await post('[{"coordinate":"3232/3232/0","id":"first"},{"coordinate":"3232/3232/0","id":"duplicate"},{"coordinate":"3296/3232/3"}]');
    assert.equal(response.status,200);
    const data=await response.json() as any;
    assert.equal(data.renderCount,2,JSON.stringify(data));assert.equal(data.failedCount,1);assert.equal(renders,2);
    const image=await mf.dispatchFetch(data.items[0].imageUrl);
    assert.equal(image.status,200);assert.equal(image.headers.get("content-type"),"image/png");
    assert.match(image.headers.get("cache-control")!,/immutable/);
    assert.equal(Buffer.from(await image.arrayBuffer()).subarray(1,4).toString(),"PNG");
    assert.equal((await mf.dispatchFetch(data.items[0].imageUrl,{method:"HEAD"})).status,200);
    assert.equal((await mf.dispatchFetch(data.items[0].imageUrl,{headers:{"if-none-match":image.headers.get("etag")!}})).status,304);
    await post('[{"coordinate":"3232/3232/0","label":"another batch"}]');assert.equal(renders,2);
    assert.equal((await post('oops')).status,400);
    assert.equal((await post(' '.repeat(65537))).status,413);
    assert.equal((await mf.dispatchFetch("https://tiles.test/previews/images/../secret")).status,404);
    assert.equal((await mf.dispatchFetch("https://tiles.test/previews/images/"+"a".repeat(64)+".png")).status,404);
  } finally { await mf.dispose(); }
});
