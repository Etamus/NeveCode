#Requires -Version 5.1
<#
.SYNOPSIS
    Baixa (se necessário) e inicia o llama-server com suporte GPU.
.DESCRIPTION
    - Detecta CUDA ou usa Vulkan como fallback para GPU
    - Baixa o binário standalone do llama.cpp caso não esteja presente
    - Inicia llama-server com flash attention, KV q8_0, ctx=32768
#>

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$BinDir   = Join-Path $PSScriptRoot "..\llama-bin"
$ModelsDir = Join-Path $PSScriptRoot "..\models"
$ServerExe = Join-Path $BinDir "llama-server.exe"
$Port = 8080

# ─── Funções auxiliares ──────────────────────────────────────────────────────

function Get-CudaVersion {
    # Tenta nvcc primeiro
    try {
        $nvcc = & nvcc --version 2>&1 | Select-String 'release (\d+\.\d+)'
        if ($nvcc -and $nvcc.Matches[0].Groups[1].Value) {
            return $nvcc.Matches[0].Groups[1].Value
        }
    } catch {}

    # Tenta nvidia-smi
    try {
        $smi = & nvidia-smi 2>&1 | Select-String 'CUDA Version: (\d+\.\d+)'
        if ($smi -and $smi.Matches[0].Groups[1].Value) {
            return $smi.Matches[0].Groups[1].Value
        }
    } catch {}

    return $null
}

function Resolve-CudaTag([string]$ver) {
    # Mapeia versão decimal → sufixo de release do llama.cpp
    $major = ($ver -split '\.')[0]
    switch ($major) {
        '13' { return '13.1' }
        '12' { return '12.4' }
        '11' { return '12.4' }  # usa 12.4 como minimo suportado
        default {
            Write-Host "[llama.cpp] AVISO: CUDA $ver nao reconhecido, usando 13.1." -ForegroundColor Yellow
            return '13.1'
        }
    }
}

function Get-LatestLlamaCppVersion {
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest' `
        -Headers @{ 'User-Agent' = 'nevecode-installer' }
    return $release.tag_name   # ex: b5000
}

function Get-InstalledVersion {
    $vf = Join-Path $BinDir 'version.txt'
    if (Test-Path $vf) { return (Get-Content $vf -Raw -Encoding UTF8).Trim() }
    return $null
}

function Select-DownloadAsset([string]$tag, [string]$cudaTag) {
    $base = "https://github.com/ggml-org/llama.cpp/releases/download/$tag"
    if (-not $cudaTag) {
        Write-Host "[llama.cpp] ERRO: CUDA nao detectado. Uma GPU NVIDIA com drivers CUDA e necessaria." -ForegroundColor Red
        Write-Host "[llama.cpp] Instale os drivers CUDA em: https://developer.nvidia.com/cuda-downloads" -ForegroundColor Yellow
        exit 1
    }
    return "$base/llama-$tag-bin-win-cuda-$cudaTag-x64.zip"
}

function Install-LlamaBinary {
    Write-Host "[llama.cpp] Detectando GPU..." -ForegroundColor Cyan
    $cudaVer = Get-CudaVersion
    if ($cudaVer) {
        Write-Host "[llama.cpp] CUDA $cudaVer detectado." -ForegroundColor Green
        $cudaTag = Resolve-CudaTag $cudaVer
    } else {
        Write-Host "[llama.cpp] AVISO: nvidia-smi/nvcc nao retornou versao CUDA. Usando cu12.4.0 generico." -ForegroundColor Yellow
        $cudaTag = Resolve-CudaTag 'unknown'
    }

    Write-Host "[llama.cpp] Obtendo versao mais recente..." -ForegroundColor Cyan
    $tag = Get-LatestLlamaCppVersion
    Write-Host "[llama.cpp] Versao: $tag" -ForegroundColor Green

    $url = Select-DownloadAsset $tag $cudaTag
    Write-Host "[llama.cpp] Baixando de: $url" -ForegroundColor Cyan

    $zip = Join-Path $env:TEMP "llama-cpp-win.zip"
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

    Write-Host "[llama.cpp] Extraindo para $BinDir..." -ForegroundColor Cyan
    if (Test-Path $BinDir) { Remove-Item $BinDir -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $BinDir -Force
    Remove-Item $zip -Force

    # O zip do llama.cpp pode criar uma subpasta; normaliza
    $inner = Get-ChildItem $BinDir -Directory | Select-Object -First 1
    if ($inner) {
        Get-ChildItem $inner.FullName | Move-Item -Destination $BinDir
        Remove-Item $inner.FullName -Recurse -Force
    }

    Write-Host "[llama.cpp] Instalado em $BinDir" -ForegroundColor Green
    # Salvar versão instalada
    $tag | Set-Content (Join-Path $BinDir 'version.txt') -Encoding UTF8

    # Baixar CUDA runtime DLLs (necessarios para ggml-cuda.dll)
    Write-Host "[llama.cpp] Baixando CUDA runtime DLLs..." -ForegroundColor Cyan
    $cudartUrl = "https://github.com/ggml-org/llama.cpp/releases/download/$tag/cudart-llama-bin-win-cuda-$cudaTag-x64.zip"
    $cudartZip = Join-Path $env:TEMP 'llama-cudart.zip'
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $wc = New-Object System.Net.WebClient
        $wc.DownloadFile($cudartUrl, $cudartZip)
        [System.IO.Compression.ZipFile]::ExtractToDirectory($cudartZip, $BinDir)
        Remove-Item $cudartZip -Force
        Write-Host "[llama.cpp] CUDA runtime DLLs instalados." -ForegroundColor Green
    } catch {
        Write-Host "[llama.cpp] AVISO: falha ao instalar cudart DLLs: $_" -ForegroundColor Yellow
    }
}

function Find-ModelFile {
    $gguf = Get-ChildItem -Path $ModelsDir -Filter '*.gguf' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($gguf) { return $gguf.FullName } else { return $null }
}

function Test-PortListening([int]$p) {
    try {
        $conn = New-Object System.Net.Sockets.TcpClient
        $conn.Connect('127.0.0.1', $p)
        $conn.Close()
        return $true
    } catch {
        return $false
    }
}

# ─── Main ────────────────────────────────────────────────────────────────────

# 1. Verificar / instalar binário apenas se não estiver presente
if (-not (Test-Path $ServerExe)) {
    Write-Host "[llama.cpp] llama-server.exe nao encontrado. Baixando..." -ForegroundColor Yellow
    Install-LlamaBinary
}

if (-not (Test-Path $ServerExe)) {
    Write-Error "Falha ao instalar llama-server.exe em $BinDir"
    exit 1
}

# Mostrar versão do binário para diagnóstico
try {
    $verOutput = & $ServerExe --version 2>&1 | Select-Object -First 3
    Write-Host "[llama.cpp] Binário: $($verOutput -join ' | ')" -ForegroundColor DarkGray
} catch {}

# 2. Matar instância existente para garantir configurações atualizadas (ctx-size etc.)
if (Test-PortListening $Port) {
    Write-Host "[llama.cpp] Parando instancia existente na porta $Port..." -ForegroundColor Yellow
    Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue | Stop-Process -Force
    # Aguardar a porta ser liberada (até 15s)
    $killWait = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $killWait -and (Test-PortListening $Port)) {
        Start-Sleep -Milliseconds 500
    }
    Start-Sleep -Seconds 2  # margem extra para liberação de VRAM
}

# 3. Encontrar modelo GGUF
$modelPath = Find-ModelFile
if (-not $modelPath) {
    Write-Host @"

[llama.cpp] Nenhum arquivo .gguf encontrado em $ModelsDir

Coloque um modelo GGUF na pasta models/ e execute novamente.
Exemplo:
  Invoke-WebRequest -Uri 'https://huggingface.co/bartowski/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf' ``
    -OutFile '$ModelsDir\qwen2.5-coder-7b.gguf'

"@ -ForegroundColor Red
    exit 1
}

Write-Host "[llama.cpp] Modelo: $modelPath" -ForegroundColor Cyan
$modelAlias = [System.IO.Path]::GetFileNameWithoutExtension($modelPath)
Write-Host "[llama.cpp] Alias: $modelAlias" -ForegroundColor Cyan

# Monta argumentos do servidor
# NOTAS:
#   --flash-attn e flag booleana (sem valor - nao passe 'on')
#   --cache-type q4_0: cache KV 4-bit (menor VRAM, prefill muito mais rapido)
#   --batch-size 2048: processar prefill em lotes maiores (mais rapido)
#   --no-mmap: evita page faults apos o modelo estar carregado
#   --reasoning-budget 0: desabilita thinking no Qwen3 (evita respostas em branco)
$serverArgs = @(
    '--model',             "`"$modelPath`"",
    '--alias',             "`"$modelAlias`"",
    '--port',              "$Port",
    '--host',              '127.0.0.1',
    '--n-gpu-layers',      '-1',
    '--flash-attn',        'on',
    '--cache-type-k',      'q4_0',
    '--cache-type-v',      'q4_0',
    '--ctx-size',          '65536',
    '--batch-size',        '2048',
    '--ubatch-size',       '512',
    '--reasoning-budget',  '0',
    '--parallel',          '1',
    '--cont-batching',
    '--no-mmap'
)

Write-Host "[llama.cpp] Iniciando llama-server..." -ForegroundColor Cyan

$serverProc = Start-Process -FilePath $ServerExe -ArgumentList $serverArgs -WindowStyle Normal -PassThru

# Aguarda ate 4s para detectar crash imediato
$startTime = Get-Date
while (((Get-Date) - $startTime).TotalSeconds -lt 4) {
    if ($serverProc.HasExited) { break }
    Start-Sleep -Milliseconds 200
}

if ($serverProc.HasExited) {
    Write-Host "[llama.cpp] ERRO: servidor encerrou imediatamente (codigo $($serverProc.ExitCode))." -ForegroundColor Red
    Write-Host ""
    Write-Host "Re-executando para capturar mensagem de erro..." -ForegroundColor Yellow

    $outFile = Join-Path $env:TEMP 'llama-diag-out.txt'
    $errFile = Join-Path $env:TEMP 'llama-diag-err.txt'
    $null = Start-Process -FilePath $ServerExe -ArgumentList $serverArgs `
        -RedirectStandardOutput $outFile `
        -RedirectStandardError  $errFile `
        -WindowStyle Hidden -PassThru -Wait

    $diagOut = ''
    if (Test-Path $outFile) { $diagOut += (Get-Content $outFile -Raw) }
    if (Test-Path $errFile) { $diagOut += (Get-Content $errFile -Raw) }

    if ($diagOut.Trim()) {
        Write-Host ""
        Write-Host "=== Saida do llama-server ===" -ForegroundColor Yellow
        Write-Host $diagOut -ForegroundColor White
        Write-Host "=============================" -ForegroundColor Yellow
    } else {
        Write-Host "(sem output capturado - possivel DLL faltando ou driver incompativel)" -ForegroundColor Yellow
        Write-Host "Binario: $ServerExe" -ForegroundColor DarkGray
        Write-Host "Modelo : $modelPath" -ForegroundColor DarkGray
    }
    exit 1
}

# Aguarda porta ficar disponivel (ate 300s)
Write-Host "[llama.cpp] Aguardando porta $Port ficar disponivel..." -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds(300)
$ready = $false
while ((Get-Date) -lt $deadline) {
    if ($serverProc.HasExited) {
        Write-Host "[llama.cpp] Servidor encerrou inesperadamente (codigo $($serverProc.ExitCode))." -ForegroundColor Red
        exit 1
    }
    if (Test-PortListening $Port) {
        $ready = $true
        break
    }
    Start-Sleep -Milliseconds 500
}

if (-not $ready) {
    Write-Error "llama-server nao ficou disponivel em 300 segundos."
    exit 1
}

Write-Host "[llama.cpp] Servidor pronto." -ForegroundColor Green

# Warm-up: pré-carrega pesos e CUDA graphs com um prompt curto
Write-Host "[llama.cpp] Pré-aquecendo modelo (primeira inferência)..." -ForegroundColor Cyan
try {
    $warmupBody = "{`"model`":`"$modelAlias`",`"messages`":[{`"role`":`"user`",`"content`":`"oi`"}],`"max_tokens`":1,`"stream`":false}"
    $null = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/v1/chat/completions" `
        -Method Post `
        -ContentType 'application/json' `
        -Body $warmupBody `
        -UseBasicParsing -ErrorAction SilentlyContinue -TimeoutSec 120
    Write-Host "[llama.cpp] Modelo pré-aquecido. Pronto para uso instantâneo." -ForegroundColor Green
} catch {
    Write-Host "[llama.cpp] Aviso: warm-up falhou (inofensivo - modelo ainda funcional)." -ForegroundColor Yellow
}

