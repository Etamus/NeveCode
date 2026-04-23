<img width="1400" height="350" alt="Neve Code" src="https://github.com/user-attachments/assets/c9d84af3-447c-49af-b951-31c62fbe9310" />

---

**Neve Code** é uma extensão de agente de codificação para VS Code que opera de forma totalmente offline, dispensando o uso de APIs pagas ou conexão com a internet. Ela integra um painel de chat interativo diretamente no editor, permitindo uma comunicação fluida e direta com o servidor llama.cpp em execução na sua própria máquina.

---

<img width="680" height="1004" alt="{CE032475-C572-433F-A4F3-2DCF85DE983F}" src="https://github.com/user-attachments/assets/6fb86fe6-0125-4542-8540-cb090a38f3b7" />

---

## Como funciona

1. O **servidor llama.cpp** é iniciado localmente na porta `8080` com o modelo GGUF da pasta `models/`
2. A **extensão VS Code** abre um painel de chat na barra lateral secundária
3. O painel se comunica com o servidor via API compatível com OpenAI (`/v1/chat/completions`)
4. O **CLI** pode ser usado no terminal como alternativa ao chat visual

---

## Extensão

A extensão **Neve Code** adiciona um painel de chat à barra lateral secundária do VS Code.

Funcionalidades:
- Chat com o modelo local em tempo real
- Histórico de sessões com possibilidade de restaurar conversas anteriores
- Suporte a streaming de resposta, blocos de raciocínio e chamadas de ferramentas
- Tema escuro integrado: **NeveCode Terminal Black**

---

## Requisitos

- Windows 10/11 64-bit
- VS Code `1.95+`
- GPU compatível com Vulkan ou CUDA (recomendado), ou CPU

---

## Instalação

### Instalador automático (recomendado)

Execute `instalar.bat` na raiz do projeto. Ele cuida de tudo, incluindo empacotar e instalar esta extensão.

O instalador vai:
- Verificar/instalar **Node.js** e **Bun**
- Rodar `bun install` e compilar o projeto
- Baixar o **llama.cpp** do GitHub (detecta CUDA, fallback para Vulkan)
- Empacotar e instalar a **extensão VS Code**
- Configurar variáveis de ambiente e `settings.json`

Depois da instalação, **reinicie o VS Code** e execute:

```bat
iniciar.bat
```

### Manual

```bat
cd vscode-extension\nevecode-vscode
npx @vscode/vsce package --no-dependencies
code --install-extension nevecode-vscode-0.2.0.vsix --force
```

---

## Modelos suportados

Coloque qualquer arquivo `.gguf` na pasta `models/`. O servidor detecta automaticamente o primeiro modelo encontrado.

O `iniciar.bat` detecta o modelo automaticamente e seta `OPENAI_MODEL` para o nome do arquivo.

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

## Estrutura do projeto

```
Neve Code/
├── models/              # Modelos GGUF (coloque o seu aqui)
├── llama-bin/           # Binários do llama.cpp (baixados pelo instalador)
├── src/                 # Código-fonte do CLI
├── dist/                # Build compilado
├── scripts/
│   └── start-llamacpp.ps1   # Inicialização do servidor llama
├── python/              # Provedores Python alternativos (llama.cpp)
├── vscode-extension/
│   └── nevecode-vscode/ # Extensão VS Code
├── instalar.bat         # Instalador completo
└── iniciar.bat          # Inicia servidor + CLI
```

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
