// Why: 제품 코드 수정 없이 고정 커밋 두 개를 같은 계측으로 비교한다.
import { createServer } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
const [source, portText, label, reportPath] = process.argv.slice(2);
const port = Number(portText);
if (!source || !label || !isAbsolute(reportPath ?? '') || !Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Usage: node qa-ime-server.mjs <app-root> <port> <label> <absolute-report-path>');
process.env.VITE_TICKSIDIAN_BROWSER_QA = '1';
process.env.NODE_ENV = 'development';
const root = resolve(source);
const probe = await readFile(new URL('./qa-ime-probe.js', import.meta.url), 'utf8');
const allowed = new Set(['compositionstart', 'compositionupdate', 'compositionend', 'keydown', 'beforeinput', 'input', 'focusin', 'focusout', 'recovery-setItem']);
const server = await createServer({
  root,
  configFile: resolve(root, 'vite.config.ts'),
  server: { host: '127.0.0.1', port, strictPort: true },
  plugins: [{
    name: 'ime-comparison-probe',
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { type: 'module', src: '/__ime-probe.js' }, injectTo: 'body' }];
    },
    configureServer(vite) {
      vite.middlewares.use('/__ime-probe.js', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(probe + '\ninstallImeProbe(' + JSON.stringify(label).replaceAll('<', '\\u003c') + ');');
      });
      vite.middlewares.use('/__ime-report', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        try {
          let body = '';
          for await (const chunk of req) {
            body += chunk.toString();
            if (body.length > 512000) throw Error('Report too large');
          }
          const report = JSON.parse(body);
          if (!Array.isArray(report.events) || report.events.length > 2000) throw Error('Invalid report');
          // 허용한 필드만 저장하며 본문/글자/경로는 기록하지 않는다.
          const events = report.events.map(e => {
            if (!allowed.has(e.type) || !Number.isFinite(e.at)) throw Error('Invalid event');
            const row = { type: e.type, at: e.at };
            if (e.type === 'recovery-setItem') {
              if (!Number.isFinite(e.duration) || !Number.isFinite(e.bytes)) throw Error('Invalid timing');
              return { ...row, duration: e.duration, bytes: e.bytes };
            }
            return { ...row, trusted: e.trusted === true, composing: e.composing === true, prevented: e.prevented === true, keyCode: [13, 229].includes(e.keyCode) ? e.keyCode : null, viewComposing: e.viewComposing === true, viewComposingAfter: e.viewComposingAfter === true,
              inputType: ['insertText', 'insertCompositionText', 'insertFromComposition', 'insertParagraph', 'insertLineBreak', 'deleteCompositionText', 'deleteContentBackward'].includes(e.inputType) ? e.inputType : null };
          });
          await mkdir(dirname(reportPath), { recursive: true });
          // 측정마다 별도 파일을 남기고 이전 결과를 덮어쓰지 않는다.
          const output = reportPath.replace(/\.json$/, '') + '-' + Date.now() + '.json';
          await writeFile(output, JSON.stringify({ label, at: new Date().toISOString(), manualInputConfirmed: report.manualInputConfirmed === true, dropped: Number.isFinite(report.dropped) ? report.dropped : 0, events }, null, 2), { flag: 'wx' });
          res.end('ok');
          console.log('IME report saved:', output);
        } catch { res.statusCode = 400; res.end('Invalid report'); }
      });
    },
  }],
});
await server.listen();
console.log(label, `http://127.0.0.1:${port}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });
