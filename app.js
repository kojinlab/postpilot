const API_BASE_URL =
  localStorage.getItem('review-queue-api-base-url') ||
  'https://postpilot-backend-qr0p.onrender.com';

const endpoints = {
  review: '/api/review',
  toggle: id => `/api/review/items/${encodeURIComponent(id)}`,
  complete: '/api/review/promote'
};

const fallbackReview = {
  items: [
    { id: 'sample-1', label: 'No.1 | P3 × 逆張り型', body: 'レビュー対象の投稿がここに表示されます。\n修正は review.md で行い、採用だけチェックします。', checked: false },
    { id: 'sample-2', label: 'No.2 | P7 × 問題提起型', body: 'バックエンド接続後は、review.md の内容をそのまま読み込みます。', checked: false }
  ]
};

const state = { items: [], stockCount: null, loading: true, saving: new Set(), completing: false, usingFallback: false };
const $ = selector => document.querySelector(selector);

async function apiRequest(path, options = {}){
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if(!response.ok) throw new Error(`API request failed: ${response.status}`);
  return response.json();
}
function normalizeReview(payload){
  const rawItems = payload?.items || payload?.posts || [];
  if(typeof payload?.stockCount === 'number') state.stockCount = payload.stockCount;
  return rawItems.map((item, index) => ({
    id: String(item.id ?? item.index ?? index + 1),
    label: item.label || item.title || `No.${index + 1}`,
    body: item.body || item.text || '',
    checked: Boolean(item.checked ?? item.approved)
  }));
}
const selectedCount = () => state.items.filter(item => item.checked).length;
const pendingCount = () => state.items.length;
function setFeedback(message = '', tone = 'info'){
  const box = $('#feedback');
  box.textContent = message;
  box.className = `feedback${message ? ` visible ${tone}` : ''}`;
}
function renderStatus(){
  $('#pendingCount').textContent = state.loading ? '--' : pendingCount();
  $('#stockCount').textContent = state.stockCount ?? '--';
  let label = 'レビュー待ちなし';
  if(state.loading) label = '読込中';
  else if(state.usingFallback) label = '接続待ち';
  else if(pendingCount()) label = `${selectedCount()}件採用`;
  $('#reviewStatus').textContent = label;
  $('#completeButton').disabled = state.loading || state.completing || pendingCount() === 0 || selectedCount() === 0 || state.usingFallback;
}
function renderPosts(){
  const list = $('#postList');
  if(state.loading){
    list.innerHTML = `<div class="empty-state">review.md を読んでいます。</div>`;
    return;
  }
  if(!state.items.length){
    list.innerHTML = `<div class="empty-state">レビュー待ちの投稿はありません。</div>`;
    return;
  }
  list.innerHTML = state.items.map(item => `
    <label class="post-item ${item.checked ? 'checked' : ''}">
      <input class="checkbox" type="checkbox" data-item-id="${escapeHtml(item.id)}" ${item.checked ? 'checked' : ''} ${state.saving.has(item.id) || state.usingFallback ? 'disabled' : ''} />
      <span class="post-copy">
        <span class="post-meta">${escapeHtml(item.label)}</span>
        <span class="post-body">${escapeHtml(item.body)}</span>
      </span>
    </label>
  `).join('');
  list.querySelectorAll('[data-item-id]').forEach(input => input.addEventListener('change', event => toggleItem(event.target.dataset.itemId, event.target.checked)));
}
function render(){ renderStatus(); renderPosts(); }
async function loadReview(){
  state.loading = true; state.usingFallback = false; setFeedback(''); render();
  try{
    state.items = normalizeReview(await apiRequest(endpoints.review));
  }catch(error){
    console.warn(error);
    state.items = normalizeReview(fallbackReview);
    state.usingFallback = true;
    setFeedback('バックエンド未接続です。UI確認用の仮データを表示しています。', 'info');
  }finally{
    state.loading = false;
    render();
  }
}
async function loadStock(){
  renderStatus();
}
async function toggleItem(id, checked){
  const item = state.items.find(entry => entry.id === id);
  if(!item) return;
  item.checked = checked;
  state.saving.add(id);
  setFeedback('');
  render();
  try{
    await apiRequest(endpoints.toggle(id), { method: 'PATCH', body: JSON.stringify({ checked }) });
  }catch(error){
    item.checked = !checked;
    setFeedback('チェックを保存できませんでした。通信を確認してもう一度。', 'error');
  }finally{
    state.saving.delete(id);
    render();
  }
}
async function completeReview(){
  if(!selectedCount() || state.usingFallback) return;
  state.completing = true;
  renderStatus();
  try{
    const payload = await apiRequest(endpoints.complete, { method: 'POST' });
    const promoted = Number(payload.promotedCount ?? payload.approvedCount ?? selectedCount());
    await Promise.all([loadReview(), loadStock()]);
    setFeedback(`${promoted}件をストックへ保存しました。`, 'success');
  }catch(error){
    console.warn(error);
    setFeedback('レビュー完了を保存できませんでした。', 'error');
  }finally{
    state.completing = false;
    renderStatus();
  }
}
function escapeHtml(value){
  return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
$('#refreshButton').addEventListener('click', () => Promise.all([loadReview(), loadStock()]));
$('#completeButton').addEventListener('click', completeReview);
Promise.all([loadReview(), loadStock()]);
