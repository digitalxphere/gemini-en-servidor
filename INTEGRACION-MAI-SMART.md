# Integración Gemini VIN Bridge con MAI Smart

## Configuración

### 1. Variable de entorno en Railway
```
GEMINI_BRIDGE_URL=https://0f80b78a46e5.ngrok-free.app
```

> ⚠️ La URL de ngrok cambia cada vez que reinicias. Actualízala cuando cambie.

---

## Servicio para MAI Smart

Crea este archivo en el backend de MAI Smart:

### `services/geminiVinService.js`

```javascript
const GEMINI_BRIDGE_URL = process.env.GEMINI_BRIDGE_URL || 'https://0f80b78a46e5.ngrok-free.app';

const headers = {
  'Content-Type': 'application/json',
  'ngrok-skip-browser-warning': 'true'
};

/**
 * Buscar información de inyector por VIN
 */
async function buscarInyector(vin) {
  try {
    const response = await fetch(`${GEMINI_BRIDGE_URL}/api/vin/inyector`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ vin })
    });
    
    if (!response.ok) throw new Error('Error en servidor Gemini');
    
    const data = await response.json();
    return {
      success: true,
      vin: data.vin,
      tipo: 'inyector',
      respuesta: data.answer
    };
  } catch (error) {
    console.error('Error buscando inyector:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Buscar información de turbo por VIN
 */
async function buscarTurbo(vin) {
  try {
    const response = await fetch(`${GEMINI_BRIDGE_URL}/api/vin/turbo`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ vin })
    });
    
    if (!response.ok) throw new Error('Error en servidor Gemini');
    
    const data = await response.json();
    return {
      success: true,
      vin: data.vin,
      tipo: 'turbo',
      respuesta: data.answer
    };
  } catch (error) {
    console.error('Error buscando turbo:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Verificar si el servidor Gemini está disponible
 */
async function verificarConexion() {
  try {
    const response = await fetch(`${GEMINI_BRIDGE_URL}/api/health`, {
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });
    const data = await response.json();
    return data.status === 'ok' && data.browserReady;
  } catch {
    return false;
  }
}

module.exports = {
  buscarInyector,
  buscarTurbo,
  verificarConexion
};
```

---

## Uso en controladores

```javascript
const { buscarInyector, buscarTurbo } = require('../services/geminiVinService');

// Endpoint en MAI Smart
router.post('/api/repuestos/buscar-vin', async (req, res) => {
  const { vin, tipo } = req.body; // tipo: 'inyector' | 'turbo'
  
  let resultado;
  if (tipo === 'turbo') {
    resultado = await buscarTurbo(vin);
  } else {
    resultado = await buscarInyector(vin);
  }
  
  res.json(resultado);
});
```

---

## Endpoints disponibles

| Método | Endpoint | Body | Descripción |
|--------|----------|------|-------------|
| POST | `/api/vin/inyector` | `{ vin: "..." }` | Busca SKU de inyector |
| POST | `/api/vin/turbo` | `{ vin: "..." }` | Busca SKU de turbo |
| POST | `/api/vin` | `{ vin: "..." }` | Busca ambos |
| GET | `/api/health` | - | Verifica estado |

---

## Notas importantes

1. **Tiempo de respuesta**: 15-60 segundos (Deep Reasoning)
2. **Header requerido**: `ngrok-skip-browser-warning: true`
3. **El Mac debe estar encendido** con Chrome y el servidor corriendo
4. **URL ngrok cambia** cada vez que reinicias ngrok
