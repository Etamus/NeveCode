# Neve Code — Extensão VS Code

Extensão VS Code para o **Neve Code**, um agente de codificação local baseado em llama.cpp. Adiciona um painel de chat interativo na **barra lateral secundária** do VS Code que se comunica com o servidor llama.cpp rodando localmente.

---

## Funcionalidades

- **Painel de chat na barra lateral secundária** — não ocupa espaço na barra de atividades principal
- **Histórico de sessões** — salva e restaura conversas anteriores
- **Streaming em tempo real** — respostas aparecem token a token
- **Blocos de raciocínio** — exibe o processo de pensamento interno do modelo
- **Chamadas de ferramentas** — visualização de cada ferramenta usada pelo agente
- **Tema escuro integrado** — *NeveCode Terminal Black*
- **Atalho de teclado**: `Ctrl+Shift+L` para abrir o chat

---

## Requisitos

- VS Code `1.95+`
- Servidor llama.cpp rodando na porta `8080` (iniciado pelo `iniciar.bat` na raiz do projeto)

---

## Instalação

### Via instalador automático (recomendado)

Execute `instalar.bat` na raiz do projeto. Ele cuida de tudo, incluindo empacotar e instalar esta extensão.

### Manual

```bat
cd vscode-extension\nevecode-vscode
npx @vscode/vsce package --no-dependencies
code --install-extension nevecode-vscode-0.2.0.vsix --force
```

---

## Comandos disponíveis

| Comando | Descrição |
|---|---|
| `Neve Code: Abrir Painel de Chat` | Abre o chat na barra lateral secundária |
| `Neve Code: Nova Conversa` | Inicia uma conversa nova |
| `Neve Code: Retomar Sessão` | Abre o histórico de sessões |
| `Neve Code: Interromper Geração` | Cancela a resposta em andamento |
| `Neve Code: Iniciar no Terminal` | Abre o CLI no terminal integrado |
| `Neve Code: Iniciar na Raiz do Workspace` | Inicia o CLI no diretório raiz do projeto aberto |

**Atalho:** `Ctrl+Shift+L` (`Cmd+Shift+L` no macOS)

---

## Configurações

| Chave | Padrão | Descrição |
|---|---|---|
| `nevecode.launchCommand` | `openclaude` | Comando executado ao iniciar no terminal |
| `nevecode.terminalName` | `Neve Code` | Nome da aba do terminal integrado |
| `nevecode.useOpenAIShim` | `false` | Define `CLAUDE_CODE_USE_OPENAI=1` (ative para llama.cpp/Ollama) |
| `nevecode.permissionMode` | `acceptEdits` | Modo de permissão: `default`, `acceptEdits`, `bypassPermissions` ou `plan` |

---

## Como abrir o chat

O painel do Neve Code fica na **barra lateral secundária** (lado direito do VS Code). Para abri-la:

1. Menu **View → Secondary Side Bar** (`Ctrl+Alt+B`)
2. Ou use o atalho `Ctrl+Shift+L`

---

## Desenvolvimento

```bash
# Rodar testes
npm run test

# Lint
npm run lint

# Empacotar
npm run package
```

---

## Tema

A extensão inclui o tema **NeveCode Terminal Black** — um tema escuro e de alto contraste otimizado para sessões longas de codificação com IA.

Ative em: **Ctrl+Shift+P → Preferences: Color Theme → NeveCode Terminal Black**

---