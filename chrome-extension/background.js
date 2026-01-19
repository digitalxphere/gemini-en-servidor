// Background Service Worker - Recibe mensajes de MAI Smart

// Escuchar mensajes EXTERNOS (desde MAI Smart u otras webs)
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
    console.log('📨 Mensaje externo recibido:', request);

    if (request.action === 'searchVIN') {
        handleVINSearch(request.vin, request.query)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Mantener canal abierto para respuesta asíncrona
    }

    if (request.action === 'ping') {
        sendResponse({ success: true, message: 'Gemini VIN Bridge activo' });
        return true;
    }
});

// Escuchar mensajes INTERNOS (desde popup o content scripts)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'searchVIN') {
        handleVINSearch(request.vin, request.query)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === 'getResponse') {
        sendResponse({ success: true });
        return true;
    }
});

// Manejar búsqueda de VIN
async function handleVINSearch(vin, customQuery) {
    try {
        // Construir la pregunta
        const question = customQuery ||
            `Para el VIN ${vin}, identifica el motor exacto y dame los SKUs de:
1. Inyector diesel (código OEM y Denso/Bosch)
2. Turbocompresor (código OEM y número de parte)

Incluye marca, modelo del vehículo y norma de emisión.`;

        console.log('🔍 Buscando:', question);

        // Buscar o crear pestaña de Gemini
        const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
        let geminiTab;

        if (tabs.length > 0) {
            geminiTab = tabs[0];
            await chrome.tabs.update(geminiTab.id, { active: true });
        } else {
            geminiTab = await chrome.tabs.create({
                url: 'https://gemini.google.com/app?hl=es',
                active: true
            });
            // Esperar a que cargue
            await waitForTabLoad(geminiTab.id);
        }

        // Navegar a nueva conversación
        await chrome.tabs.update(geminiTab.id, { url: 'https://gemini.google.com/app?hl=es' });
        await waitForTabLoad(geminiTab.id);
        await sleep(2000);

        // Inyectar la pregunta
        await chrome.scripting.executeScript({
            target: { tabId: geminiTab.id },
            func: injectAndSendQuestion,
            args: [question]
        });

        // Esperar respuesta (polling)
        let response = null;
        let attempts = 0;
        const maxAttempts = 90; // 3 minutos máximo

        while (attempts < maxAttempts) {
            await sleep(2000);

            const results = await chrome.scripting.executeScript({
                target: { tabId: geminiTab.id },
                func: extractGeminiResponse
            });

            if (results && results[0]?.result) {
                const { isComplete, text, isThinking } = results[0].result;

                if (isComplete && text) {
                    response = text;
                    break;
                }

                console.log(`⏳ Esperando... (${attempts * 2}s) ${isThinking ? '- Razonando...' : ''}`);
            }

            attempts++;
        }

        if (response) {
            console.log('✅ Respuesta obtenida');
            return {
                success: true,
                response: response,
                vin: vin
            };
        } else {
            return {
                success: false,
                error: 'Timeout esperando respuesta de Gemini',
                vin: vin
            };
        }

    } catch (error) {
        console.error('❌ Error:', error);
        return { success: false, error: error.message };
    }
}

// Esperar a que una pestaña cargue
function waitForTabLoad(tabId) {
    return new Promise((resolve) => {
        const listener = (id, info) => {
            if (id === tabId && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };
        chrome.tabs.onUpdated.addListener(listener);

        // Timeout de seguridad
        setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        }, 30000);
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Función inyectada para escribir y enviar la pregunta
function injectAndSendQuestion(question) {
    return new Promise((resolve) => {
        setTimeout(() => {
            const input = document.querySelector('div[contenteditable="true"], textarea, p[data-placeholder], .ql-editor');

            if (input) {
                input.focus();
                input.textContent = question;
                input.dispatchEvent(new Event('input', { bubbles: true }));

                setTimeout(() => {
                    // Enviar con Enter
                    input.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        which: 13,
                        bubbles: true
                    }));
                    resolve(true);
                }, 500);
            } else {
                resolve(false);
            }
        }, 1000);
    });
}

// Función inyectada para extraer la respuesta
function extractGeminiResponse() {
    const text = document.body.innerText.toLowerCase();
    const isThinking = text.includes('pensando') ||
        text.includes('razonando') ||
        text.includes('buscando') ||
        text.includes('analizando') ||
        text.includes('investigando');

    // Buscar respuestas del modelo
    const responses = document.querySelectorAll('[data-message-author-role="model"]');

    if (responses.length > 0 && !isThinking) {
        const lastResponse = responses[responses.length - 1];
        const responseText = lastResponse.innerText;

        // Verificar que la respuesta tenga contenido significativo
        if (responseText.length > 50) {
            return {
                isComplete: true,
                text: responseText,
                isThinking: false
            };
        }
    }

    return {
        isComplete: false,
        text: null,
        isThinking: isThinking
    };
}
