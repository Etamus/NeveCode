@echo off
setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "EXT_DIR=%SCRIPT_DIR%vscode-extension\nevecode-vscode"
set "DIST_CLI=%SCRIPT_DIR%dist\cli.mjs"
set "BIN_DIR=%SCRIPT_DIR%llama-bin"
set "SERVER_EXE=%BIN_DIR%\llama-server.exe"
set "EXT_ID=devnull-bootloader.nevecode-vscode"

cd /d "%SCRIPT_DIR%"

echo.
echo ============================================================
echo  NeveCode - Instalador
echo ============================================================
echo.

:: ──────────────────────────────────────────────────────────────────────────────
:: [1/6] Verificar Node.js
:: ──────────────────────────────────────────────────────────────────────────────
echo [1/6] Verificando Node.js...
node --version >nul 2>&1
if !ERRORLEVEL! NEQ 0 (
    echo  Node.js nao encontrado. Tentando instalar via winget...
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    if !ERRORLEVEL! NEQ 0 (
        echo.
        echo  ERRO: Nao foi possivel instalar o Node.js automaticamente.
        echo  Acesse https://nodejs.org e instale manualmente, depois rode este arquivo novamente.
        echo.
        pause
        exit /b 1
    )
    :: Atualizar PATH para a sessao atual
    for /f "tokens=*" %%P in ('powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\"PATH\",\"Machine\")"') do set "PATH=%%P;%PATH%"
    node --version >nul 2>&1
    if !ERRORLEVEL! NEQ 0 (
        echo  Node.js instalado. REINICIE este instalador para continuar.
        pause
        exit /b 0
    )
)
for /f "tokens=*" %%V in ('node --version 2^>nul') do echo  Node.js %%V encontrado.
echo.

:: ──────────────────────────────────────────────────────────────────────────────
:: [2/6] Verificar Bun
:: ──────────────────────────────────────────────────────────────────────────────
echo [2/6] Verificando Bun...
bun --version >nul 2>&1
if !ERRORLEVEL! NEQ 0 (
    echo  Bun nao encontrado. Instalando...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://bun.sh/install.ps1 | iex"
    if !ERRORLEVEL! NEQ 0 (
        echo.
        echo  ERRO: Nao foi possivel instalar o Bun.
        echo  Acesse https://bun.sh e instale manualmente, depois rode este arquivo novamente.
        echo.
        pause
        exit /b 1
    )
    :: Atualizar PATH
    set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
    bun --version >nul 2>&1
    if !ERRORLEVEL! NEQ 0 (
        echo  Bun instalado. REINICIE este instalador para continuar.
        pause
        exit /b 0
    )
)
for /f "tokens=*" %%V in ('bun --version 2^>nul') do echo  Bun %%V encontrado.
echo.

:: ──────────────────────────────────────────────────────────────────────────────
:: [3/6] Instalar dependencias e compilar
:: ──────────────────────────────────────────────────────────────────────────────
echo [3/6] Instalando dependencias do projeto (bun install)...
call bun install --frozen-lockfile
if !ERRORLEVEL! NEQ 0 (
    echo  Tentando sem --frozen-lockfile...
    call bun install
    if !ERRORLEVEL! NEQ 0 (
        echo.
        echo  ERRO: Falha ao instalar dependencias.
        pause
        exit /b 1
    )
)
echo.

echo  Compilando projeto...
call bun run build
if !ERRORLEVEL! NEQ 0 (
    echo.
    echo  ERRO: Falha na compilacao.
    pause
    exit /b 1
)
echo  Compilacao concluida.
echo.

:: ──────────────────────────────────────────────────────────────────────────────
:: [4/6] Instalar llama.cpp (baixar se nao existir)
:: ──────────────────────────────────────────────────────────────────────────────
echo [4/6] Verificando llama.cpp...
if exist "%SERVER_EXE%" (
    echo  llama-server.exe ja presente em llama-bin\. Pulando download.
) else (
    echo  llama-server.exe nao encontrado. Baixando do GitHub...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$BinDir = '%BIN_DIR:\=\\%';" ^
        "function Get-CudaVersion {" ^
        "    try { $n = & nvcc --version 2>&1 | Select-String 'release (\d+\.\d+)'; if ($n) { return ($n.Matches[0].Groups[1].Value) } } catch {}" ^
        "    try { $s = & nvidia-smi 2>&1 | Select-String 'CUDA Version: (\d+\.\d+)'; if ($s) { return ($s.Matches[0].Groups[1].Value) } } catch {}" ^
        "    return $null" ^
        "}" ^
        "function Resolve-CudaTag([string]$v) { switch (($v -split '\.')[0]) { '12' { 'cu12.4.0' } '11' { 'cu11.8.0' } default { $null } } }" ^
        "$cudaVer = Get-CudaVersion;" ^
        "if ($cudaVer) { Write-Host \"CUDA $cudaVer detectado.\"; $cudaTag = Resolve-CudaTag $cudaVer } else { Write-Host 'CUDA nao encontrado, usando Vulkan.'; $cudaTag = $null };" ^
        "$rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest' -Headers @{'User-Agent'='nevecode-installer'};" ^
        "$tag = $rel.tag_name; Write-Host \"Versao mais recente: $tag\";" ^
        "if ($cudaTag) { $url = \"https://github.com/ggml-org/llama.cpp/releases/download/$tag/llama-$tag-bin-win-cuda-$cudaTag-x64.zip\" }" ^
        "else { $url = \"https://github.com/ggml-org/llama.cpp/releases/download/$tag/llama-$tag-bin-win-vulkan-x64.zip\" };" ^
        "Write-Host \"Baixando: $url\";" ^
        "$zip = Join-Path $env:TEMP 'llama-cpp.zip';" ^
        "Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing;" ^
        "if (Test-Path $BinDir) { Remove-Item $BinDir -Recurse -Force };" ^
        "New-Item -ItemType Directory -Path $BinDir -Force | Out-Null;" ^
        "Expand-Archive -Path $zip -DestinationPath $BinDir -Force;" ^
        "Remove-Item $zip -Force;" ^
        "$inner = Get-ChildItem $BinDir -Directory | Select-Object -First 1;" ^
        "if ($inner) { Get-ChildItem $inner.FullName | Move-Item -Destination $BinDir; Remove-Item $inner.FullName -Recurse -Force };" ^
        "Write-Host 'llama.cpp instalado com sucesso.'"
    if !ERRORLEVEL! NEQ 0 (
        echo.
        echo  ERRO: Falha ao baixar llama.cpp. Verifique sua conexao com a internet.
        pause
        exit /b 1
    )
)
echo.

:: ──────────────────────────────────────────────────────────────────────────────
:: [5/6] Empacotar e instalar extensao VS Code
:: ──────────────────────────────────────────────────────────────────────────────
echo [5/6] Instalando extensao VS Code...
where code >nul 2>&1
if !ERRORLEVEL! NEQ 0 (
    echo.
    echo  AVISO: Comando 'code' nao encontrado no PATH.
    echo  Abra o VS Code, pressione Ctrl+Shift+P e execute:
    echo    Shell Command: Install 'code' command in PATH
    echo  Depois rode este instalador novamente.
    echo.
    pause
    exit /b 1
)

cd /d "%EXT_DIR%"
echo  Empacotando extensao...
call npx --yes @vscode/vsce package --no-dependencies
if !ERRORLEVEL! NEQ 0 (
    echo  ERRO: Falha ao empacotar extensao.
    pause
    exit /b 1
)

set "VSIX_FILE="
for /f "delims=" %%F in ('dir /b /o-d "*.vsix" 2^>nul') do (
    if not defined VSIX_FILE set "VSIX_FILE=%%F"
)
if not defined VSIX_FILE (
    echo  ERRO: Nenhum .vsix encontrado.
    pause
    exit /b 1
)

echo  Instalando !VSIX_FILE! no VS Code...
call code --install-extension "!VSIX_FILE!" --force
if !ERRORLEVEL! NEQ 0 (
    echo  ERRO: Falha ao instalar extensao.
    pause
    exit /b 1
)
echo  Extensao instalada.
echo.

:: ──────────────────────────────────────────────────────────────────────────────
:: [6/6] Configurar variaveis de ambiente e settings.json
:: ──────────────────────────────────────────────────────────────────────────────
echo [6/6] Configurando variaveis de ambiente...
cd /d "%SCRIPT_DIR%"

setx CLAUDE_CODE_USE_OPENAI "1" >nul
setx OPENAI_BASE_URL "http://localhost:8080/v1" >nul
setx OPENAI_API_KEY "no-key" >nul
setx CLAUDE_CODE_MAX_OUTPUT_TOKENS "16000" >nul

:: Detectar modelo GGUF
set "MODEL_NAME="
for /f "delims=" %%F in ('dir /b /o-d "%SCRIPT_DIR%models\*.gguf" 2^>nul') do (
    if not defined MODEL_NAME set "MODEL_NAME=%%~nF"
)
if defined MODEL_NAME (
    echo  Modelo detectado: !MODEL_NAME!
    setx OPENAI_MODEL "!MODEL_NAME!" >nul 2>&1
) else (
    echo  AVISO: Nenhum .gguf encontrado em models\. Coloque um modelo GGUF la para usar o NeveCode.
)

:: Atualizar settings.json do VS Code
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$f = \"$env:APPDATA\Code\User\settings.json\";" ^
    "New-Item -ItemType Directory -Force -Path (Split-Path $f) | Out-Null;" ^
    "$s = [pscustomobject]@{};" ^
    "if (Test-Path $f) { try { $s = Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json } catch {} };" ^
    "if (-not $s) { $s = [pscustomobject]@{} };" ^
    "Add-Member -InputObject $s -Force -MemberType NoteProperty -Name 'nevecode.launchCommand' -Value 'bun \"%DIST_CLI:\=/%\"';" ^
    "Add-Member -InputObject $s -Force -MemberType NoteProperty -Name 'nevecode.useOpenAIShim' -Value $true;" ^
    "Add-Member -InputObject $s -Force -MemberType NoteProperty -Name 'nevecode.permissionMode' -Value 'acceptEdits';" ^
    "$s | ConvertTo-Json -Depth 20 | Set-Content $f -Encoding UTF8;" ^
    "Write-Host 'settings.json atualizado.'"

echo.
echo ============================================================
echo  Instalacao concluida!
echo.
echo  Proximos passos:
echo  1. REINICIE o VS Code para carregar a extensao
echo  2. Se nao tiver um modelo GGUF em models\, baixe um e
echo     coloque la antes de usar
echo  3. Para iniciar o servidor, execute:  iniciar.bat
echo ============================================================
echo.
pause
