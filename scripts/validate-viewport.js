'use strict';

const fs = require('fs');
const path = require('path');

const DEBUG_URL = process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9222';
const PAGE_URL = process.env.PANEL_URL || 'http://127.0.0.1:3000/';
const SCREENSHOT_PATH = path.resolve(__dirname, '../validation-1920x1080.png');

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  const targets = await fetch(`${DEBUG_URL}/json/list`).then((response) => response.json());
  const target = targets.find((item) => item.type === 'page');
  if (!target?.webSocketDebuggerUrl) throw new Error('Nenhuma página disponível no Chrome headless');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  function command(method, params = {}) {
    const id = ++sequence;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await command('Page.navigate', { url: PAGE_URL });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(200);
    const ready = await evaluate("document.readyState === 'complete' && document.querySelectorAll('#painel tr').length === 11");
    if (ready) break;
  }
  await sleep(500);

  const before = await evaluate(`(() => ({
    innerWidth,
    innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    bodyScrollWidth: document.body.scrollWidth,
    bodyScrollHeight: document.body.scrollHeight,
    tableScrollWidth: document.querySelector('.table-wrap').scrollWidth,
    tableClientWidth: document.querySelector('.table-wrap').clientWidth,
    tableScrollHeight: document.querySelector('.table-wrap').scrollHeight,
    tableClientHeight: document.querySelector('.table-wrap').clientHeight,
    rows: document.querySelectorAll('#painel tr').length,
    columns: document.querySelector('#painel tr').children.length - 1,
    total: document.querySelector('#cnt-total').textContent,
    clock: document.querySelector('#clock').textContent,
    blue: document.querySelectorAll('.status-blue').length,
    green: document.querySelectorAll('.status-green').length,
    yellow: document.querySelectorAll('.status-yellow').length,
    red: document.querySelectorAll('.status-red').length,
    gray: document.querySelectorAll('.status-gray').length
  }))()`);

  await sleep(1200);
  const clockAfter = await evaluate("document.querySelector('#clock').textContent");
  const tempoUpdate = await evaluate(`(() => {
    const row = () => Array.from(document.querySelectorAll('#painel tr'))
      .find((item) => item.querySelector('.row-label')?.textContent === 'TEMPO');
    const original = lastValidFlights[0].eta;
    lastValidFlights[0].eta = new Date(Date.now() + 61000).toISOString();
    render();
    const first = row().children[1].textContent;
    lastValidFlights[0].eta = new Date(Date.now() + 59000).toISOString();
    render();
    const second = row().children[1].textContent;
    lastValidFlights[0].eta = original;
    render();
    return { first, second };
  })()`);

  const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
  socket.close();

  const result = {
    ...before,
    clockAfter,
    clockUpdated: before.clock !== clockAfter,
    tempoUpdate,
    tempoUpdated: tempoUpdate.first !== tempoUpdate.second,
    noPageScroll: before.scrollWidth === 1920 && before.scrollHeight === 1080,
    noTableScroll: before.tableScrollWidth === before.tableClientWidth
      && before.tableScrollHeight === before.tableClientHeight,
    screenshot: SCREENSHOT_PATH,
  };
  console.log(JSON.stringify(result, null, 2));

  if (!result.noPageScroll || !result.noTableScroll || !result.clockUpdated || !result.tempoUpdated) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
