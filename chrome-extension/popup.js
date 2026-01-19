document.addEventListener('DOMContentLoaded', () => {
    const extensionId = chrome.runtime.id;

    // Mostrar ID de la extensión
    document.getElementById('extensionId').textContent = extensionId;

    // Mostrar código de ejemplo
    const codeExample = `// En MAI Smart:
const EXTENSION_ID = "${extensionId}";

async function buscarVIN(vin) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      EXTENSION_ID,
      { 
        action: 'searchVIN', 
        vin: vin 
      },
      (response) => {
        if (response?.success) {
          resolve(response.response);
        } else {
          reject(response?.error);
        }
      }
    );
  });
}

// Uso:
const resultado = await buscarVIN("MMCJJKK60PH000530");`;

    document.getElementById('codeExample').textContent = codeExample;

    // Copiar ID
    document.getElementById('copyBtn').addEventListener('click', () => {
        navigator.clipboard.writeText(extensionId);
        document.getElementById('copyBtn').textContent = '✅ Copiado!';
        setTimeout(() => {
            document.getElementById('copyBtn').textContent = '📋 Copiar ID';
        }, 2000);
    });
});
