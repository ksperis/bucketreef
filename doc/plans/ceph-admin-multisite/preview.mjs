import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const option = (key, fallback) => {
  const pos = args.indexOf(key);
  return pos < 0 ? fallback : args[pos + 1];
};
const host = option('--host', '127.0.0.1');
const port = Number(option('--port', '4173'));
const types = { '.html': 'text/html', '.md': 'text/plain', '.png': 'image/png', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) {
      res.writeHead(403).end(); return;
    }
    const bytes = await readFile(target);
    res.writeHead(200, { 'Content-Type': `${types[extname(target)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
    res.end(bytes);
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(port, host, () => console.log(`Preview listening on ${host}:${port}`));
