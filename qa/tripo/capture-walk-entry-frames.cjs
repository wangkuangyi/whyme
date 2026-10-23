async (page) => {
  await page.routeWebSocket('**/*', () => {});
  const metadata = await (await page.request.get('http://127.0.0.1:5173/images-intro/frames.json')).json();
  const records = [];
  for (const variant of ['desktop', 'mobile']) {
    await page.setViewportSize(variant === 'desktop' ? { width: 1440, height: 1000 } : { width: 390, height: 844 });
    await page.goto('http://127.0.0.1:5173/?holdIntro=1&angle=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__WHYME__?.getScene()?.getState().ready);
    await page.evaluate(async () => {
      await document.fonts.ready;
      let previous = '', stable = 0;
      while (stable < 12) {
        await new Promise(requestAnimationFrame);
        const r = document.querySelector('#scene').getBoundingClientRect(), next = `${r.width},${r.height}`;
        stable = next === previous ? stable + 1 : 0; previous = next;
      }
    });
    const pending = page.waitForEvent('download');
    const state = await page.evaluate(() => {
      const scene = __WHYME__.getScene(), s = scene.getState(), r = document.querySelector('#scene').getBoundingClientRect();
      if (!s.presentationPaused || s.activeStation !== 0 || !s.posterLayout || s.animation.time !== 0) throw Error('Expected paused departure first frame');
      const a = document.createElement('a'); a.href = scene.capture({ characterOnly: true }); a.download = 'frame.png'; a.click();
      return { width: r.width, height: r.height, posterLayout: s.posterLayout, animation: s.animation, camera: s.camera, presentationPaused: s.presentationPaused, nodes: s.nodes };
    });
    const path = `public/images-intro/${variant === 'desktop' ? 'angle' : 'mobile'}-01.png`;
    await (await pending).saveAs(path); metadata[variant][0] = state; records.push({ variant, path, state });
  }
  const pending = page.waitForEvent('download');
  await page.evaluate(data => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = 'frames.json'; a.click();
  }, metadata);
  await (await pending).saveAs('public/images-intro/frames.json');
  console.log(JSON.stringify(records.map(r => ({ variant: r.variant, path: r.path, feet: { left: r.state.animation.pose.LeftFoot, right: r.state.animation.pose.RightFoot }, duration: r.state.animation.duration, weights: r.state.animation.weights }))));
}
