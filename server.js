require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Estado global
let browser = null;
let geminiPage = null;
let isReady = false;
let lastError = null;

// Conectar al Chrome existente via CDP
async function initBrowser() {
    try {
        console.log('🔌 Conectando a tu Chrome existente...');
        console.log('');

        // Intentar conectar al Chrome existente en puerto 9222
        try {
            browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
            console.log('✅ Conectado a Chrome existente');
        } catch (cdpError) {
            console.log('');
            console.log('═══════════════════════════════════════════════════════════');
            console.log('⚠️  No se encontró Chrome con debugging activo.');
            console.log('');
            console.log('   Para usar TU Chrome existente:');
            console.log('');
            console.log('   1. Cierra Chrome completamente');
            console.log('   2. Abre Chrome con este comando:');
            console.log('');
            console.log('   Windows:');
            console.log('   "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222');
            console.log('');
            console.log('   O crea un acceso directo con ese parámetro.');
            console.log('');
            console.log('   3. Abre gemini.google.com y haz login si no lo has hecho');
            console.log('   4. Vuelve a ejecutar: npm start');
            console.log('═══════════════════════════════════════════════════════════');
            console.log('');
            lastError = 'Chrome no tiene debugging habilitado';
            return;
        }

        // Obtener contextos existentes
        const contexts = browser.contexts();

        if (contexts.length === 0) {
            console.log('⚠️ No hay contextos abiertos en Chrome');
            lastError = 'No hay ventanas abiertas en Chrome';
            return;
        }

        const context = contexts[0];
        const pages = context.pages();

        // Buscar si ya hay una pestaña de Gemini
        geminiPage = pages.find(p => p.url().includes('gemini.google.com'));

        if (!geminiPage) {
            // Usar la primera pestaña disponible o crear una
            console.log('📑 Abriendo pestaña de Gemini...');
            geminiPage = await context.newPage();
            await geminiPage.goto('https://gemini.google.com/app?hl=es', {
                waitUntil: 'networkidle',
                timeout: 60000
            });
        } else {
            console.log('📑 Encontrada pestaña de Gemini existente');
        }

        await geminiPage.waitForTimeout(2000);

        // Verificar si está logueado
        const needsLogin = await geminiPage.evaluate(() => {
            const text = document.body.innerText;
            return text.includes('Iniciar sesión') ||
                text.includes('Sign in') ||
                text.includes('Acceder');
        });

        if (needsLogin) {
            console.log('');
            console.log('⚠️ Necesitas hacer login en Gemini en tu navegador');
            console.log('   Abre gemini.google.com en Chrome y haz login');
            lastError = 'Necesitas hacer login en Gemini';
            return;
        }

        isReady = true;
        console.log('');
        console.log('✅ ═══════════════════════════════════════════════════════');
        console.log('   ¡LISTO! Conectado a TU Chrome con Gemini');
        console.log(`   API: http://localhost:${PORT}/api/vin`);
        console.log('   Frontend: http://localhost:${PORT}');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');

    } catch (error) {
        lastError = error.message;
        console.error('❌ Error:', error.message);
    }
}

async function askGemini(question) {
    if (!isReady || !geminiPage) {
        throw new Error('No conectado a Chrome. Reinicia el servidor.');
    }

    try {
        // Ir a nueva conversación
        await geminiPage.goto('https://gemini.google.com/app?hl=es', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        await geminiPage.waitForTimeout(3000);

        // Cerrar popups que puedan estar bloqueando (email opt-in, bienvenida, etc.)
        try {
            await geminiPage.evaluate(() => {
                // Buscar y cerrar cualquier overlay/popup
                const overlays = document.querySelectorAll('.cdk-overlay-container button, [aria-label="Close"], [aria-label="Cerrar"], button:has-text("No"), button:has-text("Dismiss")');
                overlays.forEach(btn => btn.click());

                // Cerrar por clic en backdrop
                const backdrops = document.querySelectorAll('.cdk-overlay-backdrop');
                backdrops.forEach(b => b.click());
            });
            await geminiPage.waitForTimeout(500);
        } catch (e) { /* ignorar */ }

        // Encontrar input
        const inputSelector = 'div[contenteditable="true"], textarea, p[data-placeholder]';
        await geminiPage.waitForSelector(inputSelector, { timeout: 10000 });
        await geminiPage.click(inputSelector, { force: true }); // force: true ignora overlays
        await geminiPage.waitForTimeout(300);

        // Escribir pregunta
        await geminiPage.evaluate((text) => {
            const input = document.querySelector('div[contenteditable="true"], textarea, p[data-placeholder]');
            if (input) {
                input.focus();
                input.textContent = text;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, question);

        await geminiPage.waitForTimeout(300);
        await geminiPage.keyboard.press('Enter');

        console.log('📨 Pregunta enviada, esperando Deep Reasoning...');

        // Esperar respuesta (hasta 3 min)
        let attempts = 0;
        while (attempts < 90) {
            const isThinking = await geminiPage.evaluate(() => {
                const text = document.body.innerText.toLowerCase();
                return text.includes('pensando') ||
                    text.includes('razonando') ||
                    text.includes('buscando') ||
                    text.includes('analizando');
            });

            if (!isThinking && attempts > 8) break;

            await geminiPage.waitForTimeout(2000);
            attempts++;

            if (attempts % 15 === 0) {
                console.log(`   ⏳ Razonando... (${attempts * 2}s)`);
            }
        }

        await geminiPage.waitForTimeout(2000);

        // Cerrar popup de bienvenida si existe
        try {
            const closeButton = await geminiPage.$('button[aria-label="Close"], button:has-text("×"), .close-button');
            if (closeButton) {
                await closeButton.click();
                await geminiPage.waitForTimeout(500);
            }
        } catch (e) { /* ignorar */ }

        // Esperar y extraer respuesta con polling hasta tener contenido real
        let response = null;
        let extractAttempts = 0;
        const maxExtractAttempts = 15; // 30 segundos máximo de extracción

        while (extractAttempts < maxExtractAttempts) {
            // Verificar si Gemini sigue procesando
            const isStillThinking = await geminiPage.evaluate(() => {
                const text = document.body.innerText.toLowerCase();
                return text.includes('pensando') ||
                    text.includes('razonando') ||
                    text.includes('buscando') ||
                    text.includes('analizando');
            });

            // Intentar extraer respuesta
            response = await geminiPage.evaluate(() => {
                // Selector principal - mensajes del modelo
                const messages = document.querySelectorAll('[data-message-author-role="model"]');
                if (messages.length > 0) {
                    const lastMessage = messages[messages.length - 1];
                    const text = lastMessage.innerText;
                    if (text && text.length > 50) {
                        return text;
                    }
                }

                // Selector alternativo - contenedor de respuesta
                const responseBlocks = document.querySelectorAll('.response-container, .model-response, [class*="response"]');
                for (const block of responseBlocks) {
                    const text = block.innerText;
                    if (text && text.length > 100 && !text.includes('Nueva conversación')) {
                        return text;
                    }
                }

                return null;
            });

            // Si tiene respuesta significativa y ya no está pensando, salir
            if (response && response.length > 50 && !isStillThinking) {
                console.log(`   ✅ Respuesta extraída (${response.length} chars)`);
                break;
            }

            await geminiPage.waitForTimeout(2000);
            extractAttempts++;

            if (extractAttempts % 3 === 0) {
                console.log(`   ⏳ Extrayendo... (${extractAttempts * 2}s) ${isStillThinking ? '- Procesando' : '- Buscando respuesta'}`);
            }
        }

        // Fallback - obtener contenido principal si no se encontró respuesta específica
        if (!response || response.length < 50) {
            console.log('   ⚠️ Usando fallback de extracción');
            response = await geminiPage.evaluate(() => {
                // Buscar el main content area
                const mainArea = document.querySelector('main') || document.querySelector('[role="main"]');
                if (mainArea) {
                    // Filtrar solo el contenido relevante
                    const allText = mainArea.innerText;
                    // Buscar desde "Ver razonamiento" o similar
                    const startMarkers = ['Ver razonamiento', 'Basado en', 'El turbo', 'El inyector', 'Motor:', 'Código OEM'];
                    for (const marker of startMarkers) {
                        const idx = allText.indexOf(marker);
                        if (idx !== -1) {
                            return allText.substring(idx, Math.min(idx + 2000, allText.length));
                        }
                    }
                }
                return 'No se pudo extraer la respuesta. Verifica Gemini en el navegador.';
            });
        }

        return response;

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    }
}

// API Endpoints
app.post('/api/ask', async (req, res) => {
    try {
        const { question } = req.body;
        if (!question) return res.status(400).json({ error: 'Pregunta requerida' });
        if (!isReady) return res.status(503).json({ error: 'Servidor no listo', details: lastError });

        console.log(`📨 ${question.substring(0, 60)}...`);
        const answer = await askGemini(question);
        console.log(`✅ Respuesta (${answer.length} chars)`);

        res.json({ answer, source: 'Gemini Web (Deep Reasoning)', grounded: true });
    } catch (error) {
        res.status(500).json({ error: 'Error', details: error.message });
    }
});

// Endpoint específico para búsqueda de VIN
app.post('/api/vin', async (req, res) => {
    try {
        const { vin } = req.body;
        if (!vin) return res.status(400).json({ error: 'VIN requerido' });
        if (!isReady) return res.status(503).json({ error: 'Servidor no listo', details: lastError });

        const question = `Para el VIN ${vin}, identifica el motor exacto y dame los SKUs de:
1. Inyector diesel (código OEM y Denso/Bosch)
2. Turbocompresor (código OEM y número de parte)

Incluye marca, modelo del vehículo y norma de emisión.`;

        console.log(`🔍 Buscando VIN: ${vin}`);
        const answer = await askGemini(question);
        console.log(`✅ Respuesta (${answer.length} chars)`);

        res.json({
            vin,
            answer,
            source: 'Gemini Web (Deep Reasoning)',
            grounded: true
        });
    } catch (error) {
        res.status(500).json({ error: 'Error', details: error.message });
    }
});

// Endpoint específico para INYECTOR
app.post('/api/vin/inyector', async (req, res) => {
    try {
        const { vin, marca, modelo, version, año, motor, combustible } = req.body;
        if (!vin) return res.status(400).json({ error: 'VIN requerido' });
        if (!isReady) return res.status(503).json({ error: 'Servidor no listo', details: lastError });

        // Construir contexto con la info disponible
        let contexto = `VIN: ${vin}`;
        if (marca) contexto += `\nMarca: ${marca}`;
        if (modelo) contexto += `\nModelo: ${modelo}`;
        if (version) contexto += `\nVersión: ${version}`;
        if (año) contexto += `\nAño: ${año}`;
        if (motor) contexto += `\nN° Motor: ${motor}`;
        if (combustible) contexto += `\nCombustible: ${combustible}`;

        const question = `Eres experto en identificar repuestos de autopartes.

Tengo este vehículo:
${contexto}

Dame el SKU del INYECTOR DIESEL:
- Código OEM del fabricante
- Código del proveedor (Denso, Bosch, Delphi, etc.)
- Cantidad por motor
- Porcentaje de seguridad (0-100%)
- Comentario breve sobre la búsqueda

Responde de forma breve y directa.`;

        console.log(`🔍 Buscando INYECTOR para: ${marca || ''} ${modelo || ''} (${vin})`);
        const answer = await askGemini(question);
        console.log(`✅ Respuesta inyector (${answer.length} chars)`);

        res.json({
            vin,
            tipo: 'inyector',
            answer,
            source: 'Gemini Web (Deep Reasoning)'
        });
    } catch (error) {
        res.status(500).json({ error: 'Error', details: error.message });
    }
});

// Endpoint específico para TURBO
app.post('/api/vin/turbo', async (req, res) => {
    try {
        const { vin, marca, modelo, version, año, motor, combustible } = req.body;
        if (!vin) return res.status(400).json({ error: 'VIN requerido' });
        if (!isReady) return res.status(503).json({ error: 'Servidor no listo', details: lastError });

        // Construir contexto con la info disponible
        let contexto = `VIN: ${vin}`;
        if (marca) contexto += `\nMarca: ${marca}`;
        if (modelo) contexto += `\nModelo: ${modelo}`;
        if (version) contexto += `\nVersión: ${version}`;
        if (año) contexto += `\nAño: ${año}`;
        if (motor) contexto += `\nN° Motor: ${motor}`;
        if (combustible) contexto += `\nCombustible: ${combustible}`;

        const question = `Eres experto en identificar repuestos de autopartes.

Tengo este vehículo:
${contexto}

Dame el SKU del TURBOCOMPRESOR:
- Código OEM del fabricante
- Número de parte del proveedor
- Porcentaje de seguridad (0-100%)
- Comentario breve sobre la búsqueda

Responde de forma breve y directa.`;

        console.log(`🔍 Buscando TURBO para: ${marca || ''} ${modelo || ''} (${vin})`);
        const answer = await askGemini(question);
        console.log(`✅ Respuesta turbo (${answer.length} chars)`);

        res.json({
            vin,
            tipo: 'turbo',
            answer,
            source: 'Gemini Web (Deep Reasoning)'
        });
    } catch (error) {
        res.status(500).json({ error: 'Error', details: error.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ status: isReady ? 'ok' : 'initializing', browserReady: isReady, error: lastError });
});

// Endpoint SSE para TURBO con streaming de progreso
app.post('/api/vin/turbo/stream', async (req, res) => {
    // Configurar SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const sendEvent = (status, data = {}) => {
        res.write(`data: ${JSON.stringify({ status, ...data })}\n\n`);
    };

    try {
        const { vin, marca, modelo, version, año, motor, combustible } = req.body;
        if (!vin) {
            sendEvent('error', { error: 'VIN requerido' });
            return res.end();
        }
        if (!isReady) {
            sendEvent('error', { error: 'Servidor no listo' });
            return res.end();
        }

        sendEvent('conectando', { message: 'Conectando con Gemini...' });

        // Construir contexto
        let contexto = `VIN: ${vin}`;
        if (marca) contexto += `\nMarca: ${marca}`;
        if (modelo) contexto += `\nModelo: ${modelo}`;
        if (version) contexto += `\nVersión: ${version}`;
        if (año) contexto += `\nAño: ${año}`;
        if (motor) contexto += `\nN° Motor: ${motor}`;
        if (combustible) contexto += `\nCombustible: ${combustible}`;

        const question = `Eres experto en identificar repuestos de autopartes.

Tengo este vehículo:
${contexto}

Dame el SKU del TURBOCOMPRESOR:
- Código OEM del fabricante
- Número de parte del proveedor
- Porcentaje de seguridad (0-100%)
- Comentario breve sobre la búsqueda

Responde de forma breve y directa.`;

        sendEvent('enviando', { message: 'Enviando consulta a Gemini...' });

        // Navegar y enviar pregunta
        await geminiPage.goto('https://gemini.google.com/app?hl=es', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        await geminiPage.waitForTimeout(3000);

        sendEvent('procesando', { message: 'Gemini está procesando...' });

        // Cerrar popups
        try {
            await geminiPage.evaluate(() => {
                const overlays = document.querySelectorAll('.cdk-overlay-container button, [aria-label="Close"], [aria-label="Cerrar"]');
                overlays.forEach(btn => btn.click());
            });
        } catch (e) { }

        // Enviar pregunta
        const inputSelector = 'div[contenteditable="true"], textarea, p[data-placeholder]';
        await geminiPage.waitForSelector(inputSelector, { timeout: 10000 });
        await geminiPage.click(inputSelector, { force: true });
        await geminiPage.evaluate((text) => {
            const input = document.querySelector('div[contenteditable="true"], textarea, p[data-placeholder]');
            if (input) {
                input.focus();
                input.textContent = text;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, question);
        await geminiPage.keyboard.press('Enter');

        sendEvent('razonando', { message: 'Gemini está analizando el VIN...' });

        // Esperar respuesta con polling
        let attempts = 0;
        while (attempts < 90) {
            const isThinking = await geminiPage.evaluate(() => {
                const text = document.body.innerText.toLowerCase();
                return text.includes('pensando') || text.includes('razonando') ||
                    text.includes('buscando') || text.includes('analizando');
            });

            if (!isThinking && attempts > 8) break;
            await geminiPage.waitForTimeout(2000);
            attempts++;

            if (attempts % 5 === 0) {
                sendEvent('razonando', { message: `Procesando... (${attempts * 2}s)` });
            }
        }

        sendEvent('extrayendo', { message: 'Extrayendo respuesta...' });

        // Extraer respuesta
        await geminiPage.waitForTimeout(2000);
        let response = await geminiPage.evaluate(() => {
            const messages = document.querySelectorAll('[data-message-author-role="model"]');
            if (messages.length > 0) {
                return messages[messages.length - 1].innerText;
            }
            return null;
        });

        if (!response || response.length < 50) {
            response = await geminiPage.evaluate(() => {
                const mainArea = document.querySelector('main');
                if (mainArea) {
                    const text = mainArea.innerText;
                    const markers = ['Código OEM', 'Motor:', 'Turbo', 'El turbo'];
                    for (const m of markers) {
                        const idx = text.indexOf(m);
                        if (idx !== -1) return text.substring(idx, Math.min(idx + 2000, text.length));
                    }
                }
                return 'No se pudo extraer la respuesta.';
            });
        }

        sendEvent('completado', {
            vin,
            tipo: 'turbo',
            answer: response,
            source: 'Gemini Web (Deep Reasoning)'
        });

    } catch (error) {
        sendEvent('error', { error: error.message });
    }

    res.end();
});

// Endpoint SSE para INYECTOR con streaming de progreso
app.post('/api/vin/inyector/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const sendEvent = (status, data = {}) => {
        res.write(`data: ${JSON.stringify({ status, ...data })}\n\n`);
    };

    try {
        const { vin, marca, modelo, version, año, motor, combustible } = req.body;
        if (!vin) {
            sendEvent('error', { error: 'VIN requerido' });
            return res.end();
        }
        if (!isReady) {
            sendEvent('error', { error: 'Servidor no listo' });
            return res.end();
        }

        sendEvent('conectando', { message: 'Conectando con Gemini...' });

        let contexto = `VIN: ${vin}`;
        if (marca) contexto += `\nMarca: ${marca}`;
        if (modelo) contexto += `\nModelo: ${modelo}`;
        if (version) contexto += `\nVersión: ${version}`;
        if (año) contexto += `\nAño: ${año}`;
        if (motor) contexto += `\nN° Motor: ${motor}`;
        if (combustible) contexto += `\nCombustible: ${combustible}`;

        const question = `Eres experto en identificar repuestos de autopartes.

Tengo este vehículo:
${contexto}

Dame el SKU del INYECTOR DIESEL:
- Código OEM del fabricante
- Código del proveedor (Denso, Bosch, Delphi, etc.)
- Cantidad por motor
- Porcentaje de seguridad (0-100%)
- Comentario breve sobre la búsqueda

Responde de forma breve y directa.`;

        sendEvent('enviando', { message: 'Enviando consulta...' });

        await geminiPage.goto('https://gemini.google.com/app?hl=es', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        await geminiPage.waitForTimeout(3000);

        sendEvent('procesando', { message: 'Gemini está procesando...' });

        const inputSelector = 'div[contenteditable="true"], textarea, p[data-placeholder]';
        await geminiPage.waitForSelector(inputSelector, { timeout: 10000 });
        await geminiPage.click(inputSelector, { force: true });
        await geminiPage.evaluate((text) => {
            const input = document.querySelector('div[contenteditable="true"], textarea, p[data-placeholder]');
            if (input) {
                input.focus();
                input.textContent = text;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, question);
        await geminiPage.keyboard.press('Enter');

        sendEvent('razonando', { message: 'Analizando información del inyector...' });

        let attempts = 0;
        while (attempts < 90) {
            const isThinking = await geminiPage.evaluate(() => {
                const text = document.body.innerText.toLowerCase();
                return text.includes('pensando') || text.includes('razonando');
            });
            if (!isThinking && attempts > 8) break;
            await geminiPage.waitForTimeout(2000);
            attempts++;
        }

        sendEvent('extrayendo', { message: 'Extrayendo respuesta...' });

        await geminiPage.waitForTimeout(2000);
        let response = await geminiPage.evaluate(() => {
            const messages = document.querySelectorAll('[data-message-author-role="model"]');
            if (messages.length > 0) return messages[messages.length - 1].innerText;
            return null;
        });

        if (!response || response.length < 50) {
            response = 'No se pudo extraer la respuesta.';
        }

        sendEvent('completado', {
            vin,
            tipo: 'inyector',
            answer: response,
            source: 'Gemini Web (Deep Reasoning)'
        });

    } catch (error) {
        sendEvent('error', { error: error.message });
    }

    res.end();
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start
app.listen(PORT, async () => {
    console.log('');
    console.log('🚀 Servidor Gemini VIN Bridge');
    console.log(`   Puerto: ${PORT}`);
    console.log('   Modo: Conectar a Chrome existente');
    console.log('');
    await initBrowser();
});
