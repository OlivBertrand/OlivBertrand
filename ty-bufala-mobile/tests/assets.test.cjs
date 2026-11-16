/* Verify the deployed allowlist without installing a browser or dependencies. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server/app.py'),'utf8');
const allowed=new Set([...server.match(/ASSETS\s*=\s*\{([\s\S]*?)\}/)[1].matchAll(/'([^']+)'/g)].map(x=>x[1]));
test('every page script is explicitly served by the production asset handler',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)){
    assert(allowed.has(match[1]),`missing public asset: ${match[1]}`);
    assert(fs.existsSync(path.join(root,match[1])));
  }
});
test('every offline cached file is explicitly served',()=>{
  const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  for(const match of sw.match(/const ASSETS = \[([^\]]+)\]/)[1].matchAll(/'\.\/([^']*)'/g)){
    if(match[1])assert(allowed.has(match[1]),`offline install would fail: ${match[1]}`);
  }
});
test('source, credentials and SQLite files remain outside the public allowlist',()=>{
  for(const name of allowed)assert(!/server\/|\.db$|\.pem$|\.env|\.py$|\.md$/.test(name));
});
