import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
const dist = resolve("dist");
const html = await readFile(dist + "/index.html", "utf8");
const scripts = [
  ...html.matchAll(/<script[^>]+src="([^"]+)"[^>]*><\/script>/g),
].map((x) => x[1]);
const styles = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"[^>]*>/g)].map(
  (x) => x[1],
);
if (scripts.length !== 1 || styles.length !== 1)
  throw Error("Expected one script and stylesheet");
const js = await readFile(dist + scripts[0], "utf8");
let css = await readFile(dist + styles[0], "utf8");
const font = await readFile("public/fonts/PretendardVariable.woff2");
css = css.replaceAll(
  "/fonts/PretendardVariable.woff2",
  "data:font/woff2;base64," + font.toString("base64"),
);
let output = html
  .replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g, "")
  .replace(/<link[^>]+href="[^"]+\.css"[^>]*>/g, "");
output = output.replace(
  "</head>",
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'none'">` +
    "<style>" +
    css +
    "</style></head>",
);
output = output.replace(
  "</body>",
  '<script>window.__OFFLINE_DRAFT__=true;</script><script type="module">' +
    js.replace(/<\/script/gi, "<\\/script") +
    "</script></body>",
);
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/주간포장계획_작동초안.html", output);
console.log("OFFLINE_HTML_READY", Buffer.byteLength(output));
