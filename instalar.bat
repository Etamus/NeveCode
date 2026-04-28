@echo off
chcp 65001 > nul
setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "EXT_DIR=%SCRIPT_DIR%vscode-extension\nevecode-vscode"
set "DIST_CLI=%SCRIPT_DIR%dist\cli.mjs"
set "BIN_DIR=%SCRIPT_DIR%llama-bin"
set "SERVER_EXE=%BIN_DIR%\llama-server.exe"
set "EXT_ID=devnull-bootloader.nevecode-vscode"

cd /d "%SCRIPT_DIR%"

:: Atualizar PATH da sessão com entradas de Máquina/Usuário e locais padrão
for /f "delims=" %%P in ('powershell -NoProfile -Command "$m=[Environment]::GetEnvironmentVariable('PATH','Machine'); $u=[Environment]::GetEnvironmentVariable('PATH','User'); [Console]::Write($m+';'+$u)"') do set "PATH=%%P;%PATH%"
set "PATH=%USERPROFILE%\.bun\bin;%LocalAppData%\Programs\Microsoft VS Code\bin;%ProgramFiles%\nodejs;%LocalAppData%\Programs\Python\Python312;%LocalAppData%\Programs\Python\Python312\Scripts;%PATH%"

:: Criar diretórios ignorados pelo Git, necessários para novos usuários
if not exist "%SCRIPT_DIR%models" mkdir "%SCRIPT_DIR%models"
if not exist "%SCRIPT_DIR%models\.gitkeep" type nul > "%SCRIPT_DIR%models\.gitkeep"
if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"

echo.
echo ============================================================
echo  NeveCode - Instalador
echo ============================================================
echo.

:: ──────────────────────────────────────────────────────────────────────────────
:: [1/7] Verificar Node.js
:: ──────────────────────────────────────────────────────────────────────────────
echo [1/7] Verificando Node.js...
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
:: [2/7] Verificar Bun
:: ──────────────────────────────────────────────────────────────────────────────
echo [2/7] Verificando Bun...
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
:: ──────────────────────────────────────────────────────────────────────────────
:: [3/7] Verificar Python
:: ──────────────────────────────────────────────────────────────────────────────
echo [3/7] Verificando Python...
python --version >nul 2>&1
if !ERRORLEVEL! NEQ 0 (
    py -3 --version >nul 2>&1
    if !ERRORLEVEL! EQU 0 set "PYTHON_CMD=py -3"
) else (
    set "PYTHON_CMD=python"
)

if not defined PYTHON_CMD (
    echo  Python nao encontrado. Tentando instalar via winget...
    winget install Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements
    if !ERRORLEVEL! NEQ 0 (
        winget install Python.Python.3.11 --silent --accept-package-agreements --accept-source-agreements
    )
    if !ERRORLEVEL! NEQ 0 (
        echo.
        echo  ERRO: Nao foi possivel instalar o Python automaticamente.
        echo  Acesse https://www.python.org/downloads/ e instale marcando "Add python.exe to PATH".
        echo.
        pause
        exit /b 1
    )
    for /f "delims=" %%P in ('powershell -NoProfile -Command "$m=[Environment]::GetEnvironmentVariable('PATH','Machine'); $u=[Environment]::GetEnvironmentVariable('PATH','User'); [Console]::Write($m+';'+$u)"') do set "PATH=%%P;%PATH%"
    set "PATH=%LocalAppData%\Programs\Python\Python312;%LocalAppData%\Programs\Python\Python312\Scripts;%PATH%"
    python --version >nul 2>&1
    if !ERRORLEVEL! NEQ 0 (
        echo  Python instalado. REINICIE este instalador para continuar.
        pause
        exit /b 0
    )
    set "PYTHON_CMD=python"
)
%PYTHON_CMD% -m ensurepip --upgrade >nul 2>&1
%PYTHON_CMD% -m pip install --upgrade pip --quiet
for /f "tokens=*" %%V in ('%PYTHON_CMD% --version 2^>nul') do echo  %%V encontrado.
echo.

:: ──────────────────────────────────────────────────────────────────────────────
:: [4/7] Instalar dependencias e compilar
:: ──────────────────────────────────────────────────────────────────────────────
echo [4/7] Instalando dependencias do projeto (bun install)...
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

echo  Instalando dependencias Python (httpx para llamacpp_provider)...
%PYTHON_CMD% -m pip install httpx --quiet 2>nul
if !ERRORLEVEL! NEQ 0 (
    echo  AVISO: pip nao disponivel ou httpx falhou - verifique se Python esta no PATH.
    echo  Execute manualmente: pip install httpx
)
echo.

:: ──────────────────────────────────────────────────────────────────────────────
:: [5/7] Instalar llama.cpp (baixar se nao existir)
:: ──────────────────────────────────────────────────────────────────────────────
echo [5/7] Verificando llama.cpp...
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
        "function Resolve-CudaTag([string]$v) { switch (($v -split '\.')[0]) { '13' { '13.1' } '12' { '12.4' } '11' { '12.4' } default { '12.4' } } }" ^
        "$cudaVer = Get-CudaVersion;" ^
        "if ($cudaVer) { Write-Host \"CUDA $cudaVer detectado.\"; $cudaTag = Resolve-CudaTag $cudaVer } else { Write-Host 'CUDA nao detectado via nvidia-smi/nvcc; usando pacote CUDA 12.4 generico.'; $cudaTag = '12.4' };" ^
        "$rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest' -Headers @{'User-Agent'='nevecode-installer'};" ^
        "$tag = $rel.tag_name; Write-Host \"Versao mais recente: $tag\";" ^
        "$url = \"https://github.com/ggml-org/llama.cpp/releases/download/$tag/llama-$tag-bin-win-cuda-$cudaTag-x64.zip\";" ^
        "Write-Host \"Baixando: $url\";" ^
        "$zip = Join-Path $env:TEMP 'llama-cpp.zip';" ^
        "Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing;" ^
        "if (Test-Path $BinDir) { Remove-Item $BinDir -Recurse -Force };" ^
        "New-Item -ItemType Directory -Path $BinDir -Force | Out-Null;" ^
        "Expand-Archive -Path $zip -DestinationPath $BinDir -Force;" ^
        "Remove-Item $zip -Force;" ^
        "$inner = Get-ChildItem $BinDir -Directory | Select-Object -First 1;" ^
        "if ($inner) { Get-ChildItem $inner.FullName | Move-Item -Destination $BinDir; Remove-Item $inner.FullName -Recurse -Force };" ^
        "$tag | Set-Content (Join-Path $BinDir 'version.txt') -Encoding UTF8;" ^
        "$cudartUrl = \"https://github.com/ggml-org/llama.cpp/releases/download/$tag/cudart-llama-bin-win-cuda-$cudaTag-x64.zip\";" ^
        "$cudartZip = Join-Path $env:TEMP 'llama-cudart.zip';" ^
        "try { Invoke-WebRequest -Uri $cudartUrl -OutFile $cudartZip -UseBasicParsing; Expand-Archive -Path $cudartZip -DestinationPath $BinDir -Force; Remove-Item $cudartZip -Force; Write-Host 'CUDA runtime DLLs instalados.' } catch { Write-Host 'AVISO: falha ao instalar CUDA runtime DLLs.' };" ^
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
:: [6/7] Empacotar e instalar extensao VS Code
:: ──────────────────────────────────────────────────────────────────────────────
echo [6/7] Instalando extensao VS Code...
where code >nul 2>&1
if !ERRORLEVEL! NEQ 0 (
    echo  VS Code/code nao encontrado. Tentando instalar via winget...
    winget install Microsoft.VisualStudioCode --silent --accept-package-agreements --accept-source-agreements
    if !ERRORLEVEL! NEQ 0 (
        echo.
        echo  ERRO: Nao foi possivel instalar o VS Code automaticamente.
        echo  Instale em https://code.visualstudio.com/ e rode este instalador novamente.
        echo.
        pause
        exit /b 1
    )
    for /f "delims=" %%P in ('powershell -NoProfile -Command "$m=[Environment]::GetEnvironmentVariable('PATH','Machine'); $u=[Environment]::GetEnvironmentVariable('PATH','User'); [Console]::Write($m+';'+$u)"') do set "PATH=%%P;%PATH%"
    set "PATH=%LocalAppData%\Programs\Microsoft VS Code\bin;%PATH%"
    where code >nul 2>&1
    if !ERRORLEVEL! NEQ 0 (
        echo  VS Code instalado. REINICIE este instalador para continuar.
        pause
        exit /b 0
    )
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
:: [7/7] Configurar variaveis de ambiente e settings.json
:: ──────────────────────────────────────────────────────────────────────────────
echo [7/7] Configurando variaveis de ambiente...
cd /d "%SCRIPT_DIR%"

setx CLAUDE_CODE_USE_OPENAI "1" >nul
setx OPENAI_BASE_URL "http://localhost:8080/v1" >nul
setx OPENAI_API_KEY "no-key" >nul
setx CLAUDE_CODE_MAX_OUTPUT_TOKENS "4096" >nul
setx NEVECODE_PERFORMANCE_PROFILE "auto" >nul

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
    "Add-Member -InputObject $s -Force -MemberType NoteProperty -Name 'nevecode.permissionMode' -Value 'default';" ^
    "Add-Member -InputObject $s -Force -MemberType NoteProperty -Name 'nevecode.performanceProfile' -Value 'balanced';" ^
    "Add-Member -InputObject $s -Force -MemberType NoteProperty -Name 'nevecode.planningMode' -Value 'heuristic';" ^
    "Add-Member -InputObject $s -Force -MemberType NoteProperty -Name 'nevecode.maxOutputTokens' -Value 4096;" ^
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
