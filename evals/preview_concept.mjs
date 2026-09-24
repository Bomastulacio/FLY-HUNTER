/** Isolated design prototype. No auth, database, provider calls or production route. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
const root = fileURLToPath(new URL('../design/prototype/', import.meta.url));
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.jpg':'image/jpeg', '.woff2':'font/woff2' };
createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname === '/favicon.svg') { res.setHeader('Content-Type','image/svg+xml');res.end(await readFile(new URL('../frontend/public/favicon.svg',import.meta.url)));return; }
    const target = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if(!target.startsWith(root.endsWith(sep) ? root : root + sep)) {res.writeHead(403);res.end();return;}
    res.setHeader('Content-Type', types[extname(target)] || 'application/octet-stream');
    res.setHeader('Cache-Control','no-store');
    res.end(await readFile(target));
  } catch {res.writeHead(404);res.end('Not found');}
}).listen(4323,'127.0.0.1',()=>console.log('Design prototype: http://127.0.0.1:4323'));
