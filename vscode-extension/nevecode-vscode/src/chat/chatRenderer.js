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
    /* ── Reset ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; overflow: hidden; }

    body {
      font-family: var(--vscode-font-family, -apple-system, "Segoe UI", system-ui, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* ── Scrollbars ── */
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background, rgba(121,121,121,0.4)); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground, rgba(121,121,121,0.7)); }
    ::-webkit-scrollbar-corner { background: transparent; }
    * { scrollbar-width: thin; scrollbar-color: var(--vscode-scrollbarSlider-background, rgba(121,121,121,0.4)) transparent; }

    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }

    /* ── Header ── */
    .chat-header {
      display: flex; align-items: center; gap: 2px;
      padding: 4px 6px 4px 10px;
      border-bottom: 1px solid var(--vscode-panel-border, transparent);
      flex-shrink: 0; min-height: 35px;
    }
    .chat-header .brand {
      font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
      color: var(--vscode-foreground); opacity: 0.6;
      flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      text-transform: uppercase;
    }
    .chat-header .brand.brand-hidden { visibility: hidden; }
    .header-btn {
      display: flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; border-radius: 4px; border: none;
      background: transparent; color: var(--vscode-icon-foreground, var(--vscode-foreground));
      cursor: pointer; opacity: 0.6; transition: opacity 100ms, background 100ms;
      flex-shrink: 0; padding: 0;
    }
    .header-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
    .header-btn.danger { color: var(--vscode-errorForeground); }
    #abortBtn { display: none; }
    button:focus { outline: none; }
    button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }

    /* ── Status bar hidden ── */
    .status-bar, .status-text, .status-usage { display: none; }

    /* ── Message list ── */
    .messages {
      flex: 1; overflow-y: auto; overflow-x: hidden;
      display: flex; flex-direction: column;
    }

    /* ── Welcome ── */
    .welcome {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; flex: 1; min-height: 260px;
      text-align: center; padding: 32px 24px 16px; gap: 0;
    }
    .welcome-logo {
      display: flex; align-items: center; justify-content: center;
      gap: 10px; margin-bottom: 14px; margin-left: -14px;
      color: var(--vscode-foreground); opacity: 0.9;
    }
    .welcome-logo svg { display: block; }
    .welcome-logo-img { width: 36px; height: 36px; object-fit: contain; }
    .welcome-logo-text { font-size: 20px; font-weight: 600; color: var(--vscode-foreground); }
    .welcome-sub { font-size: 12px; color: var(--vscode-descriptionForeground); max-width: 36ch; line-height: 1.6; margin-bottom: 12px; }
    .welcome-hint { font-size: 11px; color: var(--vscode-descriptionForeground); opacity: 0.55; }
    .welcome-hint kbd {
      display: inline-block; padding: 1px 5px; border-radius: 3px;
      border: 1px solid var(--vscode-keybindingLabel-border, rgba(128,128,128,0.4));
      background: var(--vscode-keybindingLabel-background, rgba(128,128,128,0.10));
      color: var(--vscode-keybindingLabel-foreground, var(--vscode-foreground));
      font-family: inherit; font-size: 10px;
    }

    /* ── User message bubble ── */
    .msg-user {
      align-self: flex-end; max-width: 88%;
      padding: 8px 12px; margin: 10px 12px 0;
      border-radius: 18px 18px 4px 18px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      color: var(--vscode-foreground);
      word-break: break-word; white-space: pre-wrap;
      font-size: 13px; line-height: 1.55;
    }
    .msg-user:last-child { margin-bottom: 10px; }

    /* ── Assistant response: no bubble, flush to left ── */
    .msg-assistant { padding: 10px 16px 2px; min-width: 0; width: 100%; }
    .msg-assistant:last-child { padding-bottom: 12px; }

    /* ── Markdown ── */
    .md-content { font-size: 13px; line-height: 1.65; color: var(--vscode-foreground); min-width: 0; overflow-wrap: break-word; word-break: break-word; }
    .md-content:empty { display: none; }
    .md-content p { margin: 0 0 8px; line-height: 1.65; }
    .md-content p:last-child { margin-bottom: 0; }
    .md-content ul, .md-content ol { padding-left: 20px; margin: 0 0 8px; }
    .md-content li { margin-bottom: 2px; line-height: 1.55; }
    .md-content h1, .md-content h2, .md-content h3, .md-content h4 { color: var(--vscode-foreground); font-weight: 700; margin: 4px 0 3px; line-height: 1.3; }
    .md-content h1 { font-size: 17px; } .md-content h2 { font-size: 14px; } .md-content h3, .md-content h4 { font-size: 13px; }
    .md-content h1:first-child, .md-content h2:first-child, .md-content h3:first-child { margin-top: 0; }
    .md-content a { color: var(--vscode-textLink-foreground); text-decoration: none; }
    .md-content a:hover { text-decoration: underline; }
    .md-content strong { font-weight: 700; } .md-content em { font-style: italic; }
    .md-content blockquote { border-left: 3px solid var(--vscode-textBlockQuote-border, var(--vscode-focusBorder)); padding: 3px 12px; margin: 6px 0; color: var(--vscode-descriptionForeground); background: var(--vscode-textBlockQuote-background, transparent); }
    .md-content hr { border: none; border-top: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); margin: 10px 0; }
    .md-content table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 12px; }
    .md-content th, .md-content td { border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); padding: 4px 10px; text-align: left; }
    .md-content th { background: var(--vscode-editorGroupHeader-tabsBackground); font-weight: 600; }
    .md-content tr:nth-child(even) td { background: var(--vscode-list-hoverBackground); }

    /* ── Inline code ── */
    .md-content code:not(.code-block code) {
      font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
      font-size: 12px; padding: 1px 4px; border-radius: 3px;
      background: var(--vscode-textCodeBlock-background); color: var(--vscode-foreground);
    }

    /* ── Fenced code block — identical to Copilot Chat ── */
    .code-wrapper {
      position: relative; margin: 6px 0;
      border-radius: 6px;
      background: var(--vscode-textCodeBlock-background);
      overflow: hidden;
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border, transparent));
    }
    .code-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 4px 10px 4px 14px;
      background: var(--vscode-editorGroupHeader-tabsBackground, transparent);
      border-bottom: 1px solid var(--vscode-editorWidget-border, transparent);
      user-select: none;
    }
    .code-lang { font-family: var(--vscode-editor-font-family, Consolas, monospace); font-size: 11px; color: var(--vscode-descriptionForeground); opacity: 0.8; }
    .code-copy-btn {
      display: flex; align-items: center; gap: 4px; border: none; background: transparent;
      color: var(--vscode-descriptionForeground); cursor: pointer;
      font-family: var(--vscode-font-family, "Segoe UI"); font-size: 11px;
      padding: 2px 6px; border-radius: 3px; transition: color 100ms, background 100ms;
    }
    .code-copy-btn:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
    .code-block {
      display: block; padding: 12px 16px; overflow-x: auto;
      font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
      font-size: var(--vscode-editor-font-size, 12px); line-height: 1.6; white-space: pre;
      color: var(--vscode-editor-foreground, var(--vscode-foreground)); tab-size: 2;
    }
    .hl-keyword { color: #569cd6; } .hl-string { color: #ce9178; }
    .hl-comment { color: #6a9955; font-style: italic; } .hl-number { color: #b5cea8; }
    .hl-func { color: #dcdcaa; } .hl-type { color: #4ec9b0; }

    /* ── Tool card (Copilot "Working" style) ── */
    .tool-card {
      margin: 3px 0; border-radius: 5px; overflow: hidden;
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border, transparent));
      background: transparent;
    }
    .tool-header {
      display: flex; align-items: center; gap: 7px;
      padding: 5px 10px; cursor: pointer; user-select: none; min-height: 28px;
      border-radius: 5px; transition: background 80ms;
    }
    .tool-header:hover { background: var(--vscode-list-hoverBackground); }
    .tool-icon { display: flex; align-items: center; color: var(--vscode-descriptionForeground); flex-shrink: 0; opacity: 0.8; }
    .tool-name { font-size: 12px; color: var(--vscode-foreground); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tool-path { font-size: 11px; color: var(--vscode-descriptionForeground); margin-left: 3px; font-weight: 400; }
    .tool-status { font-size: 11px; color: var(--vscode-descriptionForeground); flex-shrink: 0; display: flex; align-items: center; gap: 3px; }
    .tool-status.error { color: var(--vscode-errorForeground); }
    .tool-running-spinner {
      display: inline-block; width: 11px; height: 11px;
      border: 1.5px solid rgba(128,128,128,0.25);
      border-top-color: var(--vscode-descriptionForeground);
      border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0;
    }
    .tool-chevron { color: var(--vscode-descriptionForeground); flex-shrink: 0; display: flex; align-items: center; transition: transform 150ms; opacity: 0.5; }
    .tool-card.no-output .tool-chevron { visibility: hidden; }
    .tool-card.no-output .tool-header { cursor: default; }
    .tool-card.expanded .tool-chevron { transform: rotate(180deg); }
    .tool-body { display: none; padding: 0 12px 10px; border-top: 1px solid var(--vscode-editorWidget-border, transparent); }
    .tool-card.expanded .tool-body { display: block; }
    .tool-input-label, .tool-output-label {
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--vscode-descriptionForeground); opacity: 0.65; margin: 8px 0 4px;
    }
    .tool-input-content, .tool-output-content {
      padding: 6px 8px; border-radius: 4px;
      background: var(--vscode-textCodeBlock-background);
      border: 1px solid var(--vscode-editorWidget-border, transparent);
      font-family: var(--vscode-editor-font-family, Consolas, monospace);
      font-size: 11px; color: var(--vscode-editor-foreground, var(--vscode-foreground));
      white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto;
    }
    .tool-output-content.error { color: var(--vscode-errorForeground); }
    .tool-input-content.tool-diff-old { border-left: 3px solid var(--vscode-errorForeground); padding-left: 8px; opacity: 0.75; text-decoration: line-through; }
    .tool-input-content.tool-diff-new { border-left: 3px solid var(--vscode-gitDecoration-addedResourceForeground, #89d185); padding-left: 8px; }

    /* ── File link ── */
    .file-link { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; }
    .file-link:hover { text-decoration: underline; }

    /* ── Permission card ── */
    .perm-card { margin: 8px 0; padding: 10px 12px; border-radius: 6px; border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground)); background: var(--vscode-inputValidation-warningBackground, transparent); }
    .perm-title { font-weight: 600; font-size: 12px; color: var(--vscode-editorWarning-foreground, var(--vscode-foreground)); margin-bottom: 4px; }
    .perm-desc { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
    .perm-input { padding: 6px 8px; margin-bottom: 8px; border-radius: 4px; background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family, Consolas, monospace); font-size: 11px; color: var(--vscode-foreground); white-space: pre-wrap; max-height: 100px; overflow-y: auto; }
    .perm-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .perm-btn { padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid transparent; font-family: inherit; }
    .perm-btn.allow { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .perm-btn.allow:hover { background: var(--vscode-button-hoverBackground); }
    .perm-btn.deny, .perm-btn.allow-session { background: transparent; color: var(--vscode-foreground); border-color: var(--vscode-editorWidget-border, rgba(128,128,128,0.4)); }
    .perm-btn.deny:hover, .perm-btn.allow-session:hover { background: var(--vscode-list-hoverBackground); }

    /* ── Status / rate limit ── */
    .msg-status { align-self: center; font-size: 11px; color: var(--vscode-descriptionForeground); padding: 2px 10px; margin: 5px auto; }
    .msg-rate-limit { margin: 6px 16px; padding: 6px 10px; border-radius: 4px; font-size: 12px; color: var(--vscode-editorWarning-foreground); border: 1px solid var(--vscode-inputValidation-warningBorder); background: var(--vscode-inputValidation-warningBackground); }

    /* ────────────────────────────────────────────────────────────────
       THINKING BLOCK — collapsible panel with streaming reasoning text
       (exactly like Copilot Chat "Working" section, but for reasoning)
       ──────────────────────────────────────────────────────────────── */
    .th-block {
      display: none;
      margin: 2px 16px 6px;
      border-radius: 6px;
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border, transparent));
      overflow: hidden;
    }
    .th-block.visible { display: block; }
    /* header row */
    .th-header {
      display: flex; align-items: center; gap: 7px;
      padding: 6px 10px;
      background: var(--vscode-editorGroupHeader-tabsBackground, transparent);
      cursor: pointer; user-select: none;
    }
    .th-header:hover { background: var(--vscode-list-hoverBackground); }
    .th-spinner {
      width: 12px; height: 12px; flex-shrink: 0;
      border: 1.5px solid rgba(128,128,128,0.25);
      border-top-color: var(--vscode-descriptionForeground);
      border-radius: 50%; animation: spin 0.8s linear infinite;
    }
    .th-block.done .th-spinner { display: none; }
    .th-check {
      display: none; flex-shrink: 0; opacity: 0.6;
      color: var(--vscode-descriptionForeground);
    }
    .th-block.done .th-check { display: flex; align-items: center; }
    .th-label {
      flex: 1; font-size: 12px;
      color: var(--vscode-descriptionForeground); font-style: italic;
    }
    .th-meta { font-size: 11px; color: var(--vscode-descriptionForeground); opacity: 0.55; flex-shrink: 0; }
    .th-chevron {
      flex-shrink: 0; display: flex; align-items: center;
      color: var(--vscode-descriptionForeground); opacity: 0.5;
      transition: transform 150ms;
    }
    .th-block.collapsed .th-chevron { transform: rotate(-90deg); }
    /* content area */
    .th-body {
      border-top: 1px solid var(--vscode-editorWidget-border, transparent);
      background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.08));
      max-height: 160px; overflow-y: auto; overflow-x: hidden;
      padding: 8px 14px 10px;
      transition: max-height 200ms ease;
    }
    .th-block.collapsed .th-body { display: none; }
    .th-text {
      font-family: var(--vscode-editor-font-family, Consolas, monospace);
      font-size: 11px; line-height: 1.55;
      color: var(--vscode-descriptionForeground); opacity: 0.85;
      white-space: pre-wrap; word-break: break-word;
    }

    /* ── Prefill bar ── */
    .prefill-bar {
      display: none; align-items: center; gap: 8px;
      margin: 0 16px 4px; padding: 4px 0;
      font-size: 12px; color: var(--vscode-descriptionForeground);
    }
    .prefill-bar.visible { display: flex; }
    .prefill-spinner {
      width: 11px; height: 11px; flex-shrink: 0;
      border: 1.5px solid rgba(128,128,128,0.25);
      border-top-color: var(--vscode-descriptionForeground);
      border-radius: 50%; animation: spin 0.8s linear infinite;
    }
    .prefill-elapsed { margin-left: auto; font-size: 11px; font-variant-numeric: tabular-nums; opacity: 0.55; }

    /* ── Gen indicators wrapper (holds thinking + prefill) ── */
    .gen-indicators { flex-shrink: 0; padding: 0 0 2px; display: flex; flex-direction: column; }

    /* ── Input area ── */
    .input-area {
      flex-shrink: 0; padding: 0 8px 8px; display: flex; flex-direction: column;
    }
    .file-chips-row {
      display: none; flex-wrap: wrap; gap: 4px; padding: 6px 8px 4px;
      border: 1px solid var(--vscode-input-border, transparent);
      border-bottom: none; border-radius: 6px 6px 0 0;
      background: var(--vscode-input-background);
    }
    .file-chips-row.has-chips { display: flex; }
    .file-chip {
      display: flex; align-items: center; gap: 5px; padding: 4px 10px 4px 8px;
      border-radius: 4px; border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,0.25));
      background: var(--vscode-editorGroupHeader-tabsBackground, rgba(128,128,128,0.1));
      font-size: 12px; color: var(--vscode-foreground);
      max-width: 220px; user-select: none;
    }
    .file-chip-icon { flex-shrink: 0; opacity: 0.65; }
    .file-chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
    .file-chip-remove {
      flex-shrink: 0; width: 16px; height: 16px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 50%; cursor: pointer; opacity: 0.45;
      color: var(--vscode-foreground); transition: opacity 120ms;
    }
    .file-chip-remove:hover { opacity: 1; }

    .input-box {
      display: flex; flex-direction: column;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 6px; background: var(--vscode-input-background);
      transition: border-color 120ms;
    }
    .file-chips-row.has-chips + .input-box { border-radius: 0 0 6px 6px; border-top: none; }
    .input-box:focus-within { border-color: var(--vscode-focusBorder); }
    .input-area textarea {
      width: 100%; min-height: 52px; max-height: 200px;
      padding: 9px 12px 6px; border: none; border-radius: 6px 6px 0 0;
      background: transparent; color: var(--vscode-input-foreground, var(--vscode-foreground));
      font-family: var(--vscode-font-family, "Segoe UI", system-ui); font-size: 13px;
      resize: none; outline: none; line-height: 1.55;
    }
    .input-area textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
    .input-area textarea::-webkit-scrollbar { display: none; }
    .input-area textarea { scrollbar-width: none; }

    .input-box-bar {
      display: flex; align-items: center; padding: 3px 6px 4px; gap: 2px;
      border-top: 1px solid var(--vscode-editorWidget-border, transparent);
    }
    .attach-btn {
      display: flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; border-radius: 4px; border: none;
      background: transparent; color: var(--vscode-icon-foreground, var(--vscode-foreground));
      font-size: 18px; font-weight: 300; line-height: 1;
      cursor: pointer; opacity: 0.6; transition: opacity 120ms, background 120ms; padding: 0;
    }
    .attach-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }

    /* bar buttons — lightweight, text+icon combos */
    .bar-btn {
      display: flex; align-items: center; gap: 3px; padding: 2px 6px; height: 22px;
      border-radius: 4px; border: none; background: transparent;
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-font-family, "Segoe UI"); font-size: 11px;
      cursor: pointer; user-select: none; white-space: nowrap;
      transition: background 120ms, color 120ms; flex-shrink: 0;
    }
    .bar-btn:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
    #envBtn:hover, #modelBtn:hover { background: transparent; color: var(--vscode-descriptionForeground); }
    .bar-btn svg { opacity: 0.70; flex-shrink: 0; }
    .bar-chevron { opacity: 0.45 !important; }
    .bar-btn.bar-icon { padding: 2px 4px; }

    .send-btn {
      margin-left: auto; display: flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 5px; border: none;
      background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.18));
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      cursor: not-allowed; opacity: 0.35;
      transition: opacity 120ms, background 120ms; flex-shrink: 0; padding: 0;
    }
    .send-btn:not(:disabled):not(.stopping) { opacity: 1; cursor: pointer; }
    .send-btn:not(:disabled):not(.stopping):hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.28)); }
    .send-btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .send-btn.stopping { opacity: 1; cursor: pointer; }
    .send-btn.stopping:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.28)); }

    /* ── Input footer ── */
    .input-footer { display: flex; align-items: center; padding: 4px 2px 0; gap: 2px; }
    .perm-wrap { position: relative; }
    .perm-dropdown {
      position: absolute; bottom: calc(100% + 4px); left: 0;
      background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-menu-border, var(--vscode-editorWidget-border));
      border-radius: 6px; overflow: hidden; z-index: 300; min-width: 200px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3); display: none;
    }
    .perm-dropdown.open { display: block; }
    .perm-option { padding: 7px 14px; cursor: pointer; display: flex; flex-direction: column; gap: 1px; transition: background 80ms; }
    .perm-option:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.1)); }
    .perm-option-label { font-size: 12px; color: var(--vscode-foreground); font-weight: 500; }
    .perm-option-desc { font-size: 11px; color: var(--vscode-descriptionForeground); }
    .perm-option.active { background: rgba(128,128,128,0.14); }
    .perm-option.active .perm-option-label { color: var(--vscode-foreground); font-weight: 700; }

    /* ── Session overlay ── */
    .session-overlay {
      display: none; position: absolute; inset: 0; z-index: 200;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      flex-direction: column;
    }
    .session-overlay.visible { display: flex; }
    .session-overlay-header {
      display: flex; align-items: center; gap: 8px; padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); flex-shrink: 0;
    }
    .session-overlay-header h2 { font-size: 14px; font-weight: 400; flex: 1; color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground)); opacity: 0.85; }
    .session-search { margin: 6px 10px; padding: 6px 10px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground, var(--vscode-foreground)); font-family: var(--vscode-font-family); font-size: 12px; outline: none; flex-shrink: 0; }
    .session-search:focus { border-color: var(--vscode-focusBorder); }
    .session-list { flex: 1; overflow-y: auto; padding: 4px 8px 8px; }
    .session-group-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-descriptionForeground)); padding: 10px 6px 4px; }
    .session-item { position: relative; padding: 7px 32px 7px 8px; border-radius: 4px; cursor: pointer; margin-bottom: 2px; }
    .session-item:hover { background: var(--vscode-list-hoverBackground); }
    .session-item-title { font-size: 13px; font-weight: 500; color: var(--vscode-foreground); margin-bottom: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-item-preview { font-size: 11px; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-item-time { font-size: 10px; color: var(--vscode-descriptionForeground); opacity: 0.55; }
    .session-delete-btn { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 22px; height: 22px; border-radius: 4px; border: none; background: transparent; color: var(--vscode-foreground); cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 120ms, background 120ms; }
    .session-item:hover .session-delete-btn { opacity: 0.5; }
    .session-delete-btn:hover { opacity: 1 !important; background: var(--vscode-list-hoverBackground); }
    .session-empty { text-align: center; padding: 32px; font-size: 12px; color: var(--vscode-descriptionForeground); }
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
      <div class="welcome-sub">Solicite uma alteração no código ou inicie uma nova tarefa.</div>
      <div class="welcome-hint">Pressione <kbd>${escapeHtml(modKey)}+L</kbd> para focar no campo de entrada</div>
    </div>
  </div>

  <div class="gen-indicators">
    <!-- Thinking / reasoning block — streams text, then collapses -->
    <div class="th-block" id="thinkingBlock">
      <div class="th-header" id="thinkingHeader">
        <div class="th-spinner"></div>
        <span class="th-check"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
        <span class="th-label" id="thinkingLabel">Pensando...</span>
        <span class="th-meta" id="thinkingMeta"></span>
        <span class="th-chevron"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
      </div>
      <div class="th-body" id="thinkingBody">
        <div class="th-text" id="thinkingText"></div>
      </div>
    </div>

    <div class="prefill-bar" id="prefillBar">
      <div class="prefill-spinner"></div>
      <span id="prefillText">Processando contexto...</span>
      <span class="prefill-elapsed" id="prefillElapsed">0s</span>
    </div>
  </div>

  <div class="input-area">
    <div class="input-box">
      <div class="file-chips-row" id="fileChipsRow"></div>
      <textarea id="chatInput" placeholder="Descreva para a Neve..." rows="1"></textarea>
      <div class="input-box-bar">
        <button class="attach-btn" id="attachBtn" title="Anexar arquivo">+</button>
        <button class="bar-btn" id="modelBtn" title="Modelo de IA">
          <span id="modelLabel"></span>
        </button>
        <button class="send-btn" id="sendBtn" title="Enviar mensagem"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg></button>
      </div>
    </div>
    <div class="input-footer">
      <button class="bar-btn" id="envBtn" title="Ambiente de execução">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        <span>Local</span>
      </button>
      <div class="perm-wrap" id="permWrap">
        <button class="bar-btn" id="permBtn" title="Modo de aprovações">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <span id="permLabel">Aprovações Padrão</span>
          <svg class="bar-chevron" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
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
      <button class="header-btn" id="closeSessionsBtn" title="Fechar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
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
  const attachBtn = document.getElementById('attachBtn');
  const fileChipsRow = document.getElementById('fileChipsRow');
  const newChatBtn = document.getElementById('newChatBtn');
  const historyBtn = document.getElementById('historyBtn');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const statusUsage = document.getElementById('statusUsage');
  const typingIndicator = null; // removido — indicadores visuais substituem os 3 pontos
  const prefillBar = document.getElementById('prefillBar');
  const prefillText = document.getElementById('prefillText');
  const prefillElapsed = document.getElementById('prefillElapsed');
  const modelLabel = document.getElementById('modelLabel');
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

    // Step 1: extract fenced code blocks before any escaping
    const codeBlocks = [];
    // Backtick char code = 96; use new RegExp so backticks don't break the template literal
    const BTICK = String.fromCharCode(96);
    const FENCE_RE = new RegExp(BTICK+BTICK+BTICK+'([a-zA-Z0-9_]*)\\n([\\\\s\\\\S]*?)'+BTICK+BTICK+BTICK, 'g');
    let raw = text.replace(FENCE_RE, (_, lang, code) => {
      const langLabel = lang || 'text';
      const safeCode = code
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const highlighted = highlightCode(safeCode, langLabel);
      const id = 'cb-' + Math.random().toString(36).slice(2, 8);
      const block = '<div class="code-wrapper"><div class="code-header">' +
        '<span>' + langLabel + '</span>' +
        '<button class="code-copy-btn" data-copy-id="' + id + '">Copiar</button></div>' +
        '<code class="code-block" id="' + id + '">' + highlighted + '</code></div>';
      codeBlocks.push(block);
      return '\x00CODE' + (codeBlocks.length - 1) + '\x00';
    });

    // Step 2: escape HTML special chars for remaining text
    let html = raw
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Step 3: inline code (backtick spans) — use new RegExp to avoid backtick breaking template literal
    const INLINE_CODE_RE = new RegExp(BTICK+'([^'+BTICK+'\\n]+?)'+BTICK, 'g');
    html = html.replace(INLINE_CODE_RE, (_, code) =>
      '<code>' + code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code>'
    );

    // Step 4: GFM tables — must run before paragraph logic
    html = html.replace(/^(\\|.+)\\n(\\|\\s*[-:]+[-| :\\s]*\\n)((?:\\|.+\\n?)*)/gm, (match) => {
      const lines = match.trim().split('\\n');
      const headerCells = lines[0].split('|').filter((_, i, a) => i > 0 && i < a.length - 1)
        .map(c => '<th>' + c.trim() + '</th>');
      const bodyLines = lines.slice(2);
      const rows = bodyLines.map(line => {
        const cells = line.split('|').filter((_, i, a) => i > 0 && i < a.length - 1)
          .map(c => '<td>' + c.trim() + '</td>');
        return cells.length ? '<tr>' + cells.join('') + '</tr>' : '';
      }).filter(Boolean);
      return '<table><thead><tr>' + headerCells.join('') + '</tr></thead>' +
        (rows.length ? '<tbody>' + rows.join('') + '</tbody>' : '') + '</table>';
    });

    // Step 5: headings
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Step 6: blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // Step 7: hr
    html = html.replace(/^---$/gm, '<hr/>');

    // Step 8: bold and italic
    html = html.replace(/\\*\\*([^*]+?)\\*\\*/g, '<strong>$1</strong>');
    html = html.replace(/\\*([^*]+?)\\*/g, '<em>$1</em>');

    // Step 8.5: bold-only lines (whole line = <strong>...</strong>) become implicit h4
    html = html.replace(/^(<strong>[^<]+<\\/strong>)$/gm, '<h4>$1</h4>');

    // Step 9: links
    html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" title="$2">$1</a>');

    // Step 10: lists — group consecutive list items into ul/ol
    // Mark unordered items
    html = html.replace(/^[ \\t]*[•\\-\\*] (.+)$/gm, '<li class="ul-item">$1</li>');
    // Mark ordered items
    html = html.replace(/^[ \\t]*\\d+\\. (.+)$/gm, '<li class="ol-item">$1</li>');
    // Wrap consecutive ul items — strip \\n between <li> so Step 12 won't inject <br/> between items
    html = html.replace(/((?:<li class="ul-item">.*<\\/li>\\n?)+)/g, (m) =>
      '<ul>' + m.replace(/ class="ul-item"/g, '').replace(/\\n/g, '') + '</ul>\\n\\n');
    // Wrap consecutive ol items
    html = html.replace(/((?:<li class="ol-item">.*<\\/li>\\n?)+)/g, (m) =>
      '<ol>' + m.replace(/ class="ol-item"/g, '').replace(/\\n/g, '') + '</ol>\\n\\n');

    // Step 11: paragraphs from double newlines
    html = html.replace(/\\n\\n+/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // Step 12: single newlines → <br> inside paragraphs
    html = html.replace(/<p>([^]*?)<\\/p>/g, (_, inner) =>
      '<p>' + inner.replace(/\\n/g, '<br/>') + '</p>'
    );

    // Step 13: clean up empty/mismatched paragraph tags around block elements
    const blockTags = ['h1','h2','h3','h4','ul','ol','table','blockquote','hr','div'];
    // Step 13a: remove <br/> immediately before any block-level opener (eliminates blank-line gap)
    const blockOpenPattern = new RegExp('<br\\s*\\/?>(\\s*)(<(?:' + blockTags.join('|') + ')[^>]*>)', 'g');
    html = html.replace(blockOpenPattern, '$1$2');
    blockTags.forEach(tag => {
      const open = new RegExp('<p>(<' + tag + '[^>]*>)', 'g');
      const close = new RegExp('(<\\/' + tag + '>)<\\/p>', 'g');
      const selfClose = new RegExp('<p>(<' + tag + '[^/]*\\/?>)<\\/p>', 'g');
      html = html.replace(open, '$1');
      html = html.replace(close, '$1');
      html = html.replace(selfClose, '$1');
    });
    html = html.replace(/<p><\\/p>/g, '');

    // Step 14: restore code blocks
    codeBlocks.forEach((block, i) => {
      html = html.replace('\\x00CODE' + i + '\\x00', block);
    });

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

  function setStreaming(val) {
    isStreaming = val;
    if (abortBtn) abortBtn.style.display = 'none';
    if (val) {
      sendBtn.disabled = false;
      sendBtn.classList.add('stopping');
      sendBtn.title = 'Parar geração';
      sendBtn.innerHTML = STOP_ICON;
      _showPrefill();
    } else {
      sendBtn.classList.remove('stopping');
      sendBtn.title = 'Enviar mensagem';
      sendBtn.innerHTML = SEND_ICON;
      updateSendBtn();
      _hidePrefill();
      if (thinkingBlock) {
        thinkingBlock.classList.remove('visible');
        thinkingBlock.classList.remove('done', 'collapsed');
      }
    }
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

  function setStatusLabel(_label) { /* status bar hidden — no-op */ }

  function appendUserMessage(text) {
    hideWelcome();
    const el = document.createElement('div');
    el.className = 'msg-user';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }
  /* NOTE: msg-user uses align-self:flex-end via CSS; messages container uses flex-direction:column */

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
  /* NOTE: .msg-assistant is full-width block flush to left margin — Copilot style */

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
    card.className = 'tool-card';
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
        '<span class="tool-chevron"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>' +
        '<span class="tool-status ' + statusClass + '">' + statusLabel + '</span>' +
      '</div>' +
      '<div class="tool-body">' +
        pathDisplay +
        inputDetail +
        '<div class="tool-output-label">Saída</div>' +
        '<div class="tool-output-content" data-tool-output="' + (toolUse.id || '') + '" data-running="true"></div>' +
      '</div>';
    card.classList.add('no-output');
    card.querySelector('.tool-header').addEventListener('click', () => {
      if (!card.classList.contains('no-output')) card.classList.toggle('expanded');
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
      // Output arrived — enable expand (user can click to open)
      card.classList.remove('no-output');
    }
  }

  function updateToolProgress(toolUseId, content) {
    const outputEl = document.querySelector('[data-tool-output="' + toolUseId + '"]');
    if (outputEl && outputEl.dataset.running === 'true') {
      outputEl.textContent = content || '';
      delete outputEl.dataset.running;
    }
    // Progress arrived mid-run — enable expand (user can click to open)
    const card = document.querySelector('[data-tool-id="' + toolUseId + '"]');
    if (card && content && content.trim()) {
      card.classList.remove('no-output');
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
    card.classList.remove('no-output');
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
  const thinkingHeader = document.getElementById('thinkingHeader');
  const thinkingLabel = document.getElementById('thinkingLabel');
  const thinkingMeta = document.getElementById('thinkingMeta');
  const thinkingBody = document.getElementById('thinkingBody');
  const thinkingText = document.getElementById('thinkingText');
  let _thinkingAccum = '';

  // Toggle collapse on header click
  if (thinkingHeader) {
    thinkingHeader.addEventListener('click', () => {
      thinkingBlock.classList.toggle('collapsed');
    });
  }

  function showThinkingBlock() {
    _thinkingAccum = '';
    if (thinkingText) thinkingText.textContent = '';
    if (thinkingLabel) thinkingLabel.textContent = 'Pensando...';
    if (thinkingMeta) thinkingMeta.textContent = '';
    thinkingBlock.classList.remove('done', 'collapsed');
    thinkingBlock.classList.add('visible');
    scrollToBottom();
  }

  function updateThinkingBlock(tokens, elapsed, textChunk) {
    const elapsedStr = elapsed >= 60
      ? Math.floor(elapsed / 60) + 'm ' + (elapsed % 60) + 's'
      : elapsed + 's';
    if (thinkingMeta) thinkingMeta.textContent = elapsedStr;
    // append streamed reasoning text
    if (textChunk && thinkingText) {
      _thinkingAccum += textChunk;
      thinkingText.textContent = _thinkingAccum;
      // auto-scroll the body to bottom while streaming
      if (thinkingBody) thinkingBody.scrollTop = thinkingBody.scrollHeight;
    }
  }

  function hideThinkingBlock() {
    if (!thinkingBlock.classList.contains('visible')) return;
    thinkingBlock.classList.add('done');
    thinkingBlock.classList.add('collapsed');
    if (thinkingLabel) thinkingLabel.textContent = 'Raciocínio concluído';
  }

  /* ── Session list ── */
  function renderSessionList(sessions) {
    if (!sessions || sessions.length === 0) {
      sessionList.innerHTML = '<div class="session-empty">Nenhuma sessão encontrada</div>';
      return;
    }
    let html = '';
    for (const s of sessions) {
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

  /* ── File attachment state ── */
  // Array of { name, path, content }
  let _attachedFiles = [];

  function _renderChips() {
    if (!fileChipsRow) return;
    fileChipsRow.innerHTML = '';
    if (_attachedFiles.length === 0) {
      fileChipsRow.classList.remove('has-chips');
      return;
    }
    fileChipsRow.classList.add('has-chips');
    _attachedFiles.forEach((f, idx) => {
      const chip = document.createElement('div');
      chip.className = 'file-chip';
      chip.title = f.path;
      const safeName = f.name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      chip.innerHTML =
        '<span class="file-chip-icon"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>' +
        '<span class="file-chip-name">' + safeName + '</span>' +
        '<span class="file-chip-remove" title="Remover arquivo"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>';
      chip.querySelector('.file-chip-remove').addEventListener('click', () => {
        _attachedFiles.splice(idx, 1);
        _renderChips();
      });
      fileChipsRow.appendChild(chip);
    });
  }

  if (attachBtn) {
    attachBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'pick_file' });
    });
  }

  /* ── Input handling ── */
  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isStreaming) return;
    if (!_chatTitle) setChatTitle(text);

    let fullText = text;
    if (_attachedFiles.length > 0) {
      const attachments = _attachedFiles.map(f =>
        '\\n\\n[Arquivo: ' + f.name + ' | ' + f.path + ']\\n' + f.content
      ).join('\\n\\n');
      fullText = text + '\\n\\n' + attachments;
      _attachedFiles = [];
      _renderChips();
    }

    appendUserMessage(text);
    vscode.postMessage({ type: 'send_message', text: fullText });
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
        _showPrefill('Gerando resposta...');
        setStreaming(true);
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
        if (msg.final) {
          setStreaming(false);
        }
        scrollToBottom();
        break;

      case 'tool_use':
        appendToolCard(msg.toolUse);
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
        break;

      case 'rate_limit':
        appendRateLimitMessage(msg.message || 'Limite de taxa atingido');
        break;

      case 'thinking_start':
        showThinkingBlock();
        break;

      case 'thinking_delta':
        updateThinkingBlock(msg.tokens || 0, msg.elapsed || 0, msg.text || '');
        break;

      case 'thinking_end':
        hideThinkingBlock();
        break;

      case 'system_info':
        if (msg.model && modelLabel) {
          const raw = String(msg.model);
          const short = raw.replace(/^claude-/, 'Claude ').replace(/-\d{8}$/, '').replace(/-/g, ' ');
          modelLabel.textContent = short.length > 22 ? short.substring(0, 20) + '\u2026' : short;
        }
        break;

      case 'error':
        setStreaming(false);
        finalizeAssistant();
        appendStatusMessage('Erro: ' + (msg.message || 'Erro desconhecido'));
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

      case 'file_picked':
        _attachedFiles.push({ name: msg.name, path: msg.path, content: msg.content || '' });
        _renderChips();
        inputEl.focus();
        break;

      case 'process_ready':
        break;

      case 'connected':
        setStreaming(false);
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
