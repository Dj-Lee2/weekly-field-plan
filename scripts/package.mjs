import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";
const root = resolve(".");
const dest = resolve("artifacts/delivery");
await mkdir(dest, { recursive: true });
const allowed = [
  "contract.json",
  "package.json",
  "package-lock.json",
  "index.html",
  "START-HERE.html",
  "server.mjs",
];
async function walk(dir) {
  const result = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) throw Error("Symlink denied");
    const p = dir + "/" + e.name;
    if (e.isDirectory()) result.push(...(await walk(p)));
    else result.push(p);
  }
  return result;
}
for (const dir of ["lib", "tests", "src", "scripts", "public", "dist"])
  allowed.push(...(await walk(dir)));
const files = allowed.filter((f) => !f.endsWith(".log"));
const manifest = [];
for (const f of files) {
  const bytes = await readFile(f);
  manifest.push({
    path: f,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
await writeFile(
  dest + "/manifest.json",
  JSON.stringify(
    { format: 1, scope: "local-draft-unconnected", files: manifest },
    null,
    2,
  ),
);
await writeFile(
  dest + "/주간포장계획_작동초안.html",
  await readFile("artifacts/주간포장계획_작동초안.html"),
);
await writeFile(dest + "/START-HERE.html", await readFile("START-HERE.html"));
await writeFile(
  dest + "/verification.json",
  await readFile("artifacts/verification.json"),
);
const args = [
  "-c",
  `import sys,zipfile,pathlib,json\nr=pathlib.Path(sys.argv[1]); d=r/'artifacts/delivery'; m=json.loads((d/'manifest.json').read_text()); entries=[(r/x['path'],x['path']) for x in m['files']]+[(d/n,n) for n in ['주간포장계획_작동초안.html','manifest.json','verification.json']]\nwith zipfile.ZipFile(d/'주간포장계획_초안_소스포함.zip','w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:\n for p,n in entries:z.write(p,'weekly-field-plan/'+n)\nwith zipfile.ZipFile(d/'주간포장계획_초안_소스포함.zip') as z:\n assert z.testzip() is None\n assert len(z.namelist())==len(set(z.namelist()))\n assert not any('runtime/' in n or 'node_modules/' in n or '.env' in n for n in z.namelist())\n print(json.dumps({'files':len(z.namelist()),'crc_ok':True,'zip_bytes':(d/'주간포장계획_초안_소스포함.zip').stat().st_size}))`,
  root,
];
console.log(execFileSync("python3", args, { encoding: "utf8" }));
