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

function getLaunchConfig() {
  const cfg = vscode.workspace.getConfiguration('nevecode');
  const command = cfg.get('launchCommand', 'nevecode');
  const shimEnabled = cfg.get('useOpenAIShim', false);
  const permissionMode = cfg.get('permissionMode', 'acceptEdits');
  const env = {};
  if (shimEnabled) env.CLAUDE_CODE_USE_OPENAI = '1';
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

    this._process.onMessage((msg) => {
      if (msg.type === 'system' && this._readyResolve) {
        this._readyResolve();
        this._readyResolve = null;
      }
      this._handleMessage(msg);
    });
    this._process.onError((err) => {
      // Fatal spawn error (ENOENT, EACCES, etc.) — process never started
      this._broadcast({ type: 'error', message: err.message || String(err) });
    });
    this._process.onStderr((text) => {
      // CLI wrote to stderr: warning or debug info, not a fatal error
      // Show as status so it doesn't interrupt the chat stream
      this._broadcast({ type: 'status', content: '⚠ ' + text.split('\n')[0].trim() });
    });
    this._process.onExit(({ code }) => {
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
    // Clear any panel/plan from the previous message before starting new round
    this._broadcast({ type: 'clear_plan' });
    // Phase 1: Generate task plan via local planning endpoint (fails gracefully)
    let tasks = null;
    try { tasks = await this._generatePlan(text); } catch {}

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
    // Phase 2: Execute via openclaude with optional plan injected
    await this._doSend(sendText);
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
    }, 120000);
  }

  _clearTurnWatchdog() {
    if (this._turnWatchdog) {
      clearTimeout(this._turnWatchdog);
      this._turnWatchdog = null;
    }
  }

  abort() {
    if (this._process) {
      this._clearTurnWatchdog();
      this._process.kill(); // SIGTERM — imediato
      // Mark streaming as done BEFORE onExit fires, so onExit won't double-broadcast.
      const text = this._accumulatedText;
      this._streaming = false;
      this._accumulatedText = '';
      this._broadcast({ type: 'stream_end', text, usage: null, final: true, aborted: true });
      this._onDidChangeState.fire('idle');
    }
  }

  sendPermissionResponse(requestId, action, toolUseId) {
    if (!this._process) return;
    if (action === 'deny') {
      try {
        this._process.write({
          type: 'control_response',
          response: {
            subtype: 'error',
            request_id: requestId,
            error: 'Usuário negou permissão',
          },
        });
      } catch (err) {
        this._broadcast({ type: 'error', message: err.message });
      }
      return;
    }
    try {
      this._process.sendControlResponse(requestId, {
        toolUseID: toolUseId || undefined,
        ...(action === 'allow-session' ? { remember: true } : {}),
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
      this._broadcast({
        type: 'permission_request',
        requestId: msg.request_id,
        toolName: req.tool_name || 'Unknown',
        displayName: req.display_name || req.title || toolDisplayName(req.tool_name),
        description: req.description || '',
        inputPreview: parseToolInput(req.input),
        toolUseId: req.tool_use_id || null,
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
              content: resultText.slice(0, 2000) || '(done)',
              isError: block.is_error || false,
            });
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
          if (msg.mode) {
            await vscode.workspace.getConfiguration('nevecode').update('permissionMode', msg.mode, vscode.ConfigurationTarget.Global);
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
          webview.postMessage({ type: 'init_config', permissionMode: vscode.workspace.getConfiguration('nevecode').get('permissionMode', 'acceptEdits') });
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
          if (msg.mode) {
            await vscode.workspace.getConfiguration('nevecode').update('permissionMode', msg.mode, vscode.ConfigurationTarget.Global);
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
          webview.postMessage({ type: 'init_config', permissionMode: vscode.workspace.getConfiguration('nevecode').get('permissionMode', 'acceptEdits') });
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

