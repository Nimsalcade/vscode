(function () {
  const vscode = acquireVsCodeApi();
  const messages = document.getElementById('messages');
  const prompt = document.getElementById('prompt');
  const sendBtn = document.getElementById('send');

  function addMessage(role, text) {
    const el = document.createElement('div');
    el.className = `msg ${role}`;
    el.textContent = text;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
  }

  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'assistantMessage') {
      addMessage('assistant', msg.text);
    }
  });

  function send() {
    const text = prompt.value.trim();
    if (!text) return;
    addMessage('user', text);
    vscode.postMessage({ type: 'userMessage', text });
    prompt.value = '';
  }

  sendBtn.addEventListener('click', send);
  prompt.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      send();
    }
  });
})();