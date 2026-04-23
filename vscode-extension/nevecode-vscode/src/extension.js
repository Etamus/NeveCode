const vscode = require('vscode');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  chooseLaunchWorkspace,
  describeProviderState,
  findCommandPath,
  isPathInsideWorkspace,
  parseProfileFile,
  resolveCommandCheckPath,
} = require('./state');
const { buildControlCenterViewModel } = require('./presentation');
const { ChatController, NeveCodeChatViewProvider, NeveCodeChatPanelManager } = require('./chat/chatProvider');
const { SessionManager } = require('./chat/sessionManager');
const { DiffContentProvider, SCHEME: DIFF_SCHEME } = require('./chat/diffController');

const NeveCode_REPO_URL = 'https://github.com/Gitlawb/NeveCode';
const NeveCode_SETUP_URL = 'https://github.com/Gitlawb/NeveCode/blob/main/README.md#quick-start';
const PROFILE_FILE_NAME = '.NeveCode-profile.json';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function isCommandAvailable(command, launchCwd) {
  return Boolean(findCommandPath(command, { cwd: launchCwd }));
}

function getExecutableFromCommand(command) {
  const normalized = String(command || '').trim();
  if (!normalized) {
    return '';
  }

  const doubleQuotedMatch = normalized.match(/^"([^"]+)"/);
  if (doubleQuotedMatch) {
    return doubleQuotedMatch[1];
  }

  const singleQuotedMatch = normalized.match(/^'([^']+)'/);
  if (singleQuotedMatch) {
    return singleQuotedMatch[1];
  }

  return normalized.split(/\s+/)[0];
}

function getWorkspacePaths() {
  return (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.fsPath);
}

function getActiveWorkspacePath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    return null;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  return workspaceFolder ? workspaceFolder.uri.fsPath : null;
}

function getActiveFilePath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    return null;
  }

  return editor.document.uri.fsPath || null;
}

function resolveLaunchTargets({ activeFilePath, workspacePath, workspaceSourceLabel, executable } = {}) {
  const activeFileDirectory = isPathInsideWorkspace(activeFilePath, workspacePath)
    ? path.dirname(activeFilePath)
    : null;
  const normalizedExecutable = String(executable || '').trim();
  const commandPath = normalizedExecutable
    ? resolveCommandCheckPath(normalizedExecutable, workspacePath)
    : null;
  const relativeCommandRequiresWorkspaceRoot = Boolean(
    workspacePath && commandPath && !path.isAbsolute(normalizedExecutable),
  );

  if (relativeCommandRequiresWorkspaceRoot) {
    return {
      projectAwareCwd: workspacePath,
      projectAwareCwdLabel: workspacePath,
      projectAwareSourceLabel: 'workspace root (required by relative launch command)',
      workspaceRootCwd: workspacePath,
      workspaceRootCwdLabel: workspacePath,
      launchActionsShareTarget: true,
      launchActionsShareTargetReason: 'relative-launch-command',
    };
  }

  if (activeFileDirectory) {
    return {
      projectAwareCwd: activeFileDirectory,
      projectAwareCwdLabel: activeFileDirectory,
      projectAwareSourceLabel: 'diretório do arquivo ativo',
      workspaceRootCwd: workspacePath || null,
      workspaceRootCwdLabel: workspacePath || 'Nenhum workspace aberto',
      launchActionsShareTarget: false,
      launchActionsShareTargetReason: null,
    };
  }

  if (workspacePath) {
    return {
      projectAwareCwd: workspacePath,
      projectAwareCwdLabel: workspacePath,
      projectAwareSourceLabel: workspaceSourceLabel || 'workspace root',
      workspaceRootCwd: workspacePath,
      workspaceRootCwdLabel: workspacePath,
      launchActionsShareTarget: true,
      launchActionsShareTargetReason: null,
    };
  }

  return {
    projectAwareCwd: null,
    projectAwareCwdLabel: 'Diretório padrão do terminal do VS Code',
    projectAwareSourceLabel: 'Diretório padrão do terminal do VS Code',
    workspaceRootCwd: null,
    workspaceRootCwdLabel: 'Nenhum workspace aberto',
    launchActionsShareTarget: false,
    launchActionsShareTargetReason: null,
  };
}

function resolveLaunchWorkspace() {
  return chooseLaunchWorkspace({
    activeWorkspacePath: getActiveWorkspacePath(),
    workspacePaths: getWorkspacePaths(),
  });
}

function getWorkspaceSourceLabel(source) {
  switch (source) {
    case 'active-workspace':
      return 'workspace do editor ativo';
    case 'first-workspace':
      return 'primeira pasta do workspace';
    default:
      return 'nenhum workspace aberto';
  }
}

function getProviderSourceLabel(source) {
  switch (source) {
    case 'profile':
      return 'perfil salvo';
    case 'env':
      return 'variáveis de ambiente';
    case 'shim':
      return 'configuração de início';
    default:
      return 'desconhecido';
  }
}

function readWorkspaceProfile(profilePath) {
  if (!profilePath || !fs.existsSync(profilePath)) {
    return {
      profile: null,
      statusLabel: 'Missing',
      statusHint: `${PROFILE_FILE_NAME} not found in the workspace root`,
      filePath: null,
    };
  }

  try {
    const raw = fs.readFileSync(profilePath, 'utf8');
    const profile = parseProfileFile(raw);
    if (!profile) {
      return {
        profile: null,
        statusLabel: 'Inválido',
        statusHint: `${profilePath} tem JSON inválido ou perfil não suportado`,
        filePath: profilePath,
      };
    }

    return {
      profile,
      statusLabel: 'Encontrado',
      statusHint: profilePath,
      filePath: profilePath,
    };
  } catch (error) {
    return {
      profile: null,
      statusLabel: 'Unreadable',
      statusHint: `${profilePath} (${error instanceof Error ? error.message : 'read failed'})`,
      filePath: profilePath,
    };
  }
}

async function collectControlCenterState() {
  const configured = vscode.workspace.getConfiguration('nevecode');
  const launchCommand = configured.get('launchCommand', 'openclaude');
  const terminalName = configured.get('terminalName', 'Neve Code');
  const shimEnabled = configured.get('useOpenAIShim', false);
  const executable = getExecutableFromCommand(launchCommand);
  const launchWorkspace = resolveLaunchWorkspace();
  const workspaceFolder = launchWorkspace.workspacePath;
  const workspaceSourceLabel = getWorkspaceSourceLabel(launchWorkspace.source);
  const launchTargets = resolveLaunchTargets({
    activeFilePath: getActiveFilePath(),
    workspacePath: workspaceFolder,
    workspaceSourceLabel,
    executable,
  });
  const installed = await isCommandAvailable(executable, launchTargets.projectAwareCwd);
  const profilePath = workspaceFolder
    ? path.join(workspaceFolder, PROFILE_FILE_NAME)
    : null;

  const profileState = workspaceFolder
    ? readWorkspaceProfile(profilePath)
    : {
        profile: null,
        statusLabel: 'Sem workspace',
        statusHint: 'Abra uma pasta de workspace para detectar um perfil salvo',
        filePath: null,
      };

  const providerState = describeProviderState({
    shimEnabled,
    env: process.env,
    profile: profileState.profile,
  });

  return {
    installed,
    executable,
    launchCommand,
    terminalName,
    shimEnabled,
    workspaceFolder,
    workspaceSourceLabel,
    launchCwd: launchTargets.projectAwareCwd,
    launchCwdLabel: launchTargets.projectAwareCwdLabel,
    launchCwdSourceLabel: launchTargets.projectAwareSourceLabel,
    workspaceRootCwd: launchTargets.workspaceRootCwd,
    workspaceRootCwdLabel: launchTargets.workspaceRootCwdLabel,
    launchActionsShareTarget: launchTargets.launchActionsShareTarget,
    launchActionsShareTargetReason: launchTargets.launchActionsShareTargetReason,
    canLaunchInWorkspaceRoot: Boolean(workspaceFolder),
    profileStatusLabel: profileState.statusLabel,
    profileStatusHint: profileState.statusHint,
    workspaceProfilePath: profileState.filePath,
    providerState,
    providerSourceLabel: getProviderSourceLabel(providerState.source),
  };
}

async function launchNeveCode(options = {}) {
  const { requireWorkspace = false } = options;
  const configured = vscode.workspace.getConfiguration('nevecode');
  const launchCommand = configured.get('launchCommand', 'openclaude');
  const terminalName = configured.get('terminalName', 'Neve Code');
  const shimEnabled = configured.get('useOpenAIShim', false);
  const executable = getExecutableFromCommand(launchCommand);
  const launchWorkspace = resolveLaunchWorkspace();

  if (requireWorkspace && !launchWorkspace.workspacePath) {
    await vscode.window.showWarningMessage(
      'Abra uma pasta de workspace antes de usar Iniciar na Raiz do Workspace.',
    );
    return;
  }

  const launchTargets = resolveLaunchTargets({
    activeFilePath: getActiveFilePath(),
    workspacePath: launchWorkspace.workspacePath,
    workspaceSourceLabel: getWorkspaceSourceLabel(launchWorkspace.source),
    executable,
  });
  const targetCwd = requireWorkspace
    ? launchTargets.workspaceRootCwd
    : launchTargets.projectAwareCwd;
  const installed = await isCommandAvailable(executable, targetCwd);

  if (!installed) {
    const action = await vscode.window.showErrorMessage(
      `Comando Neve Code não encontrado: ${executable}. Instale com: npm install -g @gitlawb/NeveCode`,
      'Abrir Guia de Configuração',
      'Abrir Repositório',
    );

    if (action === 'Abrir Guia de Configuração') {
      await vscode.env.openExternal(vscode.Uri.parse(NeveCode_SETUP_URL));
    } else if (action === 'Abrir Repositório') {
      await vscode.env.openExternal(vscode.Uri.parse(NeveCode_REPO_URL));
    }

    return;
  }

  const env = {};
  if (shimEnabled) {
    env.CLAUDE_CODE_USE_OPENAI = '1';
  }

  const terminalOptions = {
    name: terminalName,
    env,
  };

  if (targetCwd) {
    terminalOptions.cwd = targetCwd;
  }

  const terminal = vscode.window.createTerminal(terminalOptions);
  terminal.show(true);
  terminal.sendText(launchCommand, true);
}

async function openWorkspaceProfile() {
  const state = await collectControlCenterState();

  if (!state.workspaceProfilePath) {
    await vscode.window.showInformationMessage(
      `Nenhum arquivo ${PROFILE_FILE_NAME} foi encontrado para o workspace atual.`,
    );
    return;
  }

  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.file(state.workspaceProfilePath),
  );
  await vscode.window.showTextDocument(document, { preview: false });
}

function getToneClass(tone) {
  switch (tone) {
    case 'accent':
      return 'tone-accent';
    case 'positive':
      return 'tone-positive';
    case 'warning':
      return 'tone-warning';
    case 'critical':
      return 'tone-critical';
    default:
      return 'tone-neutral';
  }
}

function renderHeaderBadge(badge) {
  return `<div class="rail-pill ${getToneClass(badge.tone)}" title="${escapeHtml(badge.label)}: ${escapeHtml(badge.value)}">
    <span class="rail-label">${escapeHtml(badge.label)}</span>
    <span class="rail-value">${escapeHtml(badge.value)}</span>
  </div>`;
}

function renderSummaryCard(card) {
  const detail = card.detail || '';
  return `<section class="summary-card" aria-label="${escapeHtml(card.label)}">
    <div class="summary-label">${escapeHtml(card.label)}</div>
    <div class="summary-value" title="${escapeHtml(card.value)}">${escapeHtml(card.value)}</div>
    ${detail ? `<div class="summary-detail" title="${escapeHtml(detail)}">${escapeHtml(detail)}</div>` : ''}
  </section>`;
}

function renderDetailRow(row) {
  return `<div class="detail-row ${getToneClass(row.tone)}">
    <div class="detail-label">${escapeHtml(row.label)}</div>
    <div class="detail-summary" title="${escapeHtml(row.summary)}">${escapeHtml(row.summary)}</div>
    ${row.detail ? `<div class="detail-meta" title="${escapeHtml(row.detail)}">${escapeHtml(row.detail)}</div>` : ''}
  </div>`;
}

function renderDetailSection(section) {
  const sectionId = `section-${String(section.title || 'section').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return `<section class="detail-module" aria-labelledby="${escapeHtml(sectionId)}">
    <h2 class="module-title" id="${escapeHtml(sectionId)}">${escapeHtml(section.title)}</h2>
    <div class="detail-list">${section.rows.map(renderDetailRow).join('')}</div>
  </section>`;
}

function renderActionButton(action, variant = 'secondary') {
  return `<button class="action-button ${variant}" id="${escapeHtml(action.id)}" type="button" ${action.disabled ? 'disabled aria-disabled="true"' : ''}>
    <span class="action-label">${escapeHtml(action.label)}</span>
    <span class="action-detail">${escapeHtml(action.detail)}</span>
  </button>`;
}

function renderProfileEmptyState(detail) {
  return `<div class="action-empty" role="status" aria-live="polite">
    <div class="action-empty-title">Nenhum perfil de workspace ainda</div>
    <div class="action-empty-detail">${escapeHtml(detail)}</div>
  </div>`;
}

function getPrimaryLaunchActionDetail(status) {
  if (status.launchActionsShareTargetReason === 'relative-launch-command' && status.launchCwd) {
    return `Início projeto-aware ancorado à raiz do workspace pelo comando relativo · ${status.launchCwdLabel}`;
  }

  if (status.launchCwd && status.launchCwdSourceLabel === 'diretório do arquivo ativo') {
    return `Inicia ao lado do arquivo ativo · ${status.launchCwdLabel}`;
  }

  if (status.launchCwd) {
    return `Início projeto-aware. Resolvido para ${status.launchCwdSourceLabel} · ${status.launchCwdLabel}`;
  }

  return 'Início projeto-aware. Usa o diretório padrão do terminal do VS Code';
}

function getWorkspaceRootActionDetail(status, fallbackDetail) {
  if (!status.canLaunchInWorkspaceRoot) {
    return fallbackDetail;
  }

  if (status.launchActionsShareTargetReason === 'relative-launch-command') {
    return `Mesmo destino da raiz do workspace que Iniciar Neve Code pois o comando relativo resolve da raiz · ${status.workspaceRootCwdLabel}`;
  }

  return `Sempre inicia na raiz do workspace · ${status.workspaceRootCwdLabel}`;
}

function getRenderableViewModel(status) {
  const viewModel = buildControlCenterViewModel(status);
  const summaryCards = viewModel.summaryCards.map(card => {
    if (card.key !== 'launchCwd' || card.detail) {
      return card;
    }

    return {
      ...card,
      detail: status.launchCwdSourceLabel || '',
    };
  });

  return {
    ...viewModel,
    summaryCards,
    actions: {
      ...viewModel.actions,
      primary: {
        ...viewModel.actions.primary,
        detail: getPrimaryLaunchActionDetail(status),
      },
      launchRoot: {
        ...viewModel.actions.launchRoot,
        detail: getWorkspaceRootActionDetail(status, viewModel.actions.launchRoot.detail),
      },
    },
  };
}

function renderControlCenterHtml(status, options = {}) {
  const nonce = options.nonce || crypto.randomBytes(16).toString('base64');
  const platform = options.platform || process.platform;
  const viewModel = getRenderableViewModel(status);
  const profileActionOrEmpty = viewModel.actions.openProfile
    ? renderActionButton(viewModel.actions.openProfile)
    : renderProfileEmptyState(status.profileStatusHint || 'Open a workspace folder to detect a saved profile');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      --oc-bg: #0e0e10;
      --oc-panel: #141416;
      --oc-panel-strong: #1a1a1e;
      --oc-panel-soft: #1f1f24;
      --oc-border: #38383f;
      --oc-border-soft: rgba(200, 200, 210, 0.14);
      --oc-text: #f0f0f5;
      --oc-text-dim: #b8b8c8;
      --oc-text-soft: #787888;
      --oc-accent: #9898b0;
      --oc-accent-bright: #c0c0d8;
      --oc-accent-soft: rgba(192, 192, 216, 0.18);
      --oc-positive: #6abf8a;
      --oc-warning: #d4a84b;
      --oc-critical: #d46060;
      --oc-focus: #dcdcf0;
    }
    * {
      box-sizing: border-box;
    }
    h1, h2, p {
      margin: 0;
    }
    html, body {
      margin: 0;
      min-height: 100%;
    }
    body {
      padding: 16px;
      font-family: var(--vscode-font-family, "Segoe UI", sans-serif);
      color: var(--oc-text);
      background:
        radial-gradient(circle at top right, rgba(152, 152, 176, 0.12), transparent 34%),
        radial-gradient(circle at 20% 0%, rgba(100, 100, 130, 0.10), transparent 28%),
        linear-gradient(180deg, #0e0e10, #0a0a0d 58%, #0e0e10);
      line-height: 1.45;
    }
    button {
      font: inherit;
    }
    .shell {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--oc-border-soft);
      border-radius: 20px;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 16%),
        linear-gradient(180deg, rgba(17, 13, 12, 0.98), rgba(9, 7, 6, 0.98));
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.03);
    }
    .shell::before {
      content: "";
      position: absolute;
      inset: 0 0 auto;
      height: 2px;
      background: linear-gradient(90deg, #dcdcf0, #c0c0d8, #9898b0, #505068);
      opacity: 0.95;
    }
    .sunset-gradient {
      background: linear-gradient(90deg, #dcdcf0, #c0c0d8, #9898b0, #505068);
    }
    .frame {
      display: grid;
      gap: 18px;
      padding: 18px;
    }
    .hero {
      display: grid;
      gap: 14px;
      padding: 18px;
      border-radius: 16px;
      background:
        linear-gradient(135deg, rgba(152, 152, 176, 0.06), rgba(100, 100, 130, 0.02) 55%, transparent),
        var(--oc-panel);
      border: 1px solid var(--oc-border-soft);
    }
    .hero-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .brand {
      display: grid;
      gap: 6px;
      min-width: 0;
    }
    .eyebrow {
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--oc-text-soft);
    }
    .wordmark {
      font-size: 24px;
      line-height: 1;
      font-weight: 700;
      letter-spacing: -0.03em;
      color: var(--oc-text);
    }
    .wordmark-accent {
      color: var(--oc-accent-bright);
    }
    .headline {
      display: grid;
      gap: 4px;
      max-width: 44ch;
    }
    .headline-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--oc-text);
    }
    .headline-subtitle {
      font-size: 12px;
      color: var(--oc-text-dim);
    }
    .status-rail {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      justify-content: flex-end;
      flex: 1 1 250px;
    }
    .rail-pill {
      display: grid;
      gap: 2px;
      min-width: 94px;
      padding: 8px 10px;
      border-radius: 999px;
      border: 1px solid var(--oc-border-soft);
      background: rgba(255, 255, 255, 0.02);
    }
    .rail-label {
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--oc-text-soft);
    }
    .rail-value {
      font-size: 12px;
      font-weight: 700;
      color: var(--oc-text);
    }
    .refresh-button {
      display: none;
    }
    .status-rail {
      display: none;
    }
    .summary-grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    }
    .summary-card {
      display: grid;
      gap: 6px;
      min-width: 0;
      padding: 14px;
      border-radius: 14px;
      background: var(--oc-panel-strong);
      border: 1px solid var(--oc-border-soft);
    }
    .summary-label,
    .detail-label,
    .module-title,
    .action-section-title,
    .support-title {
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--oc-text-soft);
    }
    .summary-value,
    .detail-summary {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 600;
      color: var(--oc-text);
    }
    .summary-detail,
    .detail-meta,
    .action-detail,
    .action-empty-detail,
    .support-copy,
    .footer-note {
      font-size: 12px;
      color: var(--oc-text-dim);
    }
    .modules {
      display: grid;
      gap: 14px;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }
    .detail-module,
    .support-card {
      display: grid;
      gap: 12px;
      padding: 16px;
      border-radius: 16px;
      background: var(--oc-panel);
      border: 1px solid var(--oc-border-soft);
    }
    .detail-list,
    .action-stack,
    .support-stack {
      display: grid;
      gap: 10px;
    }
    .detail-row {
      display: grid;
      gap: 4px;
      min-width: 0;
      padding: 12px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(220, 195, 170, 0.08);
    }
    .actions-layout {
      display: grid;
      gap: 14px;
      grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
      align-items: start;
    }
    .action-panel {
      display: grid;
      gap: 12px;
      padding: 16px;
      border-radius: 16px;
      background: var(--oc-panel);
      border: 1px solid var(--oc-border-soft);
    }
    .action-button {
      width: 100%;
      display: grid;
      gap: 4px;
      padding: 14px;
      text-align: left;
      border-radius: 14px;
      border: 1px solid rgba(220, 195, 170, 0.14);
      background: rgba(255, 255, 255, 0.02);
      color: var(--oc-text);
      cursor: pointer;
      transition: border-color 140ms ease, transform 140ms ease, background 140ms ease, box-shadow 140ms ease;
    }
    .action-button.primary {
      border-color: rgba(152, 152, 176, 0.44);
      background:
        linear-gradient(135deg, rgba(192, 192, 216, 0.22), rgba(100, 100, 130, 0.12) 58%, rgba(50, 50, 80, 0.12)),
        #161618;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }
    .action-button.secondary:hover:enabled,
    .action-button.primary:hover:enabled,
    .refresh-button:hover {
      border-color: rgba(152, 152, 176, 0.48);
      transform: translateY(-1px);
      background-color: rgba(152, 152, 176, 0.1);
    }
    .action-button:disabled {
      cursor: not-allowed;
      opacity: 0.58;
      transform: none;
    }
    .action-label,
    .action-empty-title,
    .support-link-label {
      font-size: 13px;
      font-weight: 700;
      color: var(--oc-text);
    }
    .action-empty {
      display: grid;
      gap: 4px;
      padding: 14px;
      border-radius: 14px;
      border: 1px dashed rgba(220, 195, 170, 0.16);
      background: rgba(255, 255, 255, 0.015);
    }
    .support-link {
      width: 100%;
      display: grid;
      gap: 4px;
      padding: 12px 0;
      border: 0;
      border-top: 1px solid rgba(220, 195, 170, 0.08);
      background: transparent;
      color: inherit;
      cursor: pointer;
      text-align: left;
    }
    .support-link:first-of-type {
      border-top: 0;
      padding-top: 0;
    }
    .tone-positive .rail-value,
    .tone-positive .detail-summary {
      color: var(--oc-positive);
    }
    .tone-warning .rail-value,
    .tone-warning .detail-summary {
      color: var(--oc-warning);
    }
    .tone-critical .rail-value,
    .tone-critical .detail-summary {
      color: var(--oc-critical);
    }
    .tone-accent .rail-value,
    .tone-accent .detail-summary {
      color: var(--oc-accent-bright);
    }
    .action-button:focus-visible,
    .support-link:focus-visible,
    .refresh-button:focus-visible {
      outline: 2px solid var(--oc-focus);
      outline-offset: 2px;
      box-shadow: 0 0 0 4px rgba(255, 211, 161, 0.16);
    }
    code {
      padding: 1px 6px;
      border-radius: 999px;
      border: 1px solid rgba(240, 148, 100, 0.18);
      background: rgba(240, 148, 100, 0.08);
      color: var(--oc-accent-bright);
      font-family: var(--vscode-editor-font-family, Consolas, monospace);
      font-size: 11px;
    }
    .footer-note {
      padding-top: 2px;
    }
    @media (max-width: 720px) {
      body {
        padding: 12px;
      }
      .frame,
      .hero {
        padding: 14px;
      }
      .actions-layout {
        grid-template-columns: 1fr;
      }
      .status-rail {
        justify-content: flex-start;
      }
      .rail-pill {
        min-width: 0;
      }
    }
  </style>
</head>
<body>
  <main class="shell" aria-labelledby="control-center-title">
    <div class="frame">
      <header class="hero">
        <div class="hero-top">
          <div class="brand">
            <div class="eyebrow">${escapeHtml(viewModel.header.eyebrow)}</div>
            <div class="wordmark" aria-label="Neve Code wordmark">Neve <span class="wordmark-accent">Code</span></div>
            <div class="headline">
              <h1 class="headline-title" id="control-center-title">${escapeHtml(viewModel.header.title)}</h1>
              <p class="headline-subtitle">${escapeHtml(viewModel.header.subtitle)}</p>
            </div>
          </div>
          <div class="status-rail" role="group" aria-label="Runtime, provider, and profile status">
            ${viewModel.headerBadges.map(renderHeaderBadge).join('')}
            <button class="refresh-button" id="refresh" type="button">Atualizar</button>
          </div>
        </div>
        <section class="summary-grid" aria-label="Current launch summary">
          ${viewModel.summaryCards.map(renderSummaryCard).join('')}
        </section>
      </header>

      <section class="modules" aria-label="Control center details">
        ${viewModel.detailSections.map(renderDetailSection).join('')}
      </section>

      <section class="actions-layout" aria-label="Control center actions">
        <section class="action-panel" aria-labelledby="actions-title">
          <h2 class="action-section-title" id="actions-title">Início e Projeto</h2>
          ${renderActionButton(viewModel.actions.primary, 'primary')}
          <div class="action-stack">
            ${renderActionButton(viewModel.actions.launchRoot)}
            ${profileActionOrEmpty}
          </div>
        </section>

        <section class="support-card" aria-labelledby="quick-links-title">
          <h2 class="support-title" id="quick-links-title">Links Rápidos</h2>
          <div class="support-copy">Configurações e status do workspace ficam visíveis aqui. Links de referência ocupam posição secundária.</div>
          <div class="support-stack">
            <button class="support-link" id="setup" type="button">
              <span class="support-link-label">Abrir Guia de Configuração</span>
              <span class="summary-detail">Ir direto para a documentação de instalação e provedores.</span>
            </button>
            <button class="support-link" id="repo" type="button">
              <span class="support-link-label">Abrir Repositório</span>
              <span class="summary-detail">Navegar pelo projeto NeveCode no GitHub.</span>
            </button>
            <button class="support-link" id="commands" type="button">
              <span class="support-link-label">Abrir Paleta de Comandos</span>
              <span class="summary-detail">Acessar rapidamente comandos do VS Code e do Neve Code.</span>
            </button>
          </div>
        </section>
      </section>

      <p class="footer-note">
        Atalho rápido: use <code>${escapeHtml(platform === 'darwin' ? 'Cmd+Shift+P' : 'Ctrl+Shift+P')}</code> para a paleta de comandos e atualize este painel após mudanças no workspace ou perfil.
      </p>
    </div>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('launch').addEventListener('click', () => vscode.postMessage({ type: 'launch' }));
    document.getElementById('launchRoot').addEventListener('click', () => vscode.postMessage({ type: 'launchRoot' }));
    document.getElementById('repo').addEventListener('click', () => vscode.postMessage({ type: 'repo' }));
    document.getElementById('setup').addEventListener('click', () => vscode.postMessage({ type: 'setup' }));
    document.getElementById('commands').addEventListener('click', () => vscode.postMessage({ type: 'commands' }));
    document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));

    const profileButton = document.getElementById('openProfile');
    if (profileButton) {
      profileButton.addEventListener('click', () => vscode.postMessage({ type: 'openProfile' }));
    }
  </script>
</body>
</html>`;
}

class NeveCodeControlCenterProvider {
  constructor() {
    this.webviewView = null;
  }

  async resolveWebviewView(webviewView) {
    this.webviewView = webviewView;
    webviewView.webview.options = { enableScripts: true };

    webviewView.onDidDispose(() => {
      if (this.webviewView === webviewView) {
        this.webviewView = null;
      }
    });

    webviewView.webview.onDidReceiveMessage(async message => {
      switch (message?.type) {
        case 'launch':
          await launchNeveCode();
          break;
        case 'launchRoot':
          await launchNeveCode({ requireWorkspace: true });
          break;
        case 'openProfile':
          await openWorkspaceProfile();
          break;
        case 'repo':
          await vscode.env.openExternal(vscode.Uri.parse(NeveCode_REPO_URL));
          break;
        case 'setup':
          await vscode.env.openExternal(vscode.Uri.parse(NeveCode_SETUP_URL));
          break;
        case 'commands':
          await vscode.commands.executeCommand('workbench.action.showCommands');
          break;
        case 'refresh':
        default:
          break;
      }

      await this.refresh();
    });

    await this.refresh();
  }

  async refresh() {
    if (!this.webviewView) {
      return;
    }

    try {
      const status = await collectControlCenterState();
      this.webviewView.webview.html = this.getHtml(status);
    } catch (error) {
      this.webviewView.webview.html = this.getErrorHtml(error);
    }
  }

  getErrorHtml(error) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const message =
      error instanceof Error ? error.message : 'Erro desconhecido no Centro de Controle';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 16px;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    .panel {
      border: 1px solid var(--vscode-errorForeground);
      border-radius: 8px;
      padding: 14px;
      background: color-mix(in srgb, var(--vscode-sideBar-background) 88%, black);
    }
    .title {
      color: var(--vscode-errorForeground);
      font-weight: 700;
      margin-bottom: 8px;
    }
    .message {
      color: var(--vscode-descriptionForeground);
      margin-bottom: 12px;
      line-height: 1.5;
    }
    button {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 6px;
      padding: 8px 10px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="panel">
    <div class="title">Erro no Centro de Controle</div>
    <div class="message">${escapeHtml(message)}</div>
    <button id="refresh">Atualizar</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('refresh').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });
  </script>
</body>
</html>`;
  }

  getHtml(status) {
    const nonce = crypto.randomBytes(16).toString('base64');
    return renderControlCenterHtml(status, { nonce, platform: process.platform });
  }
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  // ── Control Center (existing) ──
  const provider = new NeveCodeControlCenterProvider();
  const refreshProvider = () => {
    void provider.refresh();
  };

  // ── Chat system ──
  const sessionManager = new SessionManager();
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    sessionManager.setCwd(folders[0].uri.fsPath);
  }

  const chatController = new ChatController(sessionManager);
  const chatViewProvider = new NeveCodeChatViewProvider(chatController, context.extensionUri);
  const chatPanelManager = new NeveCodeChatPanelManager(chatController, context.extensionUri);

  // ── Diff content provider ──
  const diffProvider = new DiffContentProvider();
  const diffProviderReg = vscode.workspace.registerTextDocumentContentProvider(
    DIFF_SCHEME,
    diffProvider,
  );

  // ── Status bar ──
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.text = '$(comment-discussion) NeveCode';
  statusBarItem.tooltip = 'Abrir Chat do Neve Code';
  statusBarItem.command = 'NeveCode.openChat';
  statusBarItem.show();

  chatController.onDidChangeState((state) => {
    switch (state) {
      case 'streaming':
        statusBarItem.text = '$(sync~spin) NeveCode';
        statusBarItem.tooltip = 'Neve Code está gerando...';
        break;
      case 'connected':
        statusBarItem.text = '$(comment-discussion) NeveCode';
        statusBarItem.tooltip = 'Neve Code conectado';
        break;
      default:
        statusBarItem.text = '$(comment-discussion) NeveCode';
        statusBarItem.tooltip = 'Abrir Chat do Neve Code';
        break;
    }
  });

  // ── Existing commands ──
  const startCommand = vscode.commands.registerCommand('NeveCode.start', async () => {
    await launchNeveCode();
  });

  const startInWorkspaceRootCommand = vscode.commands.registerCommand(
    'NeveCode.startInWorkspaceRoot',
    async () => {
      await launchNeveCode({ requireWorkspace: true });
    },
  );

  const openDocsCommand = vscode.commands.registerCommand('NeveCode.openDocs', async () => {
    await vscode.env.openExternal(vscode.Uri.parse(NeveCode_REPO_URL));
  });

  const openSetupDocsCommand = vscode.commands.registerCommand(
    'NeveCode.openSetupDocs',
    async () => {
      await vscode.env.openExternal(vscode.Uri.parse(NeveCode_SETUP_URL));
    },
  );

  const openWorkspaceProfileCommand = vscode.commands.registerCommand(
    'NeveCode.openWorkspaceProfile',
    async () => {
      await openWorkspaceProfile();
    },
  );

  // ── New chat commands ──
  const newChatCommand = vscode.commands.registerCommand('NeveCode.newChat', () => {
    chatController.stopSession();
    chatController.broadcast({ type: 'session_cleared' });
  });

  const openChatCommand = vscode.commands.registerCommand('NeveCode.openChat', () => {
    chatPanelManager.openPanel();
  });

  const resumeSessionCommand = vscode.commands.registerCommand('NeveCode.resumeSession', async () => {
    const sessions = await sessionManager.listSessions();
    if (sessions.length === 0) {
      await vscode.window.showInformationMessage('Nenhuma sessão encontrada para retomar.');
      return;
    }
    const items = sessions.slice(0, 30).map(s => ({
      label: s.title || s.id,
      description: s.timeLabel,
      detail: s.preview,
      sessionId: s.id,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Selecione uma sessão para retomar',
    });
    if (picked) {
      chatController.stopSession();
      chatController.broadcast({ type: 'session_cleared' });
      await chatController.startSession({ sessionId: picked.sessionId });
    }
  });

  const abortChatCommand = vscode.commands.registerCommand('NeveCode.abortChat', () => {
    chatController.abort();
  });

  // ── Register providers ──
  const chatViewProviderReg = vscode.window.registerWebviewViewProvider(
    'nevecode.chat',
    chatViewProvider,
    { webviewOptions: { retainContextWhenHidden: true } },
  );

  const profileWatcher = vscode.workspace.createFileSystemWatcher(`**/${PROFILE_FILE_NAME}`);

  context.subscriptions.push(
    // existing
    startCommand,
    startInWorkspaceRootCommand,
    openDocsCommand,
    openSetupDocsCommand,
    openWorkspaceProfileCommand,
    // new chat
    newChatCommand,
    openChatCommand,
    resumeSessionCommand,
    abortChatCommand,
    chatViewProviderReg,
    diffProviderReg,
    statusBarItem,
    // watchers
    profileWatcher,
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('nevecode')) {
        refreshProvider();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders((e) => {
      refreshProvider();
      const folders = vscode.workspace.workspaceFolders;
      if (folders && folders.length > 0) {
        sessionManager.setCwd(folders[0].uri.fsPath);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(refreshProvider),
    profileWatcher.onDidCreate(refreshProvider),
    profileWatcher.onDidChange(refreshProvider),
    profileWatcher.onDidDelete(refreshProvider),
    // disposables
    { dispose: () => chatController.dispose() },
    { dispose: () => chatPanelManager.dispose() },
    { dispose: () => diffProvider.dispose() },
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  NeveCodeControlCenterProvider,
  renderControlCenterHtml,
  resolveLaunchTargets,
  ChatController,
  NeveCodeChatViewProvider,
  NeveCodeChatPanelManager,
};


