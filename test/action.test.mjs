import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

test("bundled Action executes without node_modules and writes the existing manifest outputs", async () => {
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),"preview-action-"));
  const server=http.createServer((req,res)=>{
    assert.equal(req.method,"POST");res.setHeader("content-type","application/json");
    res.end(JSON.stringify({renderCount:1,failedCount:0,items:[{status:"success",id:"coordinate-1",coordinate:"3200/3200/0",resolved:{},imageUrl:"https://tiles.test/previews/images/example.png"}]}));
  }).listen(0,"127.0.0.1");
  try {
    await once(server,"listening");
    await fs.copyFile("action-dist/main.cjs",path.join(temp,"main.cjs"));
    const env={...process.env,INPUT_COORDINATES:'[{"coordinate":"3200/3200/0"}]',INPUT_COMMENT:"false",
      "INPUT_RENDERER-URL":`http://127.0.0.1:${server.address().port}/render`,"INPUT_OUTPUT-DIR":path.join(temp,"out"),
      GITHUB_STEP_SUMMARY:path.join(temp,"summary"),GITHUB_OUTPUT:path.join(temp,"outputs")};
    await fs.writeFile(env.GITHUB_STEP_SUMMARY,"");await fs.writeFile(env.GITHUB_OUTPUT,"");
    const child=spawn(process.execPath,[path.join(temp,"main.cjs")],{cwd:temp,env,stdio:["ignore","pipe","pipe"]});
    let errors="";child.stderr.on("data",chunk=>errors+=chunk);
    const [exit]=await once(child,"exit");assert.equal(exit,0,errors);
    const manifest=JSON.parse(await fs.readFile(path.join(temp,"out/manifest.json"),"utf8"));
    assert.equal(manifest.renderCount,1);assert.equal(manifest.items[0].coordinate,"3200/3200/0");
    assert.match(await fs.readFile(env.GITHUB_OUTPUT,"utf8"),/manifest_path/);
  } finally { server.close();await fs.rm(temp,{recursive:true,force:true}); }
});
