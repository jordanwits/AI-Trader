# AI Trader startup - uses port 3001 (JobDock uses 3000)
# Temp files on G: to avoid C: disk usage
$env:PORT = "3001"
$env:TEMP = "G:\AI Trader\.tmp"
$env:TMP = "G:\AI Trader\.tmp"
$env:NGROK_CONFIG = "G:\AI Trader\ngrok\ngrok.yml"

New-Item -ItemType Directory -Force -Path "G:\AI Trader\.tmp" | Out-Null

Write-Host "Starting AI Trader on port 3001..."
Set-Location "G:\AI Trader"
pnpm dev
