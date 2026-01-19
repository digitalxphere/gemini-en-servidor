#!/bin/bash
# Script para iniciar Chrome con debugging y el servidor Gemini en Mac

echo "🚀 Iniciando Gemini VIN Bridge Server..."
echo ""

# Ruta de Chrome en Mac
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Verificar si Chrome ya está corriendo con debugging
if ! lsof -i :9222 > /dev/null 2>&1; then
    echo "📱 Iniciando Chrome con debugging habilitado..."
    "$CHROME_PATH" --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-gemini" "https://gemini.google.com/app" &
    sleep 5
else
    echo "✅ Chrome ya está corriendo con debugging"
fi

echo ""
echo "🔌 Iniciando servidor Node.js..."
echo ""

# Ir al directorio del proyecto
cd "$(dirname "$0")"

# Instalar dependencias si es necesario
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependencias..."
    npm install
fi

# Iniciar el servidor
node server.js
