# Deploy extensao NevCode para a extensao instalada no VS Code
$src = "D:\Openclaude\vscode-extension\nevecode-vscode\src"
$dst = "C:\Users\Administrador\.vscode\extensions\devnull-bootloader.nevecode-vscode-0.2.0\src"

$files = @(
    "chat\chatRenderer.js",
    "chat\chatProvider.js",
    "chat\sessionManager.js",
    "chat\messageParser.js",
    "chat\diffController.js",
    "chat\processManager.js",
    "chat\protocol.js",
    "extension.js",
    "presentation.js",
    "state.js"
)

foreach ($f in $files) {
    $srcPath = Join-Path $src $f
    $dstPath = Join-Path $dst $f
    if (Test-Path $srcPath) {
        Copy-Item $srcPath $dstPath -Force
        Write-Host "OK: $f"
    }
}
Write-Host "`nDeploy concluido! Faca Developer: Reload Window no VS Code."
