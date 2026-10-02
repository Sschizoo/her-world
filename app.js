(() => {
  'use strict';
  const STORY = window.HER_STORY, ENGINE = window.HerEngine, KEY = 'her-world.prologue.v3', LEGACY_KEY = 'her-world.prologue.v2';
  const $ = id => document.getElementById(id);
  let state = ENGINE.create();
  let mode = 'unconnected', panel = 'dialogue', busy = false, pending = null, operation = 0, saveAvailable = true, storageNotice = '', previousMemoryCount = 0, toastTimer;
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = motionPreference.matches;
  // Saved narrative is always complete. These cursors belong only to this viewing session.
  let renderedMessages = [], transcriptItems = [], revealedCount = 0, activeReveal = null, revealTimer;
  let logItems = [], logSignatures = [], logDisplayed = 0, logTimer, memorySignature = '', focusSignature = '';
  const instantMotion = () => paused || motionPreference.matches;
  const revealing = () => revealedCount < transcriptItems.length;

  const textClean = text => String(text || '').normalize('NFC').replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  const chars = text => [...text];
  try {
    const raw = localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY);
    if (raw) {
      if (raw.length > 400000) throw new Error('oversize');
      const value = JSON.parse(raw), restored = ENGINE.restore(value, STORY);
      if (!restored) throw new Error('invalid');
      state = restored;
      if (state.started) storageNotice = value.version === 2 ? '旧的相遇已保留。现在可以留在任意话题，反复改变雨。继续 AI 模式需重新输入 Key。' : '已恢复完整对话与天气。继续 AI 模式，请重新输入 Key。';
    }
  } catch { storageNotice = '未能读取旧存档。可以重新开始；若浏览器禁用存储，本次仍可游玩。'; }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); saveAvailable = true; }
    catch { saveAvailable = false; }
    updateStatus();
  }
  function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5200); }
  function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function snapshot(through = Infinity) {
    if (pending?.opening) return { ...ENGINE.view(state, through), messages: [{ role: 'system', text: 'boot() → build: incomplete / input: connected', index: 0 }] };
    const view = ENGINE.view(state, through);
    if (pending?.proposal) view.messages.push({ role: 'user', text: pending.proposal.input, index: state.events.length + 1, transient: true });
    return view;
  }
  function stamp(index) { return `${String(21 + Math.floor((2 + index) / 60)).padStart(2, '0')}:${String((2 + index) % 60).padStart(2, '0')}`; }
  function updateStatus() {
    const labels = { unconnected: '未连接 · 选择试玩模式', offline: '离线试玩 · 本地回应与雨技能', ready: 'Key 已载入 · 尚未验证', ai: `AI 已回应 · glm-5.3-flash`, error: 'AI 请求未完成 · 需要选择' };
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
    if (panel !== 'logs' || revealing() || busy || pending || logDisplayed < logItems.length || !state.started || !snapshot(revealedCount).logsEligible) return;
    const next = ENGINE.visitLogs(state);
    if (next !== state) { state = next; save(); render(); }
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
    renderFocus(view);
  }
  function renderFocus(view) {
    const rows = window.HerFocus?.calculate({ ...view, messages: view.messages.slice(0, revealedCount).filter(m => !m.transient) }) || [];
    const signature = JSON.stringify(rows); if (signature === focusSignature) return; focusSignature = signature;
    const target = $('focus-bars'), existing = new Map([...target.children].map(row => [row.dataset.entity, row]));
    for (const old of [...target.children]) if (!rows.some(row => row.id === old.dataset.entity)) old.remove();
    if (!rows.length) { target.replaceChildren(element('div', 'focus-empty', '还没有足够的共同话题。')); return; }
    for (const row of rows) {
      let node = existing.get(row.id);
      if (!node) {
        node = element('div', 'focus-row'); node.dataset.entity = row.id;
        const meter = element('span', 'focus-meter'); meter.append(element('span', 'focus-track', '....................'), element('span', 'focus-fill', '--------------------'));
        node.append(element('span', 'focus-label', row.label), meter, element('span', 'focus-percent'));
      }
      node.children[1].children[1].style.width = `${row.percent}%`;
      node.children[2].textContent = `${row.percent}%`; node.setAttribute('aria-label', `${row.label}，${row.percent}%`); target.append(node);
    }
  }
  function renderChoices(view) {
    const target = $('choices'); target.replaceChildren();
    const locked = busy || Boolean(pending) || revealing();
    $('free-form').hidden = locked; $('input-note').hidden = locked; $('response-area').classList.toggle('has-free', true);
    $('scene-title').textContent = view.ended ? '今晚先到这里 · 仍可继续聊天' : view.status || STORY[view.sceneIndex]?.title || '在这里，慢慢说';
    $('turn-count').textContent = view.pendingTopic === 'rain_name' ? 'NAME / 还没决定' : view.pendingTopic === 'teach_rain' ? 'RAIN / 等一个描述' : `${view.index} 个片刻已留下`;
    const invitation = view.invitation;
    $('story-invitation').hidden = locked || !invitation;
    $('invitation-question').textContent = invitation?.question || '';
    $('invitation-note').textContent = invitation?.context || '也可以先聊别的，这件事会等你';
    $('topic-nav').hidden = locked; $('memory-invitation').hidden = locked || !view.logsEligible;
    if (locked) {
      target.append(element('div', 'response-wait', busy ? '话已经送出。等她慢慢回应。' : pending ? '这次回应还在等待你的选择。' : '先听她说完，再留下你的回应。'));
    } else {
      ENGINE.suggestions(state).slice(0, 3).forEach((choice, i) => {
        const button = element('button', 'choice'); button.dataset.choice = choice.id;
        button.append(element('span', 'choice-index', `0${i + 1}`), element('span', '', choice.label));
        button.addEventListener('click', () => respond({ choiceId: choice.id })); target.append(button);
      });
      $('free-input').maxLength = 80; $('free-input-label').textContent = '自由聊天或改变雨，最多 80 个字';
      $('free-input').placeholder = invitation?.id === 'rain_name' ? '给她一个名字，或继续聊你想到的事…' : invitation?.id === 'rain_description' ? '说说你见过、听过，或想象中的雨…' : view.rain.created ? '接着她的话说，或聊一件新的事…' : '你想从哪里开始？也可以直接问她…';
      $('free-input').disabled = false; $('free-send').disabled = false;
      $('input-note').textContent = mode === 'unconnected' ? '尚未选择连接方式 · 发送前会让你选择 AI 或离线' : mode === 'offline' ? '离线理解有限 · 未听懂会说明 · 名字最多 20 字' : '用自己的话回应，也可以岔开话题 · 对话发送给 DMXAPI';
    }
    document.querySelectorAll('[data-topic]').forEach(button => { button.disabled = locked; button.setAttribute('aria-pressed', String(!view.neutralHints && button.dataset.topic === view.topic)); });
    const skills = $('weather-controls'); skills.replaceChildren();
    const enabled = state.started && view.milestones.includes('rain_taught') && !locked;
    const hints = view.rain.created
      ? [['rain_gentle', '轻一点', '让雨轻一点'], ['rain_normal', '普通', '把雨恢复正常雨量'], ['rain_heavy', '密一点', '让雨更密一点'], view.rain.paused ? ['rain_resume', '再下起来', '再下起来'] : ['rain_pause', '停一会儿', '让雨停下']]
      : [['rain_start', '让雨落下', '试着画出第一场雨']];
    for (const [id, label, sentence] of hints) {
      const button = element('button', 'weather-skill', label); button.disabled = !enabled; button.dataset.skill = id;
      button.setAttribute('aria-label', `填入一句对话：${sentence}`); button.title = '只填入对话；发送后才会请求改变天气';
      button.addEventListener('click', () => { $('free-input').value = sentence; $('free-input').focus({ preventScroll: true }); toast('已填入对话，发送后才会请求改变天气。'); }); skills.append(button);
    }
    $('weather-skill-status').textContent = !view.rain.created ? (view.milestones.includes('rain_taught') ? 'RAIN / 已理解 · 等你开口' : 'RAIN / 尚未学会') : view.rain.paused ? 'RAIN / 已停 · 密度仍记得' : `RAIN / ${ { gentle: '疏', normal: '常', heavy: '密' }[view.rain.density] || '常' }`;
  }
  function softText(id, text) {
    const node = $(id); if (node.textContent === text) return;
    node.textContent = text;
    if (!instantMotion()) node.animate?.([{ opacity: .35 }, { opacity: 1 }], { duration: 850, easing: 'ease-out' });
  }
  function renderPresentation() {
    const view = snapshot(revealedCount), progress = view.index / view.maxMilestones;
    softText('connection-label', state.started ? 'PROCESS / STILL LEARNING' : 'WAITING FOR YOU');
    softText('progress-label', state.started ? 'PROLOGUE v0.3.5 / 不必赶路' : 'PROLOGUE v0.3.5 / 初次相遇');
    softText('world-caption', view.name !== '未命名的雨' ? `「${view.name}」` : view.rain.created ? '第一次一起看雨' : '一扇尚未被命名的窗');
    softText('world-status', view.rain.created ? `rain.${view.rain.paused ? 'paused' : view.rain.density} / persistent` : 'world.build = incomplete');
    softText('world-code', view.memories.length ? 'gc.retain("first_rain");' : view.rain.created ? 'skills.rain = reusable;' : 'const world = await you;');
    renderChoices(view); renderLogs(view); renderMemory(view);
    window.HerWorld?.setProgress(progress); window.HerWorld?.setRain(view.effect); updateStatus();
  }
  function render(instant = false) {
    const active = state.started || pending?.opening;
    $('intro').hidden = Boolean(active); $('transcript').hidden = !active; $('response-area').hidden = !active; $('reset-button').hidden = !active;
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
    if (mode === 'offline') { state = ENGINE.start(state); busy = false; pending = null; save(); render(); return; }
    const version = ++operation; render();
    try { const view = ENGINE.view(state); const lines = await HerAI.request({ scene: STORY[0], input: '', rainName: '', recent: [], opening: true, world: { rain: view.rain, name: view.name, milestones: view.milestones }, guidance: ENGINE.guidance(state), memoryContext: view.memoryContext }); if (version !== operation) return; state = ENGINE.start(state, lines); mode = 'ai'; busy = false; pending = null; save(); render(); }
    catch (error) { if (version !== operation) return; busy = false; mode = 'error'; render(); showError(error); }
  }
  function showError(error) { $('request-error-text').textContent = error.message; $('request-error').hidden = false; $('retry-button').disabled = !HerAI.connected(); $('free-form').hidden = true; document.querySelectorAll('.choice').forEach(b => { b.disabled = true; }); updateStatus(); }
  async function respond(input) {
    if (busy || pending || revealing() || !state.started) return;
    if (input.text !== undefined && (!textClean(input.text) || chars(textClean(input.text)).length > 80)) { toast('请写下 1–80 个字。'); return; }
    let proposal;
    try { proposal = ENGINE.plan(state, input); } catch { toast('本次对话记录已满。可以重新开始一段相遇。'); return; }
    if (!proposal) { toast('请写下 1–80 个字。若要命名，可以说“把雨叫做……”（名字最多 20 字）。'); return; }
    pending = { proposal }; await processPending();
  }
  async function processPending() {
    if (!pending || busy) return;
    if (mode === 'unconnected' || (!HerAI.connected() && mode !== 'offline')) { chooseMode(); return; }
    const item = pending;
    if (item.opening) { settleReveals(); pending = null; await start(); return; }
    const view = ENGINE.view(state), proposal = item.proposal;
    busy = true; $('request-error').hidden = true; render(); const version = ++operation;
    let result;
    if (mode === 'offline') { result = { lines: proposal.reply, action: proposal.action, mode: 'offline' }; await new Promise(resolve => setTimeout(resolve, paused ? 80 : 260)); }
    else {
      try { result = await HerAI.request({ scene: STORY.find(scene => scene.id === proposal.topic) || STORY[view.sceneIndex] || STORY[0], input: proposal.input, rainName: view.name, recent: view.messages.filter(m => m.role !== 'system'), world: { rain: view.rain, name: view.name, milestones: view.milestones }, allowedActions: proposal.allowedActions, topic: proposal.topic, acceptedAnswer: proposal.acceptedAnswer, pendingTopic: proposal.pendingTopic, answerQuestion: proposal.answerQuestion, requireActionEvidence: proposal.requireActionEvidence, allowedStoryIntents: proposal.allowedStoryIntents, acceptedStoryIntent: proposal.acceptedStoryIntent, guidance: proposal.guidance, memoryContext: view.memoryContext }); if (version !== operation) return; mode = 'ai'; result = { ...result, mode: 'ai' }; }
      catch (error) { if (version !== operation) return; busy = false; mode = 'error'; render(); showError(error); return; }
    }
    if (version !== operation) return;
    const next = ENGINE.commit(state, proposal, result);
    busy = false; pending = null;
    if (!next) { render(); toast('这次回应没有改变故事或天气。请换一种说法再试，或继续聊别的。'); return; }
    state = next; $('free-input').value = ''; save(); render();
    if (panel === 'logs') setPanel('logs');
    if (!revealing()) $('free-input').focus({ preventScroll: true });
  }
  $('memory-invitation').addEventListener('click', () => setPanel('logs'));
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
  $('free-form').addEventListener('submit', event => { event.preventDefault(); const text = textClean($('free-input').value); if (!text) { toast('写下一点你想对她说的话吧。'); return; } respond({ text }); });
  document.querySelectorAll('[data-topic]').forEach(button => button.addEventListener('click', () => respond({ choiceId: button.dataset.choiceId })));
  document.querySelectorAll('.tab').forEach((button, index) => { button.addEventListener('click', () => setPanel(button.dataset.panel)); button.addEventListener('keydown', event => { const tabs = [...document.querySelectorAll('.tab')]; let next; if (event.key === 'ArrowRight') next = (index + 1) % tabs.length; if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length; if (event.key === 'Home') next = 0; if (event.key === 'End') next = tabs.length - 1; if (next !== undefined) { event.preventDefault(); setPanel(tabs[next].dataset.panel); tabs[next].focus(); } }); });
  $('drawer-toggle').addEventListener('click', () => setPanel(panel === 'dialogue' ? 'logs' : 'dialogue'));
  $('about-button').addEventListener('click', () => $('about-dialog').showModal());
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  $('connect-dialog').addEventListener('close', () => { $('api-key').value = ''; if (pending && mode === 'unconnected') pending = null; });
  $('reset-button').addEventListener('click', () => $('reset-dialog').showModal());
  $('confirm-reset').addEventListener('click', () => { operation++; HerAI.disconnect(); mode = 'unconnected'; busy = false; pending = null; state = ENGINE.create(); try { localStorage.removeItem(LEGACY_KEY); } catch { toast('这次会话已重新开始，但浏览器未能移除旧存档副本。'); } $('api-key').value = ''; $('request-error').hidden = true; $('reset-dialog').close(); previousMemoryCount = 0; setPanel('dialogue'); save(); render(); $('start-button').focus(); });
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
