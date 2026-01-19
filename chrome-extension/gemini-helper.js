// Content script que corre en gemini.google.com
// Ayuda a la comunicación con el background script

// Notificar cuando la página cambie
let lastResponseCount = 0;

const observer = new MutationObserver(() => {
    const responses = document.querySelectorAll('[data-message-author-role="model"]');
    if (responses.length !== lastResponseCount) {
        lastResponseCount = responses.length;
        // Notificar al background que hay una nueva respuesta
        chrome.runtime.sendMessage({
            action: 'responseUpdate',
            count: responses.length
        });
    }
});

// Observar cambios en el DOM
observer.observe(document.body, {
    childList: true,
    subtree: true
});

console.log('🔌 Gemini VIN Bridge: Content script activo');
