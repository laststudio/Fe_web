import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const root = new URL('../cap-runtime/', import.meta.url);
const placeholder = '__LASTUDIO_CAP_NONCE__';
const sandboxPath = '/cap-assets/instrumentation-v1.html';
const virtualId = '\0lastudio-cap-widget';

export const sandboxPolicy = "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; sandbox allow-scripts; script-src 'self' 'nonce-$request_id' 'unsafe-eval'; style-src 'unsafe-inline'; connect-src 'none'; form-action 'none'";

export function widgetSource() {
  const pkg = require('cap-widget/package.json');
  if (pkg.version !== '0.1.57') throw new Error('Review the CAP sandbox adapter before upgrading cap-widget.');
  const source = readFileSync(require.resolve('cap-widget'), 'utf8');
  const start = source.indexOf('const o=window.CAP_SCRIPT_NONCE||window.CAP_CSS_NONCE,l=');
  const end = source.indexOf(',document.body.appendChild(s)', start);
  if (start < 0 || end < start || !source.slice(start, end).includes('s.srcdoc=')) {
    throw new Error('CAP instrumentation source changed; refusing an unreviewed CSP adapter.');
  }
  const replacement = `s.addEventListener("load",()=>s.contentWindow.postMessage({type:"cap:execute",script:i},"*"),{once:true}),s.src=${JSON.stringify(sandboxPath)}`;
  const setup = `const nonce=document.querySelector('meta[name="lastudio-cap-nonce"]')?.content;if(nonce&&nonce!==${JSON.stringify(placeholder)}){window.CAP_CSS_NONCE=nonce;setStyleNonce(nonce);}window.CAP_CUSTOM_WASM_URL='/cap-assets/cap_wasm-0.0.7.wasm';window.CAP_PAKO_URL='/cap-assets/pako_inflate-2.1.0.min.js';`;
  return `import {setNonce as setStyleNonce} from 'get-nonce';\n(()=>{${setup}})();\n${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

export function runtimeAssets() {
  return new Map([
    [sandboxPath, { type: 'text/html; charset=utf-8', body: Buffer.from(`<!doctype html><html><head><meta charset="utf-8"><meta name="lastudio-cap-nonce" content="${placeholder}"><script defer src="/cap-assets/instrumentation-v1.js"></script></head><body></body></html>`) }],
    ['/cap-assets/instrumentation-v1.js', { type: 'text/javascript; charset=utf-8', body: readFileSync(new URL('instrumentation.js', root)) }],
    ['/cap-assets/cap_wasm-0.0.7.wasm', { type: 'application/wasm', body: readFileSync(new URL('vendor/cap_wasm-0.0.7.wasm', root)) }],
    ['/cap-assets/pako_inflate-2.1.0.min.js', { type: 'text/javascript; charset=utf-8', body: readFileSync(new URL('vendor/pako_inflate-2.1.0.min.js', root)) }],
    ['/cap-assets/cap-wasm-LICENSE', { type: 'text/plain', body: readFileSync(new URL('vendor/cap-wasm-LICENSE', root)) }],
    ['/cap-assets/pako-LICENSE', { type: 'text/plain', body: readFileSync(new URL('vendor/pako-LICENSE', root)) }],
  ]);
}

export default function capRuntime() {
  return {
    name: 'lastudio-cap-runtime',
    enforce: 'pre',
    resolveId(id) { if (id === 'cap-widget') return virtualId; },
    load(id) { if (id === virtualId) return widgetSource(); },
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: 'lastudio-cap-nonce', content: placeholder }, injectTo: 'head-prepend' }];
    },
    generateBundle() {
      for (const [path, asset] of runtimeAssets()) this.emitFile({ type: 'asset', fileName: path.slice(1), source: asset.body });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0];
        const asset = runtimeAssets().get(path);
        if (!asset) return next();
        response.setHeader('Content-Type', asset.type);
        if (path === sandboxPath) {
          const nonce = randomBytes(16).toString('hex');
          response.setHeader('Content-Security-Policy', sandboxPolicy.replaceAll('$request_id', nonce));
          response.setHeader('Cache-Control', 'no-store');
          response.end(asset.body.toString().replaceAll(placeholder, nonce));
        } else response.end(asset.body);
      });
    },
  };
}
