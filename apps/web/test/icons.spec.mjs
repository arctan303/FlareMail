import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('shared registration supplies every referenced bundled icon without remote lookup',()=>{
 const registered=new Set();
 const source=fs.readFileSync(new URL('../src/icons/index.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'');
 const supplemental=JSON.parse(fs.readFileSync(new URL('../src/icons/supplemental.json',import.meta.url),'utf8'));
 vm.runInNewContext(source,{supplemental,addCollection:collection=>{for(const name of Object.keys(collection.icons))registered.add(collection.prefix+':'+name);}});
 const used=new Set();
 const prefixes=new Set([...registered].map(name=>name.split(':')[0]));
 function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=new URL(entry.name+(entry.isDirectory()?'/':''),dir);if(entry.isDirectory())walk(file);else if(/\.(vue|js)$/.test(entry.name))for(const match of fs.readFileSync(file,'utf8').matchAll(/['"]([a-z][a-z0-9-]*:[a-z0-9-]+)['"]/g)){if(prefixes.has(match[1].split(':')[0]))used.add(match[1]);}}}
 walk(new URL('../src/',import.meta.url));
 assert.ok(used.size>80);
 assert.deepEqual([...used].filter(name=>!registered.has(name)),[]);
 for(const collection of supplemental)for(const [name,icon] of Object.entries(collection.icons)){assert.ok(registered.has(collection.prefix+':'+name));assert.ok(icon.body.length>0);}
});
