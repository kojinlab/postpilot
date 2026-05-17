const STORAGE_KEY = 'postpilot-state-v1';
const DB_NAME = 'postpilot-media-v1';
const DB_STORE = 'images';
const API_BASE_URL =
  localStorage.getItem('postpilot-api-base-url') ||
  'https://postpilot-backend-qr0p.onrender.com';
const defaultState = {
  accounts: [
    { id: 'a', handle: '@account_a', color: '#4de8ff', slots: ['09:00','12:10','18:30'], connectionStatus: 'pending', displayName: 'Main account' },
    { id: 'b', handle: '@account_b', color: '#9c7bff', slots: ['09:00','12:10','18:30'], connectionStatus: 'pending', displayName: 'Second account' }
  ],
  activeAccountId: 'a',
  draftText: '投稿文を書く。日時を触らなければ、自動で次の固定枠へ。',
  images: [],
  draftImageIds: [],
  queue: [
    { id: crypto.randomUUID(), accountId: 'a', text: '画像付き投稿', scheduledAt: '2026-05-18T09:00', imageIds: [] },
    { id: crypto.randomUUID(), accountId: 'b', text: '昼投稿', scheduledAt: '2026-05-18T12:10', imageIds: [] }
  ]
};
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return structuredClone(defaultState);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(defaultState),
      ...parsed,
      accounts: parsed.accounts?.length ? parsed.accounts.map((a,i)=>({
        ...structuredClone(defaultState.accounts[i] || defaultState.accounts[0]),
        ...a,
        connectionStatus: a.connectionStatus || 'pending'
      })) : structuredClone(defaultState.accounts),
      queue: Array.isArray(parsed.queue) ? parsed.queue.map(q=>({...q, imageIds: Array.isArray(q.imageIds) ? q.imageIds : []})) : structuredClone(defaultState.queue),
      draftText: typeof parsed.draftText === 'string' ? parsed.draftText : defaultState.draftText,
      draftImageIds: Array.isArray(parsed.draftImageIds) ? parsed.draftImageIds : [],
      images: []
    };
  }catch{
    return structuredClone(defaultState);
  }
}
function saveState(){
  const { images, ...persisted } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}
const state = loadState();

async function apiRequest(path, options={}){
  if(!API_BASE_URL) return null;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if(!res.ok) throw new Error(`API request failed: ${res.status}`);
  return res.json();
}

function openDb(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME,1);
    req.onupgradeneeded = ()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}
async function putImage(id, blob){
  const db = await openDb();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(DB_STORE,'readwrite');
    tx.objectStore(DB_STORE).put(blob,id);
    tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error);
  });
}
async function getImage(id){
  const db = await openDb();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(DB_STORE,'readonly');
    const req = tx.objectStore(DB_STORE).get(id);
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
async function deleteImage(id){
  const db = await openDb();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(DB_STORE,'readwrite');
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error);
  });
}
async function hydrateDraftImages(){
  const files = await Promise.all(state.draftImageIds.map(async id=>({id, blob: await getImage(id)})));
  state.images = files.filter(x=>x.blob).map(x=>({id:x.id, url:URL.createObjectURL(x.blob)}));
}
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const activeAccount = () => state.accounts.find(a => a.id === state.activeAccountId);
const fmt = iso => new Date(iso).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).replace('/','/');
const localIsoMinute = d => {
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
function nextSlot(account){
  const base = new Date();
  for(let day=0; day<7; day++){
    for(const slot of account.slots){
      const [h,m] = slot.split(':').map(Number); const d = new Date(base); d.setDate(base.getDate()+day); d.setHours(h,m,0,0);
      const candidate = localIsoMinute(d);
      const occupied = state.queue.some(q => q.accountId===account.id && q.scheduledAt===candidate);
      if(!occupied && d >= base) return candidate;
    }
  }
}
function renderAccounts(){
  $('#sidebarAccounts').innerHTML = state.accounts.map(a=>`<div class="account-chip-mini"><span class="dot" style="background:${a.color}"></span>${a.handle}</div>`).join('');
  $('#accountChips').innerHTML = state.accounts.map(a=>`<button class="account-chip ${a.id===state.activeAccountId?'active':''}" data-account="${a.id}"><span class="dot" style="background:${a.color}"></span>${a.handle}</button>`).join('');
  $$('[data-account]').forEach(btn=>btn.onclick=()=>{state.activeAccountId=btn.dataset.account; render();});
}

function statusLabel(status){
  if(status==='connected') return '連携済み';
  if(status==='pending') return '未接続';
  return '切断';
}
function renderConnectedAccounts(){
  $('#accountCards').innerHTML = state.accounts.map(a=>`
    <div class="account-card">
      <div class="account-meta">
        <strong>${a.handle}</strong>
        <span>${a.displayName || ''}</span>
        <span class="status ${a.connectionStatus}"><span class="status-dot" style="background:${a.connectionStatus==='connected'?'var(--lime)':a.connectionStatus==='pending'?'#ffd66e':'var(--muted)'}"></span>${statusLabel(a.connectionStatus)}</span>
        ${a.connectionStatus==='connected'?'<small class="muted-strong">投稿可能</small>':''}
      </div>
      <div class="account-actions">
        <button class="ghost primary-soft" data-connect="${a.id}">${a.connectionStatus==='connected'?'再連携':'連携する'}</button>
        <button class="ghost" data-active-account="${a.id}">この垢で作成</button>
      </div>
    </div>`).join('');
  $$('[data-active-account]').forEach(btn=>btn.onclick=()=>{state.activeAccountId=btn.dataset.activeAccount; switchView('composer'); render();});
  $$('[data-connect]').forEach(btn=>btn.onclick=()=>{window.location.href = API_BASE_URL ? `${API_BASE_URL}/auth/x/start` : '#';});
}

async function hydrateConnectedAccounts(){
  const payload = await apiRequest('/api/accounts').catch(()=>null);
  if(!payload?.accounts?.length) return;
  for(const remote of payload.accounts){
    const existing = state.accounts.find(a => a.handle === remote.handle);
    if(existing){
      Object.assign(existing, {
        id: remote.id,
        displayName: remote.displayName,
        connectionStatus: 'connected'
      });
    } else {
      state.accounts.push({
        id: remote.id,
        handle: remote.handle,
        displayName: remote.displayName,
        color: state.accounts.length % 2 === 0 ? '#4de8ff' : '#9c7bff',
        slots: ['09:00','12:10','18:30'],
        connectionStatus: 'connected'
      });
    }
  }
}
function renderConnectionSummary(){
  const connected = state.accounts.filter(a=>a.connectionStatus==='connected').length;
  $('#connectionSummary').innerHTML = `
    <div class="summary-row"><span>連携済み</span><strong>${connected}/2</strong></div>
    <div class="summary-row"><span>現在の投稿先</span><strong>${activeAccount().handle}</strong></div>
    ${connected<2?'<div class="notice">2垢とも連携すると、予約投稿の流れが完成します。</div>':''}`;
}
function renderComposerNotice(){
  let box = $('#composerNotice');
  if(!box){
    box = document.createElement('div'); box.id='composerNotice'; box.className='composer-alert';
    $('.composer').insertBefore(box, $('#postText'));
  }
  const a = activeAccount();
  box.textContent = a.connectionStatus==='connected' ? `${a.handle} に投稿できます。` : `${a.handle} はまだ未連携です。今は下書きと予約設計まで使えます。`;
}

function renderComposerMeta(){
  const count = $('#postText').value.length;
  $('#charCount').textContent = `${count} / 280`;
  $('#charCount').style.color = count > 280 ? 'var(--danger)' : 'var(--muted)';
}
function showFeedback(message, type='success'){
  const box = $('#composerFeedback');
  box.textContent = message;
  box.className = `feedback ${type==='error'?'error':''}`;
  clearTimeout(showFeedback.timer);
  showFeedback.timer = setTimeout(()=>box.classList.add('hidden'), 2200);
}

function switchView(view){
  $$('[data-view]').forEach(x=>x.classList.toggle('active', x.dataset.view===view));
  $$('.view').forEach(v=>v.classList.remove('active'));
  $(`#${view}View`).classList.add('active');
}

function applyConnectionResultFromUrl(){
  const params = new URLSearchParams(window.location.search);
  if(params.get('connected') !== '1') return;
  const handle = params.get('handle');
  if(handle){
    showFeedback(`@${handle} を連携しました。`);
  }
  window.history.replaceState({}, '', window.location.pathname);
}

function renderSlots(){
  const a = activeAccount();
  $('#slotRail').innerHTML = a.slots.map((s,i)=>`<div class="slot-row"><span>${['Morning','Lunch','Evening'][i]||'Slot'}</span><strong>${s}</strong></div>`).join('');
  $('#slotSettings').innerHTML = a.slots.map((s,i)=>`<div class="slot-editor"><span>${a.handle} slot ${i+1}</span><input data-slot-index="${i}" type="time" value="${s}"></div>`).join('');
  $$('[data-slot-index]').forEach(input=>input.onchange=e=>{a.slots[+e.target.dataset.slotIndex]=e.target.value; render();});
}
function renderSchedule(){
  const iso = nextSlot(activeAccount());
  $('#heroNextSlot').textContent = `次の推奨枠　${fmt(iso)}`;
  $('#autoSchedule').textContent = `${fmt(iso)}（自動）`;
}
function renderPreview(){
  $('#previewAccount').textContent = activeAccount().handle;
  $('#previewText').textContent = $('#postText').value || '投稿文を書く';
  $('#previewImages').innerHTML = state.images.map(img=>`<img src="${img.url}" alt="preview">`).join('');
  $('#mediaHint').textContent = state.images.length ? `画像 ${state.images.length}枚` : '画像なし';
  $('#imageStrip').innerHTML = state.images.map((img,i)=>`<div class="thumb" style="background-image:url('${img.url}')"><button class="remove" data-remove="${i}">×</button><div class="thumb-controls"><button class="thumb-move" data-left="${i}">‹</button><button class="thumb-move" data-right="${i}">›</button></div></div>`).join('');
  $$('[data-left]').forEach(btn=>btn.onclick=()=>{const i=+btn.dataset.left;if(i>0){[state.images[i-1],state.images[i]]=[state.images[i],state.images[i-1]];[state.draftImageIds[i-1],state.draftImageIds[i]]=[state.draftImageIds[i],state.draftImageIds[i-1]];renderPreview();saveState();}});
  $$('[data-right]').forEach(btn=>btn.onclick=()=>{const i=+btn.dataset.right;if(i<state.images.length-1){[state.images[i+1],state.images[i]]=[state.images[i],state.images[i+1]];[state.draftImageIds[i+1],state.draftImageIds[i]]=[state.draftImageIds[i],state.draftImageIds[i+1]];renderPreview();saveState();}});
  $$('[data-remove]').forEach(btn=>btn.onclick=async()=>{
    const [removed] = state.images.splice(+btn.dataset.remove,1);
    state.draftImageIds = state.draftImageIds.filter(id=>id!==removed.id);
    await deleteImage(removed.id);
    renderPreview(); saveState();
  });
}
async function queueThumbUrl(ids=[]){
  if(!ids.length) return '';
  const blob = await getImage(ids[0]);
  return blob ? URL.createObjectURL(blob) : '';
}
async function renderQueue(){
  $('#queueCount').textContent = `${state.queue.length}件`;
  const items = await Promise.all(state.queue.slice().sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt)).map(async q=>{
    const a = state.accounts.find(x=>x.id===q.accountId);
    const thumb = await queueThumbUrl(q.imageIds);
    return `<div class="queue-item"><div class="queue-main">${thumb?`<div class="queue-thumb" style="background-image:url('${thumb}')"></div>`:''}<div class="queue-copy"><strong>${fmt(q.scheduledAt)}</strong><small>${a.handle} ・ 画像${q.imageIds?.length || 0}枚</small><span>${q.text}</span></div></div><div class="queue-actions"><button class="ghost" data-edit="${q.id}">編集</button><button class="ghost danger" data-delete="${q.id}">削除</button></div></div>`;
  }));
  $('#queueList').innerHTML = items.join('');
  $$('[data-delete]').forEach(btn=>btn.onclick=async()=>{
    const target = state.queue.find(q=>q.id===btn.dataset.delete);
    state.queue = state.queue.filter(q=>q.id!==btn.dataset.delete);
    for(const id of target.imageIds||[]) await deleteImage(id);
    render();
  });
  $$('[data-edit]').forEach(btn=>btn.onclick=async()=>{
    const target = state.queue.find(q=>q.id===btn.dataset.edit);
    state.activeAccountId = target.accountId;
    state.draftText = target.text;
    $('#postText').value = target.text;
    state.draftImageIds = [...(target.imageIds||[])];
    state.queue = state.queue.filter(q=>q.id!==target.id);
    await hydrateDraftImages();
    $$('.nav-item').forEach(x=>x.classList.remove('active'));
    $('[data-view="composer"]').classList.add('active');
    $$('.view').forEach(v=>v.classList.remove('active'));
    $('#composerView').classList.add('active');
    render();
  });
}
function render(){renderAccounts();renderConnectedAccounts();renderConnectionSummary();renderComposerNotice();renderSlots();renderSchedule();renderPreview();renderQueue();renderComposerMeta();saveState();}
$('#postText').value = state.draftText;
$('#postText').addEventListener('input', ()=>{state.draftText=$('#postText').value; renderPreview(); renderComposerMeta(); $('#saveState').textContent='保存済み'; saveState();});
$('#imageInput').addEventListener('change', async e=>{
  for(const file of [...e.target.files].slice(0,4-state.images.length)){
    const id = crypto.randomUUID();
    await putImage(id,file);
    state.draftImageIds.push(id);
    state.images.push({id,url:URL.createObjectURL(file)});
  }
  renderPreview(); saveState();
});
$('#manualToggle').addEventListener('change', e=>{
  $('#manualPicker').classList.toggle('hidden', !e.target.checked);
  $('#reserveButton').textContent = e.target.checked ? '指定日時で予約' : '次の固定枠で予約';
});
$('#reserveButton').addEventListener('click',()=>{
  const manual = $('#manualToggle').checked;
  const scheduledAt = manual && $('#manualDateTime').value ? $('#manualDateTime').value : nextSlot(activeAccount());
  const newPost = {id:crypto.randomUUID(),accountId:state.activeAccountId,text:($('#postText').value||'無題の投稿').slice(0,28),scheduledAt,imageIds:[...state.draftImageIds]};
  state.queue.push(newPost);
  apiRequest('/api/posts', { method:'POST', body: JSON.stringify(newPost) })
    .then(()=>showFeedback('予約しました。'))
    .catch(()=>showFeedback('ローカルには保存しました。送信サーバーは未接続です。','error'));
  $('#postText').value=''; state.draftText=''; state.images=[]; state.draftImageIds=[]; $('#manualToggle').checked=false; $('#manualPicker').classList.add('hidden'); $('#reserveButton').textContent='次の固定枠で予約'; hydrateDraftImages().then(()=>{render(); if(!API_BASE_URL) showFeedback('予約しました。','success');});
});
$$('[data-view]').forEach(btn=>btn.onclick=()=>switchView(btn.dataset.view));
Promise.all([hydrateDraftImages(), hydrateConnectedAccounts()]).then(render);
applyConnectionResultFromUrl();
