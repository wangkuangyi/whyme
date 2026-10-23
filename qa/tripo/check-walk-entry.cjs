async (hostPage) => {
  const checks = [], results = [];
  const check = (name, passed, detail) => checks.push({ name, passed: !!passed, detail });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await hostPage.context().browser().newContext({ viewport }), page = await context.newPage(), errors = [];
    await context.routeWebSocket('**/*', () => {});
    page.on('pageerror', e => errors.push(e.message));
    await context.addInitScript(() => {
      window.__entryQA = { target: 0, frozen: false, samples: [], stopAt: null };
      setInterval(() => {
        const scene = window.__WHYME__?.getScene(), s = scene?.getState(), q = __entryQA;
        if (!s?.ready || s.presentationPaused) return;
        const now = performance.now(), a = s.animation;
        if (!a.walking && q.stopAt === null) q.stopAt = now;
        const time = a.walking ? a.time : 3.6 + (now - q.stopAt) / 1000;
        const card = document.querySelector('.strengths'), panel = document.querySelector('.strength.is-active');
        const opacity = Math.min(...[card, panel, ...panel.querySelectorAll('.card-reveal')].map(e => Number(getComputedStyle(e).opacity)));
        q.samples.push({ time, action: a.action, walking: a.walking, feet: { left: a.pose.LeftFoot, right: a.pose.RightFoot }, opacity });
        if (!q.frozen && time >= q.target) { scene.setPresentationPaused(true); q.frozen = true; }
      }, 8);
    });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/models/person-animated.glb*', async route => { await gate; await route.continue(); });
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
    await page.locator('.intro-poster').evaluate(async image => { await image.decode(); await document.fonts.ready; });
    const loading = await page.evaluate(() => ({ src: document.querySelector('.intro-poster').getAttribute('src'), ready: !!window.__WHYME__?.getScene()?.getState().ready, angle: document.body.dataset.angle }));
    check(`${viewport.width} cold load uses new stable poster`, !loading.ready && loading.angle === '1' && loading.src.endsWith('01.png?v=walk-entry-long'), loading);
    await page.screenshot({ path: `output/playwright/walk-entry/${viewport.width}-loading.png`, fullPage: true });
    release();
    const captures = [];
    for (const time of [0, .3, .9, 2.34, 2.42, 3.3, 4.6]) {
      if (time) await page.evaluate(target => { __entryQA.target = target; __entryQA.frozen = false; __WHYME__.getScene().setPresentationPaused(false); }, time);
      await page.waitForFunction(() => __entryQA.frozen, {}, { timeout: 20000 });
      const capture = await page.evaluate(() => ({ state: __WHYME__.getScene().getState(), sample: __entryQA.samples.at(-1), angle: document.body.dataset.angle, overflow: document.documentElement.scrollWidth > innerWidth }));
      await page.screenshot({ path: `output/playwright/walk-entry/${viewport.width}-${time}.png`, fullPage: true });
      captures.push({ at: time, ...capture });
    }
    const first = captures[0].state.animation, after = captures.at(-1).state.animation;
    const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
    check(`${viewport.width} initial feet match settled planted feet`, Math.max(distance(first.pose.LeftFoot, after.pose.LeftFoot), distance(first.pose.RightFoot, after.pose.RightFoot)) < .003, { first: first.pose, after: after.pose });
    check(`${viewport.width} original-speed 3.6-second walk`, first.duration === 3.6 && first.speed === 1 && captures.find(c => c.at === 3.3).state.animation.walking);
    check(`${viewport.width} settles to held idle`, after.action === 'Idle' && after.idleMode === 'walk-source-hold' && after.idleSourceTime === 2.5);
    check(`${viewport.width} card visible during longer walk`, captures.some(c => c.state.animation.walking && c.sample.opacity > .99));
    check(`${viewport.width} camera framing preserved`, captures.every(c => Math.abs(c.state.camera.azimuth - 38) < .001 && Math.abs(c.state.camera.fill - (viewport.width > 900 ? .56 : captures[0].state.camera.fill)) < .001));
    check(`${viewport.width} no horizontal overflow`, captures.every(c => !c.overflow));
    const samples = await page.evaluate(() => __entryQA.samples);
    check(`${viewport.width} no browser errors`, errors.length === 0, errors);
    results.push({ viewport, loading, captures: captures.map(c => ({ at: c.at, sample: c.sample, angle: c.angle, overflow: c.overflow, duration: c.state.animation.duration, speed: c.state.animation.speed, idleMode: c.state.animation.idleMode, camera: c.state.camera })), sampleCount: samples.length, errors });
    await context.close();
  }
  const pending = hostPage.waitForEvent('download');
  await hostPage.evaluate(data => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = 'walk-entry-ui.json'; a.click(); }, { checks, results });
  await (await pending).saveAs('qa/tripo/walk-entry-ui.json');
  console.log(JSON.stringify({ passed: checks.filter(c => c.passed).length, total: checks.length, failed: checks.filter(c => !c.passed) }));
  if (checks.some(c => !c.passed)) throw Error('Walk entry checks failed');
}
