(() => {
  "use strict";
  const config = window.ALDO_ADMIN_CONFIG || {};
  const db = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
  const $ = (id) => document.getElementById(id);
  const viewNames = ["home","orders","candidates","stock","items","categories","components","customers","admins"];
  const routeView = location.hash.slice(1);
  const savedView = viewNames.includes(routeView) ? routeView : localStorage.getItem("aldoAdminViewV2");
  const savedOrderTab=Number(localStorage.getItem("aldoAdminOrdersTab")||0);
  const state = {session:null,isAdmin:false,items:[],categories:[],components:[],associations:[],packages:[],packageComponents:[],packageComponentDraft:new Map(),activePackageManagerId:null,componentReturnToGroupId:null,componentManagedMode:false,itemPackages:[],itemComponentConfigs:[],orders:[],orderLoadRevision:0,candidates:[],liveChannels:[],booting:false,view:viewNames.includes(savedView)?savedView:"home",inventoryDrafts:new Map(),orderTab:[-1,0,1,2].includes(savedOrderTab)?savedOrderTab:0,autoAcceptSiteOrders:true};
  const titles = {home:"Administração",orders:"Pedidos",candidates:"Confirmações IA",stock:"Inventário",items:"Itens",categories:"Categorias",components:"Componentes",customers:"Cadastros",admins:"Administradores"};
  let orderRefreshTimer=null;
  const displayLabels = {lista:"Lista","lista-dupla":"Lista dupla",grade:"Grade",grid:"Grid legado"};
  const linkLabels = {delta:"Ajustável",scalable:"Escalável",complementary:"Complementar"};
  const packageKindLabels={adjustable:"Delta · 0/1/2",scalable:"Escalável",decay:"Decaimento por prioridade",complementary:"Complementar (legado)",single_required:"Escolha única (legado)"};
  const packageAvailabilityLabels={all_positive_defaults_required:"Padrões positivos obrigatórios",one_available_with_priority_fallback:"Obrigatório com prioridade",optional_warn_only:"Opcional com aviso",optional:"Opcional"};

  function toast(message,error=false){const el=$("toast");el.textContent=message;el.style.borderColor=error?"var(--red)":"var(--green)";el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,4200)}
  function money(value){return Number(value||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}
  function escapeHtml(value){return String(value??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]))}
  function slug(value){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,40)||"registro"}
  async function query(table,select="*"){const {data,error}=await db.from(table).select(select);if(error)throw error;return data||[]}
  function show(which){$("loadingView").hidden=which!=="loading";$("loginView").hidden=which!=="login";$("deniedView").hidden=which!=="denied";$("appView").hidden=which!=="app"}

  async function bootstrap(){if(state.booting)return;state.booting=true;show("loading");try{const {data:{session}}=await db.auth.getSession();state.session=session;if(!session){show("login");return}const {data,error}=await db.rpc("is_admin");state.isAdmin=!error&&data===true;if(!state.isAdmin){show("denied");return}$("sessionEmail").textContent=session.user.email||"Administrador";await refreshAll();switchView(state.view);subscribe();show("app")}catch(error){show("login");toast(`Não foi possível carregar a sessão: ${error.message}`,true)}finally{state.booting=false}}
  async function login(){await db.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.origin+location.pathname}})}
  async function logout(){await db.auth.signOut();location.reload()}
  async function refreshAll(){try{await Promise.all([loadOrders(),loadCandidates(),loadCatalog(),loadAdmins(),loadCustomers(),loadOrderSettings()])}catch(error){toast(error.message,true)}}

  async function loadOrderSettings(){try{const {data,error}=await db.rpc("get_order_auto_accept");if(error)throw error;state.autoAcceptSiteOrders=data!==false;$("autoAcceptSiteOrders").checked=state.autoAcceptSiteOrders}catch(error){toast(`Configuração de pedidos indisponível: ${error.message}`,true)}}
  async function saveOrderSettings(event){event.preventDefault();const enabled=$("autoAcceptSiteOrders").checked;const {data,error}=await db.rpc("set_order_auto_accept",{p_enabled:enabled});if(error){toast(error.message,true);return}state.autoAcceptSiteOrders=data!==false;$("autoAcceptSiteOrders").checked=state.autoAcceptSiteOrders;$("orderSettingsDialog").close();toast("Configuração salva.")}

  async function loadOrders(){const revision=++state.orderLoadRevision;let orders;try{orders=await query("orders","*,order_items(*,order_item_components(*)),order_sellable_component_totals(*)")}catch(error){if(!/order_sellable_component_totals|relationship|schema cache/i.test(error.message||""))throw error;orders=await query("orders","*,order_items(*,order_item_components(*))")}if(revision!==state.orderLoadRevision)return;state.orders=orders;state.orders.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));renderOrders()}
  function orderItemMarkup(item,expanded=false){
    const catalogItem=state.items.find(entry=>String(entry.id)===String(item.catalog_item_id||item.item_id))||state.items.find(entry=>entry.name?.trim().toLocaleLowerCase()===String(item.item_name||item.name||"").trim().toLocaleLowerCase());
    const photo=catalogItem?.photo_url_1||catalogItem?.photo_url_2||catalogItem?.photo_url_3;
    const quantity=Math.max(1,Number(item.quantity)||1);
    const rawOptionsText=item.snapshot?.options_text||item.snapshot?.optionsText||item.options_text||item.modifications||"";
    const optionsText=Array.isArray(rawOptionsText)?rawOptionsText.join("|"):rawOptionsText;
    let changes=String(optionsText).split("|").map(part=>part.trim()).filter(Boolean).map(text=>{
      const normalized=text.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase();
      const kind=/^remover\b/.test(normalized)?"remove":/^adicionar\b/.test(normalized)?"add":"other";
      return `<span class="order-change-chip ${kind}">${escapeHtml(text)}</span>`;
    });
    if(!changes.length)changes=(item.order_item_components||[]).filter(component=>{
      const selected=Number(component.snapshot?.per_item_quantity??component.quantity);
      const standard=Number(component.snapshot?.default_quantity??component.free_quantity??0);
      return selected!==standard;
    }).map(component=>{
      const selected=Number(component.snapshot?.per_item_quantity??component.quantity);
      const standard=Number(component.snapshot?.default_quantity??component.free_quantity??0);
      const difference=selected-standard;
      const total=Math.abs(difference)*quantity;
      const prefix=difference>0?"Adicionar":"Remover";
      const amount=total>1?`${total}x `:"";
      return `<span class="order-change-chip ${difference>0?"add":"remove"}">${prefix} ${amount}${escapeHtml(component.component_name)}</span>`;
    });
    const image=photo?`<img src="${escapeHtml(photo)}" alt="" loading="lazy">`:'<span class="order-item-photo" aria-hidden="true"></span>';
    const note=item.notes?`<small>${escapeHtml(item.notes)}</small>`:"";
    const quantityBadge=quantity>1?`<span class="item-quantity-badge" data-quantity="${Math.min(quantity,8)}">${quantity}</span>`:"";
    return `<div class="order-item ${expanded?"expanded-order-item":""}">${image}<div class="order-item-copy"><div class="order-item-title">${quantityBadge}<strong>${escapeHtml(item.item_name||item.name||"Item")}</strong></div>${changes.length?`<div class="order-item-changes">${changes.join("")}</div>`:""}${note}</div></div>`;
  }
  function sellableTotalsMarkup(order){return (order.order_sellable_component_totals||[]).filter(row=>Number(row.quantity)>0).map(row=>`<div class="order-item pooled-order-component"><span class="order-item-photo" aria-hidden="true"></span><div class="order-item-copy"><strong>${escapeHtml(row.customer_name||row.group_name)} · ${escapeHtml(row.component_name)} ×${Number(row.quantity)}</strong>${Number(row.charged_quantity)>0?`<small>${Number(row.charged_quantity)} adicional(is) · ${money(Number(row.charged_quantity)*Number(row.unit_price))}</small>`:""}</div></div>`).join("")}
  function renderOrders(){
    const pending=state.orders.filter(order=>order.status==="pending_confirmation");
    const pendingCandidates=state.candidates;
    const active=state.orders.filter(order=>["received","confirmed","production"].includes(order.status));
    const deliveryOrders=state.orders.filter(order=>order.status==="delivery");
    const delivered=state.orders.filter(order=>order.status==="delivered").slice().reverse();
    [["pending",pending.length+pendingCandidates.length],["active",active.length],["delivery",deliveryOrders.length],["delivered",delivered.length]].forEach(([key,count])=>{
      const badge=document.querySelector(`[data-order-count="${key}"]`);if(badge)badge.textContent=count;
    });
    $("ordersView").dataset.orderTab=String(state.orderTab);
    document.querySelectorAll("[data-order-tab]").forEach(tab=>{const selected=Number(tab.dataset.orderTab)===state.orderTab;tab.classList.toggle("active",selected);tab.setAttribute("aria-selected",String(selected))});
    const orderCard=(order,tab)=>{
      const address=order.delivery_address||{};
      const location=[address.street,address.landmark,address.address_extra].filter(Boolean).map(escapeHtml).join(" · ");
      const items=(order.order_items||[]).map(item=>orderItemMarkup(item)).join("")+sellableTotalsMarkup(order);
      const generalNote=order.notes?`<p class="order-general-note"><strong>Obs. do pedido:</strong> ${escapeHtml(order.notes)}</p>`:"";
      const canPrepare=["received","confirmed"].includes(order.status),canDeliver=order.status==="production";
      const id=escapeHtml(order.id);
      const actions=tab===-1?`<button class="button order-action review-accept" data-order="${id}" data-status="received" aria-label="Aceitar pedido" title="Aceitar">✓</button><button class="button order-action review-reject" data-order="${id}" data-status="cancelled" aria-label="Recusar pedido" title="Recusar">×</button>`:tab===1?`<button class="button delivery-done icon-action" data-order="${id}" data-status="delivered" aria-label="Marcar como entregue" title="Marcar como entregue"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h11v12H3zM14 10h4l3 3v5h-7z"/><circle cx="7.5" cy="19" r="1.5"/><circle cx="18" cy="19" r="1.5"/><path d="m8 11 2 2 4-4"/></svg></button>`:tab===2?"":`<button class="button order-action icon-action" data-order="${id}" data-status="preparing" aria-label="Preparando" title="Preparando" ${canPrepare?"":"disabled"}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h16l-1.4 9H5.4L4 10Z"/><path d="M7 7c0-1 1-1 1-2m4 2c0-1 1-1 1-2m4 2c0-1 1-1 1-2M3 21h18"/></svg></button><button class="button order-action icon-action" data-order="${id}" data-status="delivery" aria-label="Saiu para entrega" title="Saiu para entrega" ${canDeliver?"":"disabled"}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h11v12H3zM14 10h4l3 3v5h-7z"/><circle cx="7.5" cy="19" r="1.5"/><circle cx="18" cy="19" r="1.5"/><path d="M16 13h4"/></svg></button>`;
      return `<article class="order-row status-${escapeHtml(order.status)}"><div class="order-customer"><strong>${escapeHtml(order.customer_known_as||order.customer_name||"")}</strong>${location?`<small>${location}</small>`:""}<strong class="order-card-total">${money(order.total)}</strong><button class="button view-order-button" data-order-view="${id}">Ver pedido</button></div><div class="order-items">${items}</div><div class="order-actions">${actions}</div>${generalNote}</article>`;
    };
    const candidateCard=candidate=>{
      const detail=candidate.interpreted_order||{};
      const address=detail.delivery_address||{};
      const location=[address.street,address.landmark,address.address_extra].filter(Boolean).map(escapeHtml).join(" · ");
      const items=(Array.isArray(detail.items)?detail.items:[]).map(item=>orderItemMarkup({...item,item_name:item.item_name||item.name,snapshot:item.snapshot||{options_text:item.options_text||item.modifications||""}})).join("");
      const total=Number.isFinite(Number(detail.total))?`<strong class="order-card-total">${money(detail.total)}</strong>`:"";
      const generalNote=detail.notes?`<p class="order-general-note"><strong>Obs. do pedido:</strong> ${escapeHtml(detail.notes)}</p>`:"";
      return `<article class="order-row candidate-order-row status-pending_confirmation"><div class="order-customer"><strong>${escapeHtml(detail.customer_known_as||detail.customer_name||"Pedido WhatsApp")}</strong>${location?`<small>${location}</small>`:""}${total}<button class="button view-order-button" data-candidate-view="${escapeHtml(candidate.id)}">Ver pedido</button></div><div class="order-items">${items}</div><div class="order-actions"><button class="button order-action review-accept" data-candidate-confirm="${escapeHtml(candidate.id)}" aria-label="Confirmar pedido" title="Confirmar">✓</button><button class="button order-action review-reject" data-candidate-discard="${escapeHtml(candidate.id)}" aria-label="Descartar pedido" title="Descartar">×</button></div>${generalNote}</article>`;
    };
    const rows=state.orderTab===-1?[...pending.map(order=>({created_at:order.created_at,html:orderCard(order,-1)})),...pendingCandidates.map(candidate=>({created_at:candidate.created_at,html:candidateCard(candidate)}))].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)).map(row=>row.html):state.orderTab===1?deliveryOrders.map(order=>orderCard(order,1)):state.orderTab===2?delivered.map(order=>orderCard(order,2)):active.map(order=>orderCard(order,0));
    $("ordersBoard").innerHTML=rows.join("");
    const customerName=order=>escapeHtml(order.customer_known_as||order.customer_name||"");
    const compact=(list)=>list.map(order=>{
      const categoryCounts=new Map();
      (order.order_items||[]).forEach(item=>{
        const category=state.categories.find(entry=>entry.id===state.items.find(catalogItem=>String(catalogItem.id)===String(item.catalog_item_id))?.category_id);
        const categoryName=category?.name||"Sem categoria";
        categoryCounts.set(categoryName,(categoryCounts.get(categoryName)||0)+Number(item.quantity||0));
      });
      const counts=[...categoryCounts].map(([name,quantity])=>`${quantity} ${escapeHtml(name)}`).join(" · ");
      const deliveredAction=list===deliveryOrders?`<button class="button delivery-done icon-action" data-order="${escapeHtml(order.id)}" data-status="delivered" aria-label="Marcar como entregue" title="Marcar como entregue"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h11v12H3zM14 10h4l3 3v5h-7z"/><circle cx="7.5" cy="19" r="1.5"/><circle cx="18" cy="19" r="1.5"/><path d="m8 11 2 2 4-4"/></svg></button>`:"";
      const compactState=list===deliveryOrders?"status-delivery":"status-delivered";
      return `<div class="compact-order-name ${compactState} ${deliveredAction?"has-action":""}"><div><strong>${customerName(order)}</strong>${counts?`<small>${counts}</small>`:""}<small class="compact-order-total">${money(order.total)}</small></div>${deliveredAction}</div>`;
    }).join("");
    $("deliveryOrders").innerHTML=compact(deliveryOrders);
    $("deliveredOrders").innerHTML=compact(state.orders.filter(order=>order.status==="delivered").slice().reverse());
  }
  function openOrderDetails(id){
    const order=state.orders.find(entry=>String(entry.id)===String(id));
    if(!order){
      const candidate=state.candidates.find(entry=>String(entry.id)===String(id));if(!candidate)return;
      const detail=candidate.interpreted_order||{},address=detail.delivery_address||{};
      const location=[address.street,address.landmark,address.address_extra].filter(Boolean).map(escapeHtml).join(" · ");
      const items=(Array.isArray(detail.items)?detail.items:[]).map(item=>orderItemMarkup({...item,item_name:item.item_name||item.name,snapshot:item.snapshot||{options_text:item.options_text||item.modifications||""}},true)).join("");
      const notes=detail.notes?`<p class="expanded-order-note"><strong>Obs. do pedido:</strong> ${escapeHtml(detail.notes)}</p>`:"";
      const total=Number.isFinite(Number(detail.total))?`<strong class="expanded-order-total">${money(detail.total)}</strong>`:"";
      $("orderExpandedContent").innerHTML=`<div class="expanded-order-customer"><strong>${escapeHtml(detail.customer_known_as||detail.customer_name||"Pedido WhatsApp")}</strong>${location?`<small>${location}</small>`:""}</div><div class="expanded-order-items">${items}</div>${notes}${total}`;
      $("orderExpandedDialog").showModal();return;
    }
    const address=order.delivery_address||{};
    const location=[address.street,address.landmark,address.address_extra].filter(Boolean).map(escapeHtml).join(" · ");
    const items=(order.order_items||[]).map(item=>orderItemMarkup(item,true)).join("")+sellableTotalsMarkup(order);
    const notes=order.notes?`<p class="expanded-order-note"><strong>Obs. do pedido:</strong> ${escapeHtml(order.notes)}</p>`:"";
    $("orderExpandedContent").innerHTML=`<div class="expanded-order-customer"><strong>${escapeHtml(order.customer_known_as||order.customer_name||"")}</strong>${location?`<small>${location}</small>`:""}</div><div class="expanded-order-items">${items}</div>${notes}<strong class="expanded-order-total">${money(order.total)}</strong>`;
    $("orderExpandedDialog").showModal();
  }

  async function transitionOrder(id,status){if(status==="cancelled"&&!confirm("Recusar este pedido?"))return;if(status==="preparing"){const order=state.orders.find(entry=>String(entry.id)===String(id));if(order?.status==="received"){const confirmation=await db.rpc("transition_order",{target_order:id,next_status:"confirmed"});if(confirmation.error){toast(confirmation.error.message,true);return}}status="production"}const {data,error}=await db.rpc("transition_order",{target_order:id,next_status:status});if(error){toast(error.message,true);return}const updated=Array.isArray(data)?data[0]:data;state.orders=state.orders.map(order=>String(order.id)===String(id)?{...order,...(updated||{}),status:updated?.status||status}:order);renderOrders();await loadOrders()}

  async function loadCandidates(){state.candidates=(await query("whatsapp_order_candidates")).filter(c=>c.status==="pending").sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));renderCandidates()}
  function renderCandidates(){const homeBadge=$("candidateHomeBadge");homeBadge.textContent=state.candidates.length;homeBadge.hidden=!state.candidates.length;$("candidateList").innerHTML=state.candidates.map(c=>`<article class="candidate-card"><h3>Conversa ${escapeHtml(c.conversation_key)}</h3><div class="meta"><span class="pill">Confiança ${c.confidence==null?"—":Math.round(c.confidence*100)+"%"}</span><span>${new Date(c.created_at).toLocaleString("pt-BR")}</span></div><pre>${escapeHtml(JSON.stringify(c.interpreted_order,null,2))}</pre><div class="actions"><button class="button primary" data-candidate-confirm="${c.id}">Confirmar</button><button class="button" data-candidate-discard="${c.id}">Descartar</button></div></article>`).join("")||"<p>Nenhum candidato aguardando confirmação.</p>";renderOrders()}

  async function loadCatalog(){
    const packageComponentQuery=query("package_component","package_id,composition_id,sort_priority,free_allowance").catch(error=>{if(!/free_allowance|column/i.test(error.message||""))throw error;return query("package_component","package_id,composition_id,sort_priority")});
    const [items,categories,components,associations,packageComponents,itemComponentConfigs]=await Promise.all([
      query("items","id,name,description,price,stock,category_id,photo_url_1,photo_url_2,photo_url_3,sort_priority,stock_mode,is_active"),
      query("node_category","id,name,parent_id,display_mode,sort_priority"),
      query("composition","id,name,stock,price,is_active,max_quantity,tracks_stock"),
      query("item_composition_association","id,owner_id,composition_id,link_type,link_value,use_group_disjunction,group_disjunction_index"),
      packageComponentQuery,
      query("item_component_config","item_id,package_id,composition_id,default_quantity,free_allowance,max_quantity,consumption_per_unit,is_enabled")
    ]);
    try{state.itemPackages=await query("item_package","item_id,package_id,cart_pooling,sort_priority,shared_free_allowance")}
    catch(error){if(!/shared_free_allowance|column/i.test(error.message||""))throw error;state.itemPackages=(await query("item_package","item_id,package_id,cart_pooling,sort_priority")).map(row=>({...row,shared_free_allowance:0}));toast("Aplique a migration 20261010_10_component_group_modes_and_pooling.sql para configurar franquia compartilhada.",true)}
    try{state.packages=await query("ingredient_package","id,name,customer_name,kind,availability_rule,min_selections,max_selections,is_active,parent_id,sort_priority,franchise_mode,is_sellable,sellable_category_id")}
    catch(error){
      if(!/customer_name|availability_rule|parent_id|sort_priority|column/i.test(error.message||""))throw error;
      try{state.packages=(await query("ingredient_package","id,name,customer_name,kind,availability_rule,min_selections,max_selections,is_active,parent_id,sort_priority")).map((pack,index)=>({...pack,parent_id:pack.parent_id??null,sort_priority:pack.sort_priority??index}))}
      catch(legacyError){
        if(!/availability_rule|column/i.test(legacyError.message||""))throw legacyError;
        state.packages=(await query("ingredient_package","id,name,kind,min_selections,max_selections,is_active")).map((pack,index)=>({...pack,availability_rule:"optional_warn_only",parent_id:null,sort_priority:index}));
      }
      state.packages=state.packages.map(pack=>({...pack,customer_name:pack.customer_name||pack.name,franchise_mode:pack.franchise_mode||"none",is_sellable:pack.is_sellable===true,sellable_category_id:pack.sellable_category_id||null}));
      toast("Aplique as migrations de nomes e modos dos grupos para editar todas as opções.",true);
    }
    state.items=items;state.categories=categories;state.components=components;state.associations=associations;state.packageComponents=packageComponents;state.itemComponentConfigs=itemComponentConfigs;
    const sort=(a,b)=>(a.sort_priority||0)-(b.sort_priority||0)||a.name.localeCompare(b.name);state.items.sort(sort);state.categories.sort(sort);state.components.sort((a,b)=>a.name.localeCompare(b.name));state.packages.sort(sort);renderStock();renderItems();renderCategories();renderComponents();renderOrders();populateCategoryControls()
  }

  function categoryPath(id){const names=[],seen=new Set();let current=state.categories.find(c=>c.id===id);while(current&&!seen.has(current.id)){seen.add(current.id);names.unshift(current.name);current=state.categories.find(c=>c.id===current.parent_id)}return names.join(" › ")||"Sem categoria"}
  function categoryOptions(excludeId=""){return state.categories.filter(c=>c.id!==excludeId).map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(categoryPath(c.id))}</option>`).join("")}
  function populateCategoryControls(){const options=categoryOptions();$("itemCategoryFilter").innerHTML='<option value="all">Todas as categorias</option><option value="">Sem categoria</option>'+options;$("itemCategory").innerHTML='<option value="">Sem categoria</option>'+options}
  function childrenOf(parentId){return state.categories.filter(c=>(c.parent_id||null)===(parentId||null))}
  function itemsOf(categoryId){return state.items.filter(i=>(i.category_id||null)===(categoryId||null))}
  function itemMatches(item){const term=$("itemSearch").value.trim().toLocaleLowerCase(),filter=$("itemCategoryFilter").value;return(!term||`${item.name} ${item.description||""}`.toLocaleLowerCase().includes(term))&&(filter==="all"||(item.category_id||"")===filter)}
  function itemCard(item){const image=item.photo_url_1?`<img src="${escapeHtml(item.photo_url_1)}" alt="">`:'<div class="item-placeholder">AL</div>';const groupCount=state.itemPackages.filter(link=>link.item_id===item.id).length;return `<article class="menu-item-card ${item.is_active===false?"inactive":""}">${image}<div class="menu-item-copy"><div class="menu-item-title"><strong>${escapeHtml(item.name)}</strong><strong>${money(item.price)}</strong></div><p>${escapeHtml(item.description||"Sem descrição")}</p><div class="meta"><span class="pill">${item.stock_mode==="composition"?"Por composição":"Estoque direto"}</span><span>${groupCount} grupo(s)</span><span>${item.is_active===false?"Oculto":"Ativo"}</span></div></div><button class="button" data-item-edit="${item.id}">Editar</button></article>`}
  function categoryPackages(categoryId){return state.packages.filter(pack=>pack.is_sellable===true&&String(pack.sellable_category_id||"")===String(categoryId))}
  function categoryEditor(category,level=0){const items=itemsOf(category.id).filter(itemMatches),packages=categoryPackages(category.id),children=childrenOf(category.id);const visible=items.length||packages.length||children.some(c=>hasVisibleCategory(c));if(!visible&&($("itemSearch").value||$("itemCategoryFilter").value!=="all"))return"";const packageCards=packages.map(pack=>`<article class="menu-item-card"><div class="menu-item-copy"><div class="menu-item-title"><strong>${escapeHtml(pack.customer_name||pack.name)}</strong><span class="pill">Vitrine de componentes</span></div><small>${state.packageComponents.filter(link=>link.package_id===pack.id).map(link=>state.components.find(component=>String(component.id)===String(link.composition_id))?.name).filter(Boolean).map(escapeHtml).join(" · ")}</small></div><button class="button" data-package-edit="${escapeHtml(pack.id)}">Editar grupo</button></article>`).join("");return `<section class="menu-category" style="--depth:${level}"><header><div><span class="eyebrow">${escapeHtml(displayLabels[category.display_mode]||category.display_mode)}</span><h3>${escapeHtml(category.name)}</h3></div><div class="actions"><button class="button" data-category-add-item="${category.id}">+ Item</button><button class="button" data-category-add-child="${category.id}">+ Subcategoria</button><button class="button" data-category-edit="${category.id}">Editar categoria</button></div></header><div class="menu-items">${items.map(itemCard).join("")}${packageCards}</div>${children.map(c=>categoryEditor(c,level+1)).join("")}</section>`}
  function hasVisibleCategory(category){return itemsOf(category.id).some(itemMatches)||categoryPackages(category.id).length>0||childrenOf(category.id).some(hasVisibleCategory)}
  function renderItems(){const roots=childrenOf(null);const orphanItems=itemsOf(null).filter(itemMatches);$("itemList").innerHTML=(orphanItems.length?`<section class="menu-category"><header><h3>Sem categoria</h3></header><div class="menu-items">${orphanItems.map(itemCard).join("")}</div></section>`:"")+roots.map(c=>categoryEditor(c)).join("")||"<p>Nenhum item corresponde aos filtros.</p>"}

  function categoryTreeRows(parentId=null,level=0){return childrenOf(parentId).map(c=>`<article class="tree-row" style="--depth:${level}"><div><strong>${escapeHtml(c.name)}</strong><small>${escapeHtml(c.id)} · ${escapeHtml(displayLabels[c.display_mode]||c.display_mode)} · ${itemsOf(c.id).length} item(ns)</small></div><div class="actions"><button class="button" data-category-add-child="${c.id}">+ Subcategoria</button><button class="button" data-category-add-item="${c.id}">+ Item</button><button class="button" data-category-edit="${c.id}">Editar</button></div></article>${categoryTreeRows(c.id,level+1)}`).join("")}
  function renderCategories(){$("categoryTree").innerHTML=categoryTreeRows()||"<p>Nenhuma categoria cadastrada.</p>"}
  function componentRow(component){return `<article class="component-group-row"><div><strong>${escapeHtml(component.name)}</strong><small>${component.tracks_stock?`Saldo ${component.stock}`:"Sem controle de estoque"} · ${component.is_active===false?"Desativado":"Ativo"}</small></div><strong>${money(component.price)}</strong><button class="button" data-component-edit="${escapeHtml(component.id)}">Editar</button></article>`}
  function componentSummaryRow(component){return `<article class="component-group-row"><div><strong>${escapeHtml(component.name)}</strong><small>${component.tracks_stock?`Saldo ${component.stock}`:"Sem controle de estoque"} · ${component.is_active===false?"Desativado":"Ativo"}</small></div><strong>${money(component.price)}</strong></article>`}
  function packageMatches(pack,term){const own=pack.name.toLocaleLowerCase().includes(term),members=state.packageComponents.filter(row=>row.package_id===pack.id).some(row=>state.components.find(c=>String(c.id)===String(row.composition_id))?.name.toLocaleLowerCase().includes(term));return own||members}
  function packageSubtreeMatches(packId,term){return state.packages.filter(entry=>String(entry.parent_id||"")===String(packId)).some(child=>packageMatches(child,term)||packageSubtreeMatches(child.id,term))}
  function packageTreeRows(parentId=null,level=0,term=""){
    return state.packages.filter(pack=>(pack.parent_id||null)===(parentId||null)).filter(pack=>!term||packageMatches(pack,term)||packageSubtreeMatches(pack.id,term)).map(pack=>{
      const members=state.packageComponents.filter(row=>row.package_id===pack.id).sort((a,b)=>(a.sort_priority||0)-(b.sort_priority||0)).map(row=>state.components.find(component=>String(component.id)===String(row.composition_id))).filter(Boolean);
      const children=packageTreeRows(pack.id,level+1,term),products=state.itemPackages.filter(row=>row.package_id===pack.id).length;
      const visibleMembers=members.filter(component=>!term||component.name.toLocaleLowerCase().includes(term)||pack.name.toLocaleLowerCase().includes(term));
      return `<section class="component-group-node" style="--group-depth:${Math.min(level,5)}"><header class="component-group-heading"><div><span class="component-group-index">${Number(pack.sort_priority)||0}</span><strong>${escapeHtml(pack.name)}</strong><span class="pill">${escapeHtml(packageKindLabels[pack.kind]||pack.kind)}</span><span class="pill">${escapeHtml(packageAvailabilityLabels[pack.availability_rule]||"Regra não definida")}</span></div><div class="actions"><button class="button" data-package-manage="${escapeHtml(pack.id)}">Gerenciar este grupo</button><button class="button" data-package-edit="${escapeHtml(pack.id)}">Editar grupo</button><button class="button danger-button" data-package-delete="${escapeHtml(pack.id)}">Excluir grupo</button></div></header><div class="component-group-meta"><span>Público: ${escapeHtml(pack.customer_name||pack.name)}</span><span>${visibleMembers.length} componente(s)</span><span>${products} item(ns)</span><span>Franquia: ${escapeHtml(pack.franchise_mode||"none")}</span>${pack.is_sellable?`<span>Vitrine: ${escapeHtml(categoryPath(pack.sellable_category_id))}</span>`:""}${pack.is_active===false?"<span>Desativado</span>":""}</div><div class="component-group-members">${visibleMembers.map(componentSummaryRow).join("")||"<small>Sem componentes</small>"}</div>${children}</section>`;
    }).join("")
  }
  function renderComponents(){
    const term=$("componentSearch").value.trim().toLocaleLowerCase(),linked=new Set(state.packageComponents.map(row=>String(row.composition_id)));
    const groups=packageTreeRows(null,0,term),ungrouped=state.components.filter(component=>!linked.has(String(component.id))&&(!term||component.name.toLocaleLowerCase().includes(term))).map(componentRow).join("");
    $("componentList").innerHTML=`${groups}${ungrouped?`<section class="component-group-node ungrouped-components"><header class="component-group-heading"><div><strong>Sem grupo</strong></div><button class="button" data-component-edit="">Novo componente</button></header><div class="component-group-members">${ungrouped}</div></section>`:""}`||"<p>Nenhum grupo ou componente cadastrado.</p>";
  }
  function itemPackageRows(itemId=""){
    const links=state.itemPackages.filter(row=>row.item_id===itemId),attached=new Set(links.map(row=>row.package_id));
    const ordered=[],walk=(parentId=null,depth=0)=>state.packages.filter(pack=>(pack.parent_id||null)===(parentId||null)).forEach(pack=>{ordered.push({pack,depth});walk(pack.id,depth+1)});walk();
    return ordered.filter(({pack})=>pack.is_active!==false||attached.has(pack.id)).map(({pack,depth})=>{
      const quantityLimit=pack.kind==="adjustable"?2:["complementary","single_required","decay"].includes(pack.kind)?1:null;
      const members=state.packageComponents.filter(row=>row.package_id===pack.id).sort((a,b)=>(a.sort_priority||0)-(b.sort_priority||0));
      const configs=members.map(member=>{const component=state.components.find(c=>String(c.id)===String(member.composition_id));if(!component)return"";const config=state.itemComponentConfigs.find(c=>c.item_id===itemId&&c.package_id===pack.id&&String(c.composition_id)===String(component.id));const maxAllowed=quantityLimit??Number(component.max_quantity??4),configuredMax=Math.min(maxAllowed,Number(config?.max_quantity??component.max_quantity??4)),defaultQuantity=Math.min(configuredMax,Number(config?.default_quantity??0)),franchiseDefault=pack.franchise_mode==="per_component"?member.free_allowance:0,freeAllowance=Math.min(configuredMax,Number(config?.free_allowance??franchiseDefault??0));return `<div class="item-package-component" data-item-package-component="${escapeHtml(component.id)}"><label class="check-row"><input type="checkbox" data-config-enabled ${config?.is_enabled===false?"":"checked"}>${escapeHtml(component.name)}</label><label>Padrão<input type="number" min="0" ${Number.isFinite(maxAllowed)?`max="${maxAllowed}"`:""} step="1" data-config-value="default_quantity" value="${defaultQuantity}"></label><label>Grátis<input type="number" min="0" ${Number.isFinite(maxAllowed)?`max="${maxAllowed}"`:""} step="1" data-config-value="free_allowance" value="${freeAllowance}"></label><label>Limite<input type="number" min="0" ${Number.isFinite(maxAllowed)?`max="${maxAllowed}"`:""} step="1" data-config-value="max_quantity" value="${configuredMax}"></label><label>Consumo<input type="number" min="0" step="1" data-config-value="consumption_per_unit" value="${config?.consumption_per_unit??1}"></label></div>`}).join("");
      const existingLink=links.find(link=>String(link.package_id)===String(pack.id));
      return `<details class="item-package-card item-package-choice" style="--group-depth:${Math.min(depth,5)}" data-item-package-card="${escapeHtml(pack.id)}"><summary><label class="check-row"><input type="checkbox" data-item-package ${attached.has(pack.id)?"checked":""}>${escapeHtml(packagePath(pack.id))}</label><span class="pill">${escapeHtml(packageKindLabels[pack.kind]||pack.kind)}</span><label class="item-package-order">Ordem<input type="number" min="0" step="1" data-item-package-priority value="${existingLink?.sort_priority??pack.sort_priority??0}" aria-label="Ordem do grupo ${escapeHtml(pack.name)}"></label></summary>${pack.is_sellable?`<label>Franquia compartilhada gratuita por unidade deste item<input type="number" min="0" step="1" data-shared-allowance value="${Math.max(0,Number(existingLink?.shared_free_allowance||0))}"></label>`:""}<div class="item-package-components">${configs||"<small>Sem componentes.</small>"}</div></details>`
    }).join("")||"<p>Crie um grupo primeiro.</p>";
  }
  function packageParentOptions(pack){
    const descendants=new Set();const collect=id=>state.packages.filter(entry=>entry.parent_id===id&&!descendants.has(entry.id)).forEach(entry=>{descendants.add(entry.id);collect(entry.id)});if(pack)collect(pack.id);
    return '<option value="">Raiz</option>'+state.packages.filter(entry=>entry.id!==pack?.id&&!descendants.has(entry.id)).map(entry=>`<option value="${escapeHtml(entry.id)}">${escapeHtml(packagePath(entry.id))}</option>`).join("");
  }
  function packagePath(id){const path=[],seen=new Set();let current=state.packages.find(entry=>String(entry.id)===String(id));while(current&&!seen.has(current.id)){seen.add(current.id);path.unshift(current.name);current=state.packages.find(entry=>String(entry.id)===String(current.parent_id))}return path.join(" › ")}
  function openPackage(id="",parentId=""){const pack=state.packages.find(p=>p.id===id);$("packageForm").reset();$("packageId").value=pack?.id||"";$("packageDialogTitle").textContent=pack?`Editar grupo: ${pack.name}`:"Novo grupo";$("packageName").value=pack?.name||"";$("packageCustomerName").value=pack?.customer_name||pack?.name||"";$("packageKind").value=pack?.kind||"adjustable";$("packageFranchiseMode").value=pack?.franchise_mode||"none";$("packageSellable").checked=pack?.is_sellable===true;$("packageCategory").innerHTML='<option value="">Escolher categoria</option>'+categoryOptions();$("packageCategory").value=pack?.sellable_category_id||"";$("packageAvailabilityRule").value=pack?.availability_rule||"optional_warn_only";$("packageMin").value=pack?.min_selections??0;$("packageRequiresSelection").checked=Number(pack?.min_selections||0)>0;$("packageMax").value=pack?.max_selections??"";$("packageParent").innerHTML=packageParentOptions(pack);$("packageParent").value=pack?.parent_id||parentId||"";$("packagePriority").value=pack?.sort_priority??0;$("packageActive").checked=pack?.is_active!==false;$("deletePackage").hidden=!pack;$("packageDialog").showModal()}
  async function savePackage(event){
    event.preventDefault();
    const id=$("packageId").value,name=$("packageName").value.trim(),customerName=$("packageCustomerName").value.trim(),minSelections=Math.trunc(Number($("packageMin").value)||0),maxRaw=$("packageMax").value.trim(),maxSelections=maxRaw===""?null:Math.trunc(Number(maxRaw));
    if(!name||!customerName){toast("Preencha o nome interno e o nome que aparece no cardápio.",true);return}
    if(maxSelections!==null&&maxSelections<minSelections){toast("O máximo deve ser igual ou maior que o mínimo.",true);return}
    const priority=Math.trunc(Number($("packagePriority").value));if(!Number.isInteger(priority)||priority<0){toast("A prioridade deve ser um número inteiro não negativo.",true);return}
    const isSellable=$("packageSellable").checked,categoryId=$("packageCategory").value||null,franchiseMode=$("packageFranchiseMode").value;
    if(isSellable&&$("packageKind").value!=="scalable"){toast("Somente grupos escaláveis podem ser vendidos como escolha própria.",true);return}
    if(franchiseMode!=="none"&&$("packageKind").value!=="scalable"){toast("Franquia pode ser configurada apenas em grupos escaláveis.",true);return}
    if(isSellable&&!categoryId){toast("Escolha a categoria da vitrine do grupo vendável.",true);return}
    const kind=$("packageKind").value,isDecay=kind==="decay";
    const payload={name,customer_name:customerName,kind,franchise_mode:franchiseMode,is_sellable:isSellable,sellable_category_id:isSellable?categoryId:null,availability_rule:isSellable?"optional_warn_only":isDecay?"one_available_with_priority_fallback":$("packageAvailabilityRule").value,min_selections:isSellable?0:isDecay?1:minSelections,max_selections:isSellable?null:isDecay?1:maxSelections,is_active:$("packageActive").checked,parent_id:$("packageParent").value||null,sort_priority:priority};
    let packageId=id;
    if(id){const {error}=await db.from("ingredient_package").update(payload).eq("id",id);if(error){toast(/customer_name|column|franchise_mode|is_sellable|sellable_category_id/i.test(error.message||"")?"Aplique as migrations 20261010_09_component_group_customer_name.sql e 20261010_10_component_group_modes_and_pooling.sql antes de salvar os grupos.":error.message,true);return}}
    else{const {data,error}=await db.from("ingredient_package").insert(payload).select("id").single();if(error){toast(/customer_name|column|franchise_mode|is_sellable|sellable_category_id/i.test(error.message||"")?"Aplique as migrations 20261010_09_component_group_customer_name.sql e 20261010_10_component_group_modes_and_pooling.sql antes de salvar os grupos.":error.message,true);return}packageId=data.id}
    $("packageDialog").close();toast(id?"Grupo atualizado.":"Grupo criado.");await loadCatalog()
  }
  function openGroupComponents(packageId){
    const pack=state.packages.find(entry=>String(entry.id)===String(packageId));if(!pack)return;
    state.activePackageManagerId=String(pack.id);
    state.packageComponentDraft=new Map(state.packageComponents.filter(row=>String(row.package_id)===String(pack.id)).map(row=>[String(row.composition_id),Math.max(0,Math.trunc(Number(row.sort_priority)||0))]));
    $("groupComponentsPackageId").value=pack.id;$("groupComponentsTitle").textContent=`Gerenciar este grupo: ${pack.name}`;
    renderGroupComponentsManager();$("groupComponentsDialog").showModal()
  }
  function renderGroupComponentsManager(){
    const draft=state.packageComponentDraft,pack=state.packages.find(entry=>String(entry.id)===String(state.activePackageManagerId));
    const rows=[...draft.entries()].map(([componentId,priority])=>{
      const component=state.components.find(entry=>String(entry.id)===componentId);if(!component)return"";
      const link=state.packageComponents.find(row=>String(row.package_id)===String(state.activePackageManagerId)&&String(row.composition_id)===componentId);
      return `<article class="group-component-row" data-group-component-row data-component-id="${escapeHtml(componentId)}"><input aria-label="Nome" data-component-name value="${escapeHtml(component.name)}"><input aria-label="Preço" type="number" min="0" step="0.01" data-component-price value="${Number(component.price)||0}"><input aria-label="Franquia grátis" title="Franquia grátis" type="number" min="0" step="1" data-component-allowance value="${Math.max(0,Number(link?.free_allowance)||0)}" ${pack?.franchise_mode==="per_component"?"":"disabled"}><input aria-label="Limite de adição" type="number" min="0" step="1" data-component-max value="${Math.max(0,Number(component.max_quantity)||0)}"><input aria-label="Prioridade" type="number" min="0" step="1" data-group-component-priority value="${priority}"><button type="button" class="button danger-button" data-group-component-remove="${escapeHtml(componentId)}" aria-label="Remover do grupo">×</button></article>`;
    }).join("");
    $("groupComponentsList").innerHTML=rows;
  }
  function addGroupComponent(){
    const pack=state.packages.find(entry=>String(entry.id)===String(state.activePackageManagerId));
    const row=document.createElement("article");row.className="group-component-row";row.dataset.groupComponentRow="";row.innerHTML=`<input aria-label="Nome" data-component-name placeholder="Nome do componente"><input aria-label="Preço" type="number" min="0" step="0.01" data-component-price value="0"><input aria-label="Franquia grátis" title="Franquia grátis" type="number" min="0" step="1" data-component-allowance value="0" ${pack?.franchise_mode==="per_component"?"":"disabled"}><input aria-label="Limite de adição" type="number" min="0" step="1" data-component-max value="4"><input aria-label="Prioridade" type="number" min="0" step="1" data-group-component-priority value="${Math.max(-1,...state.packageComponentDraft.values())+1}"><button type="button" class="button danger-button" data-new-row-remove aria-label="Remover linha">×</button>`;
    $("groupComponentsList").append(row);row.querySelector("[data-component-name]").focus()
  }
  async function saveGroupComponents(event){
    event.preventDefault();
    const packageId=$("groupComponentsPackageId").value,pack=state.packages.find(entry=>String(entry.id)===String(packageId));if(!pack)return;
    if(pack.franchise_mode==="per_component"){const {error}=await db.from("package_component").select("free_allowance").limit(1);if(error){toast("Aplique a migration 20261010_12_package_component_defaults.sql antes de configurar franquia por componente.",true);return}}
    const enteredPrices=[...$("groupComponentsList").querySelectorAll("[data-component-price]")].map(input=>Number(input.value));if(pack.franchise_mode==="shared"&&enteredPrices.some(price=>!Number.isFinite(price)||price!==enteredPrices[0])){toast("Franquia compartilhada exige o mesmo preço em todos os componentes do grupo.",true);return}
    const rows=[],seenNames=new Set();
    for(const row of $("groupComponentsList").querySelectorAll("[data-group-component-row]")){
      const name=row.querySelector("[data-component-name]").value.trim(),price=Number(row.querySelector("[data-component-price]").value),max_quantity=Math.trunc(Number(row.querySelector("[data-component-max]").value)),free_allowance=Math.trunc(Number(row.querySelector("[data-component-allowance]").value)||0),sort_priority=Math.trunc(Number(row.querySelector("[data-group-component-priority]").value));
      if(!name||!Number.isFinite(price)||price<0||![max_quantity,free_allowance,sort_priority].every(Number.isInteger)||max_quantity<0||free_allowance<0||sort_priority<0){toast("Preencha cada linha com nome, preço e quantidades inteiras não negativas.",true);return}
      const normalizedName=name.toLocaleLowerCase();if(seenNames.has(normalizedName)){toast("Cada componente deve aparecer uma única vez neste grupo.",true);return}seenNames.add(normalizedName);
      let composition_id=row.dataset.componentId;
      if(composition_id){const {error}=await db.from("composition").update({name,price,max_quantity}).eq("id",composition_id);if(error){toast(error.message,true);return}}
      else{const match=state.components.find(component=>component.name.trim().toLocaleLowerCase()===name.toLocaleLowerCase());if(match){composition_id=String(match.id);const {error}=await db.from("composition").update({name,price,max_quantity}).eq("id",composition_id);if(error){toast(error.message,true);return}}else{const {data,error}=await db.from("composition").insert({name,price,max_quantity,stock:0,tracks_stock:true,is_active:true}).select("id").single();if(error){toast(error.message,true);return}composition_id=String(data.id)}}
      rows.push({package_id:packageId,composition_id,sort_priority,...(pack.franchise_mode==="per_component"?{free_allowance}:{})});
    }
    if(pack.kind==="decay"&&!rows.length){toast("Decaimento precisa de ao menos uma opção ordenada no grupo.",true);return}
    const selected=new Set(rows.map(row=>String(row.composition_id)));
    const existing=state.packageComponents.filter(row=>String(row.package_id)===String(packageId)),remove=existing.filter(row=>!selected.has(String(row.composition_id)));
    for(const row of remove){const {error}=await db.from("package_component").delete().eq("package_id",packageId).eq("composition_id",row.composition_id);if(error){toast(`Grupo mantido, mas não foi possível remover um componente: ${error.message}`,true);await loadCatalog();return}}
    if(rows.length){const {error}=await db.from("package_component").upsert(rows,{onConflict:"package_id,composition_id"});if(error){toast(/free_allowance|column/i.test(error.message||"")?"Aplique a migration 20261010_12_package_component_defaults.sql para salvar a franquia padrão do grupo.":`Não foi possível salvar os componentes do grupo: ${error.message}`,true);await loadCatalog();return}}
    $("groupComponentsDialog").close();state.activePackageManagerId=null;toast("Componentes do grupo atualizados.");await loadCatalog()
  }
  async function deletePackage(id=$("packageId").value){
    if(!id)return;
    const pack=state.packages.find(entry=>String(entry.id)===String(id));if(!pack)return;
    const itemCount=state.itemPackages.filter(row=>String(row.package_id)===String(id)).length;
    const childCount=state.packages.filter(row=>String(row.parent_id||"")===String(id)).length;
    const confirmation=prompt(`Excluir o grupo “${pack.name}”${itemCount?`? Ele está associado a ${itemCount} item(ns), e essas associações também serão removidas`:"?"}${childCount?`; ${childCount} grupo(s) filho(s) permanecerão como grupos raiz`:""}. Os itens e categorias serão mantidos. Digite SIM para confirmar.`);
    if(confirmation?.trim().toLocaleLowerCase()!=="sim")return;
    const {error}=await db.from("ingredient_package").delete().eq("id",id);if(error){toast(error.message,true);return}
    $("packageDialog").close();toast(`Grupo “${pack.name}” excluído.`);await loadCatalog()
  }

  function inventoryKey(kind,id){return `${kind}:${id}`}
  function inventoryBase(x){const hidden=x.kind==="composition"?x.is_active===false:Number(x.stock||0)<0,stock=Math.max(0,Number(x.stock||0));return{kind:x.kind,id:String(x.id),hidden,finished:!hidden&&stock===0,stock}}
  function inventoryValue(x){return state.inventoryDrafts.get(inventoryKey(x.kind,x.id))||inventoryBase(x)}
  function inventoryState(x){const value=inventoryValue(x);return value.hidden?"hidden":value.finished?"finished":"visible"}
  function stockRows(){const term=$("stockSearch").value.trim().toLocaleLowerCase(),kind=document.querySelector("[data-stock-kind].active")?.dataset.stockKind||"all",status=$("stockState").value;return[...state.items.map(x=>({...x,kind:"item"})),...state.components.map(x=>({...x,kind:"composition"}))].filter(x=>(kind==="all"||x.kind===kind)&&(status==="all"||inventoryState(x)===status)&&`${x.name} ${x.id}`.toLocaleLowerCase().includes(term))}
  function inventoryGroupName(x){return x.kind==="composition"?"Componentes":categoryPath(x.category_id)}
  function inventoryRow(x){const value=inventoryValue(x),changed=state.inventoryDrafts.has(inventoryKey(x.kind,x.id)),photo=x.kind==="item"&&x.photo_url_1?`<img class="inventory-photo" src="${escapeHtml(x.photo_url_1)}" alt="">`:'<div class="inventory-photo item-placeholder">AL</div>';return `<article class="inventory-row ${value.hidden?"is-hidden":""} ${changed?"is-changed":""}" data-inventory-kind="${x.kind}" data-inventory-id="${escapeHtml(x.id)}">${photo}<div class="inventory-name"><strong>${escapeHtml(x.name)}</strong><small>${escapeHtml(x.id)} · ${x.kind==="item"?(x.stock_mode==="composition"?"item por composição":"item direto"):"componente"}</small></div><label class="switch inventory-hidden"><input class="inventory-hidden-input" type="checkbox" ${value.hidden?"checked":""}><span class="switch-track"></span><span class="switch-text">${value.hidden?"Oculto":"Visível"}</span></label><label class="switch inventory-finished"><input class="inventory-finished-input" type="checkbox" ${value.finished?"checked":""}><span class="switch-track"></span><span class="switch-text">${value.finished?"Finalizado":"Disponível"}</span></label><div class="stock-steps"><button type="button" data-stock-delta="-10">-10</button><button type="button" data-stock-delta="-1">−</button><input class="inventory-stock-input" type="number" min="0" step="1" value="${value.stock}" aria-label="Estoque de ${escapeHtml(x.name)}"><button type="button" data-stock-delta="1">+</button><button type="button" data-stock-delta="10">+10</button></div></article>`}
  function updateInventorySaveButton(){const count=state.inventoryDrafts.size;$("inventoryChangeCount").textContent=`(${count})`;$("saveInventory").disabled=count===0}
  function renderStock(){const all=[...state.items.map(x=>({...x,kind:"item"})),...state.components.map(x=>({...x,kind:"composition"}))],rows=stockRows(),groups=new Map;for(const x of rows){const group=inventoryGroupName(x);if(!groups.has(group))groups.set(group,[]);groups.get(group).push(x)}$("stockTotal").textContent=`Itens: ${all.length}`;$("stockVisible").textContent=`Visíveis: ${all.filter(x=>inventoryState(x)==="visible").length}`;$("stockFinished").textContent=`Finalizados: ${all.filter(x=>inventoryState(x)==="finished").length}`;$("stockHidden").textContent=`Ocultos: ${all.filter(x=>inventoryState(x)==="hidden").length}`;$("stockList").innerHTML=[...groups].map(([name,entries])=>`<section class="inventory-group"><h3>${escapeHtml(name)} (${entries.length})</h3>${entries.map(inventoryRow).join("")}</section>`).join("")||'<section class="inventory-group"><h3>Nenhum registro encontrado.</h3></section>';updateInventorySaveButton()}
  function markInventoryChanged(row){const kind=row.dataset.inventoryKind,id=row.dataset.inventoryId,entry=(kind==="item"?state.items:state.components).find(x=>String(x.id)===id),base=inventoryBase({...entry,kind}),draft={kind,id,hidden:row.querySelector(".inventory-hidden-input").checked,finished:row.querySelector(".inventory-finished-input").checked,stock:Math.max(0,Math.trunc(Number(row.querySelector(".inventory-stock-input").value)||0))},changed=draft.hidden!==base.hidden||draft.finished!==base.finished||draft.stock!==base.stock,key=inventoryKey(kind,id);if(changed)state.inventoryDrafts.set(key,draft);else state.inventoryDrafts.delete(key);row.classList.toggle("is-hidden",draft.hidden);row.classList.toggle("is-changed",changed);row.querySelector(".inventory-hidden .switch-text").textContent=draft.hidden?"Oculto":"Visível";row.querySelector(".inventory-finished .switch-text").textContent=draft.finished?"Finalizado":"Disponível";updateInventorySaveButton()}
  async function saveInventoryChanges(){const button=$("saveInventory"),drafts=[...state.inventoryDrafts.entries()];if(!drafts.length)return;button.disabled=true;button.textContent="Salvando...";let failed=0;for(const [key,draft] of drafts){let stock=draft.finished?0:draft.stock;if(draft.kind==="item"&&draft.hidden)stock=-1;const table=draft.kind==="item"?"items":"composition",payload=draft.kind==="item"?{stock}:{stock,is_active:!draft.hidden};const {error}=await db.from(table).update(payload).eq("id",draft.id);if(error)failed+=1;else state.inventoryDrafts.delete(key)}button.innerHTML='Salvar alterações <span id="inventoryChangeCount"></span>';if(failed)toast(`${failed} alteração(ões) não foram salvas.`,true);else toast(`${drafts.length} alteração(ões) salvas.`);await loadCatalog()}
  function openStock(kind,id){const entry=(kind==="item"?state.items:state.components).find(x=>String(x.id)===id);if(!entry)return;$("stockTargetKind").value=kind;$("stockTargetId").value=id;$("stockDialogTitle").textContent=entry.name;$("stockAmount").value="";$("stockReason").value="";$("stockPreview").dataset.current=entry.stock;updatePreview();$("stockDialog").showModal()}
  function updatePreview(){const current=Number($("stockPreview").dataset.current||0),amount=Number($("stockAmount").value||0);const result=$("stockOperation").value==="set"?amount:current-amount;$("stockPreview").textContent=`Saldo atual: ${current} → novo saldo: ${result}`;$("confirmStock").disabled=result<0||!Number.isInteger(amount)}
  async function saveStock(event){event.preventDefault();const payload={target_kind:$("stockTargetKind").value,target_id:$("stockTargetId").value,operation:$("stockOperation").value,amount:Number($("stockAmount").value),reason:$("stockReason").value||null};const {error}=await db.rpc("adjust_inventory",payload);if(error){toast(error.message,true);return}$("stockDialog").close();toast("Estoque atualizado.");await loadCatalog()}

  function openItem(id="",categoryId=""){
    const item=state.items.find(x=>x.id===id);
    $("itemForm").reset();$("itemId").value=item?.id||"";$("itemDialogTitle").textContent=item?`Editar ${item.name}`:"Novo item";
    $("itemName").value=item?.name||"";$("itemDescription").value=item?.description||"";$("itemPrice").value=item?.price??0;$("itemPriority").value=item?.sort_priority??0;
    $("itemCategory").innerHTML='<option value="">Sem categoria</option>'+categoryOptions();$("itemCategory").value=item?.category_id||categoryId||"";
    $("itemStockMode").value=item?.stock_mode||"direct";$("itemActive").checked=item?.is_active!==false;
    $("itemPhoto1").value=item?.photo_url_1||"";$("itemPhoto2").value=item?.photo_url_2||"";$("itemPhoto3").value=item?.photo_url_3||"";
    $("deleteItem").hidden=!item;$("itemPackageList").innerHTML=itemPackageRows(item?.id||"");$("itemDialog").showModal()
  }
  function collectItemPackageConfigs(){
    const linked=[],configs=[];
    for(const card of $("itemPackageList").querySelectorAll("[data-item-package-card]")){
      const packageId=card.dataset.itemPackageCard;
      if(!card.querySelector("[data-item-package]").checked)continue;
      const pack=state.packages.find(entry=>String(entry.id)===String(packageId));
      const quantityLimit=pack?.kind==="adjustable"?2:["complementary","single_required","decay"].includes(pack?.kind)?1:null;
      const priorityInput=card.querySelector("[data-item-package-priority]"),priority=Math.trunc(Number(priorityInput?.value));
      if(!Number.isInteger(priority)||priority<0)throw new Error("A ordem dos grupos deve ser um número inteiro não negativo.");
      const sharedAllowance=Math.trunc(Number(card.querySelector("[data-shared-allowance]")?.value||0));
      if(!Number.isInteger(sharedAllowance)||sharedAllowance<0)throw new Error("A franquia compartilhada deve ser um inteiro não negativo.");
      linked.push({package_id:packageId,sort_priority:priority,shared_free_allowance:sharedAllowance});
      const packageConfigs=[];
      for(const row of card.querySelectorAll("[data-item-package-component]")){
        const compositionId=row.dataset.itemPackageComponent,values={};
        for(const input of row.querySelectorAll("[data-config-value]")){
          const key=input.dataset.configValue,value=Number(input.value);
          if(!Number.isInteger(value)||value<0||(Number.isFinite(quantityLimit)&&value>quantityLimit))throw new Error(Number.isFinite(quantityLimit)?`Neste grupo, cada componente aceita de 0 a ${quantityLimit}.`:"As quantidades dos componentes devem ser números inteiros não negativos.");
          values[key]=value;
        }
        const max=values.max_quantity;
        if(values.default_quantity>max||values.free_allowance>max)throw new Error("O padrão e a franquia grátis não podem exceder o limite do componente.");
        const config={package_id:packageId,composition_id:compositionId,is_enabled:row.querySelector("[data-config-enabled]").checked,...values};
        if(!config.is_enabled&&config.default_quantity>0)throw new Error("Um componente desativado não pode continuar com quantidade padrão. Zere o padrão ou reative-o.");
        packageConfigs.push(config);configs.push(config);
      }
      const activeDefaults=packageConfigs.filter(config=>config.is_enabled&&config.default_quantity>0);
      if(pack?.availability_rule==="one_available_with_priority_fallback"&&(activeDefaults.length!==1||activeDefaults[0].default_quantity!==1)){
        throw new Error(`O grupo “${pack.name}” precisa ter exatamente uma opção padrão, na quantidade 1.`);
      }
      if(["single_required","decay"].includes(pack?.kind)&&(activeDefaults.length!==1||activeDefaults[0].default_quantity!==1)){
        throw new Error(`O grupo “${pack.name}” precisa ter exatamente uma escolha padrão.`);
      }
    }
    return{linked,configs}
  }
  async function syncItemPackages(itemId){
    const {linked,configs}=collectItemPackageConfigs(),existing=state.itemPackages.filter(row=>row.item_id===itemId),linkedSet=new Set(linked.map(row=>row.package_id));
    for(const row of existing){
      if(linkedSet.has(row.package_id))continue;
      const {error}=await db.from("item_component_config").delete().eq("item_id",itemId).eq("package_id",row.package_id);
      if(error)throw error;
      const unlink=await db.from("item_package").delete().eq("item_id",itemId).eq("package_id",row.package_id);
      if(unlink.error)throw unlink.error;
    }
    if(linked.length){const {error}=await db.from("item_package").upsert(linked.map(link=>({item_id:itemId,package_id:link.package_id,cart_pooling:false,sort_priority:link.sort_priority,shared_free_allowance:link.shared_free_allowance})),{onConflict:"item_id,package_id"});if(error)throw error}
    if(configs.length){
      const {error}=await db.from("item_component_config").upsert(configs.map(config=>({item_id:itemId,...config})),{onConflict:"item_id,package_id,composition_id"});
      if(error)throw error;
    }
  }
  async function uploadItemPhotos(itemId){
    const uploaded={};
    for(let slot=1;slot<=3;slot++){
      const input=$("itemPhotoFile"+slot),file=input.files?.[0];if(!file)continue;
      if(!file.type.startsWith("image/"))throw new Error(`O arquivo do slot ${slot} não é uma imagem.`);
      const extension=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg",path=`items/${itemId}/photo_${slot}.${extension}`;
      const {error}=await db.storage.from("item-photos").upload(path,file,{upsert:true,contentType:file.type,cacheControl:"3600"});if(error)throw error;
      uploaded[`photo_url_${slot}`]=db.storage.from("item-photos").getPublicUrl(path).data.publicUrl;
    }
    if(Object.keys(uploaded).length){const {error}=await db.from("items").update(uploaded).eq("id",itemId);if(error)throw error}
  }
  async function saveItem(event){
    event.preventDefault();
    const id=$("itemId").value,payload={name:$("itemName").value.trim(),description:$("itemDescription").value.trim()||null,price:Number($("itemPrice").value),sort_priority:Number($("itemPriority").value),category_id:$("itemCategory").value||null,stock_mode:$("itemStockMode").value,is_active:$("itemActive").checked,photo_url_1:$("itemPhoto1").value||null,photo_url_2:$("itemPhoto2").value||null,photo_url_3:$("itemPhoto3").value||null};
    let itemId=id,packageState;
    try{packageState=collectItemPackageConfigs()}catch(error){toast(error.message,true);return}
    const requiredGroup=packageState.linked.some(link=>{
      const pack=state.packages.find(entry=>String(entry.id)===String(link.package_id));
      return ["all_positive_defaults_required","one_available_with_priority_fallback"].includes(pack?.availability_rule)
        &&packageState.configs.some(config=>String(config.package_id)===String(link.package_id)&&config.is_enabled&&config.default_quantity>0);
    });
    if(payload.stock_mode==="composition"&&!requiredGroup){toast("Vincule um grupo com composição padrão obrigatória a este item.",true);return}
    if(id){const {error}=await db.from("items").update(payload).eq("id",id);if(error){toast(error.message,true);return}}
    else{itemId=`${slug(payload.name)}-${crypto.randomUUID().slice(0,4)}`;const {error}=await db.from("items").insert({...payload,id:itemId,stock:0});if(error){toast(error.message,true);return}}
    try{await uploadItemPhotos(itemId);await syncItemPackages(itemId)}
    catch(error){toast(`Item salvo, mas uma imagem ou grupo falhou: ${error.message}`,true);return}
    $("itemDialog").close();toast(id?"Item atualizado.":"Item criado.");await loadCatalog()
  }
  async function deleteItem(){
    const id=$("itemId").value;if(!id||!confirm("Excluir definitivamente este item?"))return;
    const {error}=await db.from("items").delete().eq("id",id);if(error){toast(error.message,true);return}
    $("itemDialog").close();toast("Item excluído.");await loadCatalog()
  }

  function openCategory(id="",parentId=""){const category=state.categories.find(c=>c.id===id);$("categoryForm").reset();$("categoryId").value=category?.id||"";$("categoryDialogTitle").textContent=category?`Editar ${category.name}`:"Nova categoria";$("categoryName").value=category?.name||"";$("categoryParent").innerHTML='<option value="">Raiz</option>'+categoryOptions(category?.id||"");$("categoryParent").value=category?.parent_id||parentId||"";$("categoryDisplay").value=category?.display_mode||"lista";$("categoryPriority").value=category?.sort_priority??0;$("deleteCategory").hidden=!category;$("categoryDialog").showModal()}
  function uniqueCategoryId(name){const base=slug(name);let candidate=base,index=2;while(state.categories.some(c=>c.id===candidate))candidate=`${base}-${index++}`;return candidate}
  async function saveCategory(event){event.preventDefault();const id=$("categoryId").value,payload={name:$("categoryName").value.trim(),parent_id:$("categoryParent").value||null,display_mode:$("categoryDisplay").value,sort_priority:Number($("categoryPriority").value)};const request=id?db.from("node_category").update(payload).eq("id",id):db.from("node_category").insert({...payload,id:uniqueCategoryId(payload.name)});const {error}=await request;if(error){toast(error.message,true);return}$("categoryDialog").close();toast(id?"Categoria atualizada.":"Categoria criada.");await loadCatalog()}
  async function deleteCategory(){const id=$("categoryId").value;if(!id||!confirm("Excluir esta categoria? A operação falhará se ela possuir itens ou subcategorias."))return;const {error}=await db.from("node_category").delete().eq("id",id);if(error){toast(error.message,true);return}$("categoryDialog").close();toast("Categoria excluída.");await loadCatalog()}

  function openComponent(id="",managedMode=false){const c=state.components.find(x=>x.id===id);state.componentManagedMode=managedMode;state.componentReturnToGroupId=managedMode&&!c?state.activePackageManagerId:null;$("componentForm").reset();$("componentId").value=c?.id||"";$("componentDialogTitle").textContent=c?`Editar ${c.name}`:"Novo componente";$("componentName").value=c?.name||"";$("componentPrice").value=c?.price??0;$("componentMax").value=c?.max_quantity??4;$("componentTracks").checked=c?.tracks_stock!==false;$("componentActive").checked=c?.is_active!==false;$("deleteComponent").hidden=!c||managedMode;$("componentDialog").showModal()}
  async function saveComponent(event){event.preventDefault();const id=$("componentId").value,payload={name:$("componentName").value.trim(),price:Number($("componentPrice").value),max_quantity:Number($("componentMax").value),tracks_stock:$("componentTracks").checked,is_active:$("componentActive").checked};let componentId=id;let request;if(id)request=await db.from("composition").update(payload).eq("id",id);else{const result=await db.from("composition").insert({...payload,stock:0}).select("id").single();request=result;componentId=result.data?.id}if(request.error){toast(request.error.message,true);return}$("componentDialog").close();toast(id?"Componente atualizado.":"Componente criado.");await loadCatalog();if(state.componentReturnToGroupId&&componentId){const priority=Math.max(-1,...state.packageComponentDraft.values())+1;state.packageComponentDraft.set(String(componentId),priority)}state.componentReturnToGroupId=null;state.componentManagedMode=false;if(state.activePackageManagerId&&$("groupComponentsDialog").open)renderGroupComponentsManager()}
  async function deleteComponent(){const id=$("componentId").value;if(!id||!confirm("Excluir definitivamente este componente?"))return;const {error}=await db.from("composition").delete().eq("id",id);if(error){toast(error.message,true);return}$("componentDialog").close();toast("Componente excluído.");await loadCatalog()}

  async function loadAdmins(){try{const {data,error}=await db.rpc("list_admins");if(error)throw error;$("adminList").innerHTML=(data||[]).map(a=>`<article class="data-row"><div><strong>${escapeHtml(a.full_name||a.email||a.user_id)}</strong><br><small>${escapeHtml(a.email||a.user_id)}</small></div><span>${new Date(a.granted_at).toLocaleDateString("pt-BR")}</span><span></span><span></span>${a.user_id!==state.session?.user.id?`<button class="button" data-admin-remove="${a.user_id}">Remover</button>`:"<span>Você</span>"}</article>`).join("")}catch(error){$("adminList").innerHTML=`<p>${escapeHtml(error.message)}</p>`}}
  async function loadCustomers(){try{const {data,error}=await db.rpc("list_customer_profiles");if(error)throw error;$("customerList").innerHTML=(data||[]).map(c=>`<article class="data-row"><div><strong>${escapeHtml(c.known_as||c.full_name||c.email||c.user_id)}</strong><br><small>${escapeHtml(c.email||c.user_id)}${c.phone?` · ${escapeHtml(c.phone)}`:""}</small></div><span>${new Date(c.created_at).toLocaleDateString("pt-BR")}</span><span></span><span></span><button class="button danger-button" data-customer-remove="${escapeHtml(c.user_id)}">Apagar cadastro</button></article>`).join("")||"<p>Nenhum cadastro.</p>"}catch(error){$("customerList").innerHTML=`<p>${escapeHtml(error.message)}</p>`}}
  function switchOrderTab(tab){if(![-1,0,1,2].includes(tab))return;state.orderTab=tab;localStorage.setItem("aldoAdminOrdersTab",String(tab));renderOrders();$("ordersBoard").scrollTop=0}
  function switchView(view){if(!viewNames.includes(view))view="home";state.view=view;localStorage.setItem("aldoAdminViewV2",view);if(location.hash!==`#${view}`)location.hash=view;document.querySelectorAll(".view").forEach(x=>x.classList.toggle("active",x.id===view+"View"));document.querySelectorAll("#nav button").forEach(x=>x.classList.toggle("active",x.dataset.view===view));$("viewTitle").textContent=titles[view];$("refresh").hidden=view==="home";$("appView").classList.toggle("orders-mode",view==="orders");$("appView").classList.toggle("home-mode",view==="home");if(orderRefreshTimer){clearInterval(orderRefreshTimer);orderRefreshTimer=null}if(view==="orders")orderRefreshTimer=setInterval(()=>{if(!document.hidden&&state.view==="orders")loadOrders().catch(error=>toast(error.message,true))},10000)}
  async function candidate(id,action){const fn=action==="confirm"?"confirm_whatsapp_candidate":"discard_whatsapp_candidate";const {error}=await db.rpc(fn,{candidate_id:id});if(error)toast(error.message,true);else{toast(action==="confirm"?"Pedido confirmado.":"Candidato descartado.");await Promise.all([loadCandidates(),loadOrders(),loadCatalog()])}}
  async function addAdmin(event){event.preventDefault();const {error}=await db.rpc("grant_admin_by_email",{target_email:$("adminEmail").value.trim()});if(error)toast(error.message,true);else{toast("Administrador adicionado.");event.target.reset();await loadAdmins()}}
  async function removeAdmin(id){const {error}=await db.from("admin_users").delete().eq("user_id",id);if(error)toast(error.message,true);else{toast("Acesso removido.");await loadAdmins()}}
  async function removeCustomerProfile(id){if(!confirm("Apagar os dados de cadastro deste cliente? A conta Google e o histórico de pedidos serão mantidos; no próximo pedido, o cadastro deverá ser preenchido novamente."))return;const {error}=await db.rpc("delete_customer_profile",{target_user:id});if(error)toast(error.message,true);else{toast("Cadastro apagado.");await loadCustomers()}}
  function subscribe(){if(state.liveChannels.length)return;state.liveChannels=[db.channel("admin-orders-live").on("postgres_changes",{event:"*",schema:"public",table:"orders"},loadOrders).subscribe(),db.channel("admin-candidates-live").on("postgres_changes",{event:"*",schema:"public",table:"whatsapp_order_candidates"},loadCandidates).subscribe()]}

  window.addEventListener("hashchange",()=>{const route=location.hash.slice(1);switchView(viewNames.includes(route)?route:"home")});
  $("nav").addEventListener("click",e=>{const button=e.target.closest("[data-view]");if(button){switchView(button.dataset.view);document.querySelector(".view-menu").open=false}});
  $("homeView").addEventListener("click",e=>{const tile=e.target.closest("[data-view]");if(tile)switchView(tile.dataset.view)});
  document.addEventListener("click",e=>{const home=e.target.closest(".home-return");if(home)switchView("home")});
  $("ordersRefresh").addEventListener("click",refreshAll);
  $("ordersTabs").addEventListener("click",e=>{const tab=e.target.closest("[data-order-tab]");if(tab)switchOrderTab(Number(tab.dataset.orderTab))});
  $("orderSettingsOpen").addEventListener("click",()=>$("orderSettingsDialog").showModal());
  $("orderSettingsCancel").addEventListener("click",()=>$("orderSettingsDialog").close());
  $("orderSettingsForm").addEventListener("submit",saveOrderSettings);
  document.addEventListener("keydown",e=>{
    if(state.view!=="orders"||$("orderExpandedDialog").open||$("orderSettingsDialog").open)return;
    if(["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName))return;
    if(e.key==="ArrowLeft"||e.key==="ArrowRight"){
      e.preventDefault();const tabs=[-1,0,1,2],index=tabs.indexOf(state.orderTab);switchOrderTab(tabs[Math.max(0,Math.min(tabs.length-1,index+(e.key==="ArrowRight"?1:-1)))]);
    }else if(e.key==="ArrowDown"||e.key==="ArrowUp"){
      e.preventDefault();$("ordersBoard").scrollBy({top:Math.max(100,$("ordersBoard").clientHeight*.72)*(e.key==="ArrowDown"?1:-1),behavior:"smooth"});
    }
  });
  const handleOrderAction=e=>{const viewButton=e.target.closest("[data-order-view]");if(viewButton){openOrderDetails(viewButton.dataset.orderView);return}const button=e.target.closest("[data-order]");if(button&&!button.disabled)transitionOrder(button.dataset.order,button.dataset.status)};
  $("ordersBoard").addEventListener("click",handleOrderAction);
  $("deliveryOrders").addEventListener("click",handleOrderAction);
  $("orderExpandedDialog").querySelector(".order-expanded-close").addEventListener("click",()=>$("orderExpandedDialog").close());
  $("stockState").addEventListener("change",renderStock);
  $("stockView").querySelector(".inventory-tabs").addEventListener("click",e=>{const tab=e.target.closest("[data-stock-kind]");if(!tab)return;$("stockKind").value=tab.dataset.stockKind;document.querySelectorAll("[data-stock-kind]").forEach(button=>{const active=button===tab;button.classList.toggle("active",active);button.setAttribute("aria-selected",String(active))});renderStock()});
  $("stockList").addEventListener("change",e=>{const row=e.target.closest(".inventory-row");if(!row)return;const hidden=row.querySelector(".inventory-hidden-input"),finished=row.querySelector(".inventory-finished-input"),stock=row.querySelector(".inventory-stock-input");if(e.target===hidden&&hidden.checked)finished.checked=false;if(e.target===finished&&finished.checked)hidden.checked=false;if((e.target===hidden||e.target===finished)&&!hidden.checked&&!finished.checked&&Number(stock.value)===0)stock.value="1";markInventoryChanged(row)});
  $("stockList").addEventListener("click",e=>{const row=e.target.closest(".inventory-row");if(!row)return;const delta=e.target.closest("[data-stock-delta]");if(delta){const input=row.querySelector(".inventory-stock-input");input.value=String(Math.max(0,Math.trunc(Number(input.value)||0)+Number(delta.dataset.stockDelta)));row.querySelector(".inventory-hidden-input").checked=false;row.querySelector(".inventory-finished-input").checked=Number(input.value)===0;markInventoryChanged(row)}});
  $("saveInventory").addEventListener("click",saveInventoryChanges);
  $("googleLogin").addEventListener("click",login);$("logout").addEventListener("click",logout);$("deniedLogout").addEventListener("click",logout);$("refresh").addEventListener("click",refreshAll);$("nav").addEventListener("click",e=>e.target.closest("button")?.dataset.view&&switchView(e.target.closest("button").dataset.view));$("stockSearch").addEventListener("input",renderStock);$("stockKind").addEventListener("change",renderStock);$("stockAmount").addEventListener("input",updatePreview);$("stockOperation").addEventListener("change",updatePreview);$("stockForm").addEventListener("submit",saveStock);$("cancelStock").addEventListener("click",()=>$("stockDialog").close());$("itemSearch").addEventListener("input",renderItems);$("itemCategoryFilter").addEventListener("change",renderItems);$("componentSearch").addEventListener("input",renderComponents);$("newItem").addEventListener("click",()=>openItem());$("newCategory").addEventListener("click",()=>openCategory());$("newComponent").addEventListener("click",()=>openComponent());$("itemForm").addEventListener("submit",saveItem);$("categoryForm").addEventListener("submit",saveCategory);$("componentForm").addEventListener("submit",saveComponent);$("cancelItem").addEventListener("click",()=>$("itemDialog").close());$("cancelCategory").addEventListener("click",()=>$("categoryDialog").close());$("cancelComponent").addEventListener("click",()=>$("componentDialog").close());$("deleteItem").addEventListener("click",deleteItem);$("deleteCategory").addEventListener("click",deleteCategory);$("deleteComponent").addEventListener("click",deleteComponent);$("adminForm").addEventListener("submit",addAdmin);
  document.addEventListener("click",e=>{const stock=e.target.closest("[data-stock-id]");if(stock)openStock(stock.dataset.stockKind,stock.dataset.stockId);const item=e.target.closest("[data-item-edit]");if(item)openItem(item.dataset.itemEdit);const addItem=e.target.closest("[data-category-add-item]");if(addItem)openItem("",addItem.dataset.categoryAddItem);const category=e.target.closest("[data-category-edit]");if(category)openCategory(category.dataset.categoryEdit);const child=e.target.closest("[data-category-add-child]");if(child)openCategory("",child.dataset.categoryAddChild);const component=e.target.closest("[data-component-edit]");if(component)openComponent(component.dataset.componentEdit);const candidateView=e.target.closest("[data-candidate-view]");if(candidateView)openOrderDetails(candidateView.dataset.candidateView);const confirmBtn=e.target.closest("[data-candidate-confirm]");if(confirmBtn)candidate(confirmBtn.dataset.candidateConfirm,"confirm");const discard=e.target.closest("[data-candidate-discard]");if(discard)candidate(discard.dataset.candidateDiscard,"discard");const remove=e.target.closest("[data-admin-remove]");if(remove)removeAdmin(remove.dataset.adminRemove);const customer=e.target.closest("[data-customer-remove]");if(customer)removeCustomerProfile(customer.dataset.customerRemove)});
  $("newPackage").addEventListener("click",()=>openPackage());
  $("packageForm").addEventListener("submit",savePackage);
  $("groupComponentsForm").addEventListener("submit",saveGroupComponents);
  $("addGroupComponent").addEventListener("click",addGroupComponent);
  $("cancelGroupComponents").addEventListener("click",()=>{ $("groupComponentsDialog").close();state.activePackageManagerId=null;state.packageComponentDraft=new Map()});
  $("packageRequiresSelection").addEventListener("change",e=>{if(e.target.checked){if(Number($("packageMin").value)<1)$("packageMin").value="1"}else $("packageMin").value="0"});
  $("packageMin").addEventListener("input",e=>{$("packageRequiresSelection").checked=Number(e.target.value)>0});
  $("cancelPackage").addEventListener("click",() => $("packageDialog").close());
  $("deletePackage").addEventListener("click",()=>deletePackage());
  $("cancelComponent").addEventListener("click",()=>{state.componentReturnToGroupId=null;state.componentManagedMode=false});
  $("groupComponentsList").addEventListener("click",e=>{const newRemove=e.target.closest("[data-new-row-remove]");if(newRemove){newRemove.closest("[data-group-component-row]").remove();return}const remove=e.target.closest("[data-group-component-remove]");if(remove){state.packageComponentDraft.delete(remove.dataset.groupComponentRemove);remove.closest("[data-group-component-row]").remove()}});
  document.addEventListener("click",e=>{const removeGroup=e.target.closest("[data-package-delete]");if(removeGroup){deletePackage(removeGroup.dataset.packageDelete);return}const manage=e.target.closest("[data-package-manage]");if(manage){openGroupComponents(manage.dataset.packageManage);return}const pack=e.target.closest("[data-package-edit]");if(pack)openPackage(pack.dataset.packageEdit)});
  db.auth.onAuthStateChange((event,session)=>{if(event==="SIGNED_OUT"){state.session=null;show("login");return}if(event==="SIGNED_IN"&&session?.user?.id!==state.session?.user?.id)setTimeout(bootstrap,0)});bootstrap();
})();
