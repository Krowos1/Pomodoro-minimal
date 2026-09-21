import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'src');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.mp3': 'audio/mpeg' };

async function firstExisting(paths) {
  for (const candidate of paths) {
    try { await access(candidate); return candidate; } catch {}
  }
  return '';
}

const browserHarness = `
window.addEventListener('load', async () => {
  const result = {};
  document.getElementById('startPauseBtn').click();
  result.started = document.querySelector('#startPauseBtn span').textContent === 'Pause';
  document.getElementById('resetBtn').click();
  result.reset = document.getElementById('timeMinutes').textContent === '25' && document.getElementById('timeSeconds').textContent === '00';
  document.getElementById('skipBtn').click();
  result.skipped = document.getElementById('modeLabel').textContent === 'Short Break';
  document.querySelector('[data-mode="stopwatch"]').click();
  document.getElementById('startPauseBtn').click();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  document.getElementById('startPauseBtn').click();
  document.getElementById('skipBtn').click();
  document.querySelector('[data-section="history"]').click();
  result.stopwatchSaved = document.getElementById('history').textContent.includes('Stopwatch task');
  result.stopwatchDuration = document.querySelector('.history-duration')?.textContent || '';
  const output = document.createElement('pre');
  output.id = 'e2eResult';
  output.textContent = JSON.stringify(result);
  document.body.append(output);
});`;

test('real browser buttons control reset, skip and stopwatch history', { timeout: 30000 }, async (t) => {
  const browserPath = await firstExisting([
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ]);
  if (!browserPath) return t.skip('Chromium browser is not installed');

  const server = createServer(async (request, response) => {
    try {
      const requestPath = new URL(request.url, 'http://localhost').pathname;
      const pathname = requestPath === '/' ? '/index.html' : requestPath;
      const filename = path.resolve(sourceRoot, `.${decodeURIComponent(pathname)}`);
      if (!filename.startsWith(sourceRoot + path.sep)) throw new Error('Invalid path');
      let contents = await readFile(filename);
      if (pathname === '/js/app.js') contents = Buffer.concat([contents, Buffer.from(browserHarness)]);
      response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' });
      response.end(contents);
    } catch {
      response.writeHead(404); response.end('Not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const profile = await mkdtemp(path.join(tmpdir(), 'pomodoro-e2e-'));
  const url = `http://127.0.0.1:${server.address().port}`;

  try {
    const html = await new Promise((resolve, reject) => {
      const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--no-sandbox', '--no-first-run', `--user-data-dir=${profile}`, '--virtual-time-budget=3000', '--dump-dom', url], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      browser.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      browser.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      browser.on('error', reject);
      browser.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`Browser exited with ${code}: ${stderr}`)));
    });
    const match = html.match(/<pre id="e2eResult">([^<]+)<\/pre>/);
    assert.ok(match, 'browser harness did not finish');
    const result = JSON.parse(match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
    assert.deepEqual({ started: result.started, reset: result.reset, skipped: result.skipped, stopwatchSaved: result.stopwatchSaved }, {
      started: true, reset: true, skipped: true, stopwatchSaved: true
    });
    assert.match(result.stopwatchDuration, /^00:0[1-9]$/);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    try { await rm(profile, { recursive: true, force: true }); } catch {}
  }
});
