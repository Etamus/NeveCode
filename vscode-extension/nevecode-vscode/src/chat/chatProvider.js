/**
 * chatProvider — WebviewViewProvider (sidebar) and WebviewPanel manager
 * (editor tab) that wire ProcessManager events to the chat UI.
 */

const vscode = require('vscode');
const crypto = require('crypto');
const { ProcessManager } = require('./processManager');
const { toViewModel } = require('./messageParser');
const { renderChatHtml } = require('./chatRenderer');
const { isAssistantMessage, isPartialMessage, isStreamEvent,
        isContentBlockDelta, isContentBlockStart, isMessageStart,
        isResultMessage, isControlRequest, isToolProgressMessage,
        isStatusMessage, isRateLimitEvent, getTextContent,
        getToolUseBlocks } = require('./protocol');

async function openFileInEditor(filePath) {
  try {
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch {
    vscode.window.showWarningMessage(`Could not open file: ${filePath}`);
  }
}

const CHANGE_SNAPSHOT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const CHANGE_SNAPSHOT_MAX_FILES = 6000;
const CHANGE_SNAPSHOT_EXCLUDE = '**/{.git,node_modules,dist,llama-bin,models,.venv,venv,__pycache__,coverage,out,build}/**';

function getWorkspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri : null;
}

async function readSnapshotFile(uri) {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type !== vscode.FileType.File || stat.size > CHANGE_SNAPSHOT_MAX_FILE_BYTES) return null;
    return Buffer.from(await vscode.workspace.fs.readFile(uri));
  } catch {
    return null;
  }
}

async function snapshotWorkspaceFiles() {
  const root = getWorkspaceRoot();
  if (!root) return null;
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(root, '**/*'),
    CHANGE_SNAPSHOT_EXCLUDE,
    CHANGE_SNAPSHOT_MAX_FILES,
  );
  const snapshot = new Map();
  for (const uri of files) {
    const bytes = await readSnapshotFile(uri);
    snapshot.set(uri.fsPath, { uri, bytes });
  }
  return { root, files: snapshot };
}

function splitTextLines(bytes) {
  if (!bytes || bytes.length === 0) return [];
  const lines = bytes.toString('utf8').split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function countChangedLines(beforeBytes, afterBytes) {
  const beforeLines = splitTextLines(beforeBytes);
  const afterLines = splitTextLines(afterBytes);
  let start = 0;
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) {
    start++;
  }
  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;
  while (beforeEnd >= start && afterEnd >= start && beforeLines[beforeEnd] === afterLines[afterEnd]) {
    beforeEnd--;
    afterEnd--;
  }
  return {
    added: Math.max(0, afterEnd - start + 1),
    removed: Math.max(0, beforeEnd - start + 1),
  };
}

async function diffWorkspaceSnapshot(before) {
  if (!before || !before.root) return [];
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(before.root, '**/*'),
    CHANGE_SNAPSHOT_EXCLUDE,
    CHANGE_SNAPSHOT_MAX_FILES,
  );
  const after = new Map();
  for (const uri of files) {
    after.set(uri.fsPath, { uri, bytes: await readSnapshotFile(uri) });
  }

  const changes = [];
  for (const [path, prev] of before.files.entries()) {
    const next = after.get(path);
    if (!next) {
      if (prev.bytes) {
        const lineDelta = countChangedLines(prev.bytes, null);
        changes.push({ type: 'deleted', path, before: prev.bytes, added: lineDelta.added, removed: lineDelta.removed });
      }
      continue;
    }
    if (prev.bytes && next.bytes && !prev.bytes.equals(next.bytes)) {
      const lineDelta = countChangedLines(prev.bytes, next.bytes);
      changes.push({ type: 'modified', path, before: prev.bytes, added: lineDelta.added, removed: lineDelta.removed });
    }
  }
  for (const [path, next] of after.entries()) {
    if (!before.files.has(path)) {
      const lineDelta = countChangedLines(null, next.bytes);
      changes.push({ type: 'created', path, before: null, added: lineDelta.added, removed: lineDelta.removed });
    }
  }
  return changes;
}

function getLaunchConfig() {
  const cfg = vscode.workspace.getConfiguration('nevecode');
  const command = cfg.get('launchCommand', 'nevecode');
  const shimEnabled = cfg.get('useOpenAIShim', false);
  let permissionMode = cfg.get('permissionMode', 'default');
  if (permissionMode === 'plan' || permissionMode === 'acceptEdits') permissionMode = 'default';
  const maxOutputTokens = cfg.get('maxOutputTokens', 4096);
  const performanceProfile = cfg.get('performanceProfile', 'balanced');
  const env = {};
  if (shimEnabled) env.CLAUDE_CODE_USE_OPENAI = '1';
  env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(maxOutputTokens || 4096);
  env.NEVECODE_PERFORMANCE_PROFILE = String(performanceProfile || 'balanced');
  env.NEVECODE_REQUIRE_TOOL_APPROVAL = '1';
  // Prefer system-installed ripgrep over missing vendored binary
  env.USE_BUILTIN_RIPGREP = '0';
  const folders = vscode.workspace.workspaceFolders;
  const cwd = folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
  // Append behavioral instructions via system prompt file (if present)
  const path = require('path');
  const fs = require('fs');
  const os = require('os');
  const internalPromptFile = path.resolve(__dirname, '..', 'plans-prompt.txt');
  const userPromptFile = path.resolve(__dirname, '..', '..', '..', '..', 'nevecode-prompt-append.txt');
  const parts = [];
  if (fs.existsSync(internalPromptFile)) parts.push(fs.readFileSync(internalPromptFile, 'utf8').trim());
  if (fs.existsSync(userPromptFile)) parts.push(fs.readFileSync(userPromptFile, 'utf8').trim());
  let extraArgs = [];
  if (parts.length > 0) {
    const tmp = path.join(os.tmpdir(), 'neve-system-prompt.txt');
    fs.writeFileSync(tmp, parts.join('\n\n'), 'utf8');
    extraArgs = ['--append-system-prompt-file', tmp];
  }
  return { command, cwd, env, permissionMode, extraArgs };
}

class ChatController {
  constructor(sessionManager, globalState) {
    this._sessionManager = sessionManager;
    this._globalState = globalState || null;
    this._process = null;
    this._webviews = new Set();
    this._accumulatedText = '';
    this._toolUses = [];
    this._messages = [];
    this._currentSessionId = null;
    this._streaming = false;
    this._lastResult = null;
    this._thinkingTokens = 0;
    this._thinkingStartTime = null;
    this._currentBlockType = null;
    this._consecutiveToolErrors = 0; // loop breaker: abort after N consecutive tool errors
    this._turnWatchdog = null;
    this._lastModel = (globalState && globalState.get('neve.lastModel')) || null;
    this._changeSnapshot = null;
    this._pendingCheckpoint = null;
    this._changeCheckpointSeq = 0;
    this._pendingPermissions = new Map();
    this._toolUseNames = new Map();
    this._changeCheckpointTimer = null;
    this._aborting = false;
    this._consecutiveTaskOutputUses = 0;
    this._taskOutputUsesThisTurn = 0;
    this._onDidChangeState = new vscode.EventEmitter();
    this.onDidChangeState = this._onDidChangeState.event;
  }

  get sessionId() { return this._currentSessionId; }
  get isStreaming() { return this._process && this._process.running; }
  get sessionManager() { return this._sessionManager; }

  registerWebview(webview) {
    this._webviews.add(webview);
    // If we already know the model, send it immediately so the label appears on load
    if (this._lastModel) {
      try { webview.postMessage({ type: 'system_info', model: this._lastModel, sessionId: this._currentSessionId }); } catch {}
    }
    return { dispose: () => this._webviews.delete(webview) };
  }

  broadcast(msg) {
    for (const wv of this._webviews) {
      try { wv.postMessage(msg); } catch { /* webview might be disposed */ }
    }
  }

  _broadcast(msg) {
    this.broadcast(msg);
  }

  async startSession(opts = {}) {
    this.stopSession();
    this._accumulatedText = '';
    this._toolUses = [];
    // Only clear messages if this is a brand new session (not continuing)
    if (!opts.continueSession && !opts.sessionId) {
      this._messages = [];
    }
    // Use the explicitly requested sessionId only — never inherit a leftover id.
    this._currentSessionId = opts.sessionId || null;

    const { command, cwd, env, permissionMode, extraArgs: launchExtraArgs } = getLaunchConfig();

    this._process = new ProcessManager({
      command,
      cwd,
      env,
      sessionId: opts.sessionId,
      continueSession: opts.continueSession || false,
      model: opts.model,
      permissionMode,
      extraArgs: [...(launchExtraArgs || []), ...(opts.extraArgs || [])],
    });

    this._readyResolve = null;
    this._readyPromise = new Promise(resolve => { this._readyResolve = resolve; });

    this._aborting = false;
    const managedProcess = this._process;

    this._process.onMessage((msg) => {
      if (this._process !== managedProcess || this._aborting) return;
      if (msg.type === 'system' && this._readyResolve) {
        this._readyResolve();
        this._readyResolve = null;
      }
      this._handleMessage(msg);
    });
    this._process.onError((err) => {
      if (this._process !== managedProcess || this._aborting) return;
      // Fatal spawn error (ENOENT, EACCES, etc.) — process never started
      this._broadcast({ type: 'error', message: err.message || String(err) });
    });
    this._process.onStderr((text) => {
      if (this._process !== managedProcess || this._aborting) return;
      // CLI wrote to stderr: warning or debug info, not a fatal error
      // Show as status so it doesn't interrupt the chat stream
      this._broadcast({ type: 'status', content: '⚠ ' + text.split('\n')[0].trim() });
    });
    this._process.onExit(({ code }) => {
      if (this._process !== managedProcess) return;
      if (this._aborting) {
        this._aborting = false;
        return;
      }
      this._clearTurnWatchdog();
      if (this._streaming) {
        // Process died mid-stream — flush and unblock the renderer
        const text = this._accumulatedText;
        const usage = (this._lastResult || {}).usage || null;
        this._broadcast({ type: 'stream_end', text, usage, final: true });
        this._streaming = false;
      } else {
        // Process exited cleanly (after 'result') or was killed via abort().
        // Still send a stream_end so the renderer always unblocks isStreaming.
        this._broadcast({ type: 'stream_end', text: '', usage: null, final: true });
      }
      this._accumulatedText = '';
      this._toolUses = [];
      this._lastResult = null;
      this._finalizeChangeCheckpoint();
      this._broadcast({
        type: 'connected',
        message: code === 0 ? 'Pronto' : `Processo encerrado (código ${code})`,
      });
      this._onDidChangeState.fire('idle');
    });

    try {
      this._process.start();
      // Use 'process_ready' instead of 'connected' so the renderer doesn't
      // reset the streaming state while the user is waiting for a response.
      this._broadcast({ type: 'process_ready', message: 'Conectado' });
      this._onDidChangeState.fire('connected');
    } catch (err) {
      this._broadcast({ type: 'error', message: `Falha ao iniciar: ${err.message}` });
    }
  }

  stopSession() {
    if (this._process) {
      this._process.dispose();
      this._process = null;
    }
    // Clear session ID so the next startSession begins a brand-new session,
    // not a resume of the stopped one.
    this._currentSessionId = null;
    this._messages = [];
  }

  async sendMessage(text) {
    if (!this._process || !this._process.running) {
      await this.startSession(
        this._currentSessionId
          ? { sessionId: this._currentSessionId }
          : {},
      );
    }
    this._changeSnapshot = await snapshotWorkspaceFiles().catch(() => null);
    this._pendingPermissions.clear();
    this._toolUseNames.clear();
    this._consecutiveTaskOutputUses = 0;
    this._taskOutputUsesThisTurn = 0;
    // Clear any panel/plan from the previous message before starting new round
    this._broadcast({ type: 'clear_plan' });
    // Phase 1: Generate task plan. Default is zero-cost heuristic to avoid
    // paying a second heavy LLM inference before every real generation.
    let tasks = null;
    try { tasks = await this._getPlanForMessage(text); } catch {}

    let sendText = text;
    if (tasks && tasks.length >= 2) {
      this._broadcast({ type: 'task_plan', tasks });
      const planBlock = tasks.map((t, i) => (i + 1) + '. ' + t).join('\n');
      sendText = text + '\n\n<task_plan>\n' + planBlock + '\n</task_plan>';
    }
    // Salva o texto original (limpo) + plano no histórico — sendText vai para a IA mas não para o display
    this._messages.push({ role: 'user', text, plan: tasks && tasks.length >= 2 ? tasks : null });
    // Injeta o diretório de trabalho do workspace para que a IA crie arquivos no lugar correto
    const _wsf = vscode.workspace.workspaceFolders;
    if (_wsf && _wsf.length > 0) {
      sendText = '[diretório de trabalho: ' + _wsf[0].uri.fsPath + ']\n\n' + sendText;
    }
    // Phase 2: Execute via nevecode with optional plan injected
    await this._doSend(sendText);
  }

  async _getPlanForMessage(text) {
    const cfg = vscode.workspace.getConfiguration('nevecode');
    const mode = cfg.get('planningMode', 'heuristic');
    if (mode === 'off') return null;
    if (mode === 'llm') return this._generatePlan(text);
    return this._generateHeuristicPlan(text);
  }

  _generateHeuristicPlan(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    const lower = s.toLowerCase();
    const looksTrivial = s.length < 80 && !/(crie|faça|implemente|corrija|ajuste|refatore|melhore|adicione|remova|altere|edite|arquivo|página|pagina|componente|bug|erro)/i.test(s);
    if (looksTrivial) return null;

    if (/(corrija|bug|erro|falha|trav|quebra)/i.test(lower)) {
      return [
        'Localizar a causa do problema no código relevante',
        'Aplicar correção mínima e segura',
        'Validar o fluxo afetado',
        'Confirmar resultado final e resumir as mudanças',
      ];
    }
    if (/(melhore|refatore|otimize|performance|rápid|rapíd|lento)/i.test(lower)) {
      return [
        'Identificar os pontos do código que precisam de melhoria',
        'Aplicar alterações direcionadas sem reescrever arquivos inteiros',
        'Revisar impacto em comportamento e compatibilidade',
        'Confirmar resultado final e resumir as mudanças',
      ];
    }
    if (/(crie|faça|implemente|adicione|nova|novo|página|pagina|html|componente|tela)/i.test(lower)) {
      return [
        'Identificar arquivos e estrutura necessária no workspace',
        'Implementar a funcionalidade solicitada com mudanças objetivas',
        'Ajustar integração, estilos ou configuração quando necessário',
        'Confirmar resultado final e resumir as mudanças',
      ];
    }
    return [
      'Analisar a solicitação e o contexto do projeto',
      'Executar as alterações necessárias de forma objetiva',
      'Validar o resultado e informar o que foi feito',
    ];
  }

  async _generatePlan(userText) {
    const path = require('path');
    const fs = require('fs');
    const cfg = vscode.workspace.getConfiguration('nevecode');
    const planningUrl = cfg.get('planningUrl', 'http://localhost:8080/v1/chat/completions');
    const planningPromptFile = path.resolve(__dirname, '..', 'planning-prompt.txt');
    if (!fs.existsSync(planningPromptFile)) return null;
    const systemPrompt = fs.readFileSync(planningPromptFile, 'utf8').trim();
    const body = JSON.stringify({
      model: 'local',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
      temperature: 0.3,
      max_tokens: 400,
      stream: false,
    });
    return new Promise((resolve) => {
      try {
        const url = new URL(planningUrl);
        const lib = url.protocol === 'https:' ? require('https') : require('http');
        const opts = {
          hostname: url.hostname,
          port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + (url.search || ''),
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
          timeout: 4000,
        };
        const req = lib.request(opts, (res) => {
          let data = '';
          res.on('data', c => { data += c; });
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              const content = json.choices?.[0]?.message?.content || '';
              const ps = content.indexOf('<nevplan>');
              const pe = content.indexOf('</nevplan>');
              if (ps === -1 || pe <= ps) { resolve(null); return; }
              const inner = content.slice(ps + 9, pe);
              const tasks = inner.split('\n').map(l => l.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean);
              resolve(tasks.length >= 2 ? tasks : null);
            } catch { resolve(null); }
          });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.write(body);
        req.end();
      } catch { resolve(null); }
    });
  }

  async _doSend(text) {
    if (!this._process) return;
    // On first message after process start, wait for CLI to be ready.
    // On subsequent messages, the process is already running and accepting input.
    if (this._readyPromise) {
      const grace = new Promise(resolve => setTimeout(resolve, 8000));
      await Promise.race([this._readyPromise, grace]);
      this._readyPromise = null;
    }
    this.setPermissionMode(this._getConfiguredPermissionMode());
    this._accumulatedText = '';
    this._toolUses = [];
    try {
      this._startTurnWatchdog();
      this._process.sendUserMessage(text);
      // Nota: mensagem de usuário já foi adicionada a _messages em sendMessage() com texto limpo
    } catch (err) {
      this._clearTurnWatchdog();
      this._broadcast({ type: 'error', message: err.message });
    }
  }

  _startTurnWatchdog() {
    this._clearTurnWatchdog();
    this._turnWatchdog = setTimeout(() => {
      this._turnWatchdog = null;
      this._broadcast({ type: 'error', message: 'Abortado: a geração ficou sem resposta por tempo demais.' });
      this.abort();
    }, 180000);
  }

  _clearTurnWatchdog() {
    if (this._turnWatchdog) {
      clearTimeout(this._turnWatchdog);
      this._turnWatchdog = null;
    }
  }

  abort() {
    if (this._process) {
      const processToKill = this._process;
      this._aborting = true;
      this._process = null;
      this._clearTurnWatchdog();
      this._clearChangeCheckpointTimer();
      this._pendingPermissions.clear();
      processToKill.kill(); // kill tree — imediato
      // Mark streaming as done BEFORE onExit fires, so onExit won't double-broadcast.
      const text = this._accumulatedText;
      this._streaming = false;
      this._accumulatedText = '';
      this._broadcast({ type: 'stream_end', text, usage: null, final: true, aborted: true });
      this._onDidChangeState.fire('idle');
    }
    this._changeSnapshot = null;
  }

  _getConfiguredPermissionMode() {
    const cfg = vscode.workspace.getConfiguration('nevecode');
    const mode = cfg.get('permissionMode', 'default');
    return mode === 'plan' || mode === 'acceptEdits' ? 'default' : mode;
  }

  _clearChangeCheckpointTimer() {
    if (this._changeCheckpointTimer) {
      clearTimeout(this._changeCheckpointTimer);
      this._changeCheckpointTimer = null;
    }
  }

  _scheduleChangeCheckpoint() {
    if (!this._changeSnapshot) return;
    this._clearChangeCheckpointTimer();
    this._changeCheckpointTimer = setTimeout(() => {
      this._changeCheckpointTimer = null;
      this._finalizeChangeCheckpoint({ keepSnapshot: true });
    }, 450);
  }

  async _finalizeChangeCheckpoint(options = {}) {
    const before = this._changeSnapshot;
    if (!options.keepSnapshot) this._changeSnapshot = null;
    if (!before) return;
    const changes = await diffWorkspaceSnapshot(before).catch(() => []);
    if (!changes || changes.length === 0) return;
    const id = String(++this._changeCheckpointSeq);
    this._pendingCheckpoint = { id, changes };
    const files = [...new Set(changes.map(c => c.path))];
    this._broadcast({
      type: 'change_checkpoint',
      id,
      fileCount: files.length,
      changeCount: changes.length,
      addedLines: changes.reduce((sum, change) => sum + Number(change.added || 0), 0),
      removedLines: changes.reduce((sum, change) => sum + Number(change.removed || 0), 0),
      files: files.slice(0, 8).map(f => vscode.workspace.asRelativePath(f)),
    });
  }

  async keepChanges(id) {
    if (!this._pendingCheckpoint || this._pendingCheckpoint.id !== id) return;
    this._clearChangeCheckpointTimer();
    this._pendingCheckpoint = null;
    if (this._changeSnapshot) {
      this._changeSnapshot = await snapshotWorkspaceFiles().catch(() => null);
    }
    this._broadcast({ type: 'change_checkpoint_cleared', id });
  }

  async undoChanges(id) {
    const checkpoint = this._pendingCheckpoint;
    if (!checkpoint || checkpoint.id !== id) return;
    try {
      for (const change of [...checkpoint.changes].reverse()) {
        const uri = vscode.Uri.file(change.path);
        if (change.type === 'created') {
          try { await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false }); } catch {}
        } else if (change.before) {
          const parent = vscode.Uri.file(require('path').dirname(change.path));
          try { await vscode.workspace.fs.createDirectory(parent); } catch {}
          await vscode.workspace.fs.writeFile(uri, change.before);
        }
      }
      this._clearChangeCheckpointTimer();
      this._pendingCheckpoint = null;
      if (this._changeSnapshot) {
        this._changeSnapshot = await snapshotWorkspaceFiles().catch(() => null);
      }
      this._broadcast({ type: 'change_checkpoint_cleared', id });
      this._broadcast({ type: 'status', content: 'Alterações desfeitas.' });
    } catch (err) {
      this._broadcast({ type: 'error', message: 'Falha ao desfazer alterações: ' + (err.message || String(err)) });
    }
  }

  setPermissionMode(mode) {
    if (!mode || mode === 'plan') return;
    if (this._process) {
      try { this._process.setPermissionMode(mode); } catch {}
    }
  }

  _rememberToolUse(id, name) {
    if (id && name) this._toolUseNames.set(id, name);
  }

  _isEditToolName(name) {
    return /^(write|edit|multiedit|notebookedit)$/i.test(String(name || ''));
  }

  _recordToolUseName(name) {
    if (String(name || '').toLowerCase() === 'taskoutput') {
      this._consecutiveTaskOutputUses++;
      this._taskOutputUsesThisTurn++;
      if (this._consecutiveTaskOutputUses >= 3 || this._taskOutputUsesThisTurn >= 4) {
        this._consecutiveTaskOutputUses = 0;
        this._taskOutputUsesThisTurn = 0;
        this._broadcast({ type: 'error', message: 'Abortado: loop de TaskOutput detectado.' });
        this.abort();
        return false;
      }
    } else if (name) {
      this._consecutiveTaskOutputUses = 0;
    }
    return true;
  }

  sendPermissionResponse(requestId, action, toolUseId) {
    if (!this._process) return;
    const pending = this._pendingPermissions.get(requestId) || {};
    this._pendingPermissions.delete(requestId);
    if (action === 'deny') {
      try {
        this._process.sendControlResponse(requestId, {
          behavior: 'deny',
          message: 'Usuário reprovou a execução da ferramenta',
          toolUseID: toolUseId || pending.toolUseId || undefined,
          decisionClassification: 'user_reject',
        });
      } catch (err) {
        this._broadcast({ type: 'error', message: err.message });
      }
      setTimeout(() => this.abort(), 25);
      return;
    }
    try {
      this._process.sendControlResponse(requestId, {
        behavior: 'allow',
        updatedInput: pending.input && typeof pending.input === 'object' ? pending.input : {},
        toolUseID: toolUseId || pending.toolUseId || undefined,
        decisionClassification: 'user_temporary',
      });
    } catch (err) {
      this._broadcast({ type: 'error', message: err.message });
    }
  }

  getMessages() { return this._messages; }

  _handleMessage(msg) {
    if (msg.session_id && !this._currentSessionId) {
      this._currentSessionId = msg.session_id;
    }

    if (msg.type === 'control_response') {
      return;
    }

    // System message — extract model and session info
    if (msg.type === 'system') {
      if (msg.model) {
        this._lastModel = msg.model;
        if (this._globalState) this._globalState.update('neve.lastModel', msg.model);
      }
      this._broadcast({
        type: 'system_info',
        model: msg.model || null,
        sessionId: msg.session_id || msg.sessionId || null,
      });
      return;
    }

    // Control request (permission prompt) — check EARLY before other handlers
    if (msg.type === 'control_request' || isControlRequest(msg)) {
      const req = msg.request || {};
      const { toolDisplayName, parseToolInput } = require('./messageParser');
      const requestId = msg.request_id || req.request_id || msg.id;
      const toolUseId = req.tool_use_id || req.toolUseID || null;
      const input = req.input || req.tool_input || null;
      if (requestId) {
        this._pendingPermissions.set(requestId, { input, toolUseId });
      }
      this._broadcast({
        type: 'permission_request',
        requestId,
        toolName: req.tool_name || 'Unknown',
        displayName: req.display_name || req.title || toolDisplayName(req.tool_name),
        description: req.description || req.action_description || '',
        inputPreview: parseToolInput(input),
        toolUseId,
      });
      return;
    }

    // Control cancel request
    if (msg.type === 'control_cancel_request') {
      return;
    }

    // Handle Anthropic raw stream events (the primary streaming mechanism)
    if (isStreamEvent(msg)) {
      this._handleStreamEvent(msg);
      return;
    }

    // Assistant message — always mid-turn; true completion comes from 'result'
    if (isAssistantMessage(msg)) {
      const inner = msg.message || msg;
      const text = getTextContent(inner);
      const toolBlocks = getToolUseBlocks(inner);
      const { toolDisplayName, toolIcon } = require('./messageParser');
      const toolUseVms = toolBlocks.map(tu => ({
        id: tu.id,
        name: tu.name,
        displayName: toolDisplayName(tu.name),
        icon: toolIcon(tu.name),
        inputPreview: typeof tu.input === 'string' ? tu.input : JSON.stringify(tu.input || ''),
        input: tu.input,
        status: 'running',
      }));
      this._messages.push({ role: 'assistant', text, toolUses: toolUseVms });
      const usage = inner.usage || msg.usage || null;

      // Finalize current text bubble but stay streaming — true completion
      // is signaled by the 'result' message, not by the assistant message.
      this._broadcast({ type: 'stream_end', text, usage, final: false });
      this._accumulatedText = '';

      if (toolBlocks.length > 0) {
        for (const tu of toolBlocks) {
          this._rememberToolUse(tu.id, tu.name);
          if (!this._recordToolUseName(tu.name)) return;
          this._broadcast({
            type: 'tool_input_ready',
            toolUseId: tu.id,
            input: tu.input,
            name: tu.name,
          });
        }
        this._broadcast({ type: 'status', content: 'Using tools...' });
      }
      return;
    }

    // User message with tool_use_result — this is the tool output
    if (msg.type === 'user' && msg.message) {
      const content = msg.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const resultText = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map(b => b.text || '').join('')
                : '';
            this._broadcast({
              type: 'tool_result',
              toolUseId: block.tool_use_id,
              toolName: this._toolUseNames.get(block.tool_use_id) || null,
              content: resultText.slice(0, 2000) || '(done)',
              isError: block.is_error || false,
            });
            if (!block.is_error && this._isEditToolName(this._toolUseNames.get(block.tool_use_id))) {
              this._scheduleChangeCheckpoint();
            }
            // Loop breaker: track consecutive tool errors
            if (block.is_error) {
              this._consecutiveToolErrors++;
              if (this._consecutiveToolErrors >= 3) {
                this._consecutiveToolErrors = 0;
                const errMsg = 'Abortado: 3 erros consecutivos de ferramenta. Tente reformular a tarefa.';
                this._broadcast({ type: 'error', message: errMsg });
                this.abort();
                return;
              }
            } else {
              this._consecutiveToolErrors = 0;
            }
          }
        }
      }
      this._broadcast({ type: 'status', content: 'Thinking...' });
      return;
    }

    // Session result — turn is complete. Go idle. The process stays alive
    // in stream-json mode for multi-turn conversation.
    // Note: we match on type === 'result' without requiring msg.subtype to be
    // truthy — some CLI versions emit result without a subtype field.
    if (msg.type === 'result') {
      this._clearTurnWatchdog();
      this._lastResult = msg;
      // For error subtypes, surface the error message to the user
      if (msg.subtype === 'error') {
        const errorText = msg.error || msg.message || msg.result || 'Erro durante a geração';
        this._broadcast({ type: 'error', message: errorText });
      }
      // Only use result text if nothing was shown via streaming yet
      const text = this._accumulatedText || '';
      this._broadcast({ type: 'stream_end', text, usage: msg.usage || null, final: true });
      // Show turn info: if the model stopped without using tools (num_turns=1),
      // the user knows the model chose not to edit
      if (msg.num_turns !== undefined) {
        const reason = msg.stop_reason || 'done';
        this._broadcast({
          type: 'status',
          content: msg.num_turns > 1
            ? 'Completed (' + msg.num_turns + ' turns)'
            : 'Ready',
        });
      }
      this._accumulatedText = '';
      this._toolUses = [];
      this._streaming = false;
      this._finalizeChangeCheckpoint();
      this._onDidChangeState.fire('idle');
      return;
    }

    if (isToolProgressMessage(msg)) {
      const vm = toViewModel(msg)[0];
      this._broadcast({
        type: 'tool_progress',
        toolUseId: vm.toolUseId,
        content: vm.content,
      });
      return;
    }

    if (isStatusMessage(msg)) {
      const vm = toViewModel(msg)[0];
      this._broadcast({ type: 'status', content: vm.content });
      return;
    }

    if (isRateLimitEvent(msg)) {
      const vm = toViewModel(msg)[0];
      this._broadcast({ type: 'rate_limit', message: vm.message });
      return;
    }

    // Log unhandled message types for debugging
    if (msg.type && msg.type !== 'stream_event') {
      this._broadcast({ type: 'status', content: '[debug] unhandled: ' + msg.type });
    }
  }

  _handleStreamEvent(msg) {
    const event = msg.event;
    if (!event) return;

    switch (event.type) {
      case 'message_start':
        this._accumulatedText = '';
        this._thinkingTokens = 0;
        this._currentBlockType = null;
        if (!this._streaming) {
          this._streaming = true;
          this._toolUses = [];
          this._onDidChangeState.fire('streaming');
        }
        this._broadcast({ type: 'stream_start' });
        break;

      case 'content_block_start':
        if (event.content_block) {
          this._currentBlockType = event.content_block.type;
          if (event.content_block.type === 'tool_use') {
            const tu = event.content_block;
            this._rememberToolUse(tu.id, tu.name);
            if (!this._recordToolUseName(tu.name)) return;
            this._toolUses.push({ id: tu.id, name: tu.name, input: '' });
            const { toolDisplayName, toolIcon } = require('./messageParser');
            this._broadcast({
              type: 'tool_use',
              toolUse: {
                id: tu.id,
                name: tu.name,
                displayName: toolDisplayName(tu.name),
                icon: toolIcon(tu.name),
                inputPreview: '',
                input: tu.input || null,
                status: 'running',
              },
            });
          } else if (event.content_block.type === 'thinking') {
            this._thinkingTokens = 0;
            this._thinkingStartTime = Date.now();
            this._broadcast({ type: 'thinking_start' });
          }
        }
        break;

      case 'content_block_delta':
        if (event.delta) {
          if (event.delta.type === 'text_delta' && event.delta.text) {
            this._accumulatedText += event.delta.text;
            this._broadcast({ type: 'stream_delta', text: this._accumulatedText });
          } else if (event.delta.type === 'thinking_delta') {
            const chunk = event.delta.thinking || '';
            this._thinkingTokens += chunk.length;
            const elapsed = Math.round((Date.now() - (this._thinkingStartTime || Date.now())) / 1000);
            this._broadcast({
              type: 'thinking_delta',
              tokens: this._thinkingTokens,
              elapsed,
              text: chunk,
            });
          } else if (event.delta.type === 'input_json_delta' && event.delta.partial_json) {
            const lastTool = this._toolUses[this._toolUses.length - 1];
            if (lastTool) {
              lastTool.input = (lastTool.input || '') + event.delta.partial_json;
            }
          }
        }
        break;

      case 'content_block_stop':
        if (this._currentBlockType === 'thinking') {
          this._broadcast({ type: 'thinking_end' });
        }
        this._currentBlockType = null;
        break;

      case 'message_delta':
        break;

      case 'message_stop':
        break;

      default:
        break;
    }
  }

  dispose() {
    this.stopSession();
    this._onDidChangeState.dispose();
  }
}

class NeveCodeChatViewProvider {
  constructor(chatController, extensionUri) {
    this._chatController = chatController;
    this._extensionUri = extensionUri || null;
    this._webviewView = null;
  }

  resolveWebviewView(webviewView, _context, _token) {
    this._webviewView = webviewView;
    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: this._extensionUri ? [vscode.Uri.joinPath(this._extensionUri, 'media')] : [],
    };

    const registration = this._chatController.registerWebview(webview);
    webviewView.onDidDispose(() => {
      registration.dispose();
      if (this._webviewView === webviewView) this._webviewView = null;
    });

    // Send active file suggestion when view becomes visible
    const sendActiveFile = () => {
      if (!webviewView.visible) return;
      // Só atualiza a sugestão quando de fato há um editor de arquivo ativo.
      // Se não há editor ativo (foco fora do editor), mantém a sugestão anterior intacta
      // para evitar que findFiles() retorne um arquivo aleatório do workspace.
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.uri.scheme === 'file') {
        const uri = editor.document.uri;
        webview.postMessage({
          type: 'suggest_file',
          name: uri.path.split('/').pop() || uri.fsPath.split(/[\\/]/).pop(),
          path: uri.fsPath,
        });
      }
      // Sem editor ativo → não faz nada; a sugestão atual permanece
    };

    webviewView.onDidChangeVisibility(() => { if (webviewView.visible) sendActiveFile(); });
    vscode.window.onDidChangeActiveTextEditor(() => sendActiveFile());

    webview.html = this._getHtml(webview);
    this._attachMessageHandler(webview);
  }

  _getHtml(webview) {
    const nonce = crypto.randomBytes(16).toString('hex');
    let logoUri = '';
    const cspSource = webview.cspSource || '';
    if (this._extensionUri && webview) {
      const logoPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'nevecode.svg');
      logoUri = webview.asWebviewUri(logoPath).toString();
    }
    return renderChatHtml({ nonce, platform: process.platform, logoUri, cspSource });
  }

  _attachMessageHandler(webview) {
    webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'send_message':
          this._chatController.sendMessage(msg.text);
          break;
        case 'abort':
          this._chatController.abort();
          break;
        case 'new_session':
          this._chatController.stopSession();
          webview.postMessage({ type: 'session_cleared' });
          break;
        case 'resume_session':
          this._chatController.stopSession();
          webview.postMessage({ type: 'session_cleared' });
          await this._loadAndDisplaySession(webview, msg.sessionId);
          await this._chatController.startSession({ sessionId: msg.sessionId });
          break;
        case 'permission_response':
          this._chatController.sendPermissionResponse(msg.requestId, msg.action, msg.toolUseId);
          break;
        case 'keep_changes':
          await this._chatController.keepChanges(msg.id);
          break;
        case 'undo_changes':
          await this._chatController.undoChanges(msg.id);
          break;
        case 'copy_code':
          if (msg.text) await vscode.env.clipboard.writeText(msg.text);
          break;
        case 'open_file':
          if (msg.path) await openFileInEditor(msg.path);
          break;
        case 'request_sessions':
          await this._sendSessionList(webview);
          break;
        case 'delete_session':
          if (this._chatController.sessionManager && msg.sessionId) {
            await this._chatController.sessionManager.deleteSession(msg.sessionId);
            await this._sendSessionList(webview);
          }
          break;
        case 'restore_request':
          this._restoreMessages(webview);
          break;
        case 'set_permission_mode':
          if (msg.mode && msg.mode !== 'plan') {
            await vscode.workspace.getConfiguration('nevecode').update('permissionMode', msg.mode, vscode.ConfigurationTarget.Global);
            this._chatController.setPermissionMode(msg.mode);
          }
          break;
        case 'get_suggested_file':
          NeveCodeChatViewProvider._sendActiveFileSuggestion(webview);
          break;
        case 'pick_suggested_file': {
          if (msg.path) {
            let content = '';
            try {
              const uri = vscode.Uri.file(msg.path);
              const bytes = await vscode.workspace.fs.readFile(uri);
              content = Buffer.from(bytes).toString('utf8');
              if (content.length > 20000) content = content.slice(0, 20000) + '\n... (truncado)';
            } catch {}
            webview.postMessage({ type: 'file_suggested', name: msg.name, path: msg.path, content });
          }
          break;
        }
        case 'pick_file': {
          const folders = vscode.workspace.workspaceFolders;
          const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: 'Anexar ao chat',
            filters: { 'Todos os arquivos': ['*'] },
            defaultUri: folders && folders.length > 0 ? folders[0].uri : undefined,
          });
          if (uris && uris[0]) {
            const uri = uris[0];
            let content = '';
            try {
              const bytes = await vscode.workspace.fs.readFile(uri);
              content = Buffer.from(bytes).toString('utf8');
              if (content.length > 20000) content = content.slice(0, 20000) + '\n... (truncado)';
            } catch {}
            webview.postMessage({
              type: 'file_picked',
              name: uri.path.split('/').pop() || uri.fsPath.split(/[\\/]/).pop(),
              path: uri.fsPath,
              content,
            });
          }
          break;
        }
        case 'webview_ready': {
          let permissionMode = vscode.workspace.getConfiguration('nevecode').get('permissionMode', 'default');
          if (permissionMode === 'plan' || permissionMode === 'acceptEdits') permissionMode = 'default';
          webview.postMessage({ type: 'init_config', permissionMode });
          const cachedModel = this._chatController._lastModel;
          if (cachedModel) webview.postMessage({ type: 'system_info', model: cachedModel });
          NeveCodeChatViewProvider._sendActiveFileSuggestion(webview);
          break;
        }
      }
    });
  }

  static _sendActiveFileSuggestion(webview) {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.scheme === 'file') {
      const uri = editor.document.uri;
      webview.postMessage({
        type: 'suggest_file',
        name: uri.path.split('/').pop() || uri.fsPath.split(/[\\/]/).pop(),
        path: uri.fsPath,
      });
      return;
    }
    // Sem editor ativo — busca o primeiro arquivo do workspace como fallback
    vscode.workspace.findFiles('**/*.{ts,js,tsx,jsx,py,html,css,json,md,txt,yaml,yml,env}', '**/node_modules/**', 5)
      .then(files => {
        if (files && files.length > 0) {
          const uri = files[0];
          webview.postMessage({
            type: 'suggest_file',
            name: uri.path.split('/').pop() || uri.fsPath.split(/[\\/]/).pop(),
            path: uri.fsPath,
          });
        } else {
          webview.postMessage({ type: 'suggest_file', name: null, path: null });
        }
      })
      .then(undefined, () => {
        webview.postMessage({ type: 'suggest_file', name: null, path: null });
      });
  }

  async _sendSessionList(webview) {
    if (!this._chatController.sessionManager) return;
    try {
      const sessions = await this._chatController.sessionManager.listSessions();
      webview.postMessage({ type: 'session_list', sessions });
    } catch {
      webview.postMessage({ type: 'session_list', sessions: [] });
    }
  }

  _restoreMessages(webview) {
    const messages = this._chatController.getMessages();
    if (messages.length > 0) {
      webview.postMessage({ type: 'restore_messages', messages });
    }
  }

  async _loadAndDisplaySession(webview, sessionId) {
    if (!this._chatController.sessionManager) return;
    try {
      const messages = await this._chatController.sessionManager.loadSession(sessionId);
      if (messages && messages.length > 0) {
        this._chatController._messages = messages;
        webview.postMessage({ type: 'restore_messages', messages });
      }
    } catch { /* session may not be loadable */ }
  }
}

class NeveCodeChatPanelManager {
  constructor(chatController, extensionUri) {
    this._chatController = chatController;
    this._extensionUri = extensionUri || null;
    this._panel = null;
  }

  openPanel() {
    if (this._panel) {
      this._panel.reveal();
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      'NeveCode.chatPanel',
      'Neve Code Chat',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: this._extensionUri ? [vscode.Uri.joinPath(this._extensionUri, 'media')] : [],
      },
    );

    const webview = this._panel.webview;
    const registration = this._chatController.registerWebview(webview);

    this._panel.onDidDispose(() => {
      registration.dispose();
      this._panel = null;
    });

    const nonce = crypto.randomBytes(16).toString('hex');
    let logoUri = '';
    const cspSource = webview.cspSource || '';
    if (this._extensionUri) {
      const logoPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'nevecode.svg');
      logoUri = webview.asWebviewUri(logoPath).toString();
    }
    webview.html = renderChatHtml({ nonce, platform: process.platform, logoUri, cspSource });
    this._attachMessageHandler(webview);

    const messages = this._chatController.getMessages();
    if (messages.length > 0) {
      webview.postMessage({ type: 'restore_messages', messages });
    }
  }

  _attachMessageHandler(webview) {
    webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'send_message':
          this._chatController.sendMessage(msg.text);
          break;
        case 'abort':
          this._chatController.abort();
          break;
        case 'new_session':
          this._chatController.stopSession();
          webview.postMessage({ type: 'session_cleared' });
          break;
        case 'resume_session':
          this._chatController.stopSession();
          webview.postMessage({ type: 'session_cleared' });
          await this._loadAndDisplaySession(webview, msg.sessionId);
          await this._chatController.startSession({ sessionId: msg.sessionId });
          break;
        case 'permission_response':
          this._chatController.sendPermissionResponse(msg.requestId, msg.action, msg.toolUseId);
          break;
        case 'keep_changes':
          await this._chatController.keepChanges(msg.id);
          break;
        case 'undo_changes':
          await this._chatController.undoChanges(msg.id);
          break;
        case 'copy_code':
          if (msg.text) await vscode.env.clipboard.writeText(msg.text);
          break;
        case 'open_file':
          if (msg.path) await openFileInEditor(msg.path);
          break;
        case 'request_sessions':
          await this._sendSessionList(webview);
          break;
        case 'delete_session':
          if (this._chatController.sessionManager && msg.sessionId) {
            await this._chatController.sessionManager.deleteSession(msg.sessionId);
            await this._sendSessionList(webview);
          }
          break;
        case 'restore_request':
          this._restoreMessages(webview);
          break;
        case 'set_permission_mode':
          if (msg.mode && msg.mode !== 'plan') {
            await vscode.workspace.getConfiguration('nevecode').update('permissionMode', msg.mode, vscode.ConfigurationTarget.Global);
            this._chatController.setPermissionMode(msg.mode);
          }
          break;
        case 'pick_file': {
          const folders = vscode.workspace.workspaceFolders;
          const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: 'Anexar ao chat',
            filters: { 'Todos os arquivos': ['*'] },
            defaultUri: folders && folders.length > 0 ? folders[0].uri : undefined,
          });
          if (uris && uris[0]) {
            const uri = uris[0];
            let content = '';
            try {
              const bytes = await vscode.workspace.fs.readFile(uri);
              content = Buffer.from(bytes).toString('utf8');
              if (content.length > 20000) content = content.slice(0, 20000) + '\n... (truncado)';
            } catch {}
            webview.postMessage({
              type: 'file_picked',
              name: uri.path.split('/').pop() || uri.fsPath.split(/[\\/]/).pop(),
              path: uri.fsPath,
              content,
            });
          }
          break;
        }
        case 'get_suggested_file':
          NeveCodeChatViewProvider._sendActiveFileSuggestion(webview);
          break;
        case 'webview_ready': {
          let permissionMode = vscode.workspace.getConfiguration('nevecode').get('permissionMode', 'default');
          if (permissionMode === 'plan' || permissionMode === 'acceptEdits') permissionMode = 'default';
          webview.postMessage({ type: 'init_config', permissionMode });
          const cachedModel = this._chatController._lastModel;
          if (cachedModel) webview.postMessage({ type: 'system_info', model: cachedModel });
          NeveCodeChatViewProvider._sendActiveFileSuggestion(webview);
          break;
        }
      }
    });
  }

  async _sendSessionList(webview) {
    if (!this._chatController.sessionManager) return;
    try {
      const sessions = await this._chatController.sessionManager.listSessions();
      webview.postMessage({ type: 'session_list', sessions });
    } catch {
      webview.postMessage({ type: 'session_list', sessions: [] });
    }
  }

  _restoreMessages(webview) {
    const messages = this._chatController.getMessages();
    if (messages.length > 0) {
      webview.postMessage({ type: 'restore_messages', messages });
    }
  }

  async _loadAndDisplaySession(webview, sessionId) {
    if (!this._chatController.sessionManager) return;
    try {
      const messages = await this._chatController.sessionManager.loadSession(sessionId);
      if (messages && messages.length > 0) {
        this._chatController._messages = messages;
        webview.postMessage({ type: 'restore_messages', messages });
      }
    } catch { /* session may not be loadable */ }
  }

  dispose() {
    if (this._panel) {
      this._panel.dispose();
      this._panel = null;
    }
  }
}

module.exports = {
  ChatController,
  NeveCodeChatViewProvider,
  NeveCodeChatPanelManager,
};

