async (page) => {
  const checks = [], samples = [], errors = [];
  const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /shader|WebGLProgram/i.test(message.text())) errors.push(message.text()); });
  // Keep the app out of this scene-only check. Test hooks live solely in the
  // intercepted module response, never in the shipped scene's public API.
  await page.route('**/src/main.js*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('**/@vite/client', route => route.fulfill({ contentType: 'text/javascript', body: 'export function createHotContext(){return {accept(){},dispose(){}}} export function injectQuery(url){return url}' }));
  await page.route('**/src/scene.js', async route => {
    const response = await route.fetch();
    const hook = `review: (allVertices = false) => {
      refreshRaycastBounds();
      const gl = renderer.getContext();
      const out = { nodes: [], missedVertices: 0, vertices: 0, shaders: renderer.info.programs.map(program => ({ linked: gl.getProgramParameter(program.program, gl.LINK_STATUS), shadowFade: (gl.getShaderSource(program.fragmentShader) || '').includes('smoothstep(.45,1.7,length(vShadowGround.xz-shadowCenter.xz))') })) };
      const exact = () => {
        const saved = meshes.filter(mesh => mesh.isSkinnedMesh).map(mesh => ({ mesh, box: mesh.boundingBox, sphere: mesh.boundingSphere }));
        for (const { mesh } of saved) { mesh.boundingBox = null; mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e10); }
        const hit = raycaster.intersectObjects(meshes, false).length > 0;
        for (const { mesh, box, sphere } of saved) { mesh.boundingBox = box; mesh.boundingSphere = sphere; }
        return hit;
      };
      for (const [index, node] of nodes.entries()) {
        rayDirection.copy(node).sub(camera.position); const distance = rayDirection.length();
        raycaster.set(camera.position, rayDirection.divideScalar(distance)); raycaster.far = Math.max(0, distance - .018);
        const bounded = hitsCharacter(), reference = exact();
        out.nodes.push({ index, bounded, reference, cached: occlusionCache[index].hidden, visible: nodePositions[index]?.visible });
      }
      if (allVertices) for (const { mesh } of skinnedBounds) for (let i = 0; i < mesh.geometry.attributes.position.count; i += 1) {
        mesh.getVertexPosition(i, point); out.vertices += 1;
        if (!mesh.boundingBox.containsPoint(point) || !mesh.boundingSphere.containsPoint(point)) out.missedVertices += 1;
      }
      return out;
    }, `;
    await route.fulfill({ response, body: (await response.text()).replace('return { setStation, setDragProgress,', `return { ${hook}setStation, setDragProgress,`) });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:5173/?angle=1');
  await page.evaluate(async () => {
    document.body.innerHTML = '<canvas id="review-canvas" style="position:absolute;inset:0;width:100%;height:100%;opacity:1"></canvas>';
    document.body.style.background = 'radial-gradient(ellipse at 49% 42%,#fff 0%,#fff 37%,#f3f3f5 100%)';
    const { createScene } = await import('/src/scene.js');
    window.reviewEvents = [];
    window.reviewScene = await createScene({ canvas: document.querySelector('canvas'), presentationPaused: true, initialStation: 0,
      onSettled: d => window.reviewEvents.push({ type: 'settled', state: window.reviewScene?.getState() }),
      onFramingChange: d => window.reviewEvents.push({ type: 'framing', state: window.reviewScene?.getState() }) });
  });
  const first = await page.evaluate(() => ({ state: reviewScene.getState(), review: reviewScene.review(true), image: reviewScene.capture().length }));
  await page.waitForTimeout(450);
  const held = await page.evaluate(() => reviewScene.getState());
  check('暂停交接期间动作停留在完整首帧', first.state.animation.time === 0 && held.animation.time === 0 && first.image > 10000 && held.presentationPaused, { first: first.state.animation, held: held.animation });
  check('首帧蒙皮包围体覆盖所有顶点', first.review.vertices > 0 && first.review.missedVertices === 0, first.review);
  check('开场暂停不提前打开卡片', await page.evaluate(() => reviewEvents.length === 0));
  check('影子和地面参数正确', first.state.studio.shadowOpacity === .1 && first.state.studio.shadowWorldPosition[1] === 6 && first.state.studio.floorTintStrength === .5 && first.state.studio.floorEdge === '#f3f3f5', first.state.studio);
  check('实际编译的阴影着色器包含远端羽化且全部着色器链接成功', first.review.shaders.some(s => s.shadowFade) && first.review.shaders.every(s => s.linked), first.review.shaders);
  await page.screenshot({ path: 'output/playwright/v24/scene-walk-first.png' });
  await page.evaluate(() => reviewScene.setPresentationPaused(false));
  let tick = 0;
  while (tick < 60) {
    await page.waitForTimeout(100);
    const sample = await page.evaluate(all => ({ state: reviewScene.getState(), review: reviewScene.review(all) }), tick % 10 === 0);
    samples.push(sample); tick += 1;
    if (tick === 12) await page.screenshot({ path: 'output/playwright/v24/scene-walk-middle.png' });
    if (!sample.state.animation.walking) break;
  }
  check('行走中更新后的包围体与无包围体精确射线结果相同', samples.every(s => s.review.nodes.every(n => n.bounded === n.reference)), samples.filter(s => s.review.nodes.some(n => n.bounded !== n.reference)));
  check('抽样的所有蒙皮顶点都位于更新后的包围体内', samples.every(s => s.review.missedVertices === 0));
  check('行走中不存在可见且被身体遮挡的节点', samples.every(s => s.review.nodes.every(n => !n.reference || !n.visible)), samples.filter(s => s.review.nodes.some(n => n.reference && n.visible)).map(s => ({ time: s.state.animation.time, nodes: s.review.nodes })));
  check('前方无遮挡节点没有被遮挡缓存误判', samples.every(s => s.review.nodes.every(n => n.reference || !n.cached)), samples.filter(s => s.review.nodes.some(n => !n.reference && n.cached)).map(s => ({ time: s.state.animation.time, nodes: s.review.nodes })));
  check('完整行走结束后才允许卡片和跟随布局回调', await page.evaluate(() => reviewEvents.length > 0 && reviewEvents.every(e => !e.state?.animation.walking)), await page.evaluate(() => reviewEvents.map(e => ({ type: e.type, walking: e.state?.animation.walking }))));
  const clicked = await page.evaluate(() => { const s = reviewScene.getState(), b = s.protectedBounds.faceBounds; return reviewScene.reactAt((b.left + b.right) / 2, (b.top + b.bottom) / 2); });
  check('位移后的当前人物位置可点击', clicked);
  await page.evaluate(() => reviewScene.setStation(2)); await page.waitForTimeout(180);
  const beforePause = await page.evaluate(() => { reviewScene.setPresentationPaused(true); return reviewScene.getState(); });
  await page.waitForTimeout(350);
  const afterPause = await page.evaluate(() => reviewScene.getState());
  check('暂停也冻结镜头、颜色和动作时间', beforePause.currentProgress === afterPause.currentProgress && beforePause.colors.hoodie === afterPause.colors.hoodie && beforePause.animation.time === afterPause.animation.time, { beforePause, afterPause });
  await page.evaluate(() => reviewScene.setPresentationPaused(false));
  await page.waitForTimeout(1200);
  check('恢复后镜头与颜色正常完成', await page.evaluate(() => { const s = reviewScene.getState(); return s.currentProgress === 2 && s.colors.hoodie === '#327b60' && s.animation.action === 'LookAround'; }));
  await page.evaluate(() => reviewScene.dispose());
  for (const station of [1, 2, 3]) {
    const result = await page.evaluate(async station => {
      const { createScene } = await import('/src/scene.js');
      reviewScene = await createScene({ canvas: document.querySelector('canvas'), initialStation: station, presentationPaused: true });
      const state = reviewScene.getState(), review = reviewScene.review(true);
      return { state, review };
    }, station);
    check(`深链机位 ${station + 1} 首帧相机、动作、颜色直接初始化`, result.state.activeStation === station && result.state.currentProgress === station && result.state.animation.time === 0 && result.state.colors.hoodie === ['#c2603d', '#3755a6', '#327b60', '#a44c76'][station], result.state);
    check(`深链机位 ${station + 1} 首帧蒙皮包围体准确`, result.review.missedVertices === 0 && result.review.nodes.every(n => n.bounded === n.reference), result.review);
    await page.evaluate(() => reviewScene.setPresentationPaused(false));
    const gestureSamples = [];
    for (let sample = 0; sample < 5; sample += 1) { await page.waitForTimeout(350); gestureSamples.push(await page.evaluate(() => reviewScene.review())); }
    check(`机位 ${station + 1} 动作中精确射线与原生结果一致`, gestureSamples.every(s => s.nodes.every(n => n.bounded === n.reference && n.cached === n.reference)), gestureSamples);
    await page.evaluate(() => reviewScene.dispose());
  }
  check('浏览器无脚本异常', errors.length === 0, errors);
  const pending = page.waitForEvent('download');
  await page.evaluate(data => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = 'v24-scene.json'; a.click(); }, { checks, samples, errors });
  await (await pending).saveAs('output/playwright/v24/scene-checks.json');
  if (checks.some(c => !c.pass)) throw new Error(checks.filter(c => !c.pass).map(c => c.name).join('; '));
}
