# Ngrok tunnel - config on G: drive
$env:NGROK_CONFIG = "G:\AI Trader\ngrok\ngrok.yml"

Write-Host "Starting ngrok tunnel to localhost:3001..."
& "G:\AI Trader\ngrok\ngrok.exe" http 3001
