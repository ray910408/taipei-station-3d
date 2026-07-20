/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { applySave } from './tools/save-handler.mjs';

// 描圖工具 dev-only 存檔端點：POST /__tracer/save {files:[{file,doc}]} → 全站驗證通過才寫檔
function tracerSavePlugin(): Plugin {
  return {
    name: 'tracer-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__tracer/save', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk; });
        req.on('end', () => {
          res.setHeader('content-type', 'application/json');
          try {
            const { files } = JSON.parse(body) as { files: Array<{ file: string; doc: unknown }> };
            const result = applySave(process.cwd(), files);
            res.statusCode = result.ok ? 200 : 422;
            res.end(JSON.stringify(result));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, errors: [String(e)], written: [] }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [tracerSavePlugin()],
  server: { port: Number(process.env.PORT) || 5173 },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        tracer: fileURLToPath(new URL('./tracer.html', import.meta.url)),
      },
    },
  },
  test: { environment: 'node' },
});
