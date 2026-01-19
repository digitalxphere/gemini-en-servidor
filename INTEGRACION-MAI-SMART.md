# Integración Gemini VIN Bridge con MAI Smart

## Configuración

### Variable de entorno en Railway
```
GEMINI_BRIDGE_URL=https://TU-URL-NGROK.ngrok-free.app
```

---

## Servicio para MAI Smart

### `services/geminiVinService.js`

```javascript
const GEMINI_BRIDGE_URL = process.env.GEMINI_BRIDGE_URL;

const headers = {
  'Content-Type': 'application/json',
  'ngrok-skip-browser-warning': 'true'
};

/**
 * Buscar SKU de inyector por datos del vehículo
 * @param {Object} vehiculo - Datos del vehículo
 * @param {string} vehiculo.vin - VIN (requerido)
 * @param {string} vehiculo.marca - Marca del vehículo
 * @param {string} vehiculo.modelo - Modelo del vehículo
 * @param {string} vehiculo.version - Versión/trim
 * @param {string} vehiculo.año - Año de fabricación
 * @param {string} vehiculo.motor - Número de motor
 * @param {string} vehiculo.combustible - Tipo de combustible
 */
async function buscarInyector(vehiculo) {
  try {
    const response = await fetch(`${GEMINI_BRIDGE_URL}/api/vin/inyector`, {
      method: 'POST',
      headers,
      body: JSON.stringify(vehiculo)
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
 * Buscar SKU de turbo por datos del vehículo
 * @param {Object} vehiculo - Datos del vehículo (mismos parámetros que buscarInyector)
 */
async function buscarTurbo(vehiculo) {
  try {
    const response = await fetch(`${GEMINI_BRIDGE_URL}/api/vin/turbo`, {
      method: 'POST',
      headers,
      body: JSON.stringify(vehiculo)
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
 * Verificar conexión con el servidor Gemini
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

module.exports = { buscarInyector, buscarTurbo, verificarConexion };
```

---

## Ejemplo de uso en MAI Smart

### Cuando el usuario busca por patente:

```javascript
const { buscarInyector, buscarTurbo } = require('./services/geminiVinService');

// Datos que ya tienes de la búsqueda por patente
const vehiculo = {
  vin: '8AFAR22L0CJ052314',
  marca: 'FORD',
  modelo: 'RANGER XLT',
  version: '2.5 LIMITED MT 4X2',
  año: '2013',
  motor: 'CJ052314',
  combustible: 'BENCINA'
};

// Cuando el usuario hace clic en "TURBO"
const turbo = await buscarTurbo(vehiculo);
console.log(turbo.respuesta);

// Cuando el usuario hace clic en "INYECTOR"
const inyector = await buscarInyector(vehiculo);
console.log(inyector.respuesta);
```

---

## Parámetros del body

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `vin` | string | ✅ Sí | VIN del vehículo |
| `marca` | string | No | Marca (FORD, TOYOTA, etc.) |
| `modelo` | string | No | Modelo (RANGER, HILUX, etc.) |
| `version` | string | No | Versión/trim del vehículo |
| `año` | string | No | Año de fabricación |
| `motor` | string | No | Número de motor |
| `combustible` | string | No | DIESEL, BENCINA, etc. |

---

## Endpoints disponibles

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/vin/inyector` | Busca SKU de inyector |
| POST | `/api/vin/turbo` | Busca SKU de turbo |
| GET | `/api/health` | Verifica estado del servidor |

---

## Ejemplo de respuesta

```json
{
  "vin": "8AFAR22L0CJ052314",
  "tipo": "turbo",
  "answer": "Motor: 2.5L Diesel\nCódigo OEM: AB39-6K682-AC\nProveedor: BorgWarner K03\n...",
  "source": "Gemini Web (Deep Reasoning)"
}
```

---

## Notas importantes

1. **Tiempo de respuesta**: 15-60 segundos
2. **Header requerido**: `ngrok-skip-browser-warning: true`
3. **El Mac debe estar encendido** con el servidor corriendo
4. **Mientras más datos envíes**, mejor será la respuesta
