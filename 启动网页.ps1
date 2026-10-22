$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath 'node_modules')) {
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) { throw '依赖安装失败。请检查 Node.js 与网络。' }
}
Write-Host '网页地址：http://127.0.0.1:5173/，按 Ctrl+C 停止服务。'
& npm.cmd run dev
