/**
 * messageParser — transforms raw SDK messages from the CLI into view-model
 * objects that the chat renderer can display.
 */

const {
  isAssistantMessage,
  isPartialMessage,
  isResultMessage,
  isControlRequest,
  isStatusMessage,
  isToolProgressMessage,
  isSessionStateChanged,
  isRateLimitEvent,
  getTextContent,
  getToolUseBlocks,
} = require('./protocol');

function parseToolInput(input) {
  if (!input || typeof input !== 'object') return String(input ?? '');
  if (input.command) return input.command;
  if (input.file_path || input.path) return input.file_path || input.path;
  if (input.query) return input.query;
  try { return JSON.stringify(input, null, 2); } catch { return String(input); }
}

function toolDisplayName(name) {
  const map = {
    Bash: 'Terminal',
    Read: 'Read File',
    Write: 'Write File',
    Edit: 'Edit File',
    MultiEdit: 'Multi Edit',
    Glob: 'Find Files',
    Grep: 'Search',
    LS: 'List Directory',
    WebFetch: 'Web Fetch',
    WebSearch: 'Web Search',
    TodoRead: 'Read Todos',
    TodoWrite: 'Write Todos',
    Task: 'Sub-agent',
  };
  return map[name] || name || 'Tool';
}

const _svgProps = 'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
function _svg(path) { return '<svg ' + _svgProps + '>' + path + '</svg>'; }
function toolIcon(name) {
  const map = {
    Bash:      _svg('<rect x="2" y="3" width="20" height="14" rx="2"/><polyline points="8 21 12 21"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="8" y1="21" x2="16" y2="21"/><polyline points="8 8 12 12 8 16" stroke-width="2"/>'),
    Read:      _svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>'),
    Write:     _svg('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
    Edit:      _svg('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
    MultiEdit: _svg('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/><line x1="15" y1="5" x2="19" y2="9" opacity=".5"/>'),
    Glob:      _svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
    Grep:      _svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>'),
    LS:        _svg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
    WebFetch:  _svg('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'),
    WebSearch: _svg('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'),
    Task:      _svg('<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="8" x2="9" y2="16"/><line x1="15" y1="8" x2="15" y2="16"/><line x1="3" y1="12" x2="21" y2="12"/>'),
  };
  return map[name] || _svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>');
}

/**
 * Converts an SDK message into one or more view-model entries for the chat UI.
 * Returns an array so partial messages can update in-place while final messages
 * produce a finalized entry.
 */
function toViewModel(msg) {
  if (isAssistantMessage(msg)) {
    return [{
      kind: 'assistant',
      id: msg.id || msg.message?.id || null,
      text: getTextContent(msg.message || msg),
      toolUses: getToolUseBlocks(msg.message || msg).map(tu => ({
        id: tu.id,
        name: tu.name,
        displayName: toolDisplayName(tu.name),
        icon: toolIcon(tu.name),
        inputPreview: parseToolInput(tu.input),
        input: tu.input,
        status: 'complete',
      })),
      model: msg.model || null,
      stopReason: msg.stop_reason || null,
      usage: msg.usage || null,
      final: true,
    }];
  }

  if (isPartialMessage(msg)) {
    const inner = msg.message || msg;
    return [{
      kind: 'assistant_partial',
      id: inner.id || null,
      text: getTextContent(inner),
      toolUses: getToolUseBlocks(inner).map(tu => ({
        id: tu.id,
        name: tu.name,
        displayName: toolDisplayName(tu.name),
        icon: toolIcon(tu.name),
        inputPreview: parseToolInput(tu.input),
        input: tu.input,
        status: 'running',
      })),
      final: false,
    }];
  }

  if (isResultMessage(msg)) {
    return [{
      kind: 'tool_result',
      toolUseId: msg.tool_use_id,
      content: typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map(b => b.text || '').join('')
          : '',
      isError: msg.is_error || false,
    }];
  }

  if (isControlRequest(msg)) {
    return [{
      kind: 'permission_request',
      requestId: msg.request_id || msg.id,
      toolName: msg.tool_name || msg.tool?.name || 'Unknown',
      displayName: toolDisplayName(msg.tool_name || msg.tool?.name),
      description: msg.description || msg.tool?.description || '',
      input: msg.tool_input || msg.input || null,
      inputPreview: parseToolInput(msg.tool_input || msg.input),
    }];
  }

  if (isToolProgressMessage(msg)) {
    return [{
      kind: 'tool_progress',
      toolUseId: msg.tool_use_id,
      content: msg.content || msg.progress || '',
    }];
  }

  if (isStatusMessage(msg)) {
    return [{
      kind: 'status',
      content: msg.content || msg.message || '',
    }];
  }

  if (isSessionStateChanged(msg)) {
    return [{
      kind: 'session_state',
      sessionId: msg.session_id || null,
      state: msg.state || null,
    }];
  }

  if (isRateLimitEvent(msg)) {
    return [{
      kind: 'rate_limit',
      retryAfter: msg.retry_after || null,
      message: msg.message || 'Rate limited',
    }];
  }

  return [{
    kind: 'unknown',
    type: msg.type,
    raw: msg,
  }];
}

module.exports = {
  toViewModel,
  toolDisplayName,
  toolIcon,
  parseToolInput,
};
