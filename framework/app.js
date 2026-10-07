(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HerFrameworkUI = api;
  if (root && root.document && root.document.getElementById('framework-app')) {
    try { root.herFrameworkApp = api.create({ window: root, document: root.document }); }
    catch (_) {
      const note = root.document.getElementById('input-note');
      if (note) note.textContent = '试验场资源没有完整载入，请刷新此页后再试。原版存档不受影响。';
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PANELS = ['world', 'memory', 'focus', 'logs'];
  const FAILURES = Object.freeze({ disconnected: '连接已断开，请重新选择连接方式。', busy: '上一条回应尚未完成。', limit: '本页请求次数已达到上限。', timeout: '等待回应超时。', network: '这次连接没有完成。', response_read: '回应在传输时中断。', auth: '转发服务或上游返回了认证或权限错误，不能仅凭此判断密码是否有误。', quota: '转发服务或模型额度暂不可用。', upstream: '模型服务暂时不可用。', format: '回应格式不符合约定。', truncated: '回应没有完整返回。', empty: '模型没有返回可用的回应。', cancelled: '这次回应已取消。', invalid: '回应中的变化未通过本地规则校验。' });
  const RUNTIME_CODES = new Set(["ANSWER_BOUNDARY", "ANSWER_UNAVAILABLE", "BEATS_INVALID", "CAPABILITY_DISABLED", "CHOICE_INVALID", "CONSENT_REQUIRED", "CONTEXT_CAPACITY", "CURSOR_INVALID", "EVENT_CAPACITY", "EVENT_INVALID", "EVIDENCE_INVALID", "GEOMETRY_INVALID", "IMPORT_ANNOTATION", "IMPORT_FACTS", "IMPORT_INVALID", "IMPORT_MEMORY", "IMPORT_OBJECT", "IMPORT_ORIGIN", "IMPORT_TRANSCRIPT", "IMPORT_WEATHER", "IMPORT_WORLD", "INPUT_INVALID", "LINES_INVALID", "MEMORY_CAPACITY", "OBSERVATION_INVALID", "OPERATION_CAPACITY", "OPERATION_EMPTY", "OPERATION_INVALID", "PACK_INVALID", "PACK_MISMATCH", "PLACEMENT_INVALID", "PLACEMENT_TARGET", "PLAN_INVALID", "PROTOCOL_TEXT", "QUESTION_UNAVAILABLE", "RELATIONSHIP_BOUND", "REPLAY_INVALID", "SAVE_INVALID", "STALE_PROPOSAL", "STATE_INVALID", "TARGET_MISSING", "TEXT_INVALID", "TOPIC_INVALID", "WORLD_CAPACITY"]);
  ['WEATHER_CONFLICT', 'RULES_VERSION_UNSUPPORTED', 'MIGRATION_WEATHER_INCOMPATIBLE', 'PLACEMENT_CAPACITY'].forEach(code => RUNTIME_CODES.add(code));
  const MIGRATION_PACK_DIGESTS = Object.freeze({
    'rain-lab': Object.freeze({ '1': '402db16c', '2': '362c6f2f', '3': 'd63194b2' }),
    'lantern-lab': Object.freeze({ '1': '8dd7d018', '2': '36792093', '3': 'ce388026' })
  });
  const DIAGNOSTIC_STAGES = new Set(['LOCAL_CONTEXT', 'REQUEST', 'NETWORK', 'HTTP', 'RESPONSE_READ', 'ENVELOPE', 'FINAL_CONTENT', 'JSON', 'CANCELLED']);
  const DIAGNOSTIC_CODES = new Set(['CONTEXT_INVALID', 'INPUT_INVALID', 'REQUEST_TOO_LARGE', 'RESPONSE_TOO_LARGE', 'ROOT_INVALID', 'PAYLOAD_REQUIRED', 'PAYLOAD_MIXED', 'OUTPUT_UNSAFE', 'JSON_SYNTAX', 'JSON_BAD_ESCAPE', 'JSON_CONTROL_CHARACTER', 'JSON_UNTERMINATED', 'JSON_TRAILING_CONTENT', 'JSON_DUPLICATE_KEY']);
  const DIAGNOSTIC_PATHS = new Set(['context', 'input', 'request', 'response', 'content', 'root']);
  const OP_LABELS = Object.freeze({ 'world.create': '新增物件', 'world.update': '修改物件', 'world.remove': '移除物件', 'world.annotate': '更新注解', 'weather.set': '改变天气', 'memory.upsert': '写入记忆', 'memory.remove': '移除记忆', 'story.answer': '记录回答', 'story.defer': '暂放问题', 'character.update': '更新角色状态', 'log.note': '记录想法', 'panel.open': '打开面板' });
  function list(value) { return Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : []; }
  function string(value, fallback) { return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback || ''; }
  function source(value) { return value && typeof value === 'object' ? string(value.text) : string(value); }
  function create(options) {
    options = options || {};
    const win = options.window || (typeof window !== 'undefined' ? window : {}), doc = options.document || win.document;
    const runtime = options.runtime || win.HerFramework, packs = options.packs || win.HerFrameworkPacks;
    const legacy = options.legacy || win.HerFrameworkLegacy;
    const offline = options.offline || win.HerFrameworkOffline, focus = options.focus || win.HerFrameworkFocus;
    const model = options.model || win.HerFrameworkModel.create();
    const timer = options.setTimeout || win.setTimeout.bind(win), clearTimer = options.clearTimeout || win.clearTimeout.bind(win);
    const $ = id => doc.getElementById(id), el = (tag, text, className) => { const node = doc.createElement(tag); if (text !== undefined) node.textContent = string(text); if (className) node.className = className; return node; };
    let storage; try { storage = Object.prototype.hasOwnProperty.call(options, 'storage') ? options.storage : win.localStorage; } catch (_) { storage = null; }
    const renderer = options.renderer || (win.HerFrameworkRenderer && win.HerFrameworkRenderer.create($('world-canvas'), { window: win }));
    const available = packs.list();
    if (!available.length) throw new Error('packs_missing');
    const query = typeof URLSearchParams === 'function' ? new URLSearchParams((win.location || {}).search || '') : null;
    const desired = query && query.get('pack');
    let pack = packs.get(desired) || packs.get(available[0].id), state, visible;
    let mode = null, activePanel = 'world', navigation = 0, generation = 0, pending = null, revealing = null;
    let lastFailure = null, currentBeat = null, saveProblem = false, toastTimer = null, destroyed = false, unobservedPanel = false, saveProtected = false, legacyCandidate = null, migrationBackupFailed = false, migrationBackedUp = false;
    const media = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let reduced = !!(media && media.matches), immediate = reduced;
    const renderCache = new Map();
    function key() { return `her-world.framework.v4:${pack.id}:${pack.version}`; }
    function text(id, value) { const node = $(id), next = string(value); if (node && node.textContent !== next) node.textContent = next; }
    function toast(message) { text('toast', message); $('toast').hidden = false; if (toastTimer) clearTimer(toastTimer); toastTimer = timer(() => { $('toast').hidden = true; }, 5500); }
    function migrationBackup(raw, migration) {
      // Only locally generated, known migration metadata can select a backup key.
      try {
        const fields = ['type', 'fromRulesVersion', 'toRulesVersion', 'fromPackDigest', 'toPackDigest'];
        if (!migration || Object.keys(migration).length !== fields.length || !fields.every(field => Object.prototype.hasOwnProperty.call(migration, field))) return false;
        const known = MIGRATION_PACK_DIGESTS[pack.id], original = JSON.parse(raw).pack, current = runtime.serialize(state).pack;
        const recognized = known && pack.version === '1.0.0' && pack.rulesVersion === '3'
          && migration.type === 'object-placement-v3' && ['1', '2'].includes(migration.fromRulesVersion) && migration.toRulesVersion === '3'
          && migration.fromPackDigest === known[migration.fromRulesVersion] && migration.toPackDigest === known['3']
          && original.id === pack.id && original.version === pack.version && original.rulesVersion === migration.fromRulesVersion && original.digest === migration.fromPackDigest
          && current.id === pack.id && current.version === pack.version && current.rulesVersion === migration.toRulesVersion && current.digest === migration.toPackDigest;
        if (!recognized) return false;
        let hash = 2166136261;
        for (let index = 0; index < raw.length; index++) hash = Math.imul(hash ^ raw.charCodeAt(index), 16777619);
        const backupKey = key() + ':backup:rules' + migration.fromRulesVersion + ':' + migration.fromPackDigest + ':' + (hash >>> 0).toString(16).padStart(8, '0');
        const prior = storage.getItem(backupKey);
        if (prior !== null && prior !== undefined) return prior === raw;
        storage.setItem(backupKey, raw);
        return storage.getItem(backupKey) === raw;
      } catch (_) { return false; }
    }
    function save() {
      if (saveProtected) { text('save-status', migrationBackupFailed ? '旧存档备份失败 · 本页未保存' : '原存档已保护 · 本页未保存'); return; }
      try { if (!storage) throw new Error('blocked'); storage.setItem(key(), JSON.stringify(runtime.serialize(state))); saveProblem = false; }
      catch (_) { saveProblem = true; }
      text('save-status', saveProblem ? '存储不可用 · 仅本页保留' : 'LOCAL SAVE · 已保存');
    }
    function load() {
      text('reveal-announcement', '');
      saveProblem = false; saveProtected = false; migrationBackupFailed = false; migrationBackedUp = false; lastFailure = null;
      state = runtime.create(pack);
      try {
        if (!storage) throw new Error('blocked');
        const raw = storage.getItem(key());
        if (raw) {
          const restored = runtime.restore(raw, pack);
          if (restored.ok) {
            state = restored.state;
            if (restored.migration) {
              migrationBackedUp = migrationBackup(raw, restored.migration);
              if (!migrationBackedUp) {
                saveProtected = true; migrationBackupFailed = true; lastFailure = 'migration_backup_failed';
                toast('旧存档已安全读取，但浏览器没有允许保留一份完整备份。原存档不会被覆盖，本页的新变化暂时不保存。');
              }
            }
          } else {
            saveProtected = true;
            lastFailure = restored.error && restored.error.code === 'PACK_MISMATCH' ? 'pack_mismatch' : restored.error && restored.error.code === 'MIGRATION_WEATHER_INCOMPATIBLE' ? 'migration_weather_incompatible' : 'save_invalid';
            const reason = lastFailure === 'pack_mismatch' ? '存档与当前内容包版本不匹配。' : lastFailure === 'migration_weather_incompatible' ? '旧存档包含无法安全转换的天气。' : '当前试验场存档未通过校验。';
            toast(reason + '原数据已保留；当前空白世界仅在本页运行。确认重新开始后才能覆盖保存。');
          }
        }
      } catch (_) { saveProblem = true; }
      visible = runtime.view(state); currentBeat = null; renderCache.clear();
      text('save-status', saveProtected ? migrationBackupFailed ? '旧存档备份失败 · 本页未保存' : '原存档已保护 · 本页未保存' : saveProblem ? '存储不可用 · 仅本页保留' : migrationBackedUp ? '旧存档已备份 · 可继续保存' : 'LOCAL SAVE · 本地保存');
    }
    function cached(name, value, fn) { const signature = JSON.stringify(value); if (renderCache.get(name) === signature) return; renderCache.set(name, signature); fn(); }
    function empty(node, message) { node.replaceChildren(el('p', message, 'empty')); }
    function card(title, body, evidence) {
      const node = el('article', undefined, 'record-card'); node.append(el('h3', title));
      if (body) node.append(el('p', body));
      if (evidence) node.append(el('p', '来源：' + evidence, 'source'));
      return node;
    }
    function message(role, content, pendingRow) {
      const node = el('div', undefined, 'message ' + (role === 'user' ? 'you' : role === 'system' ? 'system' : 'her') + (pendingRow ? ' pending' : ''));
      const body = el('span', content, 'message-text');
      if (role !== 'system') node.append(el('span', role === 'user' ? '你' : (visible.character && visible.character.name) || '她', 'speaker'));
      node.append(body); return { node, body };
    }
    function scroll() { const t = $('transcript'); t.scrollTop = t.scrollHeight; }
    function renderTranscript() {
      const transcript = $('transcript'); transcript.replaceChildren();
      if (!(visible.transcript || []).length) transcript.append(message('system', '内容包说明 · ' + ((pack.character && [pack.character.role, pack.character.stance].filter(Boolean).join('。')) || pack.title)).node);
      list(visible.transcript).forEach(item => transcript.append(message(item.role, item.text).node));
      scroll();
    }
    function renderWorld(view) {
      const world = view.world || {}, objects = list(world.objects), weather = world.weather || {};
      cached('world', world, () => {
        text('object-count', String(objects.length).padStart(2, '0'));
        const weatherName = weather.name || (weather.kind === 'rain' ? '雨' : weather.kind === 'snow' ? '雪' : weather.kind === 'mist' ? '雾' : '晴空');
        const weatherState = weather.paused ? '暂停' : Number(weather.intensity) > 0 ? '强度 ' + weather.intensity : '安静';
        text('weather-status', weatherName + ' / ' + weatherState);
        text('world-status', objects.length + ' objects · ' + weatherState);
        text('world-caption', weather.name || (objects.length ? objects[objects.length - 1].label : '一处可以慢慢填满的空白'));
        text('world-code', 'world.objects = ' + objects.length + ';');
        text('world-summary', '天气：' + weatherName + ' · ' + weatherState + '　物件 ' + objects.length + ' / ' + (world.capacity || '—') + (source(weather.source) ? '　来源：' + source(weather.source) : ''));
        const container = $('objects-list'); container.replaceChildren();
        objects.forEach(object => {
          const annotation = (world.annotations || {})[object.id] || {};
          const row = card(object.label, '位置 ' + object.x + ', ' + object.y + ' · ' + object.id, source(object.source && (object.source.lastChangedBy || object.source.createdBy)));
          if (object.glyphs) row.append(el('pre', object.glyphs));
          if (annotation.meaning) row.append(el('p', '你的意义：' + annotation.meaning));
          if (annotation.interpretation) row.append(el('p', '她的理解：' + annotation.interpretation));
          if (source((annotation.sources || {}).meaning)) row.append(el('p', '意义来源：' + source(annotation.sources.meaning), 'source'));
          if (source((annotation.sources || {}).interpretation)) row.append(el('p', '理解来源：' + source(annotation.sources.interpretation), 'source'));
          container.append(row);
        });
        if (!objects.length) empty(container, '窗外还没有你们添上的物件。说一个想法，也可以先聊聊天。');
        if (renderer) renderer.update(view);
      });
    }
    function renderMemory(view) {
      const memories = list(view.memories);
      cached('memory', memories, () => {
        text('memory-count', String(memories.length).padStart(2, '0'));
        const container = $('memory-list'); container.replaceChildren();
        memories.forEach(memory => {
          const row = card(memory.title || memory.id, memory.body, source(memory.source) || '未保留原始来源');
          if (memory.currentRevision && memory.currentRevision.number > 1) row.append(el('p', '修订 ' + memory.currentRevision.number + '：' + source(memory.currentRevision), 'source'));
          container.append(row);
        });
        if (!memories.length) empty(container, '还没有留下记忆。只会展示这段对话里确实保存的内容。');
      });
    }
    function renderLogs(view) {
      const logs = list(view.logs);
      cached('logs', logs, () => {
        text('log-count', String(logs.length).padStart(2, '0'));
        const container = $('log-list'); container.replaceChildren();
        logs.slice().reverse().forEach(log => {
          const operationText = list(log.operations).map(type => OP_LABELS[type]).filter(Boolean).join(' · ');
          const label = log.kind === 'operations' ? operationText || '变化已通过校验' : log.kind === 'turn' ? '对话已接收' : log.kind === 'ui' ? '已查看面板' : log.text || log.kind;
          const row = el('div', undefined, 'log-row'), body = el('span', label);
          if (source(log.source)) body.append(el('span', '来源：' + source(log.source), 'source'));
          row.append(el('span', log.kind || log.id || 'event'), body); container.append(row);
        });
        if (!logs.length) empty(container, '等待第一次被确认的变化。记录会跟随对应的那句话出现。');
      });
    }
    function renderFocus(view) {
      const projected = focus && focus.calculate ? focus.calculate(view, pack) : null;
      cached('focus', { focus: projected || view.focus, character: view.character }, () => {
        const container = $('focus-bars'); container.replaceChildren();
        const entries = list(projected && (projected.items || projected.entities || projected.rows || projected));
        entries.filter(item => item && typeof item === 'object').forEach(item => {
          const percent = Math.max(0, Math.min(100, Number(item.percent === undefined ? item.value === undefined ? item.score : item.value : item.percent) || 0));
          const row = el('div', undefined, 'focus-row'), track = el('div', undefined, 'focus-track'), bar = el('div', undefined, 'focus-fill');
          bar.style.width = percent + '%'; track.append(bar); row.append(el('span', item.label || item.title || item.id), track, el('span', Math.round(percent) + '%', 'amount'));
          const evidence = source(item.source) || (Array.isArray(item.evidence) ? item.evidence.map(source).filter(Boolean).join(' / ') : source(item.evidence));
          if (evidence) row.title = evidence;
          container.append(row);
        });
        if (!container.children.length) empty(container, '还没有足够的对话内容。');
        const c = view.character || {}, character = $('character-summary'); character.replaceChildren(el('h3', (c.name || '她') + ' · 虚构角色状态'));
        character.append(el('p', (c.role || '角色尚未设定') + (c.mood ? ' · ' + c.mood : '')), el('p', c.stance || ''));
        character.append(el('p', '信任 ' + string(c.trust, '—') + ' · 熟悉 ' + string(c.familiarity, '—') + '（游戏数值）'));
        character.append(el('p', source(c.basis) ? '变化来源：' + source(c.basis) : '来源：内容包的初始角色设定', 'muted small'));
      });
    }
    function renderInvitation(view) {
      const questions = list(view.pendingQuestions), current = questions.find(q => q.id === view.activeQuestionId) || questions.find(q => q.topic === (view.story || {}).topic && !q.deferred) || questions.find(q => !q.deferred) || questions[0];
      cached('question', current || null, () => { $('story-invitation').hidden = !current; text('invitation-question', current ? current.text + (current.deferred ? '（已暂放）' : '') : ''); });
      cached('hints', { mode, pack: pack.id, question: current && current.id, weather: view.world && view.world.weather, objects: list(view.world && view.world.objects).map(o => ({ id: o.id, label: o.label })) }, () => {
        const hints = [];
        if (Array.isArray(pack.hints)) hints.push(...pack.hints.map(h => typeof h === 'string' ? h : h.text).filter(Boolean));
        if (current && current.choices) hints.push(...list(current.choices).map(c => typeof c === 'string' ? c : c.text || c.label).filter(Boolean).map(label => mode === 'offline' ? '/回答 ' + label : label));
        if (!hints.length && mode === 'offline' && offline.help) hints.push(...offline.help());
        if (!hints.length) hints.push('在窗边放一张长椅', '我想先聊聊别的', '记住：今天我们一起造了一个世界');
        const container = $('hint-list'); container.replaceChildren();
        hints.slice(0, 3).forEach(hint => { const button = el('button', hint + ' ↗'); button.type = 'button'; button.title = '只填入输入框，不会发送'; button.addEventListener('click', () => { if (pending || revealing) return; $('free-input').value = hint; $('free-input').focus(); }); container.append(button); });
      });
    }
    function renderDeveloper() {
      const c = visible.character || {}, events = list(state.events), latest = events[events.length - 1];
      const data = {
        contentPack: pack.id + '@' + pack.version,
        rulesVersion: (visible.pack || {}).rulesVersion || pack.rulesVersion,
        stateRevision: state.revision,
        visibleRevision: visible.revision,
        currentBeat,
        pendingQuestion: list(visible.pendingQuestions).map(q => ({ id: q.id, text: q.text, deferred: !!q.deferred })),
        validatedEvents: events.length,
        lastEvent: latest ? { id: latest.id || latest.eventId, type: latest.type, operations: list(latest.plan && latest.plan.beats).flatMap(b => list(b.operations).map(op => op.type)) } : null,
        lastSafeFailure: lastFailure,
        memoryCount: list(visible.memories).length,
        fictionalCharacter: { name: c.name, role: c.role, trust: c.trust, familiarity: c.familiarity, source: source(c.basis) || '内容包初始设定' },
        focusEvidence: focus && focus.calculate ? focus.calculate(visible, pack).map(item => ({ entity: item.label, evidence: item.evidence })) : visible.focus || null
      };
      text('developer-content', JSON.stringify(data, null, 2));
    }
    function renderView(view) { visible = view; renderWorld(view); renderMemory(view); renderLogs(view); renderFocus(view); renderInvitation(view); renderDeveloper(); }
    function controls() {
      const busy = !!(pending || revealing);
      $('free-send').disabled = busy; $('free-input').disabled = busy;
      list($('hint-list').children).forEach(button => { button.disabled = busy; });
      $('cancel-pending').hidden = !pending;
      $('offline-help-button').hidden = mode !== 'offline'; $('offline-help-button').disabled = busy;
      $('intro').hidden = !!mode || list(visible.transcript).length > 0;
      $('transcript').hidden = !$('intro').hidden;
      $('response-area').hidden = !$('intro').hidden;
      $('start-button').hidden = !!mode;
      $('disconnect-button').hidden = !model.connected();
      text('connection-button', mode === 'online' ? 'AI 已连接 · 本页临时连接' : mode === 'offline' ? '离线规则试玩 · 有限测试表达' : '未连接 · 选择试玩模式');
      text('connection-label', pending ? 'WAITING FOR RESPONSE' : revealing ? 'SHE IS SPEAKING' : mode === 'online' ? 'CONNECTED / AI' : mode === 'offline' ? 'OFFLINE / RULES' : 'WAITING FOR YOU');
      text('input-note', pending ? '正在等待回应，尚未改变世界。可以取消。' : revealing ? '变化会跟随对应的那一句出现，按空格可显示本句。' : mode === 'offline' ? '离线规则只理解有限表达 · 提示只填入，不会发送' : mode === 'online' ? '每次发送会请求模型 · 只有校验通过的变化会被保留' : '尚未选择连接方式 · 可以先写下想说的话');
      const motionOff = immediate || reduced;
      $('motion-toggle').setAttribute('aria-pressed', String(motionOff)); $('motion-toggle').disabled = reduced;
      $('motion-toggle').setAttribute('title', reduced ? '系统已开启减少动态效果' : motionOff ? '恢复逐句文字和场景动画' : '暂停场景动画并立即显示文字');
      text('motion-toggle', motionOff ? '静态显示' : '动态显示');
      if (renderer && renderer.setReducedMotion) renderer.setReducedMotion(motionOff);
      renderDeveloper();
    }
    function selectPanel(name, manual) {
      name = name === 'character' ? 'focus' : name;
      if (!PANELS.includes(name)) return;
      if (manual) { navigation++; unobservedPanel = true; }
      activePanel = name;
      PANELS.forEach(panel => { const selected = panel === name; $('panel-' + panel).hidden = !selected; $('tab-' + panel).classList.toggle('active', selected); $('tab-' + panel).setAttribute('aria-selected', String(selected)); $('tab-' + panel).setAttribute('tabindex', selected ? '0' : '-1'); });
      if (!manual) unobservedPanel = true;
      if (!pending && !revealing) observePanel();
    }
    function observePanel() {
      if (destroyed) return;
      const panel = activePanel === 'focus' ? 'character' : activePanel;
      const eligible = list(visible.pendingQuestions).some(q => q.completion && q.completion.type === 'ui' && q.completion.panel === panel);
      if (!unobservedPanel && !eligible) return;
      unobservedPanel = false;
      try {
        const next = runtime.observe(state, { type: 'panel.viewed', panel });
        if (next !== state && JSON.stringify(next) !== JSON.stringify(state)) { state = next; save(); renderView(runtime.view(state)); }
      } catch (error) { lastFailure = { code: 'observation_invalid', rule: error && RUNTIME_CODES.has(error.code) ? error.code : 'OBSERVATION_INVALID' }; renderDeveloper(); }
    }
    function showConnect() { text('connection-error', ''); $('connection-error').hidden = true; $('connect-dialog').showModal(); }
    function safeFailure(error) {
      const code = error && FAILURES[error.code] ? error.code : 'invalid';
      lastFailure = { code };
      if (Number.isInteger(error && error.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599) lastFailure.httpStatus = error.httpStatus;
      if (code === 'invalid' && error && RUNTIME_CODES.has(error.ruleCode)) lastFailure.rule = error.ruleCode;
      const detail = error && error.diagnostic;
      if (detail && DIAGNOSTIC_STAGES.has(detail.stage)) {
        lastFailure.stage = detail.stage;
        if (DIAGNOSTIC_CODES.has(detail.code)) lastFailure.detail = detail.code;
        if (DIAGNOSTIC_PATHS.has(detail.path)) lastFailure.path = detail.path;
      }
      const explanation = lastFailure.rule === 'PLACEMENT_CAPACITY' ? '这次没有找到能安全放下这些物件的位置。可以缩小物件、换个位置，或先移走一些物件再试。' : FAILURES[code];
      return (lastFailure.httpStatus ? 'HTTP ' + lastFailure.httpStatus + ' · ' : '') + explanation;
    }
    function stopReveal(settle) {
      if (!revealing) return;
      const old = revealing; revealing = null;
      if (old.timer) clearTimer(old.timer);
      $('reveal-controls').hidden = true; currentBeat = null;
      if (settle) { renderView(runtime.view(state)); renderTranscript(); observePanel(); }
    }
    function cancel(messageText, settle) {
      generation++;
      if (pending && pending.controller) pending.controller.abort();
      pending = null; stopReveal(settle !== false);
      $('request-error').hidden = true; renderTranscript(); controls();
      if (messageText) toast(messageText);
    }
    function endReveal() {
      if (!revealing) return;
      if (revealing.timer) clearTimer(revealing.timer);
      revealing = null; currentBeat = null; $('reveal-controls').hidden = true;
      renderView(runtime.view(state)); controls(); observePanel(); $('free-input').focus();
    }
    function beginReveal(result, requestNavigation) {
      const previous = visible;
      renderTranscript();
      const finalTranscript = list(result.state.transcript);
      const user = finalTranscript.filter(t => t.role === 'user').slice(-1)[0];
      if (user && !list(previous.transcript).some(t => t === user || t.eventId === user.eventId && t.role === 'user')) $('transcript').append(message('user', user.text).node);
      revealing = { lines: result.lines, frames: result.frames, index: 0, position: 0, timer: null, row: null, requestNavigation, token: generation };
      $('reveal-controls').hidden = false; controls();
      function nextLine() {
        const r = revealing; if (!r || r.token !== generation) return;
        if (r.index >= r.lines.length) { endReveal(); return; }
        r.row = message('character', ''); $('transcript').append(r.row.node); r.position = 0;
        currentBeat = { line: r.index + 1, total: r.lines.length, phase: 'speaking' };
        text('reveal-status', '她正在慢慢说 · ' + (r.index + 1) + '/' + r.lines.length); renderDeveloper();
        r.complete = () => {
          if (revealing !== r || r.token !== generation) return;
          if (r.timer) clearTimer(r.timer);
          r.row.body.textContent = r.lines[r.index];
          const frame = r.frames[r.index] || runtime.view(state); renderView(frame);
          currentBeat = { line: r.index + 1, total: r.lines.length, phase: 'accepted' }; renderDeveloper();
          if (frame.panel && navigation === r.requestNavigation) selectPanel(frame.panel, false);
          text('reveal-announcement', r.lines[r.index]); scroll();
          r.index++; r.complete = null;
          if (immediate || reduced) nextLine(); else r.timer = timer(nextLine, 360);
        };
        if (immediate || reduced) { r.complete(); return; }
        const chars = Array.from(r.lines[r.index]);
        const tick = () => {
          if (revealing !== r || r.token !== generation) return;
          r.position = Math.min(chars.length, r.position + 1); r.row.body.textContent = chars.slice(0, r.position).join(''); scroll();
          if (r.position >= chars.length) r.complete();
          else r.timer = timer(tick, /[，。！？…,.!?]/.test(chars[r.position - 1]) ? 115 : 26);
        };
        r.timer = timer(tick, 30);
      }
      nextLine();
    }
    async function submit(inputOverride) {
      if (destroyed || pending || revealing) return false;
      const input = inputOverride === undefined ? $('free-input').value.trim() : inputOverride;
      if (!input || Array.from(input).length > 200) { toast('请写下 1–200 个字。'); return false; }
      if (!mode) { showConnect(); return false; }
      $('request-error').hidden = true; lastFailure = null;
      const token = ++generation, requestNavigation = navigation;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const base = state; let proposal;
      try { proposal = runtime.propose(base, { text: input }); }
      catch (_) { toast('这句话暂时无法提交，请检查长度后重试。'); return false; }
      pending = { token, input, controller }; controls(); renderTranscript();
      $('transcript').append(message('user', input, true).node); scroll();
      try {
        const context = runtime.context(base);
        const plan = mode === 'online' ? await model.request({ context, input, signal: controller && controller.signal }) : await offline.respond(context, input);
        if (!pending || token !== generation || state !== base) return false;
        const result = runtime.commit(base, proposal, plan);
        if (!result.ok) throw { code: 'invalid', ruleCode: result.error && result.error.code };
        state = result.state; pending = null; lastFailure = null; save();
        $('free-input').value = ''; beginReveal(result, requestNavigation); return true;
      } catch (error) {
        if (!pending || token !== generation) return false;
        pending = null; renderTranscript(); text('request-error-text', safeFailure(error) + ' 本次对话和世界没有保存或改变。');
        $('request-error').hidden = false; $('request-error').dataset.input = input; controls(); return false;
      }
    }
    available.forEach(item => { const option = el('option', item.title || item.id); option.value = item.id; $('pack-select').append(option); });
    function renderPack() {
      $('legacy-import-button').hidden = pack.id !== 'rain-lab' || !legacy;
      $('pack-select').value = pack.id; text('intro-eyebrow', '内容包说明 · ' + pack.title); text('intro-title', pack.title + '_');
      text('intro-copy', (pack.character && [pack.character.role, pack.character.stance].filter(Boolean).join('。')) || '把想到的东西，慢慢放进这个世界。');
      text('world-pack-label', 'WORLD / ' + pack.id.toUpperCase());
      renderView(visible); renderTranscript(); controls();
    }
    $('free-form').addEventListener('submit', event => { event.preventDefault(); return submit(); });
    $('start-button').addEventListener('click', showConnect); $('connection-button').addEventListener('click', showConnect);
    $('connect-form').addEventListener('submit', event => {
      event.preventDefault(); const password = $('api-key').value; $('api-key').value = '';
      let connected = false; try { connected = model.connect(password); } catch (_) {}
      if (!connected) { text('connection-error', '请输入有效的转发访问密码：8–500 位英文字母、数字或符号，不含空格和引号。'); $('connection-error').hidden = false; return; }
      cancel(null, true); mode = 'online'; $('connect-dialog').close(); renderPack(); $('free-input').focus();
    });
    $('offline-button').addEventListener('click', () => { cancel(null, true); model.disconnect(); mode = 'offline'; $('api-key').value = ''; $('connect-dialog').close(); renderPack(); $('free-input').focus(); });
    $('disconnect-button').addEventListener('click', () => { cancel(null, true); model.disconnect(); mode = null; $('api-key').value = ''; $('connect-dialog').close(); controls(); toast('已断开连接。下次在线对话需要重新输入访问密码。'); });
    $('connect-dialog').addEventListener('close', () => { $('api-key').value = ''; });
    $('connect-dialog').addEventListener('cancel', () => { $('api-key').value = ''; });
    doc.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
    $('cancel-pending').addEventListener('click', () => cancel('已取消，本次内容没有改变世界。'));
    $('cancel-request-button').addEventListener('click', () => { $('request-error').hidden = true; lastFailure = null; controls(); });
    $('retry-button').addEventListener('click', () => submit($('request-error').dataset.input));
    $('fallback-button').addEventListener('click', () => { const input = $('request-error').dataset.input; model.disconnect(); mode = 'offline'; return submit(input); });
    $('skip-reveal').addEventListener('click', () => { if (revealing && revealing.complete) revealing.complete(); });
    $('motion-toggle').addEventListener('click', () => { immediate = !immediate; if (immediate) stopReveal(true); controls(); });
    PANELS.forEach((panel, index) => {
      $('tab-' + panel).addEventListener('click', () => selectPanel(panel, true));
      $('tab-' + panel).addEventListener('keydown', event => { let target; if (event.key === 'ArrowRight') target = (index + 1) % PANELS.length; else if (event.key === 'ArrowLeft') target = (index + PANELS.length - 1) % PANELS.length; else if (event.key === 'Home') target = 0; else if (event.key === 'End') target = PANELS.length - 1; if (target !== undefined) { event.preventDefault(); selectPanel(PANELS[target], true); $('tab-' + PANELS[target]).focus(); } });
    });
    $('pack-select').addEventListener('change', () => {
      const next = packs.get($('pack-select').value); if (!next || next.id === pack.id) return;
      cancel(null, false); pack = next; $('free-input').value = ''; load(); renderPack(); selectPanel('world', true);
      try { if (win.history && win.location) { const url = new URL(win.location.href); url.searchParams.set('pack', pack.id); win.history.replaceState(null, '', url.href); } } catch (_) {}
    });
    $('reset-button').addEventListener('click', () => { text('reset-copy', '这会清空“' + pack.title + '”当前版本在此浏览器里的框架进度。另一试验场和旧版 v0.5.4 存档会保留。'); $('reset-dialog').showModal(); });
    $('confirm-reset').addEventListener('click', () => { cancel(null, false); text('reveal-announcement', ''); model.disconnect(); mode = null; $('api-key').value = ''; state = runtime.create(pack); visible = runtime.view(state); lastFailure = null; saveProtected = false; migrationBackupFailed = false; migrationBackedUp = false; renderCache.clear(); save(); $('reset-dialog').close(); renderPack(); selectPanel('world', true); toast(saveProblem ? '本页已经重新开始，但浏览器没有允许写入；刷新可能恢复上次存档。' : '当前试验场已重新开始。'); });
    $('offline-help-button').addEventListener('click', () => {
      const container = $('offline-examples'); container.replaceChildren();
      (offline.help ? offline.help() : []).forEach(example => { const button = el('button', example); button.type = 'button'; button.addEventListener('click', () => { if (pending || revealing) return; $('free-input').value = example; $('offline-help-dialog').close(); $('free-input').focus(); }); container.append(button); });
      $('offline-help-dialog').showModal();
    });
    $('legacy-import-button').addEventListener('click', () => {
      if (!legacy || pack.id !== 'rain-lab') return;
      const found = legacy.read(storage); legacyCandidate = null;
      if (!found.ok) { toast(found.error === 'LEGACY_MISSING' ? '未找到旧序章存档。请在保存过旧版进度的同一浏览器打开。' : found.error === 'LEGACY_STORAGE_UNAVAILABLE' ? '浏览器没有允许读取本地存档。' : '旧序章存档未通过校验，原数据没有更改。'); return; }
      const checked = runtime.importLegacy(found.projection, pack);
      if (!checked.ok) { toast('旧序章记录无法安全导入这个试验场，原数据没有更改。'); return; }
      legacyCandidate = { state: checked.state, packId: pack.id };
      text('legacy-summary', '找到 ' + found.summary.messages + ' 条对话、' + found.summary.objects + ' 件物件和 ' + found.summary.memories + ' 条记忆。天气：' + found.summary.weatherName + '。');
      $('legacy-dialog').showModal();
    });
    $('legacy-dialog').addEventListener('close', () => { legacyCandidate = null; });
    $('confirm-legacy-import').addEventListener('click', () => {
      if (!legacyCandidate || legacyCandidate.packId !== pack.id) return;
      const imported = legacyCandidate.state; legacyCandidate = null; cancel(null, false); model.disconnect(); mode = null; state = imported; visible = runtime.view(state); saveProtected = false; migrationBackupFailed = false; migrationBackedUp = false; lastFailure = null; renderCache.clear(); save(); $('legacy-dialog').close(); renderPack();
      toast(saveProblem ? '记录已在本页载入，但浏览器没有允许写入存档。旧序章数据保留。' : '旧序章记录已复制到当前试验场，原存档保留。');
    });
    function developer(open) { $('developer-view').hidden = !open; $('developer-toggle').setAttribute('aria-expanded', String(open)); renderDeveloper(); }
    $('developer-toggle').addEventListener('click', () => developer($('developer-view').hidden)); $('developer-close').addEventListener('click', () => developer(false));
    function motionChanged(event) { reduced = !!event.matches; if (reduced) { immediate = true; stopReveal(true); } controls(); }
    if (media && media.addEventListener) media.addEventListener('change', motionChanged);
    function keydown(event) { if ((event.code === 'Space' || event.key === ' ') && !event.repeat && revealing && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes((event.target || {}).tagName)) { event.preventDefault(); if (revealing.complete) revealing.complete(); } }
    function pagehide() {
      if (destroyed) return;
      if (renderer && renderer.suspend) renderer.suspend();
      cancel(null, true); model.disconnect(); mode = null; $('api-key').value = ''; controls();
    }
    function pageshow() { if (!destroyed && renderer && renderer.resume) renderer.resume(); }
    if (win.addEventListener) {
      win.addEventListener('keydown', keydown);
      win.addEventListener('pagehide', pagehide);
      win.addEventListener('pageshow', pageshow);
    }
    load(); renderPack();
    return Object.freeze({ submit, selectPanel: name => selectPanel(name, true), snapshot: () => ({ state, visible, mode, activePanel, busy: !!pending, revealing: !!revealing, currentBeat, lastFailure, storageKey: key() }), destroy() { cancel(null, false); destroyed = true; model.disconnect(); if (renderer && renderer.destroy) renderer.destroy(); if (toastTimer) clearTimer(toastTimer); if (media && media.removeEventListener) media.removeEventListener('change', motionChanged); if (win.removeEventListener) { win.removeEventListener('keydown', keydown); win.removeEventListener('pagehide', pagehide); win.removeEventListener('pageshow', pageshow); } } });
  }
  return Object.freeze({ create });
});
