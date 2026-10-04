(() => {
  "use strict";
  const config = window.ALDO_ADMIN_CONFIG || {};
  const db = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
  const $ = (id) => document.getElementById(id);
  const state = {session:null,isAdmin:false,items:[],compositions:[],orders:[],candidates:[],view:"orders"};
  const titles = {orders:"Pedidos",candidates:"Confirmações IA",stock:"Estoque",catalog:"Catálogo",admins:"Administradores"};
  const statusLabels = {received:"Recebido",production:"Em produção",delivery:"Saiu para entrega",delivered:"Entregue"};

  function toast(message, error=false){const el=$("toast");el.textContent=message;el.style.borderColor=error?"var(--red)":"var(--green)";el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,4200)}
  function money(value){return Number(value||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}
  function escapeHtml(value){return String(value??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]))}
  async function query(table, select="*"){const {data,error}=await db.from(table).select(select);if(error)throw error;return data||[]}

  async function bootstrap(){
    const {data:{session}}=await db.auth.getSession();state.session=session;
    if(!session){show("login");return}
    const {data,error}=await db.rpc("is_admin");state.isAdmin=!error&&data===true;
    if(!state.isAdmin){show("denied");return}
    $("sessionEmail").textContent=session.user.email||"Administrador";show("app");await refreshAll();subscribe();
  }
  function show(which){$("loginView").hidden=which!=="login";$("deniedView").hidden=which!=="denied";$("appView").hidden=which!=="app"}
  async function login(){await db.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.href.split("#")[0]}})}
  async function logout(){await db.auth.signOut();location.reload()}

  async function refreshAll(){try{await Promise.all([loadOrders(),loadCandidates(),loadStock(),loadAdmins()])}catch(error){toast(error.message,true)}}
  async function loadOrders(){state.orders=await query("orders","*,order_items(*,order_item_components(*))");state.orders.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));renderOrders()}
  function renderOrders(){const statuses=["received","production","delivery","delivered"];$("ordersBoard").innerHTML=statuses.map(status=>{const rows=state.orders.filter(o=>o.status===status);return `<section class="status-column"><h2>${statusLabels[status]} <span>${rows.length}</span></h2>${rows.map(orderCard).join("")||'<p class="fine-print">Nenhum pedido.</p>'}</section>`}).join("")}
  function orderCard(o){const next={received:"production",production:"delivery",delivery:"delivered"}[o.status];const items=(o.order_items||[]).map(i=>`${i.quantity}× ${escapeHtml(i.item_name)}`).join("<br>");return `<article class="order-card"><h3>${escapeHtml(o.customer_known_as||o.customer_name||"Cliente")}</h3><div class="meta"><span class="pill">${escapeHtml(o.source)}</span><span>${new Date(o.created_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</span></div><p>${items||"Sem itens carregados"}</p><strong>${money(o.total)}</strong><div class="actions">${next?`<button class="button primary" data-order="${o.id}" data-status="${next}">${statusLabels[next]}</button>`:""}<button class="button" data-order="${o.id}" data-status="cancelled">Cancelar</button></div></article>`}

  async function loadCandidates(){state.candidates=(await query("whatsapp_order_candidates")).filter(c=>c.status==="pending").sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));renderCandidates()}
  function renderCandidates(){const badge=$("candidateBadge");badge.textContent=state.candidates.length;badge.hidden=!state.candidates.length;$("candidateList").innerHTML=state.candidates.map(c=>`<article class="candidate-card"><h3>Conversa ${escapeHtml(c.conversation_key)}</h3><div class="meta"><span class="pill">Confiança ${c.confidence==null?"—":Math.round(c.confidence*100)+"%"}</span><span>${new Date(c.created_at).toLocaleString("pt-BR")}</span></div><pre>${escapeHtml(JSON.stringify(c.interpreted_order,null,2))}</pre><div class="actions"><button class="button primary" data-candidate-confirm="${c.id}">Confirmar</button><button class="button" data-candidate-discard="${c.id}">Descartar</button></div></article>`).join("")||"<p>Nenhum candidato aguardando confirmação.</p>"}

  async function loadStock(){[state.items,state.compositions]=await Promise.all([query("items","id,name,stock,stock_mode,is_active,price"),query("composition","id,name,stock,is_active,price,max_quantity")]);renderStock();renderCatalog()}
  function stockRows(){const term=$("stockSearch").value.toLocaleLowerCase();const kind=$("stockKind").value;return [...state.items.filter(x=>x.stock_mode!=="composition").map(x=>({...x,kind:"item"})),...state.compositions.map(x=>({...x,kind:"composition"}))].filter(x=>(kind==="all"||x.kind===kind)&&x.name.toLocaleLowerCase().includes(term)).sort((a,b)=>a.name.localeCompare(b.name))}
  function renderStock(){$("stockList").innerHTML=stockRows().map(x=>`<article class="data-row"><div><strong>${escapeHtml(x.name)}</strong><br><small>${x.kind==="item"?"Item direto":"Componente"}</small></div><span>Saldo: <strong>${x.stock}</strong></span><span>${money(x.price)}</span><span>${x.is_active===false?"Desativado":"Ativo"}</span><button class="button" data-stock-kind="${x.kind}" data-stock-id="${x.id}">Ajustar</button></article>`).join("")}
  function renderCatalog(){$("catalogList").innerHTML=state.items.sort((a,b)=>a.name.localeCompare(b.name)).map(x=>`<article class="data-row"><div><strong>${escapeHtml(x.name)}</strong><br><small>${escapeHtml(x.id)}</small></div><span>${money(x.price)}</span><span>${x.stock_mode||"direct"}</span><span>Saldo ${x.stock}</span><span>${x.is_active===false?"Desativado":"Ativo"}</span></article>`).join("")}

  async function loadAdmins(){try{const admins=await query("admin_users","user_id,granted_at,profiles(email,full_name)");$("adminList").innerHTML=admins.map(a=>`<article class="data-row"><div><strong>${escapeHtml(a.profiles?.full_name||a.profiles?.email||a.user_id)}</strong><br><small>${escapeHtml(a.user_id)}</small></div><span>${new Date(a.granted_at).toLocaleDateString("pt-BR")}</span><span></span><span></span>${a.user_id!==state.session?.user.id?`<button class="button" data-admin-remove="${a.user_id}">Remover</button>`:"<span>Você</span>"}</article>`).join("")}catch(error){$("adminList").innerHTML=`<p>${escapeHtml(error.message)}</p>`}}
  function switchView(view){state.view=view;document.querySelectorAll(".view").forEach(x=>x.classList.toggle("active",x.id===view+"View"));document.querySelectorAll("#nav button").forEach(x=>x.classList.toggle("active",x.dataset.view===view));$("viewTitle").textContent=titles[view]}

  function openStock(kind,id){const item=(kind==="item"?state.items:state.compositions).find(x=>String(x.id)===id);if(!item)return;$("stockTargetKind").value=kind;$("stockTargetId").value=id;$("stockDialogTitle").textContent=item.name;$("stockAmount").value="";$("stockReason").value="";$("stockPreview").dataset.current=item.stock;updatePreview();$("stockDialog").showModal()}
  function updatePreview(){const current=Number($("stockPreview").dataset.current||0),amount=Number($("stockAmount").value||0);const result=$("stockOperation").value==="set"?amount:current-amount;$("stockPreview").textContent=`Saldo atual: ${current} → novo saldo: ${result}`;$("confirmStock").disabled=result<0||!Number.isInteger(amount)}
  async function saveStock(event){event.preventDefault();const payload={target_kind:$("stockTargetKind").value,target_id:$("stockTargetId").value,operation:$("stockOperation").value,amount:Number($("stockAmount").value),reason:$("stockReason").value||null};const {error}=await db.rpc("adjust_inventory",payload);if(error){toast(error.message,true);return}$("stockDialog").close();toast("Estoque atualizado.");await loadStock()}
  async function transition(id,status){const {error}=await db.rpc("transition_order",{target_order:id,next_status:status});if(error)toast(error.message,true);else{toast("Pedido atualizado.");await loadOrders()}}
  async function candidate(id,action){const fn=action==="confirm"?"confirm_whatsapp_candidate":"discard_whatsapp_candidate";const {error}=await db.rpc(fn,{candidate_id:id});if(error)toast(error.message,true);else{toast(action==="confirm"?"Pedido confirmado.":"Candidato descartado.");await Promise.all([loadCandidates(),loadOrders(),loadStock()])}}
  async function addAdmin(event){event.preventDefault();const {error}=await db.rpc("grant_admin_by_email",{target_email:$("adminEmail").value.trim()});if(error)toast(error.message,true);else{toast("Administrador adicionado.");event.target.reset();await loadAdmins()}}
  async function removeAdmin(id){const {error}=await db.from("admin_users").delete().eq("user_id",id);if(error)toast(error.message,true);else{toast("Acesso removido.");await loadAdmins()}}
  function subscribe(){db.channel("admin-live").on("postgres_changes",{event:"*",schema:"public",table:"orders"},loadOrders).on("postgres_changes",{event:"*",schema:"public",table:"whatsapp_order_candidates"},loadCandidates).subscribe()}

  $("googleLogin").addEventListener("click",login);$("logout").addEventListener("click",logout);$("deniedLogout").addEventListener("click",logout);$("refresh").addEventListener("click",refreshAll);$("nav").addEventListener("click",e=>e.target.closest("button")?.dataset.view&&switchView(e.target.closest("button").dataset.view));$("stockSearch").addEventListener("input",renderStock);$("stockKind").addEventListener("change",renderStock);$("stockAmount").addEventListener("input",updatePreview);$("stockOperation").addEventListener("change",updatePreview);$("stockForm").addEventListener("submit",saveStock);$("adminForm").addEventListener("submit",addAdmin);
  document.addEventListener("click",e=>{const stock=e.target.closest("[data-stock-id]");if(stock)openStock(stock.dataset.stockKind,stock.dataset.stockId);const order=e.target.closest("[data-order]");if(order)transition(order.dataset.order,order.dataset.status);const confirm=e.target.closest("[data-candidate-confirm]");if(confirm)candidate(confirm.dataset.candidateConfirm,"confirm");const discard=e.target.closest("[data-candidate-discard]");if(discard)candidate(discard.dataset.candidateDiscard,"discard");const remove=e.target.closest("[data-admin-remove]");if(remove)removeAdmin(remove.dataset.adminRemove)});
  db.auth.onAuthStateChange(()=>setTimeout(bootstrap,0));bootstrap();
})();
