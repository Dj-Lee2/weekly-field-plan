import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync, existsSync, lstatSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyState, applyCommand } from './lib/domain.mjs';

const BODY_LIMIT = 128 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
function problem(message, status) { return Object.assign(new Error(message), { status }); }
function response(res, status, value, method = 'GET') {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(method === 'HEAD' ? undefined : body);
}
function countHeader(req, name) { let count = 0; for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === name) count++; return count; }
function validatePublicOrigin(value) {
  if (value === undefined) return undefined;
  let url;
  try { url = new URL(value); } catch { throw new Error('PUBLIC_ORIGIN은 정확한 HTTPS 출처여야 합니다.'); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password || url.hostname === 'localhost' || url.hostname === '127.0.0.1') throw new Error('PUBLIC_ORIGIN은 경로 없는 정확한 HTTPS 출처여야 합니다.');
  return url;
}
function guard(req, server, publicOrigin) {
  const port = server.address()?.port;
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (publicOrigin) allowed.add(publicOrigin.host);
  if (countHeader(req, 'host') !== 1 || !allowed.has(req.headers.host)) throw problem('허용되지 않은 접속 주소입니다.', 403);
  const isPublic = publicOrigin && req.headers.host === publicOrigin.host;
  const expectedOrigin = isPublic ? publicOrigin.origin : `http://${req.headers.host}`;
  if (countHeader(req, 'origin') > 1 || (req.headers.origin !== undefined && req.headers.origin !== expectedOrigin) || (isPublic && req.method === 'POST' && req.headers.origin !== expectedOrigin)) throw problem('다른 출처의 요청은 허용하지 않습니다.', 403);
  if (req.headers['sec-fetch-site'] === 'cross-site') throw problem('다른 출처의 요청은 허용하지 않습니다.', 403);
}
async function readJson(req) {
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(req.headers['content-type'] ?? '')) throw problem('Content-Type은 application/json이어야 합니다.', 415);
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw problem('압축된 요청은 지원하지 않습니다.', 415);
  const declared = req.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > BODY_LIMIT)) throw problem('요청 본문은 최대 128KiB입니다.', 413);
  const body = await new Promise((resolve, reject) => {
    let bytes = 0, exceeded = false;
    const chunks = [];
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > BODY_LIMIT) { if (!exceeded) { exceeded = true; reject(problem('요청 본문은 최대 128KiB입니다.', 413)); } return; }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!exceeded) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
    req.on('aborted', () => reject(problem('요청이 중단되었습니다.', 400)));
  });
  try { return JSON.parse(body); } catch { throw problem('올바른 JSON 본문이 아닙니다.', 400); }
}

export function createServer({ dbPath, staticDir, publicOrigin: originValue } = {}) {
  // Edge authentication is required for this explicitly configured HTTPS origin.
  // Never infer it from X-Forwarded-* headers; listening stays loopback-only.
  const publicOrigin = validatePublicOrigin(originValue);
  if (typeof dbPath !== 'string' || !dbPath || dbPath === ':memory:') throw new Error('영구 저장용 SQLite 파일 경로가 필요합니다.');
  const databasePath = path.resolve(dbPath);
  const staticRoot = path.resolve(staticDir ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist'));
  mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  if (existsSync(databasePath) && (lstatSync(databasePath).isSymbolicLink() || !lstatSync(databasePath).isFile())) throw new Error('일반 SQLite 파일 경로만 사용할 수 있습니다.');
  const db = new DatabaseSync(databasePath);
  try {
    chmodSync(databasePath, 0o600);
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS draft_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL)');
    db.prepare('INSERT OR IGNORE INTO draft_state(id,revision,payload) VALUES(1,0,?)').run(JSON.stringify(emptyState()));
  } catch (error) { db.close(); throw error; }
  const select = db.prepare('SELECT revision,payload FROM draft_state WHERE id=1');
  const update = db.prepare('UPDATE draft_state SET revision=?,payload=? WHERE id=1 AND revision=?');
  function load() {
    const row = select.get();
    if (!row) throw new Error('저장 상태 없음');
    const state = JSON.parse(row.payload);
    if (state.schemaVersion !== 1 || state.revision !== row.revision) throw new Error('저장 상태 불일치');
    return state;
  }
  // Fail closed at startup rather than silently resetting a corrupt database.
  try { load(); } catch (error) { db.close(); throw error; }
  const server = http.createServer({ maxHeaderSize: 16384, requestTimeout: 15000, headersTimeout: 10000 }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      guard(req, server, publicOrigin);
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw problem('올바른 경로가 아닙니다.', 400);
      let pathname;
      try { pathname = decodeURIComponent(req.url.split('?')[0]); } catch { throw problem('올바른 경로가 아닙니다.', 400); }
      if (/[\\\u0000]/u.test(pathname) || pathname.split('/').some(part => part.startsWith('.'))) throw problem('허용되지 않은 경로입니다.', 403);
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD, POST'); throw problem('지원하지 않는 요청 방식입니다.', 405); }
      if (pathname === '/api/health' && ['GET', 'HEAD'].includes(req.method)) {
        response(res, 200, { ok: true, mode: publicOrigin ? 'private-web-draft' : 'local-draft', kakaoConnected: false, aiConnected: false }, req.method); return;
      }
      if (pathname === '/api/state' && ['GET', 'HEAD'].includes(req.method)) { response(res, 200, load(), req.method); return; }
      if (pathname === '/api/commands' && req.method === 'POST') {
        const command = await readJson(req);
        let inTransaction = false, state;
        try {
          db.exec('BEGIN IMMEDIATE'); inTransaction = true;
          const previous = load();
          state = applyCommand(previous, command, { now: new Date().toISOString(), id: randomUUID() });
          if (state.revision !== previous.revision) {
            const result = update.run(state.revision, JSON.stringify(state), previous.revision);
            if (result.changes !== 1) throw problem('자료가 변경되었습니다. 다시 불러와 주세요.', 409);
          }
          db.exec('COMMIT'); inTransaction = false;
        } catch (error) { if (inTransaction) db.exec('ROLLBACK'); throw error; }
        // Read exactly what was committed, including receipts, before reporting.
        response(res, 200, { state: load() }); return;
      }
      if (pathname.startsWith('/api/')) {
        if (['/api/state', '/api/health', '/api/commands'].includes(pathname)) throw problem('지원하지 않는 요청 방식입니다.', 405);
        throw problem('API 경로를 찾지 못했습니다.', 404);
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw problem('지원하지 않는 요청 방식입니다.', 405);
      const asset = pathname === '/' ? 'index.html' : pathname.slice(1);
      const file = path.resolve(staticRoot, asset);
      if (file !== staticRoot && !file.startsWith(`${staticRoot}${path.sep}`)) throw problem('허용되지 않은 경로입니다.', 403);
      let content, info, resolvedRoot, resolvedFile;
      try {
        [resolvedRoot, resolvedFile] = await Promise.all([realpath(staticRoot), realpath(file)]);
        if (!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) throw problem('허용되지 않은 경로입니다.', 403);
        info = await stat(resolvedFile);
        if (!info.isFile()) throw problem('파일을 찾지 못했습니다.', 404);
        if (req.method !== 'HEAD') content = await readFile(resolvedFile);
      } catch (error) { if (error.status) throw error; throw problem('화면 파일을 찾지 못했습니다. 먼저 빌드해 주세요.', 404); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': info.size });
      res.end(content);
    } catch (error) {
      req.resume();
      if (res.headersSent) { res.destroy(); return; }
      const status = error.status ?? (error.code === 'CONFLICT' ? 409 : ['VALIDATION', 'LIMIT'].includes(error.code) ? 422 : 500);
      if (status === 413) res.setHeader('Connection', 'close');
      response(res, status, { error: status === 500 ? '로컬 저장소 처리에 실패했습니다. 자료를 보관하고 서버 상태를 확인해 주세요.' : error.message }, req.method);
    }
  });
  const listen = server.listen.bind(server);
  server.listen = (...args) => {
    let options, callback;
    if (typeof args[0] === 'object' && args[0] !== null) {
      options = { ...args[0] }; callback = args[1];
      if ('path' in options || 'fd' in options || 'handle' in options) throw new Error('127.0.0.1 로컬 TCP만 허용됩니다.');
    } else {
      options = { port: args[0] };
      if (typeof args[1] === 'string') options.host = args[1];
      callback = args.find(arg => typeof arg === 'function');
    }
    if ((options.host ?? '127.0.0.1') !== '127.0.0.1' || typeof options.port !== 'number' || !Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('127.0.0.1 로컬 주소와 유효한 포트만 허용됩니다.');
    options.host = '127.0.0.1';
    return callback ? listen(options, callback) : listen(options);
  };
  server.keepAliveTimeout = 1000;
  server.maxRequestsPerSocket = 100;
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST ?? '127.0.0.1';
  const portText = process.env.PORT ?? '8788';
  if (host !== '127.0.0.1' || !/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
    console.error('HOST=127.0.0.1과 1~65535 사이 PORT만 사용할 수 있습니다.'); process.exitCode = 1;
  } else {
    const root = path.dirname(fileURLToPath(import.meta.url));
    try {
      const server = createServer({ dbPath: path.join(path.resolve(process.env.DATA_DIR ?? path.join(root, 'runtime')), 'weekly-field-plan.sqlite'), staticDir: path.join(root, 'dist'), publicOrigin: process.env.PUBLIC_ORIGIN });
      server.listen(Number(portText), host, () => console.log(`주간 포장계획 로컬 초안 http://${host}:${portText} · AI/카카오 미연결`));
      server.on('error', () => { console.error('로컬 서버 시작에 실패했습니다. 포트와 저장소를 확인해 주세요.'); process.exitCode = 1; server.close(); });
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
    } catch { console.error('로컬 저장소를 열지 못했습니다. 경로와 권한을 확인해 주세요.'); process.exitCode = 1; }
  }
}
