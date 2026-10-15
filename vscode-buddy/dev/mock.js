// Stands in for the extension host so the webview can be previewed in a plain browser.
(function () {
  const builtins = [
    { id: 'bolt', name: 'Bolt the Robot', emoji: '🤖', kind: 'builtin' },
    { id: 'mochi', name: 'Mochi the Cat', emoji: '🐱', kind: 'builtin' },
    { id: 'astro', name: 'Astro', emoji: '🧑‍🚀', kind: 'builtin' },
    { id: 'waddle', name: 'Waddle the Penguin', emoji: '🐧', kind: 'builtin' },
    { id: 'bloop', name: 'Bloop the Droplet', emoji: '💧', kind: 'builtin' }
  ];
  const q = new URLSearchParams(location.search);
  const state = {
    userName: '', sound: false, muted: false, characters: builtins, defaultCharacter: q.get('char') || 'bolt',
    tasks: [
      { id: '1', text: 'Daily standup call in 5 minutes', time: '10:00', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], done: false, characterId: 'astro' },
      { id: '2', text: 'Lunch break! Step away from the screen', time: '13:30', done: false },
      { id: '3', text: 'Push the flow-update branch and raise the PR', time: '16:30', date: '2026-10-15', done: false, characterId: 'mochi' }
    ]
  };
  const send = (m) => window.postMessage(m, '*');
  window.__mock = { state, send };
  window.acquireVsCodeApi = () => ({
    postMessage(m) {
      if (m.type === 'ready') setTimeout(() => send({ type: 'state', state }), 30);
      if (m.type === 'setDefault') { state.defaultCharacter = m.id; send({ type: 'state', state }); }
      if (m.type === 'addTask') { state.tasks.push({ id: String(Math.random()), done: false, ...m.task }); send({ type: 'state', state }); }
      if (m.type === 'deleteTask') { state.tasks = state.tasks.filter((t) => t.id !== m.id); send({ type: 'state', state }); }
      if (m.type === 'toggleTask') { const t = state.tasks.find((x) => x.id === m.id); t.done = !t.done; send({ type: 'state', state }); }
      if (m.type === 'test') send({ type: 'remind', reminder: { id: 'r' + Date.now(), kind: 'water', text: 'Time to drink some water! 💧', yes: 'Yes', later: 'Remind me later', characterId: q.get('rc') || '' } });
      if (m.type === 'readImage') setTimeout(() => { const d = (window.__mockImages || {})[m.id]; send({ type: 'image', reqId: m.reqId, data: d, error: d ? undefined : 'no mock image' }); }, 20);
      console.log('to extension:', JSON.stringify(m));
    }
  });
})();
