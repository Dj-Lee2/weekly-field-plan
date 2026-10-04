import {build} from 'esbuild';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
await mkdir('dist/assets',{recursive:true});
await build({entryPoints:['src/main.jsx'],bundle:true,outdir:'dist/assets',platform:'browser',target:['chrome109','safari15.4'],minify:true,jsx:'automatic',define:{'process.env.NODE_ENV':JSON.stringify('production')},external:['/fonts/*'],logLevel:'info'});
await cp('public/fonts','dist/fonts',{recursive:true});
let html=await readFile('index.html','utf8');
html=html.replace('/src/main.jsx','/assets/main.js').replace('</head>','<link rel="stylesheet" href="/assets/main.css"></head>');
await writeFile('dist/index.html',html);
await import('./build-offline.mjs');
