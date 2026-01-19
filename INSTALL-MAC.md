# 🚀 Gemini VIN Bridge - Instalación en Mac (Servidor 24/7)

## Requisitos
- macOS
- Node.js instalado (`brew install node`)
- Google Chrome instalado

---

## Instalación Rápida

### 1. Copiar archivos al Mac
Copia toda la carpeta `Gemini en Servidor` a tu Mac, por ejemplo en:
```
~/gemini-server
```

### 2. Dar permisos al script
```bash
cd ~/gemini-server
chmod +x start-mac.sh
```

### 3. Instalar dependencias
```bash
npm install
```

### 4. Primera ejecución (hacer login en Gemini)
```bash
./start-mac.sh
```
- Se abrirá Chrome con Gemini
- **Haz login con tu cuenta Google**
- La sesión se guardará para el futuro

---

## Iniciar el servidor manualmente
```bash
cd ~/gemini-server
./start-mac.sh
```

---

## Configurar inicio automático (al encender el Mac)

### 1. Editar el archivo plist
Abre `com.gemini.vinbridge.plist` y verifica que la ruta sea correcta:
```xml
<string>cd ~/gemini-server && ./start-mac.sh</string>
```

### 2. Copiar a LaunchAgents
```bash
cp com.gemini.vinbridge.plist ~/Library/LaunchAgents/
```

### 3. Cargar el servicio
```bash
launchctl load ~/Library/LaunchAgents/com.gemini.vinbridge.plist
```

### 4. Verificar que esté corriendo
```bash
launchctl list | grep gemini
```

---

## Comandos útiles

### Ver logs
```bash
tail -f /tmp/gemini-server.log
```

### Detener el servicio
```bash
launchctl unload ~/Library/LaunchAgents/com.gemini.vinbridge.plist
```

### Reiniciar el servicio
```bash
launchctl unload ~/Library/LaunchAgents/com.gemini.vinbridge.plist
launchctl load ~/Library/LaunchAgents/com.gemini.vinbridge.plist
```

---

## API del servidor

### Buscar VIN (inyector + turbo)
```bash
curl -X POST http://TU_MAC_IP:3002/api/vin \
  -H "Content-Type: application/json" \
  -d '{"vin": "MMCJJKK60PH000530"}'
```

### Pregunta general
```bash
curl -X POST http://TU_MAC_IP:3002/api/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "tu pregunta aquí"}'
```

### Verificar estado
```bash
curl http://TU_MAC_IP:3002/api/health
```

---

## Conectar desde MAI Smart

En tu código de MAI Smart:
```javascript
const GEMINI_SERVER = 'http://TU_MAC_IP:3002';

async function buscarVIN(vin) {
  const response = await fetch(`${GEMINI_SERVER}/api/vin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vin })
  });
  const data = await response.json();
  return data.answer;
}
```

Reemplaza `TU_MAC_IP` con la IP de tu Mac (ej: `192.168.1.100`).

---

## Notas importantes

1. **Sesión de Google**: Solo necesitas hacer login la primera vez
2. **Puerto**: El servidor corre en el puerto 3002
3. **Firewall**: Asegúrate de que el puerto 3002 esté abierto en el Mac
4. **Chrome visible**: El servidor necesita que Chrome esté corriendo (puede estar minimizado)
