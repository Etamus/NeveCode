/**
 * chatRenderer — produces the full self-contained HTML document for the chat
 * webview.  All CSS and JS are inlined (no external bundles).
 *
 * The webview JS communicates with the extension host via postMessage.
 * Incoming messages update the DOM incrementally so streaming feels fluid.
 */

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderChatHtml({ nonce, platform, logoUri, cspSource }) {
  const modKey = platform === 'darwin' ? 'Cmd' : 'Ctrl';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource || ''} data: blob:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      --oc-bg: #0e0e10;
      --oc-panel: #141416;
      --oc-panel-strong: #1a1a1e;
      --oc-panel-soft: #1f1f24;
      --oc-border: #38383f;
      --oc-border-soft: rgba(200,200,210,0.14);
      --oc-text: #f0f0f5;
      --oc-text-dim: #b8b8c8;
      --oc-text-soft: #787888;
      --oc-accent: #9898b0;
      --oc-accent-bright: #c0c0d8;
      --oc-accent-soft: rgba(192,192,216,0.18);
      --oc-positive: #6abf8a;
      --oc-warning: #d4a84b;
      --oc-critical: #d46060;
      --oc-focus: #dcdcf0;
      --oc-user-bg: rgba(152,152,176,0.10);
      --oc-user-border: rgba(152,152,176,0.26);
      --oc-assistant-bg: rgba(255,255,255,0.025);
      --oc-assistant-border: rgba(200,200,210,0.09);
      --oc-code-bg: #18181c;
      --oc-code-border: rgba(200,200,210,0.11);
      --oc-tool-bg: rgba(255,255,255,0.018);
      --oc-tool-border: rgba(200,200,210,0.09);
      --oc-perm-bg: rgba(192,192,216,0.07);
      --oc-perm-border: rgba(192,192,216,0.30);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; overflow: hidden; }
    body {
      font-family: "Segoe UI", var(--vscode-font-family, system-ui, sans-serif);
      font-size: 13px;
      color: var(--oc-text);
      background: var(--oc-bg);
      display: flex;
      flex-direction: column;
      position: relative;
    }

    /* ── Header ── */
    .chat-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--oc-border-soft);
      background: var(--oc-panel);
      flex-shrink: 0;
    }
    .chat-header .brand {
      font-family: "Segoe UI", system-ui, sans-serif;
      font-weight: 400;
      font-size: 14px;
      color: var(--oc-text-dim);
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chat-header .brand.brand-hidden { visibility: hidden; }
    .chat-header .brand-accent { color: var(--oc-accent-bright); }
    .header-btn {
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--oc-text-dim);
      padding: 4px 6px;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .header-btn:hover { color: var(--oc-text); background: rgba(255,255,255,0.06); border-radius: 6px; }
    .header-btn.danger { color: var(--oc-critical); }
    .header-btn.danger:hover { background: rgba(255,138,108,0.12); }
    #abortBtn { display: none; }

    /* ── Status bar ── */
    .status-bar { display: none; }
    .status-text { display: none; }
    .status-usage { display: none; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

    /* ── Message list ── */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .messages { scrollbar-color: #4a4860 transparent; scrollbar-width: thin; }
    .messages::-webkit-scrollbar { width: 5px; }
    .messages::-webkit-scrollbar-track { display: none; background: transparent; }
    .messages::-webkit-scrollbar-track-piece { display: none; background: transparent; }
    .messages::-webkit-scrollbar-corner { display: none; background: transparent; }
    .messages::-webkit-scrollbar-thumb { background: #4a4860; border-radius: 3px; min-height: 32px; }
    .messages::-webkit-scrollbar-button,
    .messages::-webkit-scrollbar-button:vertical:start:decrement,
    .messages::-webkit-scrollbar-button:vertical:start:increment,
    .messages::-webkit-scrollbar-button:vertical:end:decrement,
    .messages::-webkit-scrollbar-button:vertical:end:increment,
    .messages::-webkit-scrollbar-button:start,
    .messages::-webkit-scrollbar-button:end,
    .messages::-webkit-scrollbar-button:vertical {
      display: none !important;
      height: 0 !important;
      width: 0 !important;
      background: transparent !important;
      -webkit-appearance: none !important;
      opacity: 0 !important;
    }

    /* ── Welcome screen ── */
    .welcome {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      text-align: center;
      padding: 32px 16px;
      gap: 16px;
    }
    .welcome-logo { display: flex; align-items: center; justify-content: center; color: var(--oc-text-dim); margin-bottom: 4px; line-height: 1; gap: 14px; margin-right: 28px; }
    .welcome-logo svg { display: block; max-width: 100%; }
    .welcome-logo-img { width: 52px; height: 52px; object-fit: contain; display: block; }
    .welcome-logo-text { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 26px; font-weight: 700; letter-spacing: 1px; color: var(--oc-text-dim); margin-left: -2px; margin-top: -3px; }
    .welcome-title { font-size: 20px; font-weight: 700; color: var(--oc-text); }
    .welcome-title .accent { color: var(--oc-accent-bright); }
    .welcome-sub { font-size: 13px; color: var(--oc-text-dim); max-width: 36ch; }
    .welcome-hint { font-size: 11px; color: var(--oc-text-soft); }
    .welcome-hint kbd {
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid var(--oc-border-soft);
      background: rgba(255,255,255,0.04);
      font-family: inherit;
      font-size: 11px;
    }

    /* ── User message ── */
    .msg-user {
      align-self: flex-end;
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 14px 14px 4px 14px;
      background: var(--oc-user-bg);
      border: 1px solid var(--oc-user-border);
      word-break: break-word;
      white-space: pre-wrap;
    }

    /* ── Assistant message — sem balão, só texto solto ── */
    .msg-assistant {
      align-self: flex-start;
      max-width: 95%;
      padding: 4px 0 6px;
      background: transparent;
      border: none;
      word-break: break-word;
    }
    .msg-assistant .md-content { line-height: 1.5; }
    .msg-assistant .md-content:empty { display: none; }
    .msg-assistant .md-content p { margin: 0 0 5px; }
    .msg-assistant .md-content p:last-child { margin-bottom: 0; }
    .msg-assistant .md-content ul,
    .msg-assistant .md-content ol { padding-left: 18px; margin: 0 0 5px; }
    .msg-assistant .md-content li { margin-bottom: 2px; }
    .msg-assistant .md-content h1,
    .msg-assistant .md-content h2,
    .msg-assistant .md-content h3 {
      color: var(--oc-text);
      margin: 8px 0 3px;
      font-size: 14px;
      font-weight: 700;
    }
    .msg-assistant .md-content h1 { font-size: 16px; }
    .msg-assistant .md-content a { color: var(--oc-accent-bright); text-decoration: underline; }
    .msg-assistant .md-content strong { color: var(--oc-text); font-weight: 700; }
    .msg-assistant .md-content em { font-style: italic; color: var(--oc-text-dim); }
    .msg-assistant .md-content blockquote {
      border-left: 3px solid var(--oc-accent);
      padding: 3px 10px;
      margin: 5px 0;
      color: var(--oc-text-dim);
    }
    .msg-assistant .md-content hr {
      border: none;
      border-top: 1px solid var(--oc-border-soft);
      margin: 8px 0;
    }

    /* inline code */
    .md-content code:not(.code-block code) {
      padding: 1px 5px;
      border-radius: 4px;
      background: var(--oc-code-bg);
      border: 1px solid var(--oc-code-border);
      font-family: var(--vscode-editor-font-family, Consolas, monospace);
      font-size: 12px;
      color: var(--oc-accent-bright);
    }

    /* fenced code */
    .code-wrapper {
      position: relative;
      margin: 2px 0;
      border-radius: 8px;
      border: 1px solid var(--oc-code-border);
      background: var(--oc-code-bg);
      overflow: hidden;
    }
    .code-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 10px;
      font-size: 11px;
      color: var(--oc-text-soft);
      border-bottom: 1px solid var(--oc-code-border);
      background: rgba(255,255,255,0.02);
    }
    .code-copy-btn {
      border: none;
      background: transparent;
      color: var(--oc-text-soft);
      cursor: pointer;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .code-copy-btn:hover { background: rgba(255,255,255,0.08); color: var(--oc-text); }
    .code-block {
      display: block;
      padding: 10px 12px;
      overflow-x: auto;
      font-family: var(--vscode-editor-font-family, Consolas, monospace);
      font-size: 12px;
      line-height: 1.5;
      white-space: pre;
      color: var(--oc-text-dim);
    }
    .code-block::-webkit-scrollbar { height: 4px; }
    .code-block::-webkit-scrollbar-thumb { background: rgba(220,195,170,0.2); border-radius: 2px; }

    /* keyword highlighting */
    .hl-keyword { color: #c586c0; }
    .hl-string { color: #ce9178; }
    .hl-comment { color: #6a9955; font-style: italic; }
    .hl-number { color: #b5cea8; }
    .hl-func { color: #dcdcaa; }
    .hl-type { color: #4ec9b0; }

    /* ── Tool use card ── */
    .tool-card {
      margin: 1px 0;
      border-radius: 8px;
      border: 1px solid var(--oc-tool-border);
      background: var(--oc-tool-bg);
      overflow: hidden;
    }
    .tool-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      cursor: pointer;
      user-select: none;
    }
    .tool-icon { font-size: 14px; flex-shrink: 0; display: none; }
    .tool-name { font-weight: 600; font-size: 12px; color: var(--oc-text); flex: 1; }
    .tool-status { font-size: 11px; color: var(--oc-text-soft); }
    .tool-status.running { color: var(--oc-text-dim); }
    .tool-status.error { color: var(--oc-critical); }
    .tool-status.complete { color: var(--oc-text-soft); }
    .tool-chevron {
      width: 14px;
      height: 14px;
      color: var(--oc-text-soft);
      flex-shrink: 0;
      transition: transform 150ms;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .tool-card.expanded .tool-chevron { transform: rotate(180deg); }
    .tool-body {
      display: none;
      padding: 0 10px 10px;
      font-size: 12px;
      border-top: 1px solid var(--oc-tool-border);
    }
    .tool-card.expanded .tool-body { display: block; }
    .tool-input-label,
    .tool-output-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--oc-text-soft);
      margin: 8px 0 4px;
    }
    .tool-input-content,
    .tool-output-content {
      padding: 6px 8px;
      border-radius: 6px;
      background: rgba(0,0,0,0.2);
      font-family: var(--vscode-editor-font-family, Consolas, monospace);
      font-size: 11px;
      color: var(--oc-text-dim);
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 200px;
      overflow-y: auto;
    }
    .tool-output-content.error { color: var(--oc-critical); }
    .tool-path {
      font-weight: 400;
      color: var(--oc-text-soft);
      font-size: 11px;
      margin-left: 4px;
    }
    .file-link {
      color: var(--oc-accent-bright);
      cursor: pointer;
      text-decoration: none;
      border-bottom: 1px dotted var(--oc-accent);
      transition: color 120ms, border-color 120ms;
    }
    .file-link:hover {
      color: var(--oc-focus);
      border-bottom-color: var(--oc-focus);
    }
    .tool-input-content.tool-diff-old {
      border-left: 3px solid var(--oc-critical);
      padding-left: 10px;
      color: #c0c0d8;
      text-decoration: line-through;
      opacity: 0.7;
    }
    .tool-input-content.tool-diff-new {
      border-left: 3px solid var(--oc-positive);
      padding-left: 10px;
      color: #c8e6a0;
    }
    .tool-diff-btn {
      margin-top: 6px;
      border: 1px solid var(--oc-accent);
      border-radius: 6px;
      background: rgba(240,148,100,0.08);
      color: var(--oc-accent-bright);
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
    }
    .tool-diff-btn:hover { background: rgba(240,148,100,0.16); }

    /* ── Permission card ── */
    .perm-card {
      margin: 8px 0;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--oc-perm-border);
      background: var(--oc-perm-bg);
    }
    .perm-title { font-weight: 700; font-size: 12px; color: var(--oc-critical); margin-bottom: 6px; }
    .perm-desc { font-size: 12px; color: var(--oc-text-dim); margin-bottom: 8px; }
    .perm-input {
      padding: 6px 8px;
      margin-bottom: 8px;
      border-radius: 6px;
      background: rgba(0,0,0,0.2);
      font-family: var(--vscode-editor-font-family, Consolas, monospace);
      font-size: 11px;
      color: var(--oc-text-dim);
      white-space: pre-wrap;
      max-height: 120px;
      overflow-y: auto;
    }
    .perm-actions { display: flex; gap: 6px; }
    .perm-btn {
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid;
    }
    .perm-btn.allow {
      background: rgba(232,184,107,0.14);
      border-color: var(--oc-positive);
      color: var(--oc-positive);
    }
    .perm-btn.deny {
      background: rgba(255,138,108,0.1);
      border-color: var(--oc-critical);
      color: var(--oc-critical);
    }
    .perm-btn.allow-session {
      background: rgba(232,184,107,0.08);
      border-color: rgba(232,184,107,0.4);
      color: var(--oc-text-dim);
    }
    .perm-btn:hover { filter: brightness(1.15); }

    /* ── Status pill ── */
    .msg-status {
      align-self: center;
      font-size: 11px;
      color: var(--oc-text-soft);
      padding: 4px 12px;
      border-radius: 999px;
      border: 1px solid var(--oc-border-soft);
      background: rgba(255,255,255,0.02);
    }

    /* ── Rate limit ── */
    .msg-rate-limit {
      align-self: center;
      font-size: 11px;
      color: var(--oc-warning);
      padding: 6px 14px;
      border-radius: 8px;
      border: 1px solid rgba(243,201,105,0.3);
      background: rgba(243,201,105,0.06);
    }

    /* ── Thinking block — sem balão, apenas texto inline ── */
    .thinking-block {
      display: none;
      padding: 2px 0 4px;
      margin: 2px 0;
      gap: 4px;
      flex-direction: column;
      background: transparent;
      border: none;
    }
    .thinking-block.visible { display: flex; }
    .thinking-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: var(--oc-text-soft);
      font-weight: 500;
    }
    .thinking-spinner {
      width: 12px; height: 12px;
      border: 2px solid rgba(150,150,170,0.25);
      border-top-color: var(--oc-text-dim);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .thinking-meta {
      font-size: 11px;
      color: var(--oc-text-soft);
    }

    /* ── Prefill progress bar ── */
    .prefill-bar {
      display: none;
      flex-direction: column;
      gap: 4px;
      padding: 2px 0 6px;
    }
    .prefill-bar.visible { display: flex; }
    .prefill-label {
      font-size: 11px;
      color: var(--oc-text-soft);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .prefill-label .prefill-spinner {
      width: 10px; height: 10px;
      border: 1.5px solid rgba(150,150,170,0.25);
      border-top-color: var(--oc-text-soft);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    .prefill-label .prefill-elapsed {
      margin-left: auto;
      font-size: 10px;
      color: var(--oc-text-soft);
      opacity: 0.7;
      font-variant-numeric: tabular-nums;
    }

    /* ── Gen indicators wrapper ── */
    .gen-indicators {
      flex-shrink: 0;
      padding: 0 12px 4px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      overflow: hidden;
    }

    /* ── Tool running spinner ── */
    .tool-running-spinner {
      display: inline-block;
      width: 11px; height: 11px;
      border: 1.5px solid rgba(150,150,170,0.25);
      border-top-color: var(--oc-text-soft);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      vertical-align: middle;
      margin-right: 4px;
    }

    /* ── Input area ── */
    .input-area {
      padding: 10px 12px;
      border-top: none;
      background: transparent;
      flex-shrink: 0;
    }
    .input-wrap {
      position: relative;
    }
    .input-area textarea {
      width: 100%;
      min-height: 84px;
      max-height: 200px;
      padding: 10px 48px 10px 14px;
      border: 1px solid var(--oc-border-soft);
      border-radius: 10px;
      background: rgba(255,255,255,0.04);
      color: var(--oc-text);
      font-family: inherit;
      font-size: 13px;
      resize: none;
      outline: none;
      line-height: 1.4;
      box-sizing: border-box;
    }
    .input-area textarea::placeholder { color: var(--oc-text-soft); }
    .input-area textarea:focus { border-color: var(--oc-accent); }
    .input-area textarea::-webkit-scrollbar { display: none; }
    .input-area textarea { scrollbar-width: none; }
    .send-btn {
      position: absolute;
      right: 8px;
      bottom: 8px;
      width: 30px;
      height: 30px;
      border-radius: 8px;
      border: none;
      background: transparent;
      color: rgba(152,152,176,0.30);
      cursor: not-allowed;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: color 140ms, background 140ms;
    }
    .send-btn:not(:disabled):not(.stopping) {
      color: var(--oc-accent-bright);
      cursor: pointer;
    }
    .send-btn:not(:disabled):not(.stopping):hover { color: var(--oc-focus); background: rgba(152,152,176,0.08); }
    .send-btn:disabled { opacity: 1; }
    .send-btn.stopping {
      color: var(--oc-accent-bright);
      cursor: pointer;
      opacity: 1;
    }
    .send-btn.stopping:hover { color: var(--oc-focus); background: rgba(152,152,176,0.08); }

    /* ── Permission mode button ── */
    .input-footer { display: flex; align-items: center; padding: 5px 2px 0; }
    .perm-wrap { position: relative; }
    .perm-btn {
      display: flex; align-items: center; gap: 4px;
      padding: 3px 8px 3px 6px;
      border-radius: 6px; border: 1px solid transparent;
      background: transparent;
      color: var(--oc-text-soft);
      font-family: 'Segoe UI', system-ui, sans-serif; font-size: 11px;
      cursor: pointer;
      transition: color 120ms, background 120ms, border-color 120ms;
      user-select: none; white-space: nowrap;
    }
    .perm-btn:hover { color: var(--oc-text-dim); border-color: var(--oc-border-soft); background: rgba(152,152,176,0.06); }
    .perm-btn svg { opacity: 0.55; flex-shrink: 0; }
    .perm-chevron { opacity: 0.4; }
    .perm-dropdown {
      position: absolute; bottom: calc(100% + 5px); left: 0;
      background: var(--oc-panel-strong);
      border: 1px solid var(--oc-border);
      border-radius: 9px; overflow: hidden; z-index: 200;
      min-width: 195px;
      box-shadow: 0 6px 24px rgba(0,0,0,0.55);
      display: none;
    }
    .perm-dropdown.open { display: block; }
    .perm-option {
      padding: 9px 14px; cursor: pointer;
      display: flex; flex-direction: column; gap: 1px;
      transition: background 100ms;
      border-bottom: 1px solid var(--oc-border-soft);
    }
    .perm-option:last-child { border-bottom: none; }
    .perm-option:hover { background: rgba(255,255,255,0.05); }
    .perm-option-label { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 12px; color: var(--oc-text-dim); font-weight: 500; }
    .perm-option-desc { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 10px; color: var(--oc-text-soft); }
    .perm-option.active .perm-option-label { color: var(--oc-accent-bright); }

    /* ── Session list overlay ── */
    .session-overlay {
      display: none;
      position: absolute;
      inset: 0;
      z-index: 100;
      background: rgba(5,5,5,0.92);
      flex-direction: column;
    }
    .session-overlay.visible { display: flex; }
    .session-overlay-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--oc-border-soft);
    }
    .session-overlay-header h2 { font-size: 14px; font-weight: 400; flex: 1; }
    .session-search {
      margin: 8px 12px;
      padding: 8px 10px;
      border: 1px solid var(--oc-border-soft);
      border-radius: 8px;
      background: rgba(255,255,255,0.04);
      color: var(--oc-text);
      font-size: 13px;
      outline: none;
    }
    .session-search:focus { border-color: var(--oc-accent); }
    .session-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 12px;
    }
    .session-group-label {
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 12px;
      letter-spacing: 0.05em;
      color: var(--oc-text-soft);
      padding: 8px 0 4px;
    }
    .session-item {
      position: relative;
      padding: 10px;
      padding-right: 34px;
      border-radius: 8px;
      border: 1px solid transparent;
      cursor: pointer;
      margin-bottom: 4px;
    }
    .session-item:hover { background: rgba(255,255,255,0.04); border-color: var(--oc-border-soft); }
    .session-item-title { font-weight: 600; font-size: 13px; color: var(--oc-text); margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-item-preview { font-size: 11px; color: var(--oc-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-item-time { font-size: 10px; color: var(--oc-text-soft); margin-top: 2px; }
    .session-delete-btn {
      position: absolute;
      right: 6px;
      top: 50%;
      transform: translateY(-50%);
      width: 22px;
      height: 22px;
      border-radius: 5px;
      border: none;
      background: transparent;
      color: var(--oc-text-soft);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 120ms, background 120ms, color 120ms;
    }
    .session-item:hover .session-delete-btn { opacity: 1; }
    .session-delete-btn:hover { background: rgba(150,150,170,0.10); color: var(--oc-text); }
    .session-empty { text-align: center; padding: 32px; color: var(--oc-text-soft); }
  </style>
</head>
<body>
  <div class="chat-header">
    <div class="brand brand-hidden" id="brandTitle"></div>
    <button class="header-btn" id="historyBtn" title="Histórico de sessões"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></button>
    <button class="header-btn" id="newChatBtn" title="Nova conversa"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
    <button class="header-btn danger" id="abortBtn" title="Interromper geração"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="3" ry="3"/></svg></button>
  </div>
  <div class="status-bar">
    <span class="status-dot" id="statusDot"></span>
    <span class="status-text" id="statusText">Pronto</span>
    <span class="status-usage" id="statusUsage"></span>
  </div>

  <div class="messages" id="messages">
    <div class="welcome" id="welcomeScreen">
      <div class="welcome-logo">
        ${logoUri
          ? `<img src="${logoUri}" class="welcome-logo-img" alt="Neve Code" /><span class="welcome-logo-text">Neve Code</span>`
          : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="240" height="60" aria-label="Neve Code">
          <defs>
            <g id="nc-arm" stroke="currentColor" stroke-linecap="round" fill="none">
              <line x1="0" y1="0" x2="0" y2="-26" stroke-width="1.8"/>
              <line x1="0" y1="-7" x2="5" y2="-10.5" stroke-width="1.5"/>
              <line x1="5" y1="-10.5" x2="0" y2="-14" stroke-width="1.5"/>
              <line x1="0" y1="-14" x2="-5" y2="-10.5" stroke-width="1.5"/>
              <line x1="-5" y1="-10.5" x2="0" y2="-7" stroke-width="1.5"/>
              <line x1="0" y1="-17" x2="5.5" y2="-20.5" stroke-width="1.5"/>
              <line x1="5.5" y1="-20.5" x2="0" y2="-24" stroke-width="1.5"/>
              <line x1="0" y1="-24" x2="-5.5" y2="-20.5" stroke-width="1.5"/>
              <line x1="-5.5" y1="-20.5" x2="0" y2="-17" stroke-width="1.5"/>
            </g>
          </defs>
          <g transform="translate(52,40)" stroke="currentColor" stroke-linecap="round" fill="none">
            <use href="#nc-arm"/>
            <use href="#nc-arm" transform="rotate(60)"/>
            <use href="#nc-arm" transform="rotate(120)"/>
            <use href="#nc-arm" transform="rotate(180)"/>
            <use href="#nc-arm" transform="rotate(240)"/>
            <use href="#nc-arm" transform="rotate(300)"/>
            <circle cx="0" cy="0" r="3.5" stroke-width="2"/>
            <circle cx="0" cy="0" r="1.5" fill="currentColor" stroke="none"/>
          </g>
          <text x="107" y="45" font-family="'Segoe UI', system-ui, sans-serif" font-size="30" font-weight="300" letter-spacing="1" fill="currentColor" dominant-baseline="middle">Neve Code</text>
        </svg>`}
      </div>
      <div class="welcome-sub">Faça uma pergunta, solicite uma alteração no código ou inicie uma nova tarefa.</div>
      <div class="welcome-hint">Pressione <kbd>${escapeHtml(modKey)}+L</kbd> para focar no campo de entrada</div>
    </div>
  </div>

  <div class="gen-indicators">
    <div class="thinking-block" id="thinkingBlock">
      <div class="thinking-header">
        <div class="thinking-spinner"></div>
        <span id="thinkingLabel">Pensando...</span>
      </div>
      <div class="thinking-meta" id="thinkingMeta"></div>
    </div>

    <div class="prefill-bar" id="prefillBar">
      <div class="prefill-label">
        <span class="prefill-spinner"></span>
        <span id="prefillText">Processando contexto...</span>
        <span class="prefill-elapsed" id="prefillElapsed">0s</span>
      </div>
    </div>
  </div>

  <div class="input-area">
    <div class="input-wrap">
      <textarea id="chatInput" placeholder="Descreva para a Neve..." rows="2"></textarea>
      <button class="send-btn" id="sendBtn" title="Enviar mensagem"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg></button>
    </div>
    <div class="input-footer">
      <div class="perm-wrap" id="permWrap">
        <button class="perm-btn" id="permBtn" title="Modo de permissão">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <span id="permLabel">Aceitar edições</span>
          <svg class="perm-chevron" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="perm-dropdown" id="permDropdown">
          <div class="perm-option" data-mode="default"><span class="perm-option-label">Padrão</span><span class="perm-option-desc">Solicita confirmação para cada operação</span></div>
          <div class="perm-option" data-mode="acceptEdits"><span class="perm-option-label">Aceitar edições</span><span class="perm-option-desc">Aceita edições de arquivo automaticamente</span></div>
          <div class="perm-option" data-mode="bypassPermissions"><span class="perm-option-label">Bypass total</span><span class="perm-option-desc">Executa tudo sem pedir confirmação</span></div>
          <div class="perm-option" data-mode="plan"><span class="perm-option-label">Somente planejar</span><span class="perm-option-desc">Apenas descreve o plano, sem executar</span></div>
        </div>
      </div>
    </div>
  </div>

  <!-- Sobreposição de lista de sessões -->
  <div class="session-overlay" id="sessionOverlay">
    <div class="session-overlay-header">
      <h2>Histórico de sessões</h2>
      <button class="header-btn" id="closeSessionsBtn">Fechar</button>
    </div>
    <input class="session-search" id="sessionSearch" type="text" placeholder="Pesquisar sessões..." />
    <div class="session-list" id="sessionList">
      <div class="session-empty">Nenhuma sessão encontrada</div>
    </div>
  </div>

<script nonce="${nonce}">
(function() {
  const vscode = acquireVsCodeApi();

  const messagesEl = document.getElementById('messages');
  const welcomeEl = document.getElementById('welcomeScreen');
  const inputEl = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const abortBtn = document.getElementById('abortBtn');
  const newChatBtn = document.getElementById('newChatBtn');
  const historyBtn = document.getElementById('historyBtn');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const statusUsage = document.getElementById('statusUsage');
  const typingIndicator = null; // removido — indicadores visuais substituem os 3 pontos
  const prefillBar = document.getElementById('prefillBar');
  const prefillText = document.getElementById('prefillText');
  const prefillElapsed = document.getElementById('prefillElapsed');
  const sessionOverlay = document.getElementById('sessionOverlay');
  const closeSessionsBtn = document.getElementById('closeSessionsBtn');
  const sessionSearch = document.getElementById('sessionSearch');
  const sessionList = document.getElementById('sessionList');
  const brandTitle = document.getElementById('brandTitle');
  const permBtn = document.getElementById('permBtn');
  const permLabel = document.getElementById('permLabel');
  const permDropdown = document.getElementById('permDropdown');

  const PERM_LABELS = {
    default: 'Padrão',
    acceptEdits: 'Aceitar edições',
    bypassPermissions: 'Bypass total',
    plan: 'Somente planejar',
  };

  let _currentPerm = 'acceptEdits';

  function setPermMode(mode, notify) {
    _currentPerm = mode;
    if (permLabel) permLabel.textContent = PERM_LABELS[mode] || mode;
    document.querySelectorAll('.perm-option').forEach(el => {
      el.classList.toggle('active', el.dataset.mode === mode);
    });
    if (notify !== false) vscode.postMessage({ type: 'set_permission_mode', mode });
  }

  if (permBtn) {
    permBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      permDropdown.classList.toggle('open');
    });
  }

  if (permDropdown) {
    permDropdown.addEventListener('click', (e) => {
      const opt = e.target.closest('.perm-option');
      if (opt && opt.dataset.mode) {
        setPermMode(opt.dataset.mode);
        permDropdown.classList.remove('open');
      }
      e.stopPropagation();
    });
  }

  document.addEventListener('click', () => {
    if (permDropdown) permDropdown.classList.remove('open');
  });

  let isStreaming = false;
  let _prefillTimer = null;
  let _prefillStart = 0;
  let currentAssistantEl = null;
  let currentTextEl = null;
  const toolResultMap = {};

  /* ── Markdown renderer ── */
  function renderMarkdown(text) {
    if (!text) return '';
    let html = escapeForMd(text);

    // fenced code blocks
    html = html.replace(/\`\`\`(\\w*?)\\n([\\s\\S]*?)\`\`\`/g, (_, lang, code) => {
      const langLabel = lang || 'text';
      const highlighted = highlightCode(code, langLabel);
      const id = 'cb-' + Math.random().toString(36).slice(2, 8);
      return '<div class="code-wrapper"><div class="code-header">' +
        '<span>' + langLabel + '</span>' +
        '<button class="code-copy-btn" data-copy-id="' + id + '">Copiar</button></div>' +
        '<code class="code-block" id="' + id + '">' + highlighted + '</code></div>';
    });

    // inline code
    html = html.replace(/\`([^\`]+?)\`/g, '<code>$1</code>');

    // headings
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // hr
    html = html.replace(/^---$/gm, '<hr/>');

    // bold / italic
    html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
    html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');

    // links
    html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" title="$2">$1</a>');

    // unordered lists (simple)
    html = html.replace(/^[\\-\\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\\/li>\\n?)+)/g, '<ul>$1</ul>');

    // ordered lists
    html = html.replace(/^\\d+\\. (.+)$/gm, '<li>$1</li>');

    // paragraphs (double newline)
    html = html.replace(/\\n\\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p><\\/p>/g, '');
    html = html.replace(/<p>(<h[123]>)/g, '$1');
    html = html.replace(/(<\\/h[123]>)<\\/p>/g, '$1');
    html = html.replace(/<p>(<ul>)/g, '$1');
    html = html.replace(/(<\\/ul>)<\\/p>/g, '$1');
    html = html.replace(/<p>(<blockquote>)/g, '$1');
    html = html.replace(/(<\\/blockquote>)<\\/p>/g, '$1');
    html = html.replace(/<p>(<hr\\/>)/g, '$1');
    html = html.replace(/(<hr\\/>)<\\/p>/g, '$1');
    html = html.replace(/<p>(<div class="code-wrapper">)/g, '$1');
    html = html.replace(/(<\\/div>)<\\/p>/g, '$1');

    return html;
  }

  function escapeForMd(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function highlightCode(code, lang) {
    let result = code;
    const kwPattern = /\\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|typeof|instanceof|switch|case|break|default|continue|do|in|of|yield|void|delete|true|false|null|undefined|this|super|extends|implements|interface|type|enum|public|private|protected|static|readonly|abstract|def|print|self|elif|except|finally|with|as|lambda|pass|raise|None|True|False)\\b/g;
    const strPattern = /(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|'[^']*?'|"[^"]*?")/g;
    const commentPattern = /(\\/{2}.*$|#.*$)/gm;
    const numPattern = /\\b(\\d+\\.?\\d*)\\b/g;

    result = result.replace(commentPattern, '<span class="hl-comment">$1</span>');
    result = result.replace(strPattern, '<span class="hl-string">$1</span>');
    result = result.replace(kwPattern, '<span class="hl-keyword">$1</span>');
    result = result.replace(numPattern, '<span class="hl-number">$1</span>');

    return result;
  }

  /* ── DOM helpers ── */
  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function hideWelcome() {
    if (welcomeEl) welcomeEl.style.display = 'none';
  }

  function showWelcome() {
    if (welcomeEl) welcomeEl.style.display = 'flex';
  }

  function setChatTitle(text) {
    if (!brandTitle) return;
    if (!text) {
      brandTitle.textContent = '';
      brandTitle.classList.add('brand-hidden');
    } else {
      brandTitle.textContent = text;
      brandTitle.classList.remove('brand-hidden');
    }
  }

  function updateSendBtn() {
    if (isStreaming) return; // em streaming o botão vira stop, não desabilitar
    sendBtn.disabled = !inputEl.value.trim();
  }

  const SEND_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
  const STOP_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="3" ry="3"/></svg>';

  function setStreaming(val, label) {
    isStreaming = val;
    abortBtn.style.display = 'none';
    if (val) {
      sendBtn.disabled = false;
      sendBtn.classList.add('stopping');
      sendBtn.title = 'Parar geração';
      sendBtn.innerHTML = STOP_ICON;
      // mostrar barra de prefill até o primeiro token chegar
      _showPrefill();
    } else {
      sendBtn.classList.remove('stopping');
      sendBtn.title = 'Enviar mensagem';
      sendBtn.innerHTML = SEND_ICON;
      updateSendBtn();
      _hidePrefill();
    }
    typingIndicator; // no-op — removido
    statusDot.className = 'status-dot ' + (val ? 'streaming' : 'connected');
    statusText.textContent = label || (val ? 'Gerando...' : 'Pronto');
  }

  function _showPrefill(label) {
    if (_prefillTimer !== null) {
      // Já rodando: apenas atualiza o label se fornecido
      if (label) prefillText.textContent = label;
      return;
    }
    _prefillStart = Date.now();
    prefillElapsed.textContent = '0s';
    prefillText.textContent = label || 'Processando contexto...';
    prefillBar.classList.add('visible');
    _prefillTimer = setInterval(() => {
      const s = Math.floor((Date.now() - _prefillStart) / 1000);
      prefillElapsed.textContent = s + 's';
    }, 500);
  }

  function _hidePrefill() {
    if (_prefillTimer) { clearInterval(_prefillTimer); _prefillTimer = null; }
    prefillBar.classList.remove('visible');
  }

  function setStatusLabel(label) {
    statusText.textContent = label;
  }

  function appendUserMessage(text) {
    hideWelcome();
    const el = document.createElement('div');
    el.className = 'msg-user';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function getOrCreateAssistantEl() {
    if (!currentAssistantEl) {
      hideWelcome();
      currentAssistantEl = document.createElement('div');
      currentAssistantEl.className = 'msg-assistant';
      currentTextEl = document.createElement('div');
      currentTextEl.className = 'md-content';
      currentAssistantEl.appendChild(currentTextEl);
      messagesEl.appendChild(currentAssistantEl);
    }
    return { container: currentAssistantEl, textEl: currentTextEl };
  }

  function finalizeAssistant() {
    // Hide the text div if it's empty (model went straight to tool use)
    if (currentTextEl && !currentTextEl.textContent.trim()) {
      currentTextEl.style.display = 'none';
    }
    // Remove the entire bubble if it has no visible content at all
    if (currentAssistantEl) {
      const hasText = currentTextEl && currentTextEl.textContent.trim();
      const hasToolCards = currentAssistantEl.querySelector('.tool-card');
      if (!hasText && !hasToolCards) {
        currentAssistantEl.remove();
      }
    }
    currentAssistantEl = null;
    currentTextEl = null;
  }

  function appendToolCard(toolUse) {
    const { container } = getOrCreateAssistantEl();
    const card = document.createElement('div');
    card.className = 'tool-card expanded';
    card.dataset.toolId = toolUse.id || '';
    const statusClass = toolUse.status || 'running';
    const statusLabel = statusClass === 'running'
      ? '<span class="tool-running-spinner"></span>'
      : statusClass === 'error' ? 'Erro' : 'Concluído';

    var inputSummary = '';
    if (toolUse.input && typeof toolUse.input === 'object') {
      if (toolUse.input.file_path || toolUse.input.path) {
        inputSummary = (toolUse.input.file_path || toolUse.input.path);
      }
      if (toolUse.input.command) {
        inputSummary = toolUse.input.command;
      }
    }
    if (!inputSummary) inputSummary = toolUse.inputPreview || '';

    var inputDetail = '';
    if (toolUse.input && typeof toolUse.input === 'object') {
      if (toolUse.input.new_string || toolUse.input.content) {
        var content = toolUse.input.new_string || toolUse.input.content || '';
        if (content.length > 500) content = content.slice(0, 500) + '... (truncated)';
        inputDetail = '<div class="tool-input-label">Alterações</div>' +
          '<div class="tool-input-content">' + escapeForMd(content) + '</div>';
      }
      if (toolUse.input.old_string && toolUse.input.new_string) {
        var oldStr = toolUse.input.old_string;
        var newStr = toolUse.input.new_string;
        if (oldStr.length > 300) oldStr = oldStr.slice(0, 300) + '...';
        if (newStr.length > 300) newStr = newStr.slice(0, 300) + '...';
        inputDetail = '<div class="tool-input-label">Substituir</div>' +
          '<div class="tool-input-content tool-diff-old">' + escapeForMd(oldStr) + '</div>' +
          '<div class="tool-input-label">Por</div>' +
          '<div class="tool-input-content tool-diff-new">' + escapeForMd(newStr) + '</div>';
      }
    }

    var isFileTool = inputSummary && !toolUse.input?.command;
    var fileLink = isFileTool
      ? '<a class="file-link" data-filepath="' + escapeForMd(inputSummary) + '" title="Abrir no editor">' + escapeForMd(inputSummary.split(/[\\/]/).pop() || inputSummary) + '</a>'
      : (inputSummary ? escapeForMd(inputSummary.split(/[\\/]/).pop() || inputSummary) : '');
    var pathDisplay = isFileTool
      ? '<div class="tool-input-label">Caminho</div><div class="tool-input-content"><a class="file-link" data-filepath="' + escapeForMd(inputSummary) + '" title="Abrir no editor">' + escapeForMd(inputSummary) + '</a></div>'
      : (inputSummary ? '<div class="tool-input-label">' + (toolUse.input?.command ? 'Comando' : 'Caminho') + '</div><div class="tool-input-content">' + escapeForMd(inputSummary) + '</div>' : '');

    card.innerHTML =
      '<div class="tool-header">' +
        '<span class="tool-icon">' + (toolUse.icon || '') + '</span>' +
        '<span class="tool-name">' + escapeForMd(toolUse.displayName || toolUse.name || 'Tool') +
          (fileLink ? ' <span class="tool-path">' + fileLink + '</span>' : '') +
        '</span>' +
        '<span class="tool-status ' + statusClass + '">' + statusLabel + '</span>' +
        '<span class="tool-chevron"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>' +
      '</div>' +
      '<div class="tool-body">' +
        pathDisplay +
        inputDetail +
        '<div class="tool-output-label">Saída</div>' +
        '<div class="tool-output-content" data-tool-output="' + (toolUse.id || '') + '" data-running="true"></div>' +
      '</div>';
    card.querySelector('.tool-header').addEventListener('click', () => {
      card.classList.toggle('expanded');
    });
    container.appendChild(card);
    scrollToBottom();
    return card;
  }

  function updateToolResult(toolUseId, content, isError) {
    const outputEl = document.querySelector('[data-tool-output="' + toolUseId + '"]');
    if (outputEl) {
      outputEl.textContent = content || '(concluído)';
      if (isError) outputEl.classList.add('error');
    }
    const card = document.querySelector('[data-tool-id="' + toolUseId + '"]');
    if (card) {
      const statusEl = card.querySelector('.tool-status');
      if (statusEl) {
        statusEl.className = 'tool-status ' + (isError ? 'error' : 'complete');
        statusEl.textContent = isError ? 'Erro' : 'Concluído';
      }
    }
  }

  function updateToolProgress(toolUseId, content) {
    const outputEl = document.querySelector('[data-tool-output="' + toolUseId + '"]');
    if (outputEl && outputEl.dataset.running === 'true') {
      outputEl.textContent = content || '';
      delete outputEl.dataset.running;
    }
  }

  function updateToolInput(toolUseId, input, toolName) {
    const card = document.querySelector('[data-tool-id="' + toolUseId + '"]');
    if (!card) return;
    const body = card.querySelector('.tool-body');
    if (!body) return;

    if (!input || typeof input !== 'object') return;

    // Update the header with clickable file path
    const nameEl = card.querySelector('.tool-name');
    if (nameEl && (input.file_path || input.path)) {
      const fp = input.file_path || input.path;
      const shortName = fp.split(/[\\/]/).pop() || fp;
      if (!nameEl.querySelector('.tool-path')) {
        nameEl.insertAdjacentHTML('beforeend', ' <span class="tool-path"><a class="file-link" data-filepath="' + escapeForMd(fp) + '" title="Open in editor">' + escapeForMd(shortName) + '</a></span>');
      }
    }

    // Update path display
    var pathHtml = '';
    if (input.file_path || input.path) {
      var fp = input.file_path || input.path;
      pathHtml = '<div class="tool-input-label">Caminho</div><div class="tool-input-content">' +
        '<a class="file-link" data-filepath="' + escapeForMd(fp) + '" title="Abrir no editor">' + escapeForMd(fp) + '</a></div>';
    }
    if (input.command) {
      pathHtml = '<div class="tool-input-label">Comando</div><div class="tool-input-content">' +
        escapeForMd(input.command) + '</div>';
    }

    // Build diff display for edit operations
    var diffHtml = '';
    if (input.old_string && input.new_string) {
      var oldStr = input.old_string;
      var newStr = input.new_string;
      if (oldStr.length > 500) oldStr = oldStr.slice(0, 500) + '... (truncado)';
      if (newStr.length > 500) newStr = newStr.slice(0, 500) + '... (truncado)';
      diffHtml = '<div class="tool-input-label">Substituir</div>' +
        '<div class="tool-input-content tool-diff-old">' + escapeForMd(oldStr) + '</div>' +
        '<div class="tool-input-label">Por</div>' +
        '<div class="tool-input-content tool-diff-new">' + escapeForMd(newStr) + '</div>';
    } else if (input.content || input.new_string) {
      var content = input.content || input.new_string || '';
      if (content.length > 800) content = content.slice(0, 800) + '... (truncado)';
      diffHtml = '<div class="tool-input-label">Conteúdo</div>' +
        '<div class="tool-input-content tool-diff-new">' + escapeForMd(content) + '</div>';
    }

    // Keep the output element
    const outputEl = body.querySelector('[data-tool-output]');
    const outputHtml = outputEl ? outputEl.outerHTML : '';
    const outputLabel = '<div class="tool-output-label">Saída</div>';

    body.innerHTML = pathHtml + diffHtml + outputLabel + outputHtml;
    card.classList.add('expanded');
    scrollToBottom();
  }

  function appendPermissionCard(perm) {
    hideWelcome();
    const el = document.createElement('div');
    el.className = 'perm-card';
    el.dataset.requestId = perm.requestId || '';
    el.innerHTML =
      '<div class="perm-title">Permissão Necessária: ' + escapeForMd(perm.displayName || perm.toolName || 'Ferramenta') + '</div>' +
      (perm.description ? '<div class="perm-desc">' + escapeForMd(perm.description) + '</div>' : '') +
      (perm.inputPreview ? '<div class="perm-input">' + escapeForMd(perm.inputPreview) + '</div>' : '') +
      '<div class="perm-actions">' +
        '<button class="perm-btn allow" data-action="allow">Permitir</button>' +
        '<button class="perm-btn deny" data-action="deny">Negar</button>' +
        '<button class="perm-btn allow-session" data-action="allow-session">Permitir para esta sessão</button>' +
      '</div>';
    el.querySelectorAll('.perm-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        vscode.postMessage({
          type: 'permission_response',
          requestId: perm.requestId,
          toolUseId: perm.toolUseId || null,
          action: action,
        });
        el.querySelectorAll('.perm-btn').forEach(b => { b.disabled = true; b.style.opacity = '0.4'; });
        btn.style.opacity = '1';
      });
    });
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function appendStatusMessage(text) {
    const el = document.createElement('div');
    el.className = 'msg-status';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function appendRateLimitMessage(text) {
    const el = document.createElement('div');
    el.className = 'msg-rate-limit';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  /* ── Thinking block ── */
  const thinkingBlock = document.getElementById('thinkingBlock');
  const thinkingLabel = document.getElementById('thinkingLabel');
  const thinkingMeta = document.getElementById('thinkingMeta');

  function showThinkingBlock() {
    thinkingBlock.classList.add('visible');
    thinkingLabel.textContent = 'Pensando...';
    thinkingMeta.textContent = '';
    setStatusLabel('Pensando...');
    scrollToBottom();
  }

  function updateThinkingBlock(tokens, elapsed) {
    const elapsedStr = elapsed >= 60
      ? Math.floor(elapsed / 60) + 'm ' + (elapsed % 60) + 's'
      : elapsed + 's';
    thinkingLabel.textContent = 'Pensando...';
    thinkingMeta.textContent = elapsedStr + ' · ~' + tokens + ' tokens';
    setStatusLabel('Pensando... (' + elapsedStr + ')');
  }

  function hideThinkingBlock() {
    thinkingBlock.classList.remove('visible');
    setStatusLabel('Gerando...');
  }

  /* ── Session list ── */
  function renderSessionList(sessions) {
    if (!sessions || sessions.length === 0) {
      sessionList.innerHTML = '<div class="session-empty">Nenhuma sessão encontrada</div>';
      return;
    }
    const groups = groupByDate(sessions);
    let html = '';
    for (const [label, items] of groups) {
      html += '<div class="session-group-label">' + escapeForMd(label) + '</div>';
      for (const s of items) {
        const _title = escapeForMd(s.title || s.id || 'Sem título');
        const _preview = (s.preview && !s.preview.startsWith((s.title || '').slice(0, 40)))
          ? '<div class="session-item-preview">' + escapeForMd(s.preview) + '</div>' : '';
        html += '<div class="session-item" data-session-id="' + (s.id || '') + '">' +
          '<div class="session-item-title">' + _title + '</div>' +
          _preview +
          '<div class="session-item-time">' + escapeForMd(s.timeLabel || '') + '</div>' +
          '<button class="session-delete-btn" data-delete-id="' + (s.id || '') + '" title="Excluir sessão"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>' +
        '</div>';
      }
    }
    sessionList.innerHTML = html;
    sessionList.querySelectorAll('.session-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: 'delete_session', sessionId: btn.dataset.deleteId });
      });
    });
    sessionList.querySelectorAll('.session-item').forEach(el => {
      el.addEventListener('click', () => {
        vscode.postMessage({ type: 'resume_session', sessionId: el.dataset.sessionId });
        sessionOverlay.classList.remove('visible');
      });
    });
  }

  function groupByDate(sessions) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const weekAgo = today - 604800000;
    const groups = new Map();
    for (const s of sessions) {
      const t = s.timestamp || 0;
      let label;
      if (t >= today) label = 'Hoje';
      else if (t >= yesterday) label = 'Ontem';
      else if (t >= weekAgo) label = 'Esta semana';
      else label = 'Mais antigas';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(s);
    }
    return groups;
  }

  let _chatTitle = '';

  /* ── Input handling ── */
  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isStreaming) return;
    if (!_chatTitle) setChatTitle(text);
    appendUserMessage(text);
    vscode.postMessage({ type: 'send_message', text });
    inputEl.value = '';
    autoResizeInput();
    setStreaming(true);
  }

  function autoResizeInput() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
  }

  sendBtn.disabled = true;

  inputEl.addEventListener('input', () => { autoResizeInput(); updateSendBtn(); });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  sendBtn.addEventListener('click', () => {
    if (isStreaming) {
      // Para imediatamente na UI sem esperar resposta do backend
      _hidePrefill();
      finalizeAssistant();
      setStreaming(false);
      vscode.postMessage({ type: 'abort' });
    } else {
      sendMessage();
    }
  });
  abortBtn.addEventListener('click', () => vscode.postMessage({ type: 'abort' }));
  newChatBtn.addEventListener('click', () => vscode.postMessage({ type: 'new_session' }));
  historyBtn.addEventListener('click', () => {
    sessionOverlay.classList.toggle('visible');
    if (sessionOverlay.classList.contains('visible')) {
      vscode.postMessage({ type: 'request_sessions' });
      sessionSearch.focus();
    }
  });
  closeSessionsBtn.addEventListener('click', () => sessionOverlay.classList.remove('visible'));
  sessionSearch.addEventListener('input', () => {
    const q = sessionSearch.value.toLowerCase();
    sessionList.querySelectorAll('.session-item').forEach(el => {
      const text = el.textContent.toLowerCase();
      el.style.display = text.includes(q) ? '' : 'none';
    });
  });

  // Copy code handler (event delegation)
  document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.code-copy-btn');
    if (copyBtn) {
      const id = copyBtn.dataset.copyId;
      const codeEl = document.getElementById(id);
      if (codeEl) {
        const text = codeEl.textContent;
        vscode.postMessage({ type: 'copy_code', text });
        copyBtn.textContent = 'Copiado!';
        setTimeout(() => { copyBtn.textContent = 'Copiar'; }, 1500);
      }
      return;
    }

    const fileLink = e.target.closest('.file-link');
    if (fileLink) {
      e.preventDefault();
      e.stopPropagation();
      const filepath = fileLink.dataset.filepath;
      if (filepath) {
        vscode.postMessage({ type: 'open_file', path: filepath });
      }
      return;
    }
  });

  /* ── Message handling from extension ── */
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;

    switch (msg.type) {
      case 'stream_start':
        // Servidor começou a gerar — atualiza label do prefill mas mantém timer
        _showPrefill('Aguardando 1º token...');
        setStreaming(true, 'Gerando...');
        getOrCreateAssistantEl();
        break;

      case 'stream_delta': {
        _hidePrefill(); // primeiro token chegou — esconde o indicador de prefill
        setStatusLabel('Gerando...');
        const { textEl } = getOrCreateAssistantEl();
        textEl.innerHTML = renderMarkdown(msg.text || '');
        scrollToBottom();
        break;
      }

      case 'stream_end':
        if (msg.text) {
          const { textEl } = getOrCreateAssistantEl();
          textEl.innerHTML = renderMarkdown(msg.text);
        }
        finalizeAssistant();
        if (msg.usage) {
          const u = msg.usage;
          statusUsage.textContent = (u.input_tokens || 0) + ' in / ' + (u.output_tokens || 0) + ' out';
        }
        if (msg.final) {
          setStreaming(false);
        }
        scrollToBottom();
        break;

      case 'tool_use':
        appendToolCard(msg.toolUse);
        setStatusLabel('Executando: ' + (msg.toolUse.displayName || msg.toolUse.name || 'ferramenta') + '...');
        break;

      case 'tool_result':
        updateToolResult(msg.toolUseId, msg.content, msg.isError);
        break;

      case 'tool_input_ready':
        updateToolInput(msg.toolUseId, msg.input, msg.name);
        break;

      case 'tool_progress':
        updateToolProgress(msg.toolUseId, msg.content);
        break;

      case 'permission_request':
        appendPermissionCard(msg);
        break;

      case 'status':
        setStatusLabel(msg.content || 'Trabalhando...');
        break;

      case 'rate_limit':
        appendRateLimitMessage(msg.message || 'Limite de taxa atingido');
        break;

      case 'thinking_start':
        showThinkingBlock();
        break;

      case 'thinking_delta':
        updateThinkingBlock(msg.tokens || 0, msg.elapsed || 0);
        break;

      case 'thinking_end':
        hideThinkingBlock();
        break;

      case 'system_info':
        if (msg.model) {
          statusUsage.textContent = msg.model;
        }
        break;

      case 'error':
        setStreaming(false);
        finalizeAssistant();
        statusDot.className = 'status-dot error';
        statusText.textContent = 'Erro: ' + (msg.message || 'Erro desconhecido');
        break;

      case 'session_list':
        renderSessionList(msg.sessions);
        break;

      case 'init_config':
        if (msg.permissionMode) setPermMode(msg.permissionMode, false);
        break;

      case 'session_cleared':
        messagesEl.innerHTML = '';
        if (welcomeEl) {
          messagesEl.appendChild(welcomeEl);
          showWelcome();
        }
        currentAssistantEl = null;
        currentTextEl = null;
        _chatTitle = '';
        setChatTitle('');
        statusUsage.textContent = '';
        statusDot.className = 'status-dot connected';
        statusText.textContent = 'Pronto';
        break;

      case 'restore_messages':
        hideWelcome();
        if (msg.messages) {
          const firstUser = msg.messages.find(m => m.role === 'user');
          _chatTitle = firstUser ? firstUser.text || '' : '';
          setChatTitle(_chatTitle);
          for (const m of msg.messages) {
            if (m.role === 'user') {
              appendUserMessage(m.text || '');
            } else if (m.role === 'assistant') {
              const { textEl } = getOrCreateAssistantEl();
              textEl.innerHTML = renderMarkdown(m.text || '');
              if (m.toolUses && m.toolUses.length > 0) {
                for (const tu of m.toolUses) {
                  var displayName = tu.name || 'Tool';
                  var icon = '';
                  var inputPreview = '';
                  if (tu.input && typeof tu.input === 'object') {
                    inputPreview = tu.input.file_path || tu.input.path || tu.input.command || '';
                  }
                  var card = appendToolCard({
                    id: tu.id,
                    name: tu.name,
                    displayName: displayName,
                    icon: icon,
                    inputPreview: inputPreview,
                    input: tu.input,
                    status: tu.status || 'complete',
                  });
                  if (tu.input) {
                    updateToolInput(String(tu.id), tu.input, tu.name);
                  }
                  if (tu.result !== undefined && tu.result !== null) {
                    updateToolResult(String(tu.id), tu.result, tu.isError || false);
                  } else {
                    updateToolResult(String(tu.id), '(done)', false);
                  }
                }
              }
              finalizeAssistant();
            }
          }
        }
        scrollToBottom();
        break;

      case 'connected':
        setStreaming(false);
        statusDot.className = 'status-dot connected';
        statusText.textContent = '';
        break;

      default:
        break;
    }
  });

  // Focus input on Ctrl/Cmd+L
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
      e.preventDefault();
      inputEl.focus();
    }
  });

  // Restore state
  const prevState = vscode.getState();
  if (prevState && prevState.hasMessages) {
    vscode.postMessage({ type: 'restore_request' });
  }

  // Notify ready
  vscode.postMessage({ type: 'webview_ready' });
})();
</script>
</body>
</html>`;
}

module.exports = { renderChatHtml };
