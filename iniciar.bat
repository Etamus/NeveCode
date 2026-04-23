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

:: ── Empacotar e instalar extensao VS Code (sempre atualiza) ─────────────────
echo Atualizando extensao VS Code...
cd /d "%EXT_DIR%"
call npx --yes @vscode/vsce package --no-dependencies >nul 2>&1
if !ERRORLEVEL! NEQ 0 (
    echo AVISO: Falha ao empacotar extensao. Continuando com versao anterior.
) else (
    set "VSIX_FILE="
    for /f "delims=" %%F in ('dir /b /o-d "*.vsix" 2^>nul') do (
        if not defined VSIX_FILE set "VSIX_FILE=%%F"
    )
    if defined VSIX_FILE (
        call code --install-extension "!VSIX_FILE!" --force >nul 2>&1
        echo Extensao atualizada: !VSIX_FILE!
    )
)

:: Configurar variaveis de ambiente e settings (na primeira vez ou se necessario)
code --list-extensions 2>nul | findstr /i "%EXT_ID%" >nul 2>&1
if !ERRORLEVEL! NEQ 0 (
    setx CLAUDE_CODE_USE_OPENAI "1" >nul
    setx OPENAI_BASE_URL "http://localhost:8080/v1" >nul
    setx OPENAI_API_KEY "no-key" >nul
    setx CLAUDE_CODE_MAX_OUTPUT_TOKENS "16000" >nul

    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$f = \"$env:APPDATA\Code\User\settings.json\";" ^
      "New-Item -ItemType Directory -Force -Path (Split-Path $f) | Out-Null;" ^
      "$s = @{};" ^
      "if (Test-Path $f) { try { $s = Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json } catch {} };" ^
      "if (-not $s) { $s = [pscustomobject]@{} };" ^
      "Add-Member -InputObject $s -Force -MemberType NoteProperty -Name 'nevecode.launchCommand' -Value 'bun \"%DIST_CLI:\=/%\"';" ^
      "Add-Member -InputObject $s -Force -MemberType NoteProperty -Name 'nevecode.useOpenAIShim' -Value $true;" ^
      "Add-Member -InputObject $s -Force -MemberType NoteProperty -Name 'nevecode.permissionMode' -Value 'acceptEdits';" ^
      "$s | ConvertTo-Json -Depth 20 | Set-Content $f -Encoding UTF8;" ^
      "Write-Host 'settings.json atualizado.'"

    echo.
    echo  Extensao instalada pela primeira vez! REINICIE o VS Code para carrega-la.
    echo  Depois rode novamente este arquivo para iniciar o servidor.
    echo.
    pause
    exit /b 0
)
echo.

cd /d "%SCRIPT_DIR%"

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

