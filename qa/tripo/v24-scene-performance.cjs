async (page) => {
  await page.route('**/src/main.js*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('**/@vite/client', route => route.fulfill({ contentType: 'text/javascript', body: 'export function createHotContext(){return {accept(){},dispose(){}}} export function injectQuery(url){return url}' }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:5173/?angle=1');
  const results = await page.evaluate(async () => {
    document.body.innerHTML = '<canvas style="position:absolute;inset:0;width:100%;height:100%;opacity:1"></canvas>';
    const { createScene } = await import('/src/scene.js');
    const fallbacks = [], scene = await createScene({ canvas: document.querySelector('canvas'), onPerformanceFallback: e => fallbacks.push(e) });
    const frames = [], start = performance.now();
    while (performance.now() - start < 10500) {
      await new Promise(requestAnimationFrame);
      const state = scene.getState();
      frames.push({ t: performance.now() - start, action: state.animation.action, walking: state.animation.walking, quality: state.quality });
    }
    scene.dispose();
    const summarize = rows => {
      const times = rows.map(r => r.quality.timings.nodesMs).sort((a, b) => a - b);
      return { frames: rows.length, meanNodesMs: times.reduce((a, b) => a + b, 0) / times.length, p95NodesMs: times[Math.floor(times.length * .95)], maxNodesMs: times.at(-1), maxQualityLevel: Math.max(...rows.map(r => r.quality.level)) };
    };
    return { walk: summarize(frames.filter(r => r.walking)), idle: summarize(frames.filter(r => !r.walking && r.t > 7000)), fallbacks, frames };
  });
  const pending = page.waitForEvent('download');
  await page.evaluate(data => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = 'v24-scene-performance.json'; a.click(); }, results);
  await (await pending).saveAs('output/playwright/v24/scene-performance.json');
  if (results.fallbacks.length || results.walk.maxQualityLevel || results.idle.maxQualityLevel) throw new Error('单场景性能检查触发降级');
}
