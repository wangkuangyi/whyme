const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function setupDialogs({profile,availability,getStatic,toggleMode}){
  const dialog=document.querySelector('#detail-dialog');
  const details={
    contact:()=>`<h2 id="dialog-title">聊聊下一次，<br>一起做点什么。</h2><p class="dialog-lead">${esc(availability)}。期待一起做有用、好用的 AI 产品。</p><div class="contact-detail"><span>邮箱</span><a href="mailto:${esc(profile.email)}">${esc(profile.email)} ↗</a><button id="copy-email" class="text-link">复制邮箱</button></div><div class="contact-detail"><span>更多作品</span><a href="${esc(profile.website)}" target="_blank" rel="noopener noreferrer">个人网站 ↗</a><a href="${esc(profile.github)}" target="_blank" rel="noopener noreferrer">GitHub ↗</a></div><p id="copy-status" aria-live="polite"></p>`,
    'behind-the-scenes':()=>`<h2 id="dialog-title">让每个角度，<br>都有自己的表达。</h2><p class="dialog-lead">一位主角，一张卡片。一点互动，慢慢认识。</p><section><h3>优点，住在光环的节点里</h3><p>拖动时卡片收回，节点带着镜头转动。停下来，新的卡片从节点旁展开，让你转过来的那个点，成为接着读到的故事。</p></section><section><h3>从颜色到质感</h3><p>赤陶、群青、松绿、莓果，四种成衣色在相近的明度和彩度间连续变化。细微的针织纹理和有方向的光，让卫衣保留布料的柔和。</p></section><section><h3>让动作有自己的镜头</h3><p>点头和轻轻挥手，用近景看清回应。走路时，镜头从侧前方跟着人物前进；停下来，再靠近肩膀和面容。动作来自 Tripo，面部保留原来的样子。</p></section><section><h3>关于这个版本</h3><p>${esc(profile.version)} · 2026.10.23 · 本地版本</p><p>正文、中英文和数字统一使用 Noto Sans SC。Instrument Serif Italic 只用于页面左上的 Why me?。</p><div class="dialog-links"><a class="text-link" href="#changelog">更新记录 ↗</a><button class="text-link" id="mode-toggle" aria-pressed="${getStatic()}">${getStatic()?'启用 3D 展示':'切换到静帧展示'}</button><button class="text-link" id="print-page">打印文字版 ↗</button></div></section>`,
    changelog:()=>`<h2 id="dialog-title">每一次改进，<br>都留在这里。</h2><section class="release"><p class="release-date">v2.2 · 2026.10.23</p><h3>动作简单一点，镜头靠近一点。</h3><ul><li>随时出发，跟着人物走一段；好队友，保留轻轻的挥手。</li><li>收紧上半身构图，动作结束后自然靠近肩膀和面容。</li></ul></section><section class="release"><p class="release-date">v2.1 · 2026.10.23</p><h3>动作有回应，镜头跟着走。</h3><ul><li>加入 Tripo 的招手、点头、走路与挥手动作。</li><li>用上半身近景看清手势，用侧前方跟拍陪人物走一段。</li><li>保留原来的面部，动作之间自然过渡。</li></ul></section><section class="release"><p class="release-date">v2.0 · 2026.10.23</p><h3>少一些信息，多一点生命感。</h3><ul><li>把页面收拢到身份、联系、节点卡片和目录。</li><li>统一字体，换上成衣色和更有空间感的影棚。</li><li>卡片贴着节点展开，手机说明区与节点相连。</li><li>恢复原始面部与站姿，关闭不自然的表情和动作。</li><li>改进光环、拖动换色和性能降级。</li></ul></section><section class="release"><p class="release-date">v1.0 · 2026.10.23</p><h3>四个角度，第一次见面。</h3><p>建立 3D 人物、四机位导航、简历入口和静帧版本。</p></section><a class="text-link" href="#behind-the-scenes">回到幕后 ↗</a>`
  };
  let trigger=null;
  document.addEventListener('click',e=>{
    const link=e.target.closest('a[href^="#"]'),key=link?.getAttribute('href').slice(1);if(!details[key])return;
    e.preventDefault();if(!dialog.open)trigger=link;
    document.querySelector('#dialog-content').innerHTML=details[key]();if(!dialog.open)dialog.showModal();dialog.scrollTop=0;document.querySelector('#close-dialog').focus();
    document.querySelector('#mode-toggle')?.addEventListener('click',toggleMode);
    document.querySelector('#print-page')?.addEventListener('click',()=>{dialog.close();window.print();});
    document.querySelector('#copy-email')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(profile.email);document.querySelector('#copy-status').textContent='邮箱已复制。';}catch{document.querySelector('#copy-status').textContent='可以直接选择上方邮箱复制，或点击发送邮件。';}});
  });
  document.querySelector('#close-dialog').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>trigger?.focus());
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
}

