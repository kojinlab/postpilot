const STORAGE_KEY = 'postpilot-state-v1';
const DB_NAME = 'postpilot-media-v1';
const DB_STORE = 'images';
const defaultState = {
  accounts: [
    { id: 'a', handle: '@account_a', color: '#4de8ff', slots: ['09:00','12:10','18:30'] },
    { id: 'b', handle: '@account_b', color: '#9c7bff', slots: ['09:00','12:10','18:30'] }
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
      accounts: parsed.accounts?.length ? parsed.accounts : structuredClone(defaultState.accounts),
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
  $('#imageStrip').innerHTML = state.images.map((img,i)=>`<div class="thumb" style="background-image:url('${img.url}')"><button class="remove" data-remove="${i}">×</button></div>`).join('');
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
function render(){renderAccounts();renderSlots();renderSchedule();renderPreview();renderQueue();saveState();}
$('#postText').value = state.draftText;
$('#postText').addEventListener('input', ()=>{state.draftText=$('#postText').value; renderPreview(); saveState();});
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
  state.queue.push({id:crypto.randomUUID(),accountId:state.activeAccountId,text:($('#postText').value||'無題の投稿').slice(0,28),scheduledAt,imageIds:[...state.draftImageIds]});
  $('#postText').value=''; state.draftText=''; state.images=[]; state.draftImageIds=[]; $('#manualToggle').checked=false; $('#manualPicker').classList.add('hidden'); $('#reserveButton').textContent='次の固定枠で予約'; hydrateDraftImages().then(render);
});
$$('[data-view]').forEach(btn=>btn.onclick=()=>{
  $$('[data-view]').forEach(x=>x.classList.remove('active'));
  $$(`[data-view="${btn.dataset.view}"]`).forEach(x=>x.classList.add('active'));
  $$('.view').forEach(v=>v.classList.remove('active')); $(`#${btn.dataset.view}View`).classList.add('active');
});
hydrateDraftImages().then(render);
