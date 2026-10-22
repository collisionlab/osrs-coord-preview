import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { startServer } from "../src/server.js";

test("origin requires its secret and rejects malformed or excessive input before rendering", async () => {
  delete process.env.PUBLISH_MODE;
  process.env.ORIGIN_TOKEN="test-origin-token";
  const server=startServer(0);await once(server,"listening");
  const url=`http://127.0.0.1:${(server.address() as any).port}/render`;
  const post=(body:string,authorization="Bearer test-origin-token")=>fetch(url,{method:"POST",headers:{authorization,"content-type":"application/json"},body});
  try {
    assert.equal((await post("[]","Bearer incorrect")).status,401);
    assert.equal((await post("oops")).status,400);
    assert.equal((await post(" ".repeat(65537))).status,413);
    assert.equal((await fetch(url)).status,405);
  } finally { server.close();delete process.env.ORIGIN_TOKEN; }
});
