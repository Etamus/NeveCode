function truncateMiddle(value, maxLength) {
  const text = String(value || '');
  if (!text || text.length <= maxLength) {
    return text;
  }

  const basename = text.split(/[\\/]/).filter(Boolean).pop() || '';
  if (basename && basename.length + 4 <= maxLength) {
    const separator = text.includes('\\') ? '\\' : '/';
    return `...${separator}${basename}`;
  }

  if (maxLength <= 3) {
    return '.'.repeat(Math.max(maxLength, 0));
  }

  const available = maxLength - 3;
  const startLength = Math.ceil(available / 2);
  const endLength = Math.floor(available / 2);
  return `${text.slice(0, startLength)}...${text.slice(text.length - endLength)}`;
}

function getPathTail(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }

  return text.split(/[\\/]/).filter(Boolean).pop() || text;
}

function buildActionModel({ canLaunchInWorkspaceRoot, workspaceProfilePath } = {}) {
  return {
    primary: {
      id: 'launch',
      label: 'Iniciar NeveCode',
      detail: 'Usar o diretório de início resolvido pelo projeto',
      tone: 'accent',
      disabled: false,
    },
    launchRoot: {
      id: 'launchRoot',
      label: 'Iniciar na Raiz do Workspace',
      detail: canLaunchInWorkspaceRoot
        ? 'Iniciar diretamente da raiz do workspace resolvida'
        : 'Abra uma pasta de workspace para habilitar esta opção',
      tone: 'neutral',
      disabled: !canLaunchInWorkspaceRoot,
    },
    openProfile: workspaceProfilePath
      ? {
          id: 'openProfile',
          label: 'Abrir Perfil do Workspace',
          detail: `Inspecionar ${truncateMiddle(workspaceProfilePath, 40)}`,
          tone: 'neutral',
          disabled: false,
        }
      : null,
  };
}

function getRuntimeTone(installed) {
  return installed ? 'positive' : 'critical';
}

function getProfileTone(profileStatusLabel) {
  return profileStatusLabel === 'Inválido' || profileStatusLabel === 'Ilegível'
    ? 'warning'
    : 'neutral';
}

function getProviderTone(providerState) {
  return providerState?.source === 'shim' || providerState?.source === 'unknown'
    ? 'warning'
    : 'neutral';
}

function getProviderDetail(providerState, providerSourceLabel) {
  const detail = providerState?.detail || '';
  if (!detail) {
    return providerSourceLabel || '';
  }

  switch (providerState?.source) {
    case 'profile':
      return [detail, providerSourceLabel].filter(Boolean).join(' · ');
    case 'env':
      return /^from environment$/i.test(detail)
        ? detail
        : [detail, providerSourceLabel].filter(Boolean).join(' · ');
    case 'shim':
    case 'unknown':
      return detail;
    default:
      return [detail, providerSourceLabel].filter(Boolean).join(' · ');
  }
}

function buildControlCenterViewModel(status = {}) {
  const runtimeSummary = status.installed ? 'Instalado' : 'Não encontrado';
  const runtimeDetail = status.executable || 'Comando desconhecido';
  const providerDetail = getProviderDetail(status.providerState, status.providerSourceLabel);
  const providerTone = getProviderTone(status.providerState);
  const workspaceSummary = status.workspaceFolder ? getPathTail(status.workspaceFolder) : 'Nenhum workspace aberto';
  const workspaceDetail = [status.workspaceFolder, status.workspaceSourceLabel]
    .filter(Boolean)
    .join(' · ') || 'nenhum workspace aberto';

  return {
    header: {
      eyebrow: 'Centro de Controle NeveCode',
      title: 'Painel de controle do NeveCode',
      subtitle:
        'Status local, comportamento de início previsível e acesso rápido aos fluxos que você realmente usa.',
    },
    headerBadges: [
      {
        key: 'runtime',
        label: 'Executável',
        value: runtimeSummary,
        tone: getRuntimeTone(status.installed),
      },
      {
        key: 'provider',
        label: 'Provedor',
        value: status.providerState?.label || 'Desconhecido',
        tone: providerTone,
      },
      {
        key: 'profileStatus',
        label: 'Perfil',
        value: status.profileStatusLabel || 'Desconhecido',
        tone: getProfileTone(status.profileStatusLabel),
      },
    ],
    summaryCards: [
      {
        key: 'workspace',
        label: 'Workspace',
        value: status.workspaceFolder || 'Nenhum workspace aberto',
        detail: status.workspaceSourceLabel || 'nenhum workspace aberto',
      },
      {
        key: 'launchCwd',
        label: 'Diret. de início',
        value: status.launchCwdLabel || 'Diretório padrão do terminal do VS Code',
      },
      {
        key: 'launchCommand',
        label: 'Comando de início',
        value: status.launchCommand || '',
        detail: status.terminalName ? `Terminal integrado: ${status.terminalName}` : '',
      },
    ],
    detailSections: [
      {
        title: 'Projeto',
        rows: [
          {
            key: 'workspace',
            label: 'Pasta do workspace',
            summary: workspaceSummary,
            detail: workspaceDetail,
          },
          {
            key: 'profileStatus',
            label: 'Perfil do workspace',
            summary: status.profileStatusLabel || 'Desconhecido',
            detail: status.profileStatusHint || '',
            tone: getProfileTone(status.profileStatusLabel),
          },
        ],
      },
      {
        title: 'Executável',
        rows: [
          {
            key: 'runtime',
            label: 'Executável NeveCode',
            summary: runtimeSummary,
            detail: runtimeDetail,
            tone: getRuntimeTone(status.installed),
          },
          {
            key: 'provider',
            label: 'Provedor detectado',
            summary: status.providerState?.label || 'Desconhecido',
            detail: providerDetail,
            tone: providerTone,
          },
        ],
      },
    ],
    actions: buildActionModel(status),
  };
}

module.exports = {
  truncateMiddle,
  buildActionModel,
  buildControlCenterViewModel,
};
