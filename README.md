<img width="1400" height="350" alt="Neve Code (1) (1)" src="https://github.com/user-attachments/assets/7045efa5-b6ba-4693-853e-a0a47bcac9ac" />

---

**Neve Code** é um agente de codificação integrado ao VS Code que viabiliza a execução de modelos de linguagem de grande porte (LLMs) diretamente em seu ambiente de desenvolvimento local. Ao operar inteiramente offline e sem dependência de APIs de terceiros, a solução oferece uma experiência de assistência por IA focada em privacidade e soberania de dados, utilizando o ecossistema llama.cpp para processar modelos no formato GGUF. A ferramenta disponibiliza um painel de chat dedicado para interação direta com o modelo, proporcionando suporte contínuo ao fluxo de trabalho de programação dentro do editor.

---

<table>
  <tr>
    <td align="center">
      <img width="511" height="976" alt="{304561A7-58B3-4845-A52B-CA14E7A3D261}" src="https://github.com/user-attachments/assets/8b53de52-cc4f-4cb5-a8fd-12eebb103db6" />
    </td>
    <td align="center">
      <img width="512" height="977" alt="{F76D4847-CB95-4477-BBE9-0537A92CCEC7}" src="https://github.com/user-attachments/assets/da5a5484-f78c-4f96-8e81-27de48803b5a" />
    </td>
  </tr>
</table>

<h1 align="center">
<img width="800" height="429" alt="NeveCode" src="https://github.com/user-attachments/assets/1f04fa1e-c340-4893-bde1-440634e603be" />
</h1>

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
