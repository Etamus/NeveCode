@echo off
chcp 65001 > nul
setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "EXT_DIR=%SCRIPT_DIR%vscode-extension\nevecode-vscode"
set "DIST_CLI=%SCRIPT_DIR%dist\cli.mjs"
set "EXT_ID=devnull-bootloader.nevecode-vscode"

cd /d "%SCRIPT_DIR%"

echo ============================================================
echo  NeveCode - Iniciando
echo ============================================================
echo.

:: ── Verificar se extensao VS Code esta instalada ───────────────────────────
echo Verificando extensao VS Code...

where code >nul 2>&1
if !ERRORLEVEL! NEQ 0 (
    echo.
    echo  AVISO: Comando 'code' nao encontrado no PATH.
    echo  Abra o VS Code, pressione Ctrl+Shift+P e execute:
    echo    Shell Command: Install 'code' command in PATH
    echo  Depois rode este arquivo novamente.
    echo.
    pause
    exit /b 1
)

:: Detectar pasta da extensao instalada e confirmar no registro do VS Code
set "EXT_INSTALLED_DIR="
for /d %%D in ("%USERPROFILE%\.vscode\extensions\%EXT_ID%*") do (
    if not defined EXT_INSTALLED_DIR set "EXT_INSTALLED_DIR=%%D"
)

set "EXT_LISTED="
for /f "delims=" %%E in ('code --list-extensions 2^>nul ^| findstr /i /x "%EXT_ID%"') do set "EXT_LISTED=%%E"

if not defined EXT_INSTALLED_DIR (
    echo  Extensao nao encontrada na pasta de extensoes.
) else if not defined EXT_LISTED (
    echo  Pasta da extensao existe, mas VS Code nao lista a extensao. Reinstalando...
) else (
    echo  Extensao encontrada em: !EXT_INSTALLED_DIR!
)

if not defined EXT_INSTALLED_DIR if not defined EXT_LISTED set "NEED_EXT_INSTALL=1"
if defined EXT_INSTALLED_DIR if not defined EXT_LISTED set "NEED_EXT_INSTALL=1"
if /i "%NEVECODE_FORCE_EXTENSION_INSTALL%"=="1" set "NEED_EXT_INSTALL=1"
if /i not "%NEVECODE_SKIP_EXTENSION_INSTALL%"=="1" set "NEED_EXT_INSTALL=1"

if defined NEED_EXT_INSTALL (
    echo  Instalando/atualizando extensao VS Code...

    :: Atualizar settings.json e variaveis de ambiente
    setx CLAUDE_CODE_USE_OPENAI "1" >nul
    setx OPENAI_BASE_URL "http://localhost:8080/v1" >nul
    setx OPENAI_API_KEY "no-key" >nul
    setx CLAUDE_CODE_MAX_OUTPUT_TOKENS "4096" >nul
    setx NEVECODE_PERFORMANCE_PROFILE "auto" >nul

    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$f = \"$env:APPDATA\Code\User\settings.json\";" ^
      "New-Item -ItemType Directory -Force -Path (Split-Path $f) | Out-Null;" ^
      "$s = @{};" ^
      "if (Test-Path $f) { try { $s = Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json } catch {} };" ^
      "if (-not $s) { $s = [pscustomobject]@{} };" ^
      "Add-Member -InputObject $s -Force -MemberType NoteProperty -Name 'nevecode.launchCommand' -Value 'bun \"%DIST_CLI:\=/%\"';" ^
      "Add-Member -InputObject $s -Force -MemberType NoteProperty -Name 'nevecode.useOpenAIShim' -Value $true;" ^
    "Add-Member -InputObject $s -Force -MemberType NoteProperty -Name 'nevecode.permissionMode' -Value 'default';" ^
            "Add-Member -InputObject $s -Force -MemberType NoteProperty -Name 'nevecode.performanceProfile' -Value 'balanced';" ^
            "Add-Member -InputObject $s -Force -MemberType NoteProperty -Name 'nevecode.planningMode' -Value 'heuristic';" ^
            "Add-Member -InputObject $s -Force -MemberType NoteProperty -Name 'nevecode.maxOutputTokens' -Value 4096;" ^
      "$s | ConvertTo-Json -Depth 20 | Set-Content $f -Encoding UTF8;" ^
      "Write-Host 'settings.json atualizado.'"

    :: Empacotar e instalar a extensao
    cd /d "%EXT_DIR%"
    echo  Empacotando extensao...
    call npx --yes @vscode/vsce package --no-dependencies --skip-license --out nevecode.vsix
    if !ERRORLEVEL! NEQ 0 (
        echo  ERRO: Falha ao empacotar extensao.
        pause
        exit /b 1
    )

    echo  Instalando extensao no VS Code...
    call code --install-extension "%EXT_DIR%\nevecode.vsix" --force
    if !ERRORLEVEL! NEQ 0 (
        echo  ERRO: Falha ao instalar extensao.
        pause
        exit /b 1
    )
    del /q "%EXT_DIR%\nevecode.vsix" 2>nul

    echo.
    echo  Extensao instalada/atualizada. Se o VS Code estiver aberto, use Developer: Reload Window.
    echo.
)
echo.

cd /d "%SCRIPT_DIR%"

:: Defaults de performance para execuções existentes (sem reinstalar extensão)
if not defined CLAUDE_CODE_MAX_OUTPUT_TOKENS set "CLAUDE_CODE_MAX_OUTPUT_TOKENS=4096"
if not defined NEVECODE_PERFORMANCE_PROFILE set "NEVECODE_PERFORMANCE_PROFILE=auto"

:: ── Detectar modelo GGUF e definir OPENAI_MODEL ─────────────────────────────
set "MODEL_NAME="
for /f "delims=" %%F in ('dir /b /o-d "%SCRIPT_DIR%models\*.gguf" 2^>nul') do (
    if not defined MODEL_NAME set "MODEL_NAME=%%~nF"
)
if defined MODEL_NAME (
    echo Modelo detectado: !MODEL_NAME!
    set "OPENAI_MODEL=!MODEL_NAME!"
    setx OPENAI_MODEL "!MODEL_NAME!" >nul 2>&1
) else (
    echo AVISO: Nenhum .gguf encontrado em models/. Usando nome padrao.
    set "OPENAI_MODEL=local-model"
)
echo.

:: ── 1. Compilar ──────────────────────────────────────────────────────────────
echo [1/2] Compilando o projeto...
call bun run build
if errorlevel 1 (
    echo.
    echo [ERRO] Falha na compilacao. Verifique a saida acima.
    pause
    exit /b 1
)

:: ── 2. Iniciar llama-server ──────────────────────────────────────────────────
echo.
echo [2/2] Iniciando llama-server (porta 8080)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%scripts\start-llamacpp.ps1"
if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao iniciar llama-server. Verifique a saida acima.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  Servidor iniciado! Abra o VS Code e use o painel lateral
echo  do NeveCode para conversar (icone na barra de atividades)
echo ============================================================
echo.
echo  Pressione Ctrl+C para encerrar o servidor.
echo.

