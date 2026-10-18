// Runs only in the opaque-origin, allow-scripts CAP sandbox, never the app window.
(() => {
  if (window.parent === window) return;
  const parentOrigin = new URL(window.location.href).origin;
  let started = false;
  window.addEventListener('message', (event) => {
    if (started || event.source !== window.parent || event.origin !== parentOrigin) return;
    const data = event.data;
    if (data?.type !== 'cap:execute' || typeof data.script !== 'string' || data.script.length > 262144) return;
    started = true;
    try {
      const script = document.createElement('script');
      script.nonce = document.querySelector('meta[name="lastudio-cap-nonce"]')?.content || '';
      script.textContent = data.script;
      document.body.appendChild(script);
      // Upstream's script sets onload. The isolated document is already loaded.
      if (typeof window.onload === 'function') window.onload(new Event('load'));
    } catch {
      window.parent.postMessage({ type: 'cap:error' }, parentOrigin);
    }
  });
})();
