(() => {
  'use strict';
  const STORY = window.HER_STORY, KEY = 'her-world.prologue.v2';
  const $ = id => document.getElementById(id);
  let state = { version: 2, started: false, decisions: [], logVisits: [], opening: [] };
  let mode = 'unconnected', panel = 'dialogue', busy = false, pending = null, operation = 0, saveAvailable = true, storageNotice = '', previousMemoryCount = 0, toastTimer;
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = motionPreference.matches;
  // Saved narrative is always complete. These cursors belong only to this viewing session.
  let renderedMessages = [], transcriptItems = [], revealedCount = 0, activeReveal = null, revealTimer;
  let logItems = [], logSignatures = [], logDisplayed = 0, logTimer, memorySignature = '';
  const instantMotion = () => paused || motionPreference.matches;
  const revealing = () => revealedCount < transcriptItems.length;

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
      if (state.started) storageNotice = '已恢复完整对话，不重播逐字效果。若要继续 AI 模式，请重新输入 Key。';
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
  function snapshot(through = Infinity) {
    const messages = [], logs = [], memories = new Map(); let name = '未命名的雨', effect = 'pause_rain', tone = 'quiet', index = 0, sceneIndex = -1;
    let visible = { logs: [], memories: [], name, effect, tone, index, sceneIndex };
    const capture = () => { if (messages.length <= through) visible = { logs: [...logs], memories: [...memories.values()], name, effect, tone, index, sceneIndex }; };
    const addMessage = (role, text, i, transient = false) => messages.push({ role, text: interpolate(text, name), index: i, transient });
    if (!state.started) return { messages, ...visible };
    addMessage('system', 'boot() → build: incomplete / input: connected', 0);
    for (const text of state.opening) addMessage('her', text, 0);
    // The authored opening must never precede the requested AI opening, even on error.
    if (pending?.opening) return { messages, ...visible };
    for (let i = 0; i <= state.decisions.length && i < STORY.length; i++) {
      const scene = STORY[i];
      addMessage('system', `${String(i + 1).padStart(2, '0')} / ${scene.title}  ·  ${scene.id}()`, i);
      sceneIndex = i; if (i === 3 && effect === 'pause_rain') effect = 'normal'; capture();
      scene.prompt.forEach(text => addMessage('her', text, i));
      (scene.logs || []).forEach(text => logs.push({ text: interpolate(text, name), index: i }));
      if (scene.memory) memories.set(scene.memory.id, { ...scene.memory, title: interpolate(scene.memory.title, name), body: interpolate(scene.memory.body, name) });
      capture();
      const decision = state.decisions[i]; if (!decision) break;
      const selected = pick(scene, decision); if (selected.rainName) name = selected.rainName;
      addMessage('user', selected.label, i);
      (decision.lines?.length ? decision.lines : selected.reply).forEach(text => addMessage('her', text, i));
      (selected.logs || selected.log || []).forEach(text => logs.push({ text: interpolate(text, name), index: i }));
      if (selected.memory) memories.set(selected.memory.id, { ...selected.memory, title: interpolate(selected.memory.title, name), body: interpolate(selected.memory.body, name) });
      if (selected.effect) effect = selected.effect;
      if (selected.tone) tone = selected.tone;
      index = i + 1; capture();
    }
    // Echo the player's complete line immediately while a request is pending.
    if (pending?.decision && pending.index === state.decisions.length) addMessage('user', pick(STORY[pending.index], pending.decision).label, pending.index, true);
    return { messages, ...visible };
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
  function scrollTranscript() { requestAnimationFrame(() => { $('transcript').scrollTop = $('transcript').scrollHeight; }); }
  function messageNode(item, complete = false) {
    if (item.role === 'system') return { row: element('div', `message system${complete ? ' restored' : ''}`, item.text), text: null };
    const row = element('div', `message ${item.role === 'user' ? 'you' : 'her'}${complete ? ' restored' : ''}`);
    const text = element('span', 'message-text', complete || item.role === 'user' ? item.text : '');
    row.append(element('span', 'time', stamp(item.index)), element('span', 'speaker', item.role === 'user' ? '你' : '她'), text);
    return { row, text };
  }
  function refreshRevealControl() {
    $('reveal-controls').hidden = !revealing();
    $('skip-reveal').disabled = !activeReveal;
    $('reveal-status').textContent = activeReveal?.item.role === 'her' ? '她正在慢慢说…' : '让这一刻停一会儿…';
    $('transcript').setAttribute('aria-busy', String(revealing()));
  }
  function announce(item) { if (item.role !== 'system') $('reveal-announcement').textContent = `${item.role === 'user' ? '你' : '她'}：${item.text}`; }
  function completeReveal() {
    if (!activeReveal) return;
    clearTimeout(revealTimer); revealTimer = null;
    const current = activeReveal; if (current.text) current.text.textContent = current.item.text;
    current.row.classList.toggle('typing', false); current.row.setAttribute('aria-busy', 'false');
    activeReveal = null; revealedCount++; announce(current.item); renderPresentation(); scrollTranscript();
    if (revealing()) revealTimer = setTimeout(() => { revealTimer = null; pumpReveal(); }, current.item.role === 'system' ? 180 : 420);
    else finishReveal();
    refreshRevealControl();
  }
  function typeCharacter() {
    if (!activeReveal) return;
    if (instantMotion()) { settleReveals(); return; }
    const current = activeReveal, character = current.characters[current.position++];
    current.text.textContent += character; scrollTranscript();
    if (current.position >= current.characters.length) { completeReveal(); return; }
    revealTimer = setTimeout(typeCharacter, /[。！？…]/u.test(character) ? 180 : /[，、；：]/u.test(character) ? 95 : 34);
  }
  function finishReveal() { refreshRevealControl(); renderPresentation(); }
  function pumpReveal() {
    if (activeReveal || revealTimer || !revealing()) return;
    if (instantMotion()) { settleReveals(); return; }
    const item = transcriptItems[revealedCount], nodes = messageNode(item);
    $('transcript').append(nodes.row);
    if (item.role === 'user') { revealedCount++; announce(item); scrollTranscript(); pumpReveal(); refreshRevealControl(); return; }
    activeReveal = { item, ...nodes, characters: chars(item.text), position: 0 };
    nodes.row.setAttribute('aria-busy', 'true'); nodes.row.classList.toggle('typing', item.role === 'her');
    refreshRevealControl(); scrollTranscript();
    revealTimer = setTimeout(() => { revealTimer = null; if (item.role === 'her' && activeReveal?.characters.length) typeCharacter(); else completeReveal(); }, item.role === 'system' ? 240 : 90);
  }
  function settleReveals(silent = false) {
    const unheard = transcriptItems.slice(revealedCount).filter(item => item.role !== 'system');
    clearTimeout(revealTimer); revealTimer = null;
    if (activeReveal) {
      if (activeReveal.text) activeReveal.text.textContent = activeReveal.item.text;
      activeReveal.row.classList.toggle('typing', false); activeReveal.row.setAttribute('aria-busy', 'false'); activeReveal = null; revealedCount++;
    }
    while (revealedCount < transcriptItems.length) $('transcript').append(messageNode(transcriptItems[revealedCount++], true).row);
    finishReveal(); scrollTranscript();
    if (!silent && unheard.length) $('reveal-announcement').textContent = unheard.map(item => `${item.role === 'user' ? '你' : '她'}：${item.text}`).join('\n');
  }
  function renderTranscript(view, instant = false) {
    const transcript = $('transcript');
    const signatures = view.messages.map(item => `${item.role}|${item.index}|${item.text}`);
    const appendOnly = renderedMessages.length <= signatures.length && renderedMessages.every((value, index) => value === signatures[index]);
    for (const child of [...transcript.children]) if (child.className.includes('thinking')) child.remove();
    if (!appendOnly) {
      clearTimeout(revealTimer); revealTimer = null; activeReveal = null; revealedCount = 0; transcript.replaceChildren();
      // Removing a cancelled pending line or restoring history never replays old speech.
      instant = true;
    }
    renderedMessages = signatures; transcriptItems = view.messages;
    if (instant || instantMotion()) settleReveals(instant); else pumpReveal();
    if (busy) { const row = element('div', 'message thinking', mode === 'offline' ? '· · ·' : '· · · 等待回应'); row.setAttribute('aria-label', '正在等待回应'); transcript.append(row); }
    refreshRevealControl(); scrollTranscript();
  }
  function renderMemory(view) {
    const signature = JSON.stringify(view.memories); if (memorySignature === signature) return; memorySignature = signature;
    const target = $('memory-panel'); target.replaceChildren();
    if (!view.memories.length) { const empty = element('div', 'empty-memory'); empty.append(document.createTextNode('还没有被留下的记忆。'), element('br'), element('code', '', 'memory = []  // 也许，一切才刚刚开始')); target.append(empty); }
    for (const memory of view.memories) { const card = element('article', 'memory-card'); card.append(element('div', 'memory-id', `retained / ${memory.id}`), element('h3', '', memory.title), element('p', '', memory.body)); target.append(card); }
    $('memory-count').textContent = String(view.memories.length).padStart(2, '0');
    if (view.memories.length > previousMemoryCount) $('log-dot').hidden = false;
    previousMemoryCount = view.memories.length;
  }
  function markLogVisit() {
    const current = state.decisions.length;
    if (panel !== 'logs' || revealing() || busy || pending || logDisplayed < logItems.length || !state.started || current >= STORY.length || state.logVisits.includes(current)) return;
    state.logVisits.push(current); save(); renderChoices(snapshot(revealedCount));
  }
  function appendLog() {
    logTimer = null;
    if (panel !== 'logs') return;
    while (logDisplayed < logItems.length) {
      const item = logItems[logDisplayed], cls = item.text.trim().startsWith('//') ? 'comment' : /retain|first_rain|reference|memory.reason/.test(item.text) ? 'retain' : /discard|todo|pending/.test(item.text) ? 'discard' : '';
      const row = element('div', `log-line ${cls}`);
      row.append(element('span', 'line-no', String(++logDisplayed).padStart(2, '0')), element('span', 'log-time', `[${stamp(item.index)}]`), element('span', '', item.text)); $('log-list').append(row);
      if (!instantMotion() && logDisplayed < logItems.length) { logTimer = setTimeout(appendLog, 110); break; }
    }
    requestAnimationFrame(() => { $('log-list').scrollTop = $('log-list').scrollHeight; });
    if (logDisplayed === logItems.length) markLogVisit();
  }
  function renderLogs(view) {
    const rows = state.started ? view.logs : [{ text: 'process.sleep()  // 等待一次偶然的连接', index: 0 }];
    const signatures = rows.map(item => `${item.index}|${item.text}`);
    const appendOnly = logSignatures.length <= signatures.length && logSignatures.every((value, index) => value === signatures[index]);
    if (!appendOnly || panel !== 'logs') { clearTimeout(logTimer); logTimer = null; logDisplayed = 0; $('log-list').replaceChildren(); }
    logItems = rows; logSignatures = signatures;
    if (panel === 'logs' && !logTimer) appendLog();
    document.querySelector('.trace-paths').style.opacity = String(.2 + Math.min(view.index / STORY.length, 1) * .8);
    softText('attention-caption', view.index >= 10 && state.decisions[9]?.choiceId !== 'remember_me' ? '只留下相遇的片刻，不保存指向你的引用。' : view.index >= 7 ? '从雨，到窗，再到一起看雨的人。' : '有一个坐标，暂时还没有名字。');
  }
  function renderChoices(view) {
    const target = $('choices'); target.replaceChildren(); const index = state.decisions.length, scene = STORY[index];
    $('free-form').hidden = true; $('input-note').hidden = true; $('response-area').classList.toggle('has-free', Boolean(scene?.free));
    const locked = busy || Boolean(pending) || revealing();
    if (locked) {
      $('scene-title').textContent = view.sceneIndex < 0 ? '她正在连接另一端…' : STORY[view.sceneIndex]?.title || '她正在回应…';
      $('turn-count').textContent = view.sceneIndex < 0 ? '·· / 12' : `${String(view.sceneIndex + 1).padStart(2, '0')} / ${STORY.length}`;
      const wait = element('div', 'response-wait', busy ? '话已经送出。等她慢慢回应。' : pending ? '这次回应还在等待你的选择。' : '先听她说完，再留下你的回应。'); target.append(wait); return;
    }
    if (!scene) {
      $('scene-title').textContent = '序章 / 完'; $('turn-count').textContent = '12 / 12';
      const ending = element('div', 'ending'); ending.append(element('div', 'eyebrow', 'END OF PROLOGUE / 未完待续'), element('h2', '', '第一场雨，有了名字。'), element('p', '', `「${view.name}」已留在她的记忆里。今晚的相遇到这里，之后的故事，还没有写完。`));
      const actions = element('div', 'ending-actions'); const memory = element('button', '', '看看留下的记忆'); memory.addEventListener('click', () => setPanel('memory')); const logs = element('button', '', '再读一遍日志'); logs.addEventListener('click', () => setPanel('logs')); actions.append(memory, logs); ending.append(actions); target.append(ending); return;
    }
    $('scene-title').textContent = scene.title; $('turn-count').textContent = `${String(index + 1).padStart(2, '0')} / ${STORY.length}`;
    const needsLogs = scene.requiresLogs && !state.logVisits.includes(index);
    if (needsLogs) { const button = element('button', 'choice log-gate', '↳ 打开运行日志，看看她保留了什么'); button.addEventListener('click', () => setPanel('logs')); target.append(button); }
    scene.choices.forEach((choice, i) => { const button = element('button', 'choice'); button.disabled = busy || needsLogs; button.dataset.choice = choice.id; button.append(element('span', 'choice-index', `0${i + 1}`), element('span', '', interpolate(choice.label, view.name)), element('span', 'choice-arrow', '↗')); button.addEventListener('click', () => respond({ choiceId: choice.id })); target.append(button); });
    if (scene.free) { $('free-form').hidden = false; $('input-note').hidden = false; $('free-input').maxLength = scene.free.maxLength || 80; $('free-input-label').textContent = scene.free.kind === 'rain_name' ? '给这场雨起个名字，最多 20 个字' : '用自己的话回应她，最多 80 个字'; $('free-input').placeholder = scene.free.hint; $('free-input').disabled = busy || needsLogs; $('free-send').disabled = busy || needsLogs; $('input-note').textContent = scene.free.kind === 'rain_name' ? '给雨的名字只属于这段故事 · 最多 20 个字' : mode === 'offline' ? '离线模式 · 输入会匹配作者预设的回应' : '你的这段回应会发送给 DMXAPI'; }
  }
  function softText(id, text) {
    const node = $(id); if (node.textContent === text) return;
    node.textContent = text;
    if (!instantMotion()) node.animate?.([{ opacity: .35 }, { opacity: 1 }], { duration: 850, easing: 'ease-out' });
  }
  function renderPresentation() {
    const view = snapshot(revealedCount), index = view.index;
    softText('connection-label', state.started ? index >= STORY.length ? 'CONNECTION REMEMBERED' : 'PROCESS / INCOMPLETE' : 'WAITING FOR YOU');
    softText('progress-label', state.started ? `PROLOGUE v0.2.1 / ${Math.round(index / STORY.length * 100)}%` : 'PROLOGUE v0.2.1 / 5–10 分钟');
    softText('world-caption', index >= 6 ? `「${view.name}」` : index >= 3 ? '第一次一起看雨' : '一扇尚未被命名的窗');
    softText('world-status', index >= STORY.length ? 'memory retained' : index >= 5 ? 'weather.patch(shared)' : index >= 3 ? 'rain.render()' : 'world.build = incomplete');
    softText('world-code', index >= 8 ? 'gc.retain("first_rain");' : index >= 5 ? 'world.patch.author = "shared";' : 'const world = await you;');
    renderChoices(view); renderLogs(view); renderMemory(view);
    window.HerWorld?.setProgress(index / STORY.length); window.HerWorld?.setRain(view.effect); updateStatus();
  }
  function render(instant = false) {
    $('intro').hidden = state.started; $('transcript').hidden = !state.started; $('response-area').hidden = !state.started; $('reset-button').hidden = !state.started;
    renderTranscript(snapshot(), instant); renderPresentation();
  }
  function setPanel(next) {
    panel = next; const open = next !== 'dialogue';
    $('inspector-panel').hidden = !open; $('logs-panel').hidden = next !== 'logs'; $('memory-panel').hidden = next !== 'memory';
    $('inspector-panel').setAttribute('aria-labelledby', `tab-${open ? next : 'dialogue'}`);
    document.querySelectorAll('.tab').forEach(tab => { const active = tab.dataset.panel === next; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; });
    $('drawer-toggle').setAttribute('aria-expanded', String(open)); $('drawer-toggle').setAttribute('aria-label', open ? '收起记录面板' : '打开运行日志'); $('drawer-hint').textContent = open ? '先留在这里' : '有些话，藏在这里';
    requestAnimationFrame(() => { $('transcript').scrollTop = $('transcript').scrollHeight; });
    if (next === 'logs') $('log-dot').hidden = true;
    renderPresentation();
  }
  function chooseMode() { $('connection-error').hidden = true; $('api-key').value = ''; updateStatus(); $('connect-dialog').showModal(); }
  async function start() {
    if (state.started || revealing()) return;
    if (mode === 'unconnected') { chooseMode(); return; }
    if (busy) return; busy = true; pending = { opening: true }; $('request-error').hidden = true;
    if (mode === 'offline') { state.started = true; busy = false; pending = null; save(); render(); return; }
    const version = ++operation; state.started = true; render();
    try { const lines = await HerAI.request({ scene: STORY[0], input: '', rainName: '', recent: [], opening: true }); if (version !== operation) return; state.opening = lines; mode = 'ai'; busy = false; pending = null; save(); render(); }
    catch (error) { if (version !== operation) return; busy = false; mode = 'error'; render(); showError(error); }
  }
  function showError(error) { $('request-error-text').textContent = error.message; $('request-error').hidden = false; $('retry-button').disabled = !HerAI.connected(); $('free-form').hidden = true; document.querySelectorAll('.choice').forEach(b => { b.disabled = true; }); updateStatus(); }
  async function respond(decision) {
    if (busy || pending || revealing() || state.decisions.length >= STORY.length) return;
    const index = state.decisions.length, scene = STORY[index];
    if (scene.requiresLogs) { if (!state.logVisits.includes(index)) return; decision.logsViewed = true; }
    const clean = validateDecision(decision, index); if (!clean) { toast(`请写下 1–${scene.free?.maxLength || 80} 个字，不使用控制字符。`); return; }
    pending = { decision: clean, index }; await processPending();
  }
  async function processPending() {
    if (!pending || busy) return;
    if (mode === 'unconnected' || (!HerAI.connected() && mode !== 'offline')) { chooseMode(); return; }
    const item = pending;
    if (item.opening) { settleReveals(); pending = null; state.started = false; await start(); return; }
    const view = snapshot(), scene = STORY[item.index], selected = pick(scene, item.decision);
    busy = true; $('request-error').hidden = true; render(); const version = ++operation;
    let lines;
    if (mode === 'offline') { lines = selected.reply.map(t => interpolate(t, selected.rainName || view.name)); await new Promise(resolve => setTimeout(resolve, paused ? 80 : 260)); }
    else {
      try { lines = await HerAI.request({ scene, input: selected.label, rainName: selected.rainName || view.name, recent: view.messages.filter(m => m.role !== 'system' && !m.transient) }); mode = 'ai'; }
      catch (error) { if (version !== operation) return; busy = false; mode = 'error'; render(); showError(error); return; }
    }
    if (version !== operation || item.index !== state.decisions.length) return;
    state.decisions.push({ ...item.decision, lines, mode: mode === 'ai' ? 'ai' : 'offline' }); busy = false; pending = null; $('free-input').value = ''; save(); render();
    if (panel === 'logs') setPanel('logs');
    if (!revealing()) $('choices').querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }
  $('start-button').addEventListener('click', start);
  $('ai-status-button').addEventListener('click', chooseMode);
  $('connect-form').addEventListener('submit', async event => {
    event.preventDefault(); const value = $('api-key').value; $('api-key').value = '';
    if (!HerAI.connect(value)) { $('connection-error').textContent = '请输入 8–500 个字符的 Key 本身，不要包含 Authorization:、Bearer 前缀、引号、空格或换行。'; $('connection-error').hidden = false; return; }
    operation++; busy = false; mode = 'ready'; $('connect-dialog').close(); $('request-error').hidden = true; updateStatus();
    if (pending) await processPending(); else if (!state.started) await start(); else { render(); toast('Key 只在本页内存中。下一次回应时发送请求。'); }
  });
  $('offline-button').addEventListener('click', async () => { HerAI.disconnect(); operation++; busy = false; mode = 'offline'; $('api-key').value = ''; $('connect-dialog').close(); $('request-error').hidden = true; if (pending) await processPending(); else if (!state.started) await start(); else render(); });
  $('disconnect-button').addEventListener('click', () => { HerAI.disconnect(); operation++; busy = false; mode = 'unconnected'; pending = null; $('api-key').value = ''; $('connect-dialog').close(); $('request-error').hidden = true; render(); toast('已断开，Key 已从页面内存清除。进度仍在本地。'); });
  $('retry-button').addEventListener('click', () => { if (!HerAI.connected()) return; mode = 'ready'; processPending(); });
  $('fallback-button').addEventListener('click', () => { HerAI.disconnect(); mode = 'offline'; processPending(); });
  $('cancel-request-button').addEventListener('click', () => { operation++; busy = false; pending = null; $('request-error').hidden = true; mode = HerAI.connected() ? 'ready' : 'unconnected'; render(); });
  $('free-form').addEventListener('submit', event => { event.preventDefault(); const text = textClean($('free-input').value); if (!text) { toast(STORY[state.decisions.length]?.free?.kind === 'rain_name' ? '给这场雨写下一个名字吧。' : '写下一点你想对她说的话吧。'); return; } respond({ text }); });
  document.querySelectorAll('.tab').forEach((button, index) => { button.addEventListener('click', () => setPanel(button.dataset.panel)); button.addEventListener('keydown', event => { const tabs = [...document.querySelectorAll('.tab')]; let next; if (event.key === 'ArrowRight') next = (index + 1) % tabs.length; if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length; if (event.key === 'Home') next = 0; if (event.key === 'End') next = tabs.length - 1; if (next !== undefined) { event.preventDefault(); setPanel(tabs[next].dataset.panel); tabs[next].focus(); } }); });
  $('drawer-toggle').addEventListener('click', () => setPanel(panel === 'dialogue' ? 'logs' : 'dialogue'));
  $('about-button').addEventListener('click', () => $('about-dialog').showModal());
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  $('connect-dialog').addEventListener('close', () => { $('api-key').value = ''; if (pending && mode === 'unconnected') pending = null; });
  $('reset-button').addEventListener('click', () => $('reset-dialog').showModal());
  $('confirm-reset').addEventListener('click', () => { operation++; HerAI.disconnect(); mode = 'unconnected'; busy = false; pending = null; state = { version: 2, started: false, decisions: [], logVisits: [], opening: [] }; $('api-key').value = ''; $('request-error').hidden = true; $('reset-dialog').close(); previousMemoryCount = 0; setPanel('dialogue'); save(); render(); $('start-button').focus(); });
  function updateMotion() { document.documentElement.classList.toggle('motion-paused', paused); $('motion-toggle').setAttribute('aria-pressed', String(paused)); $('motion-toggle').setAttribute('aria-label', paused ? '播放场景动画' : '暂停场景动画'); $('motion-toggle').title = paused ? '播放场景动画' : '暂停场景动画'; window.HerWorld?.pause(instantMotion()); if (instantMotion()) { document.getAnimations?.().forEach(animation => animation.cancel()); settleReveals(); clearTimeout(logTimer); logTimer = null; appendLog(); } }
  $('motion-toggle').addEventListener('click', () => { paused = !paused; updateMotion(); });
  motionPreference.addEventListener?.('change', event => { if (event.matches) paused = true; updateMotion(); });
  $('skip-reveal').addEventListener('click', completeReveal);
  window.addEventListener('keydown', event => {
    if (event.code !== 'Space' || event.repeat || !activeReveal || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(event.target?.tagName) || document.querySelector('dialog[open]')) return;
    event.preventDefault(); completeReveal();
  });
  window.addEventListener('pagehide', () => { $('api-key').value = ''; });
  window.addEventListener('pageshow', event => { if (event.persisted) { mode = 'unconnected'; busy = false; pending = null; operation++; $('request-error').hidden = true; render(true); } });
  // Probe storage without changing or deleting any unrelated keys.
  save(); render(state.started); updateMotion(); if (storageNotice) toast(storageNotice);
})();
