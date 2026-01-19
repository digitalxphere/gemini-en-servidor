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

        // Encontrar input
        const inputSelector = 'div[contenteditable="true"], textarea, p[data-placeholder]';
        await geminiPage.waitForSelector(inputSelector, { timeout: 10000 });
        await geminiPage.click(inputSelector);
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

        // Extraer respuesta con múltiples selectores
        const response = await geminiPage.evaluate(() => {
            // Selector principal
            const messages = document.querySelectorAll('[data-message-author-role="model"]');
            if (messages.length > 0) {
                return messages[messages.length - 1].innerText;
            }

            // Selectores alternativos
            const modelResponse = document.querySelector('.model-response-text');
            if (modelResponse) return modelResponse.innerText;

            const responseContainer = document.querySelector('.response-container');
            if (responseContainer) return responseContainer.innerText;

            // Buscar por contenido de respuesta (después de "Ver razonamiento")
            const allDivs = document.querySelectorAll('div');
            for (const div of allDivs) {
                if (div.innerText && div.innerText.includes('Basado en el análisis del VIN')) {
                    return div.innerText;
                }
            }

            // Último recurso - buscar contenido largo
            const mainContent = document.querySelector('main');
            if (mainContent && mainContent.innerText.length > 200) {
                return mainContent.innerText;
            }

            return 'Revisa la ventana del navegador.';
        });

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
