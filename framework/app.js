(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HerFrameworkUI = api;
  if (root && root.document && root.document.getElementById('framework-app')) {
    try { root.herFrameworkApp = api.create({ window: root, document: root.document }); }
    catch (error) {
      const note = root.document.getElementById('input-note');
      if (note) note.textContent = error && error.message === 'qa_namespace_invalid' ? '隔离 QA 地址无效，未读取或写入任何存档。请使用唯一的 1–32 位英文字母、数字、下划线或连字符 QA 标识。' : '试验场资源没有完整载入，请刷新此页后再试。原版存档不受影响。';
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PANELS = ['world', 'memory', 'focus', 'logs'];
  const WEATHER_LABELS = Object.freeze({ rain: '雨', snow: '雪', mist: '雾', clear: '晴空' });
  const ONLINE_STATUS = Object.freeze({
    unverified: Object.freeze({ button: '在线待验证 · 本页临时设置', label: 'UNVERIFIED / AI', note: '访问密码已临时设置，尚未验证服务。首次发送时验证；每次发送会请求模型。' }),
    responded: Object.freeze({ button: 'AI 已回应 · 本页临时连接', label: 'RESPONSE RECEIVED / AI', note: '每次发送会请求模型 · 只有校验通过的变化会被保留' }),
    auth_rejected: Object.freeze({ button: '认证或权限被拒 · 检查连接', label: 'AUTH REJECTED / AI', note: '上次请求遭认证或权限拒绝。请检查转发服务与上游配置；不能仅凭此判断密码有误。' }),
    failed: Object.freeze({ button: '在线请求未完成 · 未自动重试', label: 'REQUEST FAILED / AI', note: '上次请求未完成。不会自动重试；每次发送会再次请求模型。' })
  });
  const CREDENTIAL_BLOCKED = '这份进度含有当前或先前识别到的连接密码，无法保存。原有记录没有被改写。请先更换密码，并妥善处理已有记录。';
  const FAILURES = Object.freeze({ disconnected: '连接已断开，请重新选择连接方式。', busy: '上一条回应尚未完成。', limit: '本页请求次数已达到上限。', timeout: '等待回应超时。', network: '这次连接没有完成。', response_read: '回应在传输时中断。', auth: '转发服务或上游返回了认证或权限错误，不能仅凭此判断密码是否有误。', quota: '转发服务或模型额度暂不可用。', upstream: '模型服务暂时不可用。', format: '回应格式不符合约定。', truncated: '回应没有完整返回。', empty: '模型没有返回可用的回应。', cancelled: '这次回应已取消。', invalid: '回应中的变化未通过本地规则校验。' });
  const RUNTIME_CODES = new Set(["ANSWER_BOUNDARY", "ANSWER_UNAVAILABLE", "BEATS_INVALID", "CAPABILITY_DISABLED", "CHOICE_INVALID", "CONSENT_REQUIRED", "CONTEXT_CAPACITY", "CURSOR_INVALID", "EVENT_CAPACITY", "EVENT_INVALID", "EVIDENCE_INVALID", "GEOMETRY_INVALID", "IMPORT_ANNOTATION", "IMPORT_FACTS", "IMPORT_INVALID", "IMPORT_MEMORY", "IMPORT_OBJECT", "IMPORT_ORIGIN", "IMPORT_TRANSCRIPT", "IMPORT_WEATHER", "IMPORT_WORLD", "INPUT_INVALID", "LINES_INVALID", "MEMORY_CAPACITY", "OBSERVATION_INVALID", "OPERATION_CAPACITY", "OPERATION_EMPTY", "OPERATION_INVALID", "PACK_INVALID", "PACK_MISMATCH", "PLACEMENT_INVALID", "PLACEMENT_TARGET", "PLAN_INVALID", "PROTOCOL_TEXT", "QUESTION_UNAVAILABLE", "RELATIONSHIP_BOUND", "REPLAY_INVALID", "SAVE_INVALID", "STALE_PROPOSAL", "STATE_INVALID", "TARGET_MISSING", "TEXT_INVALID", "TOPIC_INVALID", "WORLD_CAPACITY"]);
  ['WEATHER_CONFLICT', 'RULES_VERSION_UNSUPPORTED', 'MIGRATION_WEATHER_INCOMPATIBLE', 'PLACEMENT_CAPACITY'].forEach(code => RUNTIME_CODES.add(code));
  ['MEMORY_ALREADY_REMOVED', 'MEMORY_CLAIM_INVALID', 'MEMORY_HANDLE_INVALID', 'MEMORY_IMPORT_INVALID', 'MEMORY_INVALID', 'MEMORY_METADATA_INVALID', 'MEMORY_REMOVE_INVALID', 'MEMORY_SHARED_EVENT_UNVERIFIED', 'MEMORY_STALE_GENERATION', 'MEMORY_SUPPORT_AMBIGUOUS', 'MEMORY_SUPPORT_INVALID', 'RECALL_CAPACITY', 'RECALL_CONTEXT_INVALID', 'RECALL_DAG_INVALID', 'RECALL_EXPOSURE_INVALID', 'RECALL_POLICY_INVALID', 'RECALL_RECORD_INVALID', 'RECALL_SOURCE_INVALID', 'RECALL_SPAN_INVALID'].forEach(code => RUNTIME_CODES.add(code));
  const MIGRATION_PACK_DIGESTS = Object.freeze({
    'rain-lab': Object.freeze({ '1': '402db16c', '2': '362c6f2f', '3': 'd63194b2', '4': '7f91f3a5' }),
    'lantern-lab': Object.freeze({ '1': '8dd7d018', '2': '36792093', '3': 'ce388026', '4': 'd11120d9' })
  });
  const COMPLETION_PACK_DIGESTS = Object.freeze({ 'lantern-lab': 'cae92e8e' });
  const DIAGNOSTIC_STAGES = new Set(['LOCAL_CONTEXT', 'REQUEST', 'NETWORK', 'HTTP', 'RESPONSE_READ', 'ENVELOPE', 'FINAL_CONTENT', 'JSON', 'CANCELLED']);
  const DIAGNOSTIC_CODES = new Set(['CONTEXT_INVALID', 'INPUT_INVALID', 'REQUEST_TOO_LARGE', 'RESPONSE_TOO_LARGE', 'ROOT_INVALID', 'PAYLOAD_REQUIRED', 'PAYLOAD_MIXED', 'OUTPUT_UNSAFE', 'JSON_SYNTAX', 'JSON_BAD_ESCAPE', 'JSON_CONTROL_CHARACTER', 'JSON_UNTERMINATED', 'JSON_TRAILING_CONTENT', 'JSON_DUPLICATE_KEY']);
  const PROXY_DIAGNOSTICS = Object.freeze({ PROXY_AUTH_REQUIRED: 401, PROXY_ORIGIN_DENIED: 403, PROXY_REQUEST_TOO_LARGE: 413, PROXY_DAILY_LIMIT: 429, PROXY_RATE_LIMIT: 429, PROXY_BUSY: 429, PROXY_UPSTREAM_QUOTA_OR_RATE_LIMIT: 429, PROXY_UPSTREAM_REJECTED: 502, PROXY_UPSTREAM_FORMAT: 502, PROXY_UPSTREAM_TOO_LARGE: 502, PROXY_UPSTREAM_UNAVAILABLE: 502, PROXY_BUDGET_UNAVAILABLE: 503, PROXY_SERVICE_UNAVAILABLE: 503, PROXY_UPSTREAM_TIMEOUT: 504 });
  ['TURN_ROOT_FIELDS', 'TURN_LINES_INVALID', 'TURN_ROW_FIELDS', 'TURN_ROW_TEXT', 'TURN_ROW_MODE', 'TURN_ROW_OPERATIONS', 'TURN_OPERATION_LIMIT', 'REPORT_SUPPORT_REQUIRED', 'REPORT_SUPPORT_INVALID', 'REPORT_SUPPORT_AMBIGUOUS', 'WORLD_INTENT_INVALID', 'WORLD_INTENT_SUPPORT_INVALID', 'WORLD_INTENT_SUPPORT_AMBIGUOUS', 'WORLD_INTENT_REQUIRED', 'WORLD_INTENT_DISCUSSION'].forEach(code => DIAGNOSTIC_CODES.add(code));
  const DIAGNOSTIC_PATHS = new Set(['context', 'input', 'request', 'response', 'content', 'root']);
  const OP_LABELS = Object.freeze({ 'world.create': '新增物件', 'world.update': '修改物件', 'world.remove': '移除物件', 'world.annotate': '更新注解', 'weather.set': '改变天气', 'memory.upsert': '写入记忆', 'memory.remove': '移除记忆', 'story.answer': '记录回答', 'story.defer': '暂放问题', 'character.update': '更新角色状态', 'log.note': '记录想法', 'panel.open': '打开面板' });
  function runtimeDiagnostic(detail, rule) {
    if (!detail || detail.stage !== 'RUNTIME' || !RUNTIME_CODES.has(rule)) return null;
    let path;
    const result = { stage: 'RUNTIME' };
    if (rule === 'BEATS_INVALID' && ['BEATS_ARRAY_REQUIRED', 'BEATS_LIMIT'].includes(detail.reason)) path = 'beats';
    else {
      if (!Number.isInteger(detail.beatIndex) || detail.beatIndex < 0 || detail.beatIndex > 3) return null;
      result.beatIndex = detail.beatIndex;
      path = 'beats[' + detail.beatIndex + ']';
      if (rule === 'BEATS_INVALID') {
        if (detail.reason === 'BEAT_FIELDS') { /* The whole beat shape failed. */ }
        else if (['BEAT_LINE_INTEGER', 'BEAT_LINE_RANGE', 'BEAT_LINE_ORDER'].includes(detail.reason)) path += '.afterLine';
        else if (['BEAT_OPERATIONS_ARRAY', 'BEAT_OPERATIONS_EMPTY'].includes(detail.reason)) path += '.operations';
        else return null;
      } else {
        if (!Number.isInteger(detail.operationIndex) || detail.operationIndex < 0 || detail.operationIndex > 11) return null;
        result.operationIndex = detail.operationIndex;
        path += '.operations[' + detail.operationIndex + ']';
        if (rule === 'EVIDENCE_INVALID' && ['EVIDENCE_INPUT_EXCERPT', 'EVIDENCE_INPUT_MISMATCH'].includes(detail.reason)) path += '.evidence';
        else if (detail.reason !== 'OPERATION_REJECTED') return null;
        if (typeof detail.operationType === 'string' && Object.prototype.hasOwnProperty.call(OP_LABELS, detail.operationType)) result.operationType = detail.operationType;
      }
    }
    // Rebuild the display object; never copy model/provider metadata wholesale.
    if (typeof detail.path !== 'string' || detail.path !== path) return null;
    if (['memory.upsert','memory.remove'].includes(result.operationType) && rule === 'OPERATION_INVALID') {
      if (['REQUIRED_FIELD_MISSING','UNKNOWN_FIELD','TYPE_INVALID','STRING_LENGTH_INVALID','ENUM_INVALID','ID_FORMAT_INVALID','NUMBER_RANGE_INVALID','SUPPORT_OFFSETS_UNPAIRED'].includes(detail.memoryReason)) {
        result.memoryReason = detail.memoryReason;
        if (['id','title','body','kind','perspective','evidence','support','support.quote','support.start','support.end'].includes(detail.memoryField)) result.memoryField = detail.memoryField;
      }
    }
    if (['world.create','world.update'].includes(result.operationType) && ['OPERATION_INVALID','TARGET_MISSING','PLACEMENT_INVALID','PLACEMENT_TARGET','PLACEMENT_CAPACITY','GEOMETRY_INVALID','WORLD_CAPACITY'].includes(rule)) {
      if (['SCHEMA_INVALID','OBJECT_TARGET_MISSING','OBJECT_LABEL_USED','REFERENCE_TARGET_MISSING','REFERENCE_LABEL_USED','LANDMARK_MISSING','SELF_TARGET','FOOTPRINT_INVALID','LANDMARK_FOOTPRINT','OUT_OF_BOUNDS','POSITION_OCCUPIED','NO_FREE_POSITION','SEARCH_BUDGET','SEARCH_CHOICE','WORLD_CAPACITY'].includes(detail.geometryReason)) result.geometryReason = detail.geometryReason;
      if (['sky','ground','keep_center','keep_base','window_left','window_right','window_below','above','below','left_of','right_of'].includes(detail.placementAnchor)) result.placementAnchor = detail.placementAnchor;
      if (['auto','exact'].includes(detail.placementPolicy)) result.placementPolicy = detail.placementPolicy;
      if (Number.isInteger(detail.footprintCols) && detail.footprintCols >= 1 && detail.footprintCols <= 72 && Number.isInteger(detail.footprintRows) && detail.footprintRows >= 1 && detail.footprintRows <= 30) { result.footprintCols = detail.footprintCols; result.footprintRows = detail.footprintRows; }
      if (Number.isInteger(detail.occupiedCount) && detail.occupiedCount >= 0 && detail.occupiedCount <= 8) result.occupiedCount = detail.occupiedCount;
    }
    return { ...result, reason: detail.reason, path };
  }
  function list(value) { return Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : []; }
  function string(value, fallback) { return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback || ''; }
  function source(value) { return value && typeof value === 'object' ? string(value.text) : string(value); }
  function create(options) {
    options = options || {};
    const win = options.window || (typeof window !== 'undefined' ? window : {}), doc = options.document || win.document;
    const query = typeof URLSearchParams === 'function' ? new URLSearchParams((win.location || {}).search || '') : null;
    if (!query && (win.location || {}).search) throw new Error('qa_namespace_invalid');
    const qaValues = query ? query.getAll('qa') : [];
    if (qaValues.length > 1 || qaValues.length === 1 && !/^[A-Za-z0-9_-]{1,32}$/.test(qaValues[0])) throw new Error('qa_namespace_invalid');
    const qa = qaValues.length === 1 ? qaValues[0] : null;
    const runtime = options.runtime || win.HerFramework, packs = options.packs || win.HerFrameworkPacks;
    if (typeof runtime?.commitModel !== 'function' || typeof runtime?.contextBudgetBytes !== 'function') throw new Error('runtime_version_mismatch');
    const legacy = options.legacy || win.HerFrameworkLegacy;
    const offline = options.offline || win.HerFrameworkOffline, focus = options.focus || win.HerFrameworkFocus;
    const model = options.model || win.HerFrameworkModel.create();
    if (!['containsCredential', 'redactCredential', 'onCredentialBoundary'].every(name => typeof model[name] === 'function')) throw new Error('model_version_mismatch');
    const timer = options.setTimeout || win.setTimeout.bind(win), clearTimer = options.clearTimeout || win.clearTimeout.bind(win);
    const $ = id => doc.getElementById(id), el = (tag, text, className) => { const node = doc.createElement(tag); if (text !== undefined) node.textContent = string(text); if (className) node.className = className; return node; };
    let storage; try { storage = Object.prototype.hasOwnProperty.call(options, 'storage') ? options.storage : win.localStorage; } catch (_) { storage = null; }
    let lockManager = null, lockAccessFailed = false;
    try { const locks = win.navigator && win.navigator.locks; if (locks !== undefined && locks !== null) { if (typeof locks.request === 'function') lockManager = locks; else lockAccessFailed = true; } } catch (_) { lockAccessFailed = true; }
    const renderer = options.renderer || (win.HerFrameworkRenderer && win.HerFrameworkRenderer.create($('world-canvas'), { window: win }));
    const available = packs.list();
    if (!available.length) throw new Error('packs_missing');
    const desired = query && query.get('pack');
    let pack = packs.get(desired) || packs.get(available[0].id), state, visible;
    let mode = null, onlineStatus = 'unverified', activePanel = 'world', navigation = 0, generation = 0, pending = null, revealing = null;
    let lastFailure = null, currentBeat = null, saveProblem = false, toastTimer = null, destroyed = false, pageHidden = false, unobservedPanel = false, saveProtected = false, legacyCandidate = null, migrationBackupFailed = false, migrationBackedUp = false;
    const media = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let reduced = !!(media && media.matches), immediate = reduced;
    const renderCache = new Map(), panelObservations = new Map(), parkedPanelObservations = new Map();
    let pendingPanelObservation = null;
    let expectedRaw = null, baselineKnown = false, baselineState = null, saveConflict = false, pendingCommit = null, pendingMigration = null;
    let retryInput = null, diagnosticsProtected = false;
    const blockedStates = new WeakSet(), blockedSaveSignatures = new Set();
    let checkedStates = new WeakSet();
    // Keep only compact fingerprints of blocked canonical data for later
    // refusal, never an erased credential for filtering. A collision refuses
    // saving; it cannot permit it. Canonical evidence itself is not edited.
    function saveSignature(save) {
      const raw = JSON.stringify(save); let a = 2166136261, b = 5381;
      for (let i = 0; i < raw.length; i++) { a = Math.imul(a ^ raw.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ raw.charCodeAt(i); }
      return raw.length + ':' + (a >>> 0) + ':' + (b >>> 0);
    }
    function blockedSave(save, alreadyBlocked = false) {
      const matched = model.containsCredential(save);
      if (!alreadyBlocked && !matched && !blockedSaveSignatures.size) return false;
      const signature = saveSignature(save);
      if (alreadyBlocked || matched) blockedSaveSignatures.add(signature);
      return blockedSaveSignatures.has(signature);
    }
    function blockedState(candidate) {
      if (!candidate) return false;
      if (blockedStates.has(candidate)) return true;
      if (checkedStates.has(candidate)) return false;
      if (blockedSave(runtime.serialize(candidate))) { blockedStates.add(candidate); return true; }
      checkedStates.add(candidate);
      return false;
    }
    function safeDraft(value) { return model.redactCredential(typeof value === 'string' ? value : ''); }
    function clearRetry() { retryInput = null; delete $('request-error').dataset.input; $('retry-button').disabled = true; $('fallback-button').disabled = true; }
    function protectBuffers(phase) {
      if (phase === 'connected') checkedStates = new WeakSet();
      if (phase === 'before-clear' || phase === 'connected') {
        onlineStatus = 'unverified';
        generation++;
        if (pending && pending.controller) pending.controller.abort();
        pending = null;
      }
      $('free-input').value = safeDraft($('free-input').value);
      // Datasets from an older UI are never accepted as retry authority.
      delete $('request-error').dataset.input;
      if (retryInput !== null && model.containsCredential(retryInput)) clearRetry();
      if (pending) pending.input = safeDraft(pending.input);
      if (pendingCommit) pendingCommit.credentialBlocked = blockedSave(pendingCommit.save, pendingCommit.credentialBlocked);
      blockedState(state);
      if (legacyCandidate) blockedState(legacyCandidate.state);
      if (model.containsCredential($('developer-content').textContent)) diagnosticsProtected = true;
      if (diagnosticsProtected || state && blockedStates.has(state)) text('developer-content', '含已识别密码的内容已保护，诊断内容已隐藏。');
      else text('developer-content', safeDraft($('developer-content').textContent));
      if (phase === 'before-clear' || phase === 'connected') {
        invalidateCommit();
      }
    }
    const stopCredentialBoundary = model.onCredentialBoundary(protectBuffers);
    function key() { return qa ? `her-world.framework.qa.v4:${qa}:${pack.id}:${pack.version}` : `her-world.framework.v4:${pack.id}:${pack.version}`; }
    function text(id, value) { const node = $(id), next = string(value); if (node && node.textContent !== next) node.textContent = next; }
    function toast(message) { text('toast', message); $('toast').hidden = false; if (toastTimer) clearTimer(toastTimer); toastTimer = timer(() => { $('toast').hidden = true; }, 5500); }
    function migrationBackup(raw, migration) {
      // Only locally generated, known migration metadata can select a backup key.
      try {
        if (blockedSave(JSON.parse(raw))) return false;
        const fields = ['type', 'fromRulesVersion', 'toRulesVersion', 'fromPackDigest', 'toPackDigest'];
        if (!migration || Object.keys(migration).length !== fields.length || !fields.every(field => Object.prototype.hasOwnProperty.call(migration, field))) return false;
        const known = MIGRATION_PACK_DIGESTS[pack.id], original = JSON.parse(raw).pack, current = runtime.serialize(state).pack;
        const memoryMigration = migration.type === 'memory-provenance-v4' && ['1', '2', '3'].includes(migration.fromRulesVersion) && migration.toPackDigest === (known && known['4']);
        const completionMigration = !!COMPLETION_PACK_DIGESTS[pack.id] && migration.type === 'current-object-completion-v2' && ['1', '2', '3', '4'].includes(migration.fromRulesVersion) && migration.toPackDigest === COMPLETION_PACK_DIGESTS[pack.id];
        const recognized = known && pack.version === '1.0.0' && pack.rulesVersion === '4'
          && (memoryMigration || completionMigration) && migration.toRulesVersion === '4'
          && migration.fromPackDigest === known[migration.fromRulesVersion]
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
    function saveStatus(initial = false) {
      const limited = !lockManager && !lockAccessFailed ? ' · 多页保护有限' : '';
      text('save-status', saveConflict ? '另一页面已更新 · 本页未保存' : pendingCommit ? '等待保存 · 尚未确认' : pendingMigration && !migrationBackupFailed ? '旧存档已读取 · 待备份后保存' : saveProtected ? migrationBackupFailed ? '旧存档备份失败 · 本页未保存' : '原存档已保护 · 本页未保存' : saveProblem ? '存储不可用 · 仅本页保留' : migrationBackedUp ? '旧存档已备份 · 可继续保存' : (initial ? 'LOCAL SAVE · 本地保存' : 'LOCAL SAVE · 已保存') + limited);
      $('save-conflict').hidden = !saveConflict;
    }
    function invalidateCommit() {
      const commit = pendingCommit;
      if (!commit) return;
      pendingCommit = null; commit.cancelled = true;
      if (commit.controller) commit.controller.abort();
    }
    function hasUnsavedState() { return !!state && state !== baselineState; }
    function conflict() {
      if (saveConflict) return false;
      // Latch first: cancellation and observation settlement must never save
      // an old branch over another page's newer bytes.
      saveConflict = true; invalidateCommit(); generation++;
      if (pending) {
        $('free-input').value = safeDraft(pending.input);
        if (pending.controller) pending.controller.abort();
      }
      pending = null; panelObservations.clear(); unobservedPanel = false;
      stopReveal(false);
      lastFailure = { code: 'save_conflict' }; $('request-error').hidden = true;
      renderView(runtime.view(state)); renderTranscript(); saveStatus(); controls();
      return false;
    }
    function sameStoredBase() {
      if (saveConflict) return false;
      if (!storage) throw new Error('blocked');
      const raw = storage.getItem(key());
      if (!baselineKnown && raw === null) { expectedRaw = null; baselineKnown = true; }
      return baselineKnown && raw === expectedRaw ? true : conflict();
    }
    function checkStoredBase() {
      try { return sameStoredBase(); }
      catch (_) { saveProblem = true; saveStatus(); return true; } // Remain playable in memory; save() still requires a successful read.
    }
    function commitCandidate(candidate, apply, options = {}) {
      if (blockedState(candidate) || !options.replaceProtected && blockedState(state)) { toast(CREDENTIAL_BLOCKED); return false; }
      const commit = { storageKey: key(), pack, base: state, generation, save: runtime.serialize(candidate), credentialBlocked: false, cancelled: false, controller: typeof AbortController === 'function' ? new AbortController() : null };
      const current = () => !destroyed && !commit.cancelled && commit.generation === generation && commit.pack === pack && commit.storageKey === key() && state === commit.base && !saveConflict;
      const install = saved => {
        state = candidate;
        apply(saved); saveStatus(); controls(); return true;
      };
      const write = () => {
        if (!current() || lockManager && pageHidden) { return false; }
        if (blockedSave(commit.save, commit.credentialBlocked)) { commit.credentialBlocked = true; toast(CREDENTIAL_BLOCKED); return false; }
        try { if (!sameStoredBase()) { return false; } }
        catch (_) { saveProblem = true; return install(false); }
        if (pendingMigration && !options.replaceProtected) {
          migrationBackedUp = migrationBackup(pendingMigration.raw, pendingMigration.migration);
          migrationBackupFailed = !migrationBackedUp; saveProtected = !migrationBackedUp;
          if (migrationBackedUp) pendingMigration = null;
        }
        if (saveProtected && !options.replaceProtected) return install(false);
        const raw = JSON.stringify(commit.save);
        try {
          // With Web Locks this complete read/compare/write/readback section is
          // exclusive among cooperating pages. The no-API path remains only a
          // sequential stale-write guard; older non-locking pages are outside it.
          if (!sameStoredBase()) { return false; }
          storage.setItem(commit.storageKey, raw);
          const written = storage.getItem(commit.storageKey);
          if (written !== raw) {
            if (written !== expectedRaw) { return conflict(); }
            throw new Error('write_unverified');
          }
          expectedRaw = raw; baselineKnown = true; baselineState = candidate; saveProblem = false;
          saveProtected = false; migrationBackedUp = false; migrationBackupFailed = false; pendingMigration = null;
        } catch (_) { saveProblem = true; return install(false); }
        return install(true);
      };
      if (!lockManager && !lockAccessFailed) return write();
      if (pendingCommit || pageHidden) { return false; }
      pendingCommit = commit; saveStatus(); controls();
      let request;
      try {
        if (!lockManager) throw new Error('lock_unavailable');
        request = lockManager.request('her-world-save:' + commit.storageKey, { mode: 'exclusive', ...(commit.controller ? { signal: commit.controller.signal } : {}) }, write);
      } catch (_) { request = Promise.reject(new Error('lock_unavailable')); }
      return Promise.resolve(request).catch(() => {
        if (current()) saveProblem = true;
        return false; // A present-but-failing API must never fall back to an unlocked write.
      }).finally(() => {
        if (pendingCommit !== commit) return;
        pendingCommit = null; saveStatus(); controls();
        if (!pending && !revealing && !saveConflict && panelObservations.size) flushPanelObservations();
      });
    }
    function loadLatest() {
      let raw, restored;
      try {
        if (!storage) throw new Error('blocked');
        raw = storage.getItem(key());
        restored = raw === null ? { ok: true, state: runtime.create(pack) } : runtime.restore(raw, pack);
        if (!restored.ok) { toast('另一页面的存档未通过校验，无法载入。本页画面和原数据均已保留。'); return; }
      } catch (_) { toast('浏览器暂时不允许读取存档。本页内容已保留。'); return; }
      const draft = safeDraft($('free-input').value);
      generation++; if (pending && pending.controller) pending.controller.abort();
      pending = null; panelObservations.clear(); parkedPanelObservations.delete(key()); unobservedPanel = false; stopReveal(false);
      // load() is deliberately read-only for the active save; it retains the
      // existing verified-backup rule for historical migrations.
      load(raw, restored); $('free-input').value = draft; renderPack();
      toast('已载入本地最新进度，连接和草稿仍在。原先的本页画面已替换。');
    }
    function load(rawOverride, restoredOverride) {
      invalidateCommit();
      text('reveal-announcement', '');
      panelObservations.clear(); pendingPanelObservation = null; unobservedPanel = false;
      saveProblem = false; saveProtected = false; migrationBackupFailed = false; migrationBackedUp = false; lastFailure = null; saveConflict = false; baselineKnown = false; expectedRaw = null; pendingMigration = null;
      state = runtime.create(pack);
      try {
        if (!storage) throw new Error('blocked');
        const raw = rawOverride === undefined ? storage.getItem(key()) : rawOverride; expectedRaw = raw; baselineKnown = true;
        if (raw !== null) {
          const restored = restoredOverride || runtime.restore(raw, pack);
          if (restored.ok) {
            state = restored.state;
            if (restored.migration && (lockManager || lockAccessFailed)) {
              pendingMigration = { raw, migration: restored.migration }; saveProtected = true;
            } else if (restored.migration) {
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
      visible = runtime.view(state); currentBeat = null; renderCache.clear(); baselineState = state;
      saveStatus(true);
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
    function changeReceipt(row, eventId, line) {
      const event = state.events.find(item => item.id === eventId && item.type === 'turn');
      const beat = event && event.plan.beats.find(item => item.afterLine === line);
      const counts = new Map();
      for (const op of (beat && beat.operations) || []) if (['world.create','world.update','world.remove','weather.set'].includes(op.type)) counts.set(op.type, (counts.get(op.type) || 0) + 1);
      if (!counts.size) return;
      const label = [...counts].map(([type,count]) => OP_LABELS[type] + (count > 1 ? ' ×' + count : '')).join(' · ');
      const receipt = el('small', '本句已落实：' + label, 'change-receipt');
      receipt.setAttribute('aria-label', '本句已验证的世界变化'); row.node.append(receipt);
    }
    function scroll() { const t = $('transcript'); t.scrollTop = t.scrollHeight; }
    function renderTranscript() {
      const transcript = $('transcript'); transcript.replaceChildren();
      if (!(visible.transcript || []).length) transcript.append(message('system', '内容包说明 · ' + ((pack.character && [pack.character.role, pack.character.stance].filter(Boolean).join('。')) || pack.title)).node);
      list(visible.transcript).forEach(item => { const row = message(item.role, item.text); if (item.role === 'character') changeReceipt(row, item.eventId, item.line); transcript.append(row.node); });
      scroll();
    }
    function renderWorld(view) {
      const world = view.world || {}, objects = list(world.objects), weather = world.weather || {};
      cached('world', world, () => {
        text('object-count', String(objects.length).padStart(2, '0'));
        const weatherKind = WEATHER_LABELS[weather.kind] || '未知天气';
        const weatherName = weather.name ? '名称：' + weather.name : '';
        const weatherState = weather.paused ? '暂停' : Number(weather.intensity) > 0 ? '强度 ' + weather.intensity : '安静';
        text('weather-status', weatherKind + ' / ' + weatherState + (weatherName ? ' · ' + weatherName : ''));
        text('world-status', objects.length + ' objects · ' + weatherKind + ' · ' + weatherState);
        text('world-caption', weather.name || (objects.length ? objects[objects.length - 1].label : '一处可以慢慢填满的空白'));
        text('world-code', 'world.objects = ' + objects.length + ';');
        text('world-summary', '天气：' + weatherKind + ' · ' + weatherState + (weatherName ? '　' + weatherName : '') + '　物件 ' + objects.length + ' / ' + (world.capacity || '—') + (source(weather.source) ? '　来源：' + source(weather.source) : ''));
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
          const kinds = { concept: '学到的概念', preference: '偏好', experience: '共同经历', promise: '约定', note: '记下的片段' };
          const perspectives = { player_report: '你的原话', shared_event: '已发生的世界变化', character_interpretation: '她的理解，可被纠正' };
          const bodyLabel = perspectives[memory.perspective] || '已保留的历史记录';
          const row = card('她记作：' + (memory.title || memory.id), bodyLabel + '：' + memory.body, source(memory.source) || '未保留原始来源');
          row.append(el('p', '她的归类：' + (kinds[memory.kind] || '历史记录') + (memory.generation > 1 ? ' · 第 ' + memory.generation + ' 次重新记下' : '') + (memory.recallHandle ? ' · 引用 ' + memory.recallHandle : ''), 'muted small'));
          if (memory.recallStatus === 'withheld') row.append(el('p', '关联来源已被忘记，当前不参与回应。你可以用新的明确说法修正它。', 'source'));
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
      cached('question', current || null, () => {
        $('story-invitation').hidden = !current;
        text('invitation-question', current ? current.text + (current.deferred ? '（已暂放）' : '') : '');
        $('invitation-save-note').hidden = !current || current.kind !== 'consent';
        text('invitation-save-note', '来访者引用是故事中的选择，不是本地保存开关。对话和选择仍按本地存档规则保存；拒绝或暂缓本身不会删除已有记忆与历史。');
      });
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
      if (diagnosticsProtected || blockedState(state)) { text('developer-content', '含已识别密码的内容已保护，诊断内容已隐藏。'); return; }
      const c = visible.character || {}, events = list(state.events), latest = events[events.length - 1];
      const data = {
        contentPack: pack.id + '@' + pack.version,
        persistence: { mode: lockAccessFailed ? 'lock-api-unavailable' : lockManager ? 'web-locks' : 'sequential-fallback', saving: !!pendingCommit, conflict: saveConflict, isolatedQA: qa !== null },
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
      if (model.containsCredential(data)) { diagnosticsProtected = true; text('developer-content', '含已识别密码的内容已保护，诊断内容已隐藏。'); }
      else text('developer-content', JSON.stringify(data, null, 2));
    }
    function renderView(view) { visible = view; renderWorld(view); renderMemory(view); renderLogs(view); renderFocus(view); renderInvitation(view); renderDeveloper(); }
    function controls() {
      const busy = !!(pending || revealing || pendingCommit);
      const online = ONLINE_STATUS[onlineStatus];
      $('free-send').disabled = busy || saveConflict; $('free-input').disabled = busy;
      $('pack-select').disabled = saveConflict || hasUnsavedState();
      list($('hint-list').children).forEach(button => { button.disabled = busy; });
      $('cancel-pending').hidden = !(pending || pendingCommit);
      $('offline-help-button').hidden = mode !== 'offline'; $('offline-help-button').disabled = busy;
      $('intro').hidden = !!mode || list(visible.transcript).length > 0;
      $('transcript').hidden = !$('intro').hidden;
      $('response-area').hidden = !$('intro').hidden;
      $('start-button').hidden = !!mode;
      $('disconnect-button').hidden = !model.connected();
      $('retry-button').disabled = retryInput === null || !model.connected(); $('fallback-button').disabled = retryInput === null;
      text('connection-button', mode === 'online' ? online.button : mode === 'offline' ? '离线规则试玩 · 有限测试表达' : '未连接 · 选择试玩模式');
      text('connection-label', pendingCommit ? 'WAITING FOR LOCAL SAVE' : pending ? 'WAITING FOR RESPONSE' : revealing ? 'SHE IS SPEAKING' : mode === 'online' ? online.label : mode === 'offline' ? 'OFFLINE / RULES' : 'WAITING FOR YOU');
      text('input-note', pendingCommit ? '回应已校验，正在等待本地保存。可以取消；取消后回应不会提交，输入仍在。' : pending ? '正在等待回应，尚未改变世界。可以取消。' : revealing ? '变化会跟随对应的那一句出现，按空格可显示本句。' : mode === 'offline' ? '离线规则只理解有限表达 · 提示只填入，不会发送' : mode === 'online' ? online.note : '尚未选择连接方式 · 可以先写下想说的话');
      const motionOff = immediate || reduced;
      $('motion-toggle').setAttribute('aria-pressed', String(motionOff)); $('motion-toggle').disabled = reduced;
      $('motion-toggle').setAttribute('title', reduced ? '系统已开启减少动态效果' : motionOff ? '恢复逐句文字和场景动画' : '暂停场景动画并立即显示文字');
      text('motion-toggle', motionOff ? '静态显示' : '动态显示');
      if (renderer && renderer.setReducedMotion) renderer.setReducedMotion(motionOff);
      renderDeveloper();
    }
    function selectPanel(name, manual, deferObservation) {
      name = name === 'character' ? 'focus' : name;
      if (!PANELS.includes(name)) return;
      if (manual) { navigation++; unobservedPanel = true; }
      activePanel = name;
      PANELS.forEach(panel => { const selected = panel === name; $('panel-' + panel).hidden = !selected; $('tab-' + panel).classList.toggle('active', selected); $('tab-' + panel).setAttribute('aria-selected', String(selected)); $('tab-' + panel).setAttribute('tabindex', selected ? '0' : '-1'); });
      if (!manual) unobservedPanel = true;
      // Manual visits and paced sentence frames remain on screen for the user.
      // Instant multi-line reveals only expose their final selected panel.
      if ((manual || !revealing || !(immediate || reduced)) && queuePanelObservation(true)) unobservedPanel = false;
      if (!pending && !revealing && !deferObservation) observePanel();
    }
    function panelCanBeObserved() { return !saveConflict && !destroyed && !pageHidden && doc.visibilityState !== 'hidden'; }
    function queuePanelObservation(explicit) {
      if (!panelCanBeObserved()) return false;
      const panel = activePanel === 'focus' ? 'character' : activePanel;
      const eligible = list(visible.pendingQuestions).filter(q => q.completion && q.completion.type === 'ui' && q.completion.panel === panel).map(q => q.id);
      if (!eligible.length) return false;
      const questions = panelObservations.get(panel) || new Set();
      eligible.forEach(id => questions.add(id)); panelObservations.set(panel, questions); return true;
    }
    function sameObservationBase(observation) {
      return observation.raw === expectedRaw && (observation.base === state || JSON.stringify(runtime.serialize(observation.base)) === JSON.stringify(runtime.serialize(state)));
    }
    function mergePanelObservations(target, visits) {
      for (const [panel, ids] of visits) {
        const questions = target.get(panel) || new Set();
        ids.forEach(id => questions.add(id)); target.set(panel, questions);
      }
    }
    function parkPanelObservations() {
      // One receipt per pack for question IDs already shown on this exact base.
      // It survives same-page navigation / bfcache, not a hard page close.
      const prior = parkedPanelObservations.get(key()), visits = new Map();
      if (prior && sameObservationBase(prior)) mergePanelObservations(visits, prior.visits);
      parkedPanelObservations.delete(key());
      mergePanelObservations(visits, panelObservations);
      if (pendingPanelObservation && pendingPanelObservation.commit === pendingCommit && pendingCommit && !pendingCommit.cancelled && sameObservationBase(pendingPanelObservation)) mergePanelObservations(visits, pendingPanelObservation.visits);
      if (visits.size) parkedPanelObservations.set(key(), { raw: expectedRaw, base: state, visits });
    }
    function resumePanelObservations() {
      const observation = parkedPanelObservations.get(key());
      if (!observation) return;
      // Discard mismatches permanently, even if stored bytes later roll back.
      parkedPanelObservations.delete(key());
      if (checkStoredBase() && sameObservationBase(observation)) mergePanelObservations(panelObservations, observation.visits);
    }
    function flushPanelObservations(show = true, discardChanges = false) {
      if (destroyed || pending || revealing || pendingCommit || !checkStoredBase()) return;
      const visits = [...panelObservations]; panelObservations.clear();
      let changed = false, failed = false, candidate = state;
      for (const [panel, questions] of visits) {
        try {
          const eligible = new Set(list(runtime.view(candidate).pendingQuestions).filter(q => q.completion && q.completion.type === 'ui' && q.completion.panel === panel).map(q => q.id));
          const questionIds = [...questions].filter(id => eligible.has(id));
          if (!questionIds.length) continue;
          const next = runtime.observe(candidate, { type: 'panel.viewed', panel, questionIds });
          if (next !== candidate) { candidate = next; changed = true; }
        } catch (error) { failed = true; lastFailure = { code: 'observation_invalid', rule: error && RUNTIME_CODES.has(error.code) ? error.code : 'OBSERVATION_INVALID' }; }
      }
      if (changed && discardChanges) return;
      if (changed) {
        const observation = { raw: expectedRaw, base: state, visits, commit: null };
        pendingPanelObservation = observation;
        const clear = () => { if (pendingPanelObservation === observation) pendingPanelObservation = null; };
        const committed = commitCandidate(candidate, () => { clear(); if (show) renderView(runtime.view(state)); });
        observation.commit = pendingCommit;
        if (committed && typeof committed.then === 'function') return committed.then(accepted => { clear(); return accepted; });
        clear(); return committed;
      }
      if (show && failed) renderView(runtime.view(state));
    }
    function observePanel() {
      if (panelCanBeObserved()) { queuePanelObservation(unobservedPanel); unobservedPanel = false; }
      flushPanelObservations();
    }
    function showConnect() { text('connection-error', ''); $('connection-error').hidden = true; $('connect-dialog').showModal(); }
    function safeFailure(error) {
      const data = (object, name) => { try { const property = object && Object.getOwnPropertyDescriptor(object, name); return property && Object.prototype.hasOwnProperty.call(property, 'value') ? property.value : undefined; } catch (_) { return undefined; } };
      const suppliedCode = data(error, 'code'), status = data(error, 'httpStatus'), rule = data(error, 'ruleCode');
      const code = typeof suppliedCode === 'string' && Object.prototype.hasOwnProperty.call(FAILURES, suppliedCode) ? suppliedCode : 'invalid';
      lastFailure = { code };
      if (Number.isInteger(status) && status >= 100 && status <= 599) lastFailure.httpStatus = status;
      if (code === 'invalid' && RUNTIME_CODES.has(rule)) lastFailure.rule = rule;
      const suppliedDetail = data(error, 'diagnostic'), detail = {};
      for (const name of ['stage','code','path','rowIndex','linesReason','reason','beatIndex','operationIndex','operationType','memoryReason','memoryField','geometryReason','placementAnchor','placementPolicy','footprintCols','footprintRows','occupiedCount']) {
        const value = data(suppliedDetail, name);
        if (typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) detail[name] = value;
      }
      if (detail && DIAGNOSTIC_STAGES.has(detail.stage)) {
        lastFailure.stage = detail.stage;
        if (DIAGNOSTIC_CODES.has(detail.code)) lastFailure.detail = detail.code;
        else if (detail.stage === 'HTTP' && detail.path === 'response' && Object.prototype.hasOwnProperty.call(PROXY_DIAGNOSTICS, detail.code) && PROXY_DIAGNOSTICS[detail.code] === lastFailure.httpStatus) lastFailure.detail = detail.code;
        if (DIAGNOSTIC_PATHS.has(detail.path)) lastFailure.path = detail.path;
        if (detail.stage === 'JSON' && detail.path === 'content' && ['TURN_ROW_FIELDS', 'TURN_ROW_TEXT', 'TURN_ROW_MODE', 'TURN_ROW_OPERATIONS', 'TURN_OPERATION_LIMIT', 'REPORT_SUPPORT_REQUIRED', 'REPORT_SUPPORT_INVALID', 'REPORT_SUPPORT_AMBIGUOUS', 'WORLD_INTENT_REQUIRED', 'WORLD_INTENT_DISCUSSION'].includes(detail.code) && Number.isInteger(detail.rowIndex) && detail.rowIndex >= 0 && detail.rowIndex <= 3) lastFailure.rowIndex = detail.rowIndex;
        if (detail.stage === 'JSON' && detail.path === 'content' && detail.code === 'TURN_LINES_INVALID' && ['LINES_ARRAY_REQUIRED', 'LINES_EMPTY', 'LINES_LIMIT'].includes(detail.linesReason)) lastFailure.linesReason = detail.linesReason;
      }
      const runtimeDetail = runtimeDiagnostic(detail, lastFailure.rule);
      if (runtimeDetail) Object.assign(lastFailure, runtimeDetail);
      const explanation = lastFailure.rule === 'PLACEMENT_CAPACITY' ? '这次没有找到能安全放下这些物件的位置。可以缩小物件、换个位置，或先移走一些物件再试。' : lastFailure.rule === 'MEMORY_HANDLE_INVALID' ? '这个记忆引用已失效或不在当前列表中。请查看下方记忆面板，使用那条记录现在显示的引用编号。' : FAILURES[code];
      return (lastFailure.httpStatus ? 'HTTP ' + lastFailure.httpStatus + ' · ' : '') + explanation;
    }
    function stopReveal(settle) {
      if (!revealing) return;
      const old = revealing; revealing = null;
      if (old.timer) clearTimer(old.timer);
      $('reveal-controls').hidden = true; currentBeat = null;
      if (settle) {
        renderView(runtime.view(state)); renderTranscript();
        // Settling accepts the remaining sentence frames just as their normal
        // reveal would. A later manual visit still owns the selected panel.
        const finalFrame = old.frames[old.frames.length - 1];
        if (finalFrame && finalFrame.panel && navigation === old.requestNavigation) selectPanel(finalFrame.panel, false, true);
        text('reveal-announcement', old.lines[old.lines.length - 1]);
        observePanel();
      }
    }
    function cancel(messageText, settle, leaving = false) {
      if (!checkStoredBase()) return;
      if (leaving) parkPanelObservations(); else parkedPanelObservations.delete(key());
      pendingPanelObservation = null;
      const wasCommitting = !!pendingCommit;
      invalidateCommit();
      generation++;
      if (pending && pending.controller) pending.controller.abort();
      const wasRevealing = !!revealing;
      pending = null; stopReveal(settle !== false);
      if (wasCommitting) { flushPanelObservations(false, true); unobservedPanel = false; }
      else if (settle === false) { flushPanelObservations(false); unobservedPanel = false; }
      else if (!wasRevealing) observePanel();
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
          const spoken = list(frame.transcript).filter(item => item.role === 'character').slice(-1)[0];
          if (spoken) changeReceipt(r.row, spoken.eventId, spoken.line);
          currentBeat = { line: r.index + 1, total: r.lines.length, phase: 'accepted' }; renderDeveloper();
          if (frame.panel && navigation === r.requestNavigation) selectPanel(frame.panel, false);
          if (!(immediate || reduced)) queuePanelObservation(false);
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
      if (destroyed || pending || revealing || pendingCommit) return false;
      const input = inputOverride === undefined ? $('free-input').value.trim() : inputOverride;
      if (!input || Array.from(input).length > 200) { toast('请写下 1–200 个字。'); return false; }
      if (model.containsCredential(input)) {
        protectBuffers('input'); clearRetry();
        text('request-error-text', safeFailure({ code: 'format', diagnostic: { stage: 'LOCAL_CONTEXT', code: 'OUTPUT_UNSAFE', path: 'input' } }) + ' 输入含有连接密码，已移除；请重新编辑后发送。');
        $('request-error').hidden = false; controls(); return false;
      }
      if (blockedState(state)) { clearRetry(); toast(CREDENTIAL_BLOCKED); return false; }
      if (!checkStoredBase()) return false;
      if (state.events.length >= runtime.constants.MAX_EVENTS) { toast('当前存档已达到事件上限。本次没有发送请求，历史记录保持不变。可以继续查看；重新开始需要单独确认。'); return false; }
      if (!mode) { showConnect(); return false; }
      $('request-error').hidden = true; lastFailure = null; clearRetry();
      const token = ++generation, requestNavigation = navigation;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const base = state; let proposal, receivedResponse = false;
      try { proposal = runtime.propose(base, { text: input }); }
      catch (_) { toast('这句话暂时无法提交，请检查长度后重试。'); return false; }
      pending = { token, input, controller }; controls(); renderTranscript();
      $('transcript').append(message('user', input, true).node); scroll();
      try {
        const context = runtime.context(base);
        const plan = mode === 'online' ? await model.request({ context, input, signal: controller && controller.signal }) : await offline.respond(context, input);
        if (!pending || token !== generation || state !== base || !checkStoredBase()) return false;
        // A locally accepted password is only configuration. Record a service
        // response only for this still-current request, before local game rules.
        if (mode === 'online') { receivedResponse = true; onlineStatus = 'responded'; }
        const result = mode === 'online' ? runtime.commitModel(base, proposal, plan) : runtime.commit(base, proposal, plan);
        if (!result.ok) throw { code: 'invalid', ruleCode: result.error && result.error.code, diagnostic: result.error && result.error.diagnostic };
        const accepted = await commitCandidate(result.state, () => { pending = null; lastFailure = null; $('free-input').value = ''; beginReveal(result, requestNavigation); });
        if (!accepted && pending && token === generation) { pending = null; $('free-input').value = safeDraft(input); renderTranscript(); controls(); saveStatus(); toast('回应未提交，世界没有改变，输入仍在。请先处理保存问题，再决定是否重试。'); }
        return accepted;
      } catch (error) {
        if (!pending || token !== generation || !checkStoredBase()) return false;
        pending = null; renderTranscript(); text('request-error-text', safeFailure(error) + ' 本次对话和世界没有保存或改变。');
        if (mode === 'online' && !receivedResponse && lastFailure.code !== 'cancelled') {
          onlineStatus = lastFailure.code === 'auth' && [401, 403].includes(lastFailure.httpStatus) && lastFailure.stage === 'HTTP' ? 'auth_rejected' : 'failed';
        }
        const rejectedCredential = model.containsCredential(input) || lastFailure.stage === 'LOCAL_CONTEXT' && lastFailure.detail === 'OUTPUT_UNSAFE';
        if (rejectedCredential) { protectBuffers('input'); clearRetry(); } else retryInput = input;
        $('request-error').hidden = false; observePanel(); controls(); return false;
      }
    }
    available.forEach(item => { const option = el('option', item.title || item.id); option.value = item.id; $('pack-select').append(option); });
    function renderPack() {
      $('home-link').setAttribute('href', qa === null ? './framework.html' : './framework.html?qa=' + encodeURIComponent(qa) + '&pack=' + encodeURIComponent(pack.id));
      $('legacy-import-button').hidden = qa !== null || pack.id !== 'rain-lab' || !legacy;
      $('qa-banner').hidden = qa === null; text('qa-namespace', qa || ''); $('connect-form').hidden = qa !== null;
      $('pack-select').value = pack.id; text('intro-eyebrow', '内容包说明 · ' + pack.title); text('intro-title', pack.title + '_');
      text('intro-copy', (pack.character && [pack.character.role, pack.character.stance].filter(Boolean).join('。')) || '把想到的东西，慢慢放进这个世界。');
      text('world-pack-label', 'WORLD / ' + pack.id.toUpperCase());
      renderView(visible); renderTranscript(); controls();
    }
    $('free-form').addEventListener('submit', event => { event.preventDefault(); return submit(); });
    $('start-button').addEventListener('click', showConnect); $('connection-button').addEventListener('click', showConnect);
    $('connect-form').addEventListener('submit', event => {
      event.preventDefault(); if (qa !== null) { $('api-key').value = ''; toast('隔离 QA 仅使用离线规则，不建立模型连接。'); return; } const password = $('api-key').value; $('api-key').value = '';
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
    $('cancel-request-button').addEventListener('click', () => { $('request-error').hidden = true; lastFailure = null; clearRetry(); controls(); });
    $('retry-button').addEventListener('click', () => retryInput === null ? false : submit(retryInput));
    $('fallback-button').addEventListener('click', () => {
      if (retryInput === null) return false;
      if (model.containsCredential(retryInput)) { protectBuffers('input'); clearRetry(); return false; }
      const input = retryInput; model.disconnect(); mode = 'offline'; return submit(input);
    });
    $('skip-reveal').addEventListener('click', () => { if (revealing && revealing.complete) revealing.complete(); });
    $('motion-toggle').addEventListener('click', () => { immediate = !immediate; if (immediate) stopReveal(true); controls(); });
    PANELS.forEach((panel, index) => {
      $('tab-' + panel).addEventListener('click', () => selectPanel(panel, true));
      $('tab-' + panel).addEventListener('keydown', event => { let target; if (event.key === 'ArrowRight') target = (index + 1) % PANELS.length; else if (event.key === 'ArrowLeft') target = (index + PANELS.length - 1) % PANELS.length; else if (event.key === 'Home') target = 0; else if (event.key === 'End') target = PANELS.length - 1; if (target !== undefined) { event.preventDefault(); selectPanel(PANELS[target], true); $('tab-' + PANELS[target]).focus(); } });
    });
    $('pack-select').addEventListener('change', () => {
      const next = packs.get($('pack-select').value); if (!next || next.id === pack.id) return;
      if (saveConflict || hasUnsavedState()) { $('pack-select').value = pack.id; toast('本页有未保存内容或保存冲突，暂时不能切换。请先解决保存问题，当前画面和输入仍保留。'); return; }
      const draft = safeDraft($('free-input').value);
      cancel(null, false, true);
      if (saveConflict || hasUnsavedState()) { $('pack-select').value = pack.id; toast('本页还有未保存的变化，当前画面保留。'); return; }
      pack = next; load(); $('free-input').value = draft; renderPack(); resumePanelObservations(); selectPanel('world', true);
      try { if (win.history && win.location) { const url = new URL(win.location.href); url.searchParams.set('pack', pack.id); win.history.replaceState(null, '', url.href); } } catch (_) {}
    });
    $('reset-button').addEventListener('click', () => { text('reset-copy', '这会清空“' + pack.title + '”当前版本在此浏览器里的框架进度，包括仅保留在本页的未保存变化。另一试验场和旧版 v0.5.4 存档会保留。'); $('reset-dialog').showModal(); });
    $('confirm-reset').addEventListener('click', () => {
      if (!checkStoredBase()) { $('reset-dialog').close(); return; }
      cancel(null, false); invalidateCommit();
      if (saveConflict) { $('reset-dialog').close(); return; }
      $('reset-dialog').close();
      return commitCandidate(runtime.create(pack), () => {
        text('reveal-announcement', ''); model.disconnect(); mode = null; $('api-key').value = ''; visible = runtime.view(state); lastFailure = null;
        saveProtected = false; migrationBackupFailed = false; migrationBackedUp = false; pendingMigration = null; renderCache.clear(); renderPack(); selectPanel('world', true);
        toast(saveProblem ? '本页已经重新开始，但浏览器没有允许写入；刷新可能恢复上次存档。' : '当前试验场已重新开始。');
      }, { replaceProtected: true });
    });
    $('offline-help-button').addEventListener('click', () => {
      const container = $('offline-examples'); container.replaceChildren();
      (offline.help ? offline.help() : []).forEach(example => { const button = el('button', example); button.type = 'button'; button.addEventListener('click', () => { if (pending || revealing) return; $('free-input').value = example; $('offline-help-dialog').close(); $('free-input').focus(); }); container.append(button); });
      $('offline-help-dialog').showModal();
    });
    $('legacy-import-button').addEventListener('click', () => {
      if (qa !== null || !legacy || pack.id !== 'rain-lab') return;
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
      if (qa !== null || !legacyCandidate || legacyCandidate.packId !== pack.id || !checkStoredBase()) return;
      const imported = legacyCandidate.state; legacyCandidate = null; cancel(null, false); invalidateCommit();
      if (saveConflict) return;
      $('legacy-dialog').close();
      return commitCandidate(imported, () => {
        model.disconnect(); mode = null; visible = runtime.view(state); saveProtected = false; migrationBackupFailed = false; migrationBackedUp = false; pendingMigration = null; lastFailure = null; renderCache.clear(); renderPack();
        toast(saveProblem ? '记录已在本页载入，但浏览器没有允许写入存档。旧序章数据保留。' : '旧序章记录已复制到当前试验场，原存档保留。');
      }, { replaceProtected: true });
    });
    function developer(open) { $('developer-view').hidden = !open; $('developer-toggle').setAttribute('aria-expanded', String(open)); renderDeveloper(); }
    $('developer-toggle').addEventListener('click', () => developer($('developer-view').hidden)); $('developer-close').addEventListener('click', () => developer(false));
    function motionChanged(event) { reduced = !!event.matches; if (reduced) { immediate = true; stopReveal(true); } controls(); }
    if (media && media.addEventListener) media.addEventListener('change', motionChanged);
    function keydown(event) { if ((event.code === 'Space' || event.key === ' ') && !event.repeat && revealing && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes((event.target || {}).tagName)) { event.preventDefault(); if (revealing.complete) revealing.complete(); } }
    function pagehide() {
      if (destroyed) return;
      pageHidden = true;
      if (renderer && renderer.suspend) renderer.suspend();
      cancel(null, true, true); model.disconnect(); mode = null; $('api-key').value = ''; controls();
    }
    function pageshow() { if (!destroyed) { if (pending || pendingCommit) { pageHidden = true; cancel(null, false, true); } pageHidden = false; checkStoredBase(); resumePanelObservations(); if (renderer && renderer.resume) renderer.resume(); observePanel(); } }
    function visibilityChanged() { if (doc.visibilityState !== 'hidden') { checkStoredBase(); observePanel(); } }
    function storageChanged(event) { if (!destroyed && (event.key === key() || event.key === null)) checkStoredBase(); }
    if (doc.addEventListener) doc.addEventListener('visibilitychange', visibilityChanged);
    if (win.addEventListener) {
      win.addEventListener('keydown', keydown);
      win.addEventListener('pagehide', pagehide);
      win.addEventListener('pageshow', pageshow);
      win.addEventListener('storage', storageChanged);
    }
    $('load-latest-save').addEventListener('click', () => $('load-latest-dialog').showModal());
    $('confirm-load-latest').addEventListener('click', () => { $('load-latest-dialog').close(); loadLatest(); });
    load(); renderPack();
    return Object.freeze({ submit, selectPanel: name => selectPanel(name, true), snapshot: () => ({ state, visible, mode, activePanel, busy: !!(pending || pendingCommit), saving: !!pendingCommit, revealing: !!revealing, currentBeat, lastFailure, storageKey: key(), saveConflict, unsaved: hasUnsavedState() }), destroy() { cancel(null, false); invalidateCommit(); destroyed = true; model.disconnect(); stopCredentialBoundary(); if (renderer && renderer.destroy) renderer.destroy(); if (toastTimer) clearTimer(toastTimer); if (media && media.removeEventListener) media.removeEventListener('change', motionChanged); if (doc.removeEventListener) doc.removeEventListener('visibilitychange', visibilityChanged); if (win.removeEventListener) { win.removeEventListener('keydown', keydown); win.removeEventListener('pagehide', pagehide); win.removeEventListener('pageshow', pageshow); win.removeEventListener('storage', storageChanged); } } });
  }
  return Object.freeze({ create });
});
