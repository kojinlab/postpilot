const API_BASE_URL =
  localStorage.getItem('review-queue-api-base-url') ||
  'https://postpilot-backend-qr0p.onrender.com';

const endpoints = {
  generate: '/api/generate',
  import: '/api/candidates/import',
  candidates: '/api/candidates',
  update: id => `/api/candidates/${encodeURIComponent(id)}`,
  promote: '/api/candidates/promote'
};

const fallbackCandidates = {
  items: [
    {
      id: 'sample-1',
      angle: '逆張り',
      body: 'テーマを入れると、ここに候補が並びます。\n保存したい先だけ選びます。',
      targets: { kojinlab: true, ClaudeStart: false }
    },
    {
      id: 'sample-2',
      angle: '具体例',
      body: 'ChatGPTで磨いた投稿も貼り付けて追加できます。\n未チェックはストックに残りません。',
      targets: { kojinlab: false, ClaudeStart: true }
    }
  ]
};

const state = {
  mode: 'generate',
  items: [],
  loading: true,
  generating: false,
  importing: false,
  promoting: false,
  saving: new Set(),
  usingFallback: false
};

const $ = selector => document.querySelector(selector);

async function apiRequest(path, options = {}){
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if(!response.ok) throw new Error(`API request failed: ${response.status}`);
  return response.json();
}

function normalizeCandidates(payload){
  const rawItems = payload?.items || payload?.candidates || [];
  return rawItems.map((item, index) => ({
    id: String(item.id ?? index + 1),
    angle: item.angle || item.label || item.title || `候補 ${index + 1}`,
    body: item.body || item.text || '',
    targets: {
      kojinlab: Boolean(item.targets?.kojinlab ?? item.kojinlab),
      ClaudeStart: Boolean(item.targets?.ClaudeStart ?? item.targets?.claudeStart ?? item.ClaudeStart)
    }
  }));
}

const selectedFor = target => state.items.filter(item => item.targets[target]).length;
const selectedTotal = () => state.items.filter(item => item.targets.kojinlab || item.targets.ClaudeStart).length;
const canMutate = () => !state.loading && !state.usingFallback;

function setFeedback(message = '', tone = 'info'){
  const box = $('#feedback');
  box.textContent = message;
  box.className = `feedback${message ? ` visible ${tone}` : ''}`;
}

function setMode(mode){
  state.mode = mode;
  document.querySelectorAll('.mode-tab').forEach(tab => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active);
  });
  $('#generatePanel').classList.toggle('active', mode === 'generate');
  $('#importPanel').classList.toggle('active', mode === 'import');
}

function renderStatus(){
  const selectionCount = selectedTotal();
  $('#candidateCount').textContent = state.loading ? '--' : state.items.length;
  $('#kojinlabCount').textContent = selectedFor('kojinlab');
  $('#claudeStartCount').textContent = selectedFor('ClaudeStart');
  $('#generateButton').disabled = state.generating || state.usingFallback;
  $('#importButton').disabled = state.importing || state.usingFallback;
  $('#promoteButton').disabled = !canMutate() || state.promoting || !state.items.length;
  $('#generateButton').textContent = state.generating ? '生成中…' : '10案生成';
  $('#importButton').textContent = state.importing ? '追加中…' : '候補に追加';
  $('#refreshButton').disabled = state.loading;
  $('#refreshButton').textContent = state.loading ? '読込中…' : '再読込';
  $('#promoteButton').textContent = state.promoting
    ? '保存中…'
    : selectionCount
      ? '選んだ投稿をストックへ保存'
      : '今回は保存せず閉じる';

  const hint = $('#selectionHint');
  if(state.loading){
    hint.textContent = '';
  }else if(!state.items.length){
    hint.textContent = '候補を作ると、ここで2つのアカウントへ振り分けられます。';
  }else if(selectionCount){
    hint.textContent = `保存対象は ${selectionCount}件。未チェックの候補は保存されません。`;
  }else{
    hint.textContent = 'チェックは0件です。このまま進むと、今回は何も保存せず候補を閉じます。';
  }
}

function renderCandidates(){
  const list = $('#candidateList');
  if(state.loading){
    list.innerHTML = `<div class="empty-state">候補を読んでいます。</div>`;
    return;
  }
  if(!state.items.length){
    list.innerHTML = `
      <div class="empty-state">
        <strong>まだ候補はありません。</strong>
        <span>テーマから10案作るか、外で作った投稿を貼り付けて始めます。</span>
      </div>
    `;
    return;
  }
  list.innerHTML = state.items.map((item, index) => `
    <article class="candidate-card">
      <div class="candidate-head">
        <span class="candidate-number">No.${String(index + 1).padStart(2, '0')}</span>
        <span class="candidate-angle">${escapeHtml(item.angle)}</span>
      </div>
      <p class="candidate-body">${escapeHtml(item.body)}</p>
      <div class="target-row" aria-label="保存先">
        ${targetCheckbox(item, 'kojinlab', 'kojinlab')}
        ${targetCheckbox(item, 'ClaudeStart', 'ClaudeStart')}
      </div>
    </article>
  `).join('');
  list.querySelectorAll('[data-item-id]').forEach(input => input.addEventListener('change', event => {
    toggleTarget(event.target.dataset.itemId, event.target.dataset.target, event.target.checked);
  }));
}

function targetCheckbox(item, target, label){
  const disabled = state.saving.has(item.id) || state.usingFallback ? 'disabled' : '';
  const checked = item.targets[target] ? 'checked' : '';
  const active = item.targets[target] ? 'active' : '';
  return `
    <label class="target-chip ${active}">
      <input type="checkbox" data-item-id="${escapeHtml(item.id)}" data-target="${target}" ${checked} ${disabled} />
      <span>${label}</span>
    </label>
  `;
}

function render(){
  renderStatus();
  renderCandidates();
}

async function loadCandidates(){
  if(state.loading && state.items.length) return;
  state.loading = true;
  state.usingFallback = false;
  setFeedback('');
  render();
  try{
    state.items = normalizeCandidates(await apiRequest(endpoints.candidates));
  }catch(error){
    console.warn(error);
    state.items = normalizeCandidates(fallbackCandidates);
    state.usingFallback = true;
    setFeedback('接続できませんでした。いまは見本だけ表示しています。少し置いて「再読込」を押してください。', 'info');
  }finally{
    state.loading = false;
    render();
  }
}

async function generateCandidates(){
  if(state.generating || state.importing || state.promoting) return;
  const theme = $('#themeInput').value.trim();
  if(!theme){
    setFeedback('先にテーマを入れてください。', 'error');
    $('#themeInput').focus();
    return;
  }
  state.generating = true;
  setFeedback('');
  renderStatus();
  try{
    await apiRequest(endpoints.generate, { method: 'POST', body: JSON.stringify({ theme }) });
    await loadCandidates();
    setFeedback('10案を作りました。置き先を選んでください。', 'success');
  }catch(error){
    console.warn(error);
    setFeedback('生成できませんでした。少し置いてもう一度。', 'error');
  }finally{
    state.generating = false;
    renderStatus();
  }
}

async function importCandidates(){
  if(state.generating || state.importing || state.promoting) return;
  const text = $('#importInput').value.trim();
  if(!text){
    setFeedback('追加する投稿を貼り付けてください。', 'error');
    $('#importInput').focus();
    return;
  }
  state.importing = true;
  setFeedback('');
  renderStatus();
  try{
    await apiRequest(endpoints.import, { method: 'POST', body: JSON.stringify({ text }) });
    $('#importInput').value = '';
    await loadCandidates();
    setFeedback('候補に追加しました。', 'success');
  }catch(error){
    console.warn(error);
    setFeedback('追加できませんでした。通信を確認してもう一度。', 'error');
  }finally{
    state.importing = false;
    renderStatus();
  }
}

async function toggleTarget(id, target, checked){
  if(state.promoting || state.saving.has(id)) return;
  const item = state.items.find(entry => entry.id === id);
  if(!item || !['kojinlab', 'ClaudeStart'].includes(target)) return;
  item.targets[target] = checked;
  state.saving.add(id);
  setFeedback('');
  render();
  try{
    await apiRequest(endpoints.update(id), {
      method: 'PATCH',
      body: JSON.stringify({ targets: item.targets })
    });
  }catch(error){
    console.warn(error);
    item.targets[target] = !checked;
    setFeedback('保存先を更新できませんでした。', 'error');
  }finally{
    state.saving.delete(id);
    render();
  }
}

async function promoteCandidates(){
  if(!state.items.length || state.usingFallback || state.promoting) return;
  state.promoting = true;
  setFeedback('');
  renderStatus();
  try{
    const payload = await apiRequest(endpoints.promote, { method: 'POST' });
    const promoted = Number(payload.promotedCount ?? payload.savedCount ?? selectedTotal());
    await loadCandidates();
    setFeedback(promoted ? `${promoted}件をストックへ保存しました。` : '今回は保存せず、候補を閉じました。', 'success');
  }catch(error){
    console.warn(error);
    setFeedback('ストックへ保存できませんでした。候補は残っているので、もう一度押せます。', 'error');
  }finally{
    state.promoting = false;
    renderStatus();
  }
}

function escapeHtml(value){
  return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}

document.querySelectorAll('.mode-tab').forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
$('#generateButton').addEventListener('click', generateCandidates);
$('#importButton').addEventListener('click', importCandidates);
$('#refreshButton').addEventListener('click', loadCandidates);
$('#promoteButton').addEventListener('click', promoteCandidates);
loadCandidates();
