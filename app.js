(() => {
  'use strict';
  const STORY = window.HER_STORY, KEY = 'her-world.prologue.v2';
  const $ = id => document.getElementById(id);
  let state = { version: 2, started: false, decisions: [], logVisits: [], opening: [] };
  let mode = 'unconnected', panel = 'dialogue', busy = false, pending = null, operation = 0, saveAvailable = true, storageNotice = '', previousMemoryCount = 0, toastTimer;
  let paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderedMessages = [];
  const textClean = text => String(text || '').normalize('NFC').replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  const chars = text => [...text];
  const isLines = value => Array.isArray(value) && value.length <= 3 && value.every(line => typeof line === 'string' && line.length <= 500);
  function validateDecision(value, index) {
    const scene = STORY[index]; if (!scene || !value || typeof value !== 'object') return null;
    let clean;
    if (typeof value.choiceId === 'string' && scene.choices.some(c => c.id === value.choiceId) && value.text === undefined) clean = { choiceId: value.choiceId };
    else if (scene.free && typeof value.text === 'string' && value.choiceId === undefined) { const input = textClean(value.text); if (!input || chars(input).length > (scene.free.maxLength || 80)) return null; clean = { text: input }; }
    else return null;
    if (scene.requiresLogs && value.logsViewed !== true) return null;
    if (scene.requiresLogs) clean.logsViewed = true;
    if (isLines(value.lines)) clean.lines = value.lines;
    clean.mode = value.mode === 'ai' ? 'ai' : 'offline'; return clean;
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      if (raw.length > 100000) throw new Error('oversize');
      const value = JSON.parse(raw);
      if (value.version !== 2 || typeof value.started !== 'boolean' || !Array.isArray(value.decisions) || value.decisions.length > STORY.length) throw new Error('invalid');
      const decisions = value.decisions.map(validateDecision);
      if (decisions.some(d => !d)) throw new Error('invalid');
      state = { version: 2, started: value.started || decisions.length > 0, decisions, logVisits: Array.isArray(value.logVisits) ? value.logVisits.filter(n => Number.isInteger(n) && n >= 0 && n < STORY.length) : [], opening: isLines(value.opening) ? value.opening : [] };
      if (state.started) storageNotice = '已回到上次停下的地方。若要继续 AI 模式，请重新输入 Key。';
    }
  } catch { storageNotice = '未能读取旧存档。可以重新开始；若浏览器禁用存储，本次仍可完整游玩。'; }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); saveAvailable = true; }
    catch { saveAvailable = false; }
    updateStatus();
  }
  function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5200); }
  function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function interpolate(text, name) { return String(text).split('{{rainName}}').join(name || '未命名的雨'); }
  function pick(scene, decision) {
    if (decision.choiceId) return scene.choices.find(c => c.id === decision.choiceId);
    const free = scene.free;
    const matched = free.keywords?.find(group => group.words.some(word => decision.text.includes(word)));
    return { id: 'free', label: decision.text, reply: matched?.reply || free.reply || free.fallback, logs: matched?.logs || free.logs || [], tone: matched?.tone || free.tone, rainName: free.kind === 'rain_name' ? decision.text : undefined };
  }
  function snapshot() {
    const messages = [], logs = [], memories = new Map(); let name = '未命名的雨', effect = 'pause_rain', tone = 'quiet';
    const addMessage = (role, text, index) => messages.push({ role, text: interpolate(text, name), index });
    if (state.started) { addMessage('system', 'boot() → build: incomplete / input: connected', 0); for (const text of state.opening) addMessage('her', text, 0); }
    for (let i = 0; i <= state.decisions.length && i < STORY.length; i++) {
      const scene = STORY[i]; if (i >= 3 && effect === 'pause_rain' && state.decisions.length < 5) effect = 'normal';
      addMessage('system', `${String(i + 1).padStart(2, '0')} / ${scene.title}  ·  ${scene.id}()`, i);
      scene.prompt.forEach(text => addMessage('her', text, i));
      (scene.logs || []).forEach(text => logs.push({ text: interpolate(text, name), index: i }));
      if (scene.memory) memories.set(scene.memory.id, { ...scene.memory, title: interpolate(scene.memory.title, name), body: interpolate(scene.memory.body, name) });
      const decision = state.decisions[i]; if (!decision) break;
      const selected = pick(scene, decision); if (selected.rainName) name = selected.rainName;
      addMessage('user', selected.label, i);
      (decision.lines?.length ? decision.lines : selected.reply).forEach(text => addMessage('her', text, i));
      (selected.logs || selected.log || []).forEach(text => logs.push({ text: interpolate(text, name), index: i }));
      if (selected.memory) memories.set(selected.memory.id, { ...selected.memory, title: interpolate(selected.memory.title, name), body: interpolate(selected.memory.body, name) });
      if (selected.effect) effect = selected.effect;
      if (selected.tone) tone = selected.tone;
    }
    return { messages, logs, memories: [...memories.values()], name, effect, tone };
  }
  function stamp(index) { return `21:${String(2 + index).padStart(2, '0')}`; }
  function updateStatus() {
    const labels = { unconnected: '未连接 · 选择试玩模式', offline: '离线试玩 · 作者分支文本', ready: 'Key 已载入 · 尚未验证', ai: `AI 已回应 · glm-5.3-flash`, error: 'AI 请求未完成 · 需要选择' };
    $('ai-status-button').textContent = busy && mode !== 'offline' ? '正在等待 AI 回应…' : labels[mode];
    $('ai-status-button').classList.toggle('ai-live', mode === 'ai');
    $('save-status').replaceChildren(element('i'), document.createTextNode(saveAvailable ? 'LOCAL SAVE · 已保存在此浏览器' : 'SESSION ONLY · 存储不可用'));
    $('save-status').classList.toggle('warning', !saveAvailable);
    $('disconnect-button').hidden = !HerAI.connected();
  }
  function renderTranscript(view) {
    const transcript = $('transcript');
    const signatures = view.messages.map(item => `${item.role}|${item.index}|${item.text}`);
    const appendOnly = renderedMessages.length <= signatures.length && renderedMessages.every((value, index) => value === signatures[index]);
    const startAt = appendOnly ? renderedMessages.length : 0;
    if (!appendOnly) transcript.replaceChildren();
    for (const child of [...transcript.children]) if (child.className.includes('thinking')) child.remove();
    for (const item of view.messages.slice(startAt)) {
      if (item.role === 'system') { transcript.append(element('div', 'message system', item.text)); continue; }
      const row = element('div', `message ${item.role === 'user' ? 'you' : 'her'}`);
      row.append(element('span', 'time', stamp(item.index)), element('span', 'speaker', item.role === 'user' ? '你' : item.index < 7 ? '她' : '她'), element('span', 'message-text', item.text));
      transcript.append(row);
    }
    renderedMessages = signatures;
    if (busy) { const row = element('div', 'message thinking', mode === 'offline' ? '· · ·' : '· · · 等待回应'); row.setAttribute('aria-label', '正在等待回应'); transcript.append(row); }
    requestAnimationFrame(() => { transcript.scrollTop = transcript.scrollHeight; });
  }
  function renderMemory(view) {
    const target = $('memory-panel'); target.replaceChildren();
    if (!view.memories.length) { const empty = element('div', 'empty-memory'); empty.append(document.createTextNode('还没有被留下的记忆。'), element('br'), element('code', '', 'memory = []  // 也许，一切才刚刚开始')); target.append(empty); }
    for (const memory of view.memories) { const card = element('article', 'memory-card'); card.append(element('div', 'memory-id', `retained / ${memory.id}`), element('h3', '', memory.title), element('p', '', memory.body)); target.append(card); }
    $('memory-count').textContent = String(view.memories.length).padStart(2, '0');
    if (view.memories.length > previousMemoryCount) $('log-dot').hidden = false;
    previousMemoryCount = view.memories.length;
  }
  function renderLogs(view) {
    const target = $('log-list'); target.replaceChildren();
    const rows = state.started ? view.logs : [{ text: 'process.sleep()  // 等待一次偶然的连接', index: 0 }];
    rows.forEach((item, i) => { const cls = item.text.trim().startsWith('//') ? 'comment' : /retain|first_rain|reference|memory.reason/.test(item.text) ? 'retain' : /discard|todo|pending/.test(item.text) ? 'discard' : ''; const row = element('div', `log-line ${cls}`); row.append(element('span', 'line-no', String(i + 1).padStart(2, '0')), element('span', 'log-time', `[${stamp(item.index)}]`), element('span', '', item.text)); target.append(row); });
    requestAnimationFrame(() => { target.scrollTop = target.scrollHeight; });
    document.querySelector('.trace-paths').style.opacity = String(.2 + Math.min(state.decisions.length / STORY.length, 1) * .8);
    $('attention-caption').textContent = state.decisions.length >= 10 && state.decisions[9]?.choiceId !== 'remember_me' ? '只留下相遇的片刻，不保存指向你的引用。' : state.decisions.length >= 8 ? '从雨，到窗，再到一起看雨的人。' : '有一个坐标，暂时还没有名字。';
  }
  function renderChoices(view) {
    const target = $('choices'); target.replaceChildren(); const index = state.decisions.length, scene = STORY[index];
    $('free-form').hidden = true; $('input-note').hidden = true;
    if (!scene) {
      $('scene-title').textContent = '序章 / 完'; $('turn-count').textContent = '12 / 12';
      const ending = element('div', 'ending'); ending.append(element('div', 'eyebrow', 'END OF PROLOGUE / 未完待续'), element('h2', '', '第一场雨，有了名字。'), element('p', '', `「${view.name}」已留在她的记忆里。今晚的相遇到这里，之后的故事，还没有写完。`));
      const actions = element('div', 'ending-actions'); const memory = element('button', '', '看看留下的记忆'); memory.addEventListener('click', () => setPanel('memory')); const logs = element('button', '', '再读一遍日志'); logs.addEventListener('click', () => setPanel('logs')); actions.append(memory, logs); ending.append(actions); target.append(ending); return;
    }
    $('scene-title').textContent = scene.title; $('turn-count').textContent = `${String(index + 1).padStart(2, '0')} / ${STORY.length}`;
    const needsLogs = scene.requiresLogs && !state.logVisits.includes(index);
    if (needsLogs) { const button = element('button', 'choice log-gate', '↳ 打开运行日志，看看她保留了什么'); button.addEventListener('click', () => setPanel('logs')); target.append(button); }
    scene.choices.forEach((choice, i) => { const button = element('button', 'choice'); button.disabled = busy || needsLogs; button.dataset.choice = choice.id; button.append(element('span', 'choice-index', `0${i + 1}`), element('span', '', interpolate(choice.label, view.name)), element('span', 'choice-arrow', '↗')); button.addEventListener('click', () => respond({ choiceId: choice.id })); target.append(button); });
    if (scene.free) { $('free-form').hidden = false; $('input-note').hidden = false; $('free-input').maxLength = scene.free.maxLength || 80; $('free-input').placeholder = scene.free.hint; $('free-input').disabled = busy || needsLogs; $('free-send').disabled = busy || needsLogs; $('input-note').textContent = scene.free.kind === 'rain_name' ? '给雨的名字只属于这段故事 · 最多 20 个字' : mode === 'offline' ? '离线模式 · 输入会匹配作者预设的回应' : '你的这段回应会发送给 DMXAPI'; }
  }
  function render() {
    const view = snapshot(), index = state.decisions.length;
    $('intro').hidden = state.started; $('transcript').hidden = !state.started; $('response-area').hidden = !state.started; $('reset-button').hidden = !state.started;
    $('connection-label').textContent = state.started ? index >= STORY.length ? 'CONNECTION REMEMBERED' : 'PROCESS / INCOMPLETE' : 'WAITING FOR YOU';
    $('progress-label').textContent = state.started ? `PROLOGUE / ${Math.round(index / STORY.length * 100)}%` : 'PROLOGUE / 5–10 分钟';
    $('world-caption').textContent = index >= 6 ? `「${view.name}」` : index >= 3 ? '第一次一起看雨' : '一扇尚未被命名的窗';
    $('world-status').textContent = index >= STORY.length ? 'memory retained' : index >= 5 ? 'weather.patch(shared)' : index >= 3 ? 'rain.render()' : 'world.build = incomplete';
    $('world-code').textContent = index >= 8 ? 'gc.retain("first_rain");' : index >= 5 ? 'world.patch.author = "shared";' : 'const world = await you;';
    if (state.started) renderTranscript(view); renderChoices(view); renderLogs(view); renderMemory(view);
    window.HerWorld?.setProgress(index / STORY.length); window.HerWorld?.setRain(view.effect); updateStatus();
  }
  function setPanel(next) {
    panel = next; const open = next !== 'dialogue';
    $('inspector-panel').hidden = !open; $('logs-panel').hidden = next !== 'logs'; $('memory-panel').hidden = next !== 'memory';
    $('inspector-panel').setAttribute('aria-labelledby', `tab-${open ? next : 'dialogue'}`);
    document.querySelectorAll('.tab').forEach(tab => { const active = tab.dataset.panel === next; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; });
    $('drawer-toggle').setAttribute('aria-expanded', String(open)); $('drawer-toggle').setAttribute('aria-label', open ? '收起记录面板' : '打开运行日志'); $('drawer-hint').textContent = open ? '先留在这里' : '有些话，藏在这里';
    if (next === 'logs') { $('log-dot').hidden = true; const current = state.decisions.length; if (state.started && !state.logVisits.includes(current) && current < STORY.length) { state.logVisits.push(current); save(); renderChoices(snapshot()); } requestAnimationFrame(() => { $('log-list').scrollTop = $('log-list').scrollHeight; }); }
  }
  function chooseMode() { $('connection-error').hidden = true; $('api-key').value = ''; updateStatus(); $('connect-dialog').showModal(); }
  async function start() {
    if (state.started) return;
    if (mode === 'unconnected') { chooseMode(); return; }
    if (busy) return; busy = true; pending = { opening: true }; $('request-error').hidden = true;
    if (mode === 'offline') { state.started = true; busy = false; pending = null; save(); render(); return; }
    const version = ++operation; state.started = true; render();
    try { const lines = await HerAI.request({ scene: STORY[0], input: '', rainName: '', recent: [], opening: true }); if (version !== operation) return; state.opening = lines; mode = 'ai'; busy = false; pending = null; save(); render(); }
    catch (error) { if (version !== operation) return; busy = false; mode = 'error'; render(); showError(error); }
  }
  function showError(error) { $('request-error-text').textContent = error.message; $('request-error').hidden = false; $('retry-button').disabled = !HerAI.connected(); $('free-form').hidden = true; document.querySelectorAll('.choice').forEach(b => { b.disabled = true; }); updateStatus(); }
  async function respond(decision) {
    if (busy || pending || state.decisions.length >= STORY.length) return;
    const index = state.decisions.length, scene = STORY[index];
    if (scene.requiresLogs) { if (!state.logVisits.includes(index)) return; decision.logsViewed = true; }
    const clean = validateDecision(decision, index); if (!clean) { toast('请写下 1–20 个字的名字，不使用控制字符。'); return; }
    pending = { decision: clean, index }; await processPending();
  }
  async function processPending() {
    if (!pending || busy) return;
    if (mode === 'unconnected' || (!HerAI.connected() && mode !== 'offline')) { chooseMode(); return; }
    const item = pending;
    if (item.opening) { pending = null; state.started = false; await start(); return; }
    const view = snapshot(), scene = STORY[item.index], selected = pick(scene, item.decision);
    busy = true; $('request-error').hidden = true; render(); const version = ++operation;
    let lines;
    if (mode === 'offline') { lines = selected.reply.map(t => interpolate(t, selected.rainName || view.name)); await new Promise(resolve => setTimeout(resolve, paused ? 80 : 260)); }
    else {
      try { lines = await HerAI.request({ scene, input: selected.label, rainName: selected.rainName || view.name, recent: view.messages.filter(m => m.role !== 'system') }); mode = 'ai'; }
      catch (error) { if (version !== operation) return; busy = false; mode = 'error'; render(); showError(error); return; }
    }
    if (version !== operation || item.index !== state.decisions.length) return;
    state.decisions.push({ ...item.decision, lines, mode: mode === 'ai' ? 'ai' : 'offline' }); busy = false; pending = null; $('free-input').value = ''; save(); render();
    if (panel === 'logs') setPanel('logs');
    $('choices').querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }
  $('start-button').addEventListener('click', start);
  $('ai-status-button').addEventListener('click', chooseMode);
  $('connect-form').addEventListener('submit', async event => {
    event.preventDefault(); const value = $('api-key').value; $('api-key').value = '';
    if (!HerAI.connect(value)) { $('connection-error').textContent = '请输入 8–500 个字符的 Key，不要包含换行或空白控制符。'; $('connection-error').hidden = false; return; }
    operation++; busy = false; mode = 'ready'; $('connect-dialog').close(); $('request-error').hidden = true; updateStatus();
    if (pending) await processPending(); else if (!state.started) await start(); else { render(); toast('Key 只在本页内存中。下一次回应时发送请求。'); }
  });
  $('offline-button').addEventListener('click', async () => { HerAI.disconnect(); operation++; busy = false; mode = 'offline'; $('api-key').value = ''; $('connect-dialog').close(); $('request-error').hidden = true; if (pending) await processPending(); else if (!state.started) await start(); else render(); });
  $('disconnect-button').addEventListener('click', () => { HerAI.disconnect(); operation++; busy = false; mode = 'unconnected'; pending = null; $('api-key').value = ''; $('connect-dialog').close(); $('request-error').hidden = true; render(); toast('已断开，Key 已从页面内存清除。进度仍在本地。'); });
  $('retry-button').addEventListener('click', () => { if (!HerAI.connected()) return; mode = 'ready'; processPending(); });
  $('fallback-button').addEventListener('click', () => { HerAI.disconnect(); mode = 'offline'; processPending(); });
  $('cancel-request-button').addEventListener('click', () => { operation++; busy = false; pending = null; $('request-error').hidden = true; mode = HerAI.connected() ? 'ready' : 'unconnected'; render(); });
  $('free-form').addEventListener('submit', event => { event.preventDefault(); const text = textClean($('free-input').value); if (!text) { toast('给这场雨写下一个名字吧。'); return; } respond({ text }); });
  document.querySelectorAll('.tab').forEach((button, index) => { button.addEventListener('click', () => setPanel(button.dataset.panel)); button.addEventListener('keydown', event => { const tabs = [...document.querySelectorAll('.tab')]; let next; if (event.key === 'ArrowRight') next = (index + 1) % tabs.length; if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length; if (event.key === 'Home') next = 0; if (event.key === 'End') next = tabs.length - 1; if (next !== undefined) { event.preventDefault(); setPanel(tabs[next].dataset.panel); tabs[next].focus(); } }); });
  $('drawer-toggle').addEventListener('click', () => setPanel(panel === 'dialogue' ? 'logs' : 'dialogue'));
  $('about-button').addEventListener('click', () => $('about-dialog').showModal());
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  $('connect-dialog').addEventListener('close', () => { $('api-key').value = ''; if (pending && mode === 'unconnected') pending = null; });
  $('reset-button').addEventListener('click', () => $('reset-dialog').showModal());
  $('confirm-reset').addEventListener('click', () => { operation++; HerAI.disconnect(); mode = 'unconnected'; busy = false; pending = null; state = { version: 2, started: false, decisions: [], logVisits: [], opening: [] }; $('api-key').value = ''; $('request-error').hidden = true; $('reset-dialog').close(); previousMemoryCount = 0; setPanel('dialogue'); save(); render(); $('start-button').focus(); });
  function updateMotion() { document.documentElement.classList.toggle('motion-paused', paused); $('motion-toggle').setAttribute('aria-pressed', String(paused)); $('motion-toggle').setAttribute('aria-label', paused ? '播放场景动画' : '暂停场景动画'); $('motion-toggle').title = paused ? '播放场景动画' : '暂停场景动画'; window.HerWorld?.pause(paused); }
  $('motion-toggle').addEventListener('click', () => { paused = !paused; updateMotion(); });
  window.addEventListener('pagehide', () => { $('api-key').value = ''; });
  window.addEventListener('pageshow', event => { if (event.persisted) { mode = 'unconnected'; busy = false; pending = null; operation++; $('request-error').hidden = true; render(); } });
  // Probe storage without changing or deleting any unrelated keys.
  save(); render(); updateMotion(); if (storageNotice) toast(storageNotice);
})();
