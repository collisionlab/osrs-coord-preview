import { once } from "node:events";
import test from "node:test";
import assert from "node:assert/strict";
import { handleRenderRequest, type ImageStore } from "../src/service.js";
import { objectKey } from "../src/config.js";
import { parseCoordinateItems } from "../src/input.js";
import { fixtureFetch } from "./fixtures.js";

test("keys depend only on pixel inputs; caching deduplicates across batches", async () => {
  const first=parseCoordinateItems('[{"coordinate":"3232/3232/1","id":"first"}]')[0];
  const second=parseCoordinateItems('[{"coordinate":"03232/3232/1","id":"second","source":"elsewhere"}]')[0];
  const key=await objectKey(first);
  assert.match(key,/^[a-f0-9]{64}\.png$/);
  assert.equal(key,await objectKey(second));
  for (const options of [{style:"tactical" as const},{cropSize:386},{markerRadius:3},{tileVersion:"2741-8acf5d122b49"},{insetVersion:"111111111111111111111111"}])
    assert.notEqual(key,await objectKey(first,options));
  const objects=new Map<string,Uint8Array>();let puts=0,fetches=0;
  const store:ImageStore={has:async key=>objects.has(key),put:async(key,bytes)=>{puts++;objects.set(key,bytes);}};
  const fixture=await fixtureFetch();
  const options={fetchImpl:(async (url,init)=>{fetches++;return fixture(url,init);}) as typeof fetch};
  const response=await handleRenderRequest(JSON.stringify([first,second]),store,options);
  assert.equal(response.renderCount,2);assert.equal(puts,1);
  const before=fetches;
  assert.equal((await handleRenderRequest(JSON.stringify([second]),store,options)).renderCount,1);
  assert.equal(fetches,before);
  const failure=await handleRenderRequest('[{"coordinate":"3296/3232/3"},{"coordinate":"3232/3232/1"}]',store,options);
  assert.equal(failure.renderCount,1);assert.equal(failure.failedCount,1);
});

test("R2 S3 adapter uses bucket-scoped signed HEAD/PUT and preserves PNG metadata", async () => {
  const http=await import("node:http");const {imageStore}=await import("../src/service.js");
  let stored:Buffer|undefined;let fail=false;
  const server=http.createServer(async(req,res)=>{
    assert.match(req.url!,/^\/previews\/a\.png/);assert.match(req.headers.authorization!,/^AWS4-HMAC-SHA256/);
    if(fail){res.writeHead(403);res.end();return;}
    if(req.method==="HEAD"){res.writeHead(stored?200:404,stored?{"content-length":stored.length}:{});res.end();return;}
    assert.equal(req.method,"PUT");assert.equal(req.headers["content-type"],"image/png");assert.match(req.headers["cache-control"]!,/immutable/);
    const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));stored=Buffer.concat(chunks);
    res.setHeader("etag",'"test"');res.end();
  }).listen(0,"127.0.0.1");await once(server,"listening");
  const old={...process.env};
  try {
    delete process.env.PUBLISH_MODE;
    Object.assign(process.env,{R2_BUCKET:"previews",R2_ENDPOINT:`http://127.0.0.1:${(server.address() as any).port}`,AWS_ACCESS_KEY_ID:"test",AWS_SECRET_ACCESS_KEY:"test"});
    const store=imageStore();assert.equal(await store.has("a.png"),false);
    await store.put("a.png",Buffer.from("PNG fixture"));assert.equal(await store.has("a.png"),true);assert.equal(stored!.toString(),"PNG fixture");
    fail=true;await assert.rejects(store.has("a.png"));
  } finally {process.env=old;server.close();}
});
