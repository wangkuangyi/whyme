async page => {
  const records = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  for (const variant of ['desktop', 'mobile']) {
    await page.setViewportSize(variant === 'desktop' ? { width: 1440, height: 1000 } : { width: 390, height: 844 });
    for (let station = 1; station <= 4; station++) {
      await page.goto(`http://127.0.0.1:5173/?angle=${station}`);
      await page.bringToFront();
      await page.waitForFunction(() => window.__WHYME__?.getScene()?.getState().ready);
      for (const progress of [.1, .3, .5, .75, .9, 1]) {
        const state = await page.evaluate(async progress => {
          const scene = __WHYME__.getScene(); scene.setPresentationPaused(false);
          for (let i = 0; i < 2000; i++) {
            await new Promise(requestAnimationFrame);
            const state = scene.getState(), motion = state.animation;
            if (progress < 1 ? !motion.end && motion.time >= motion.duration * progress : motion.end && !motion.transition) {
              scene.setPresentationPaused(true); return scene.getState();
            }
          }
          throw Error(`Unable to capture action progress ${progress}`);
        }, progress);
        const file = `output/playwright/blender-motion/${variant}-0${station}-${Math.round(progress * 100)}.png`;
        await page.screenshot({ path: file, scale: 'css' });
        records.push({ variant, station, progress, file, state });
      }
    }
  }
  const download = page.waitForEvent('download');
  await page.evaluate(data => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = 'sequences.json'; a.click(); }, { records, errors });
  await (await download).saveAs('qa/blender-motion/sequences.json');
  if (errors.length) throw Error(errors.join('; '));
  await page.goto('about:blank');
}
