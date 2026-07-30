import { addTransaction, deleteTransaction, getAllTransactions, getSetting, migrateLegacyLocalStorage, replaceTransactions, saveSetting } from "./database.js";

const STORAGE_KEY = "myMobileApp.data.v3";
const THEME_KEY = "myMobileApp.theme";
const categories = ["Alimentation","Logement","Transport","Factures","Santé","Loisirs","Épargne","Revenu","Maman","Papa","Fils","Femme","Fille","Frère","Sœur","Autres"];
const categoryColors = ["#4f46e5","#ef4444","#f97316","#f59e0b","#22c55e","#06b6d4","#8b5cf6","#10b981","#ec4899","#3b82f6","#14b8a6","#d946ef","#f43f5e","#0ea5e9","#a855f7","#64748b"];

const state = {
  selectedMonth: new Date().toISOString().slice(0,7),
  budgetLimit: 1500,
  transactions: [],
  chartRange: "monthly",
  deferredPrompt: null
};

const $ = selector => document.querySelector(selector);
const elements = {
  monthLabel: $("#currentMonthLabel"), incomeTotal: $("#incomeTotal"), expenseTotal: $("#expenseTotal"),
  balanceTotal: $("#balanceTotal"), budgetStatus: $("#budgetStatus"), budgetPercent: $("#budgetPercent"),
  budgetProgress: $("#budgetProgress"), transactionList: $("#transactionList"), emptyState: $("#emptyState"),
  modal: $("#transactionModal"), form: $("#transactionForm"), type: $("#transactionType"),
  label: $("#transactionLabel"), amount: $("#transactionAmount"), category: $("#transactionCategory"),
  date: $("#transactionDate"), note: $("#transactionNote"), search: $("#searchInput"),
  typeFilter: $("#typeFilter"), categoryFilter: $("#categoryFilter"), trendChart: $("#trendChart"),
  chartTooltip: $("#chartTooltip"), donut: $("#donutChart"), donutTotal: $("#donutTotal"),
  categoryLegend: $("#categoryLegend"), budgetModal: $("#budgetModal"), budgetInput: $("#budgetInput"),
  monthModal: $("#monthModal"), monthInput: $("#monthInput"), toast: $("#toast")
};

const currency = new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"});
const compactCurrency = value => new Intl.NumberFormat("fr-FR",{notation:"compact",maximumFractionDigits:1}).format(value)+" €";

async function loadState(){
  const migrated = await migrateLegacyLocalStorage(STORAGE_KEY);
  state.budgetLimit = await getSetting("budgetLimit", 1500);
  state.transactions = await getAllTransactions();
  if (migrated) showToast("Anciennes données transférées vers IndexedDB");
}

function formatMonth(key){const [y,m]=key.split("-").map(Number);return new Intl.DateTimeFormat("fr-FR",{month:"long",year:"numeric"}).format(new Date(y,m-1,1));}
function formatDate(date){return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(date+"T12:00:00"));}
function escapeHtml(value){const div=document.createElement("div");div.textContent=value??"";return div.innerHTML;}
function getMonthTransactions(key=state.selectedMonth){return state.transactions.filter(t=>t.date.startsWith(key));}
function getMonthSummary(key){
  const tx=getMonthTransactions(key);
  return {
    income:tx.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0),
    expenses:tx.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0)
  };
}
function shiftMonth(key,offset){const [y,m]=key.split("-").map(Number);return new Date(y,m-1+offset,1).toISOString().slice(0,7);}
function showToast(message){elements.toast.textContent=message;elements.toast.hidden=false;clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>elements.toast.hidden=true,2200);}
function categoryIcon(category){return ({Alimentation:"🛒",Logement:"⌂",Transport:"▣",Factures:"⌁",Santé:"✚",Loisirs:"◉",Épargne:"◇",Revenu:"↗",Maman:"♡",Papa:"♙",Fils:"♟",Femme:"♥",Fille:"✿",Frère:"◆",Sœur:"❀",Autres:"•"})[category]||"•";}

function render(){
  const tx=getFilteredTransactions();
  const month=getMonthSummary();
  const previous=getMonthSummary(shiftMonth(state.selectedMonth,-1));
  const balance=month.income-month.expenses;
  const percent=state.budgetLimit>0?Math.min(month.expenses/state.budgetLimit*100,100):0;
  const savingRate=month.income>0?Math.max(balance/month.income*100,0):0;

  elements.monthLabel.textContent=formatMonth(state.selectedMonth);
  const currentMonth=new Date().toISOString().slice(0,7);
  const todayButton=$("#todayMonth");
  if(todayButton) todayButton.hidden=state.selectedMonth===currentMonth;
  $("#nextMonth").disabled=state.selectedMonth>=currentMonth;
  $("#nextMonth").style.opacity=$("#nextMonth").disabled?".4":"1";
  elements.incomeTotal.textContent=currency.format(month.income);
  elements.expenseTotal.textContent=currency.format(month.expenses);
  elements.balanceTotal.textContent=currency.format(balance);
  $("#savingRate").textContent=`Épargne ${Math.round(savingRate)}%`;
  $("#incomeDelta").textContent=deltaLabel(month.income,previous.income);
  $("#expenseDelta").textContent=deltaLabel(month.expenses,previous.expenses);
  elements.budgetStatus.textContent=`${currency.format(month.expenses)} sur ${currency.format(state.budgetLimit)}`;
  elements.budgetPercent.textContent=`${Math.round(percent)}%`;
  elements.budgetProgress.style.width=`${percent}%`;

  renderTransactions(tx);
  renderTrendChart();
  renderDonut();
}

function deltaLabel(current,previous){
  if(!previous)return "Ce mois";
  const d=((current-previous)/previous)*100;
  return `${d>=0?"+":""}${Math.round(d)}% vs mois précédent`;
}

function getFilteredTransactions(){
  const query=elements.search.value.trim().toLowerCase();
  const type=elements.typeFilter.value;
  const category=elements.categoryFilter.value;
  return getMonthTransactions()
    .filter(t=>type==="all"||t.type===type)
    .filter(t=>category==="all"||t.category===category)
    .filter(t=>!query||[t.label,t.category,t.note].some(v=>(v||"").toLowerCase().includes(query)))
    .sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt);
}

function renderTransactions(transactions){
  elements.transactionList.innerHTML="";
  elements.emptyState.hidden=transactions.length>0;
  transactions.forEach((t,index)=>{
    const item=document.createElement("article");
    item.className="transaction-item";
    item.style.animationDelay=`${Math.min(index*35,210)}ms`;
    const sign=t.type==="income"?"+":"−";
    item.innerHTML=`
      <div class="transaction-icon">${categoryIcon(t.category)}</div>
      <div class="transaction-copy"><strong>${escapeHtml(t.label)}</strong><small>${escapeHtml(t.category)} · ${formatDate(t.date)}${t.note?` · ${escapeHtml(t.note)}`:""}</small></div>
      <div><div class="amount ${t.type}">${sign}${currency.format(t.amount)}</div><button class="delete-transaction" data-id="${t.id}" aria-label="Supprimer">✕</button></div>`;
    elements.transactionList.appendChild(item);
  });
}

function renderTrendChart(){
  const annual=state.chartRange==="annual";
  const data=[];
  if(annual){
    const year=Number(state.selectedMonth.slice(0,4));
    for(let i=5;i>=0;i--){
      const y=year-i;
      const sums=state.transactions.filter(t=>t.date.startsWith(String(y))).reduce((a,t)=>{a[t.type]+=t.amount;return a;},{income:0,expense:0});
      data.push({label:String(y),income:sums.income,expense:sums.expense});
    }
  }else{
    for(let i=5;i>=0;i--){
      const key=shiftMonth(state.selectedMonth,-i),s=getMonthSummary(key);
      data.push({label:new Intl.DateTimeFormat("fr-FR",{month:"short"}).format(new Date(key+"-01T12:00:00")),income:s.income,expense:s.expenses});
    }
  }
  const svg=elements.trendChart,width=640,height=260,pad={l:42,r:16,t:20,b:34};
  const max=Math.max(100,...data.flatMap(d=>[d.income,d.expense]))*1.12;
  const x=i=>pad.l+i*((width-pad.l-pad.r)/(data.length-1||1));
  const y=v=>height-pad.b-(v/max)*(height-pad.t-pad.b);
  const points=key=>data.map((d,i)=>`${x(i)},${y(d[key])}`).join(" ");
  let html="";
  for(let i=0;i<4;i++){const yy=pad.t+i*((height-pad.t-pad.b)/3);html+=`<line class="chart-grid" x1="${pad.l}" y1="${yy}" x2="${width-pad.r}" y2="${yy}"/><text class="chart-label" x="0" y="${yy+4}">${compactCurrency(max*(1-i/3))}</text>`;}
  data.forEach((d,i)=>{html+=`<text class="chart-label" text-anchor="middle" x="${x(i)}" y="${height-8}">${d.label}</text>`;});
  html+=`<polyline class="line-income" points="${points("income")}"/><polyline class="line-expense" points="${points("expense")}"/>`;
  data.forEach((d,i)=>{
    html+=`<circle class="chart-point point-income" data-index="${i}" data-type="income" cx="${x(i)}" cy="${y(d.income)}" r="5"/>`;
    html+=`<circle class="chart-point point-expense" data-index="${i}" data-type="expense" cx="${x(i)}" cy="${y(d.expense)}" r="5"/>`;
  });
  svg.innerHTML=html;
  svg.querySelectorAll(".chart-point").forEach(point=>point.addEventListener("pointerenter",event=>{
    const i=Number(point.dataset.index),type=point.dataset.type,d=data[i];
    elements.chartTooltip.innerHTML=`<strong>${d.label}</strong><br>${type==="income"?"Revenus":"Dépenses"} : ${currency.format(d[type])}`;
    elements.chartTooltip.style.left=`${point.cx.baseVal.value/640*100}%`;
    elements.chartTooltip.style.top=`${point.cy.baseVal.value/260*100}%`;
    elements.chartTooltip.hidden=false;
  }));
  svg.addEventListener("pointerleave",()=>elements.chartTooltip.hidden=true,{once:true});
}

function renderDonut(){
  const expenses=getMonthTransactions().filter(t=>t.type==="expense");
  const total=expenses.reduce((s,t)=>s+t.amount,0);
  const sums=categories.map((c,i)=>({category:c,value:expenses.filter(t=>t.category===c).reduce((s,t)=>s+t.amount,0),color:categoryColors[i]})).filter(x=>x.value>0).sort((a,b)=>b.value-a.value);
  let start=0;
  const segments=sums.map(x=>{const end=start+(x.value/total*100||0);const part=`${x.color} ${start}% ${end}%`;start=end;return part;});
  elements.donut.style.background=segments.length?`conic-gradient(${segments.join(",")})`:"conic-gradient(var(--border) 0 100%)";
  elements.donutTotal.textContent=currency.format(total);
  elements.categoryLegend.innerHTML=sums.slice(0,6).map(x=>`<div class="category-row"><i class="category-color" style="background:${x.color}"></i><span>${x.category}</span><span>${Math.round(x.value/total*100)}%</span></div>`).join("")||'<span class="muted">Aucune dépense ce mois-ci.</span>';
}

function changeMonth(offset){const next=shiftMonth(state.selectedMonth,offset);const current=new Date().toISOString().slice(0,7);if(next>current)return;state.selectedMonth=next;render();}
function openTransactionModal(type="expense"){
  elements.type.value=type;document.querySelectorAll(".type-switch button").forEach(b=>b.classList.toggle("active",b.dataset.type===type));
  elements.date.value=state.selectedMonth===new Date().toISOString().slice(0,7)?new Date().toISOString().slice(0,10):`${state.selectedMonth}-01`;
  elements.modal.showModal();setTimeout(()=>elements.label.focus(),180);
}
function closeModal(){elements.form.reset();elements.modal.close();}

function exportData(){
  const payload={app:"MyMobileApp",version:3,exportedAt:new Date().toISOString(),data:{budgetLimit:state.budgetLimit,transactions:state.transactions}};
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));
  const link=document.createElement("a");link.href=url;link.download=`MyMobileApp-${new Date().toISOString().slice(0,10)}.json`;link.click();URL.revokeObjectURL(url);showToast("Sauvegarde exportée");
}
async function importData(file){
  try{const payload=JSON.parse(await file.text()),data=payload.data??payload;if(!Array.isArray(data.transactions))throw 0;state.budgetLimit=Number(data.budgetLimit)||1500;await replaceTransactions(data.transactions);await saveSetting("budgetLimit",state.budgetLimit);state.transactions=await getAllTransactions();render();showToast("Données importées");}
  catch{showToast("Fichier JSON invalide");}
}


categories.forEach(c=>{elements.category.add(new Option(c,c));elements.categoryFilter.add(new Option(c,c));});
elements.form.addEventListener("submit",async event=>{
  event.preventDefault();
  const t={id:crypto.randomUUID?.()||String(Date.now()),type:elements.type.value,label:elements.label.value.trim(),amount:Number(elements.amount.value),category:elements.category.value,date:elements.date.value,note:elements.note.value.trim(),createdAt:Date.now()};
  if(!t.label||t.amount<=0||!t.date)return;
  const saved = await addTransaction(t);state.transactions.push(saved);closeModal();render();showToast("Opération ajoutée");
});
$("#prevMonth").onclick=()=>changeMonth(-1);$("#nextMonth").onclick=()=>changeMonth(1);$("#todayMonth").onclick=()=>{state.selectedMonth=new Date().toISOString().slice(0,7);render();};
$("#openTransactionModal").onclick=()=>openTransactionModal();$("#floatingAdd").onclick=()=>openTransactionModal();
$("#closeTransactionModal").onclick=closeModal;$("#cancelTransaction").onclick=closeModal;
document.querySelectorAll(".type-switch button").forEach(b=>b.onclick=()=>{elements.type.value=b.dataset.type;document.querySelectorAll(".type-switch button").forEach(x=>x.classList.toggle("active",x===b));elements.category.value=b.dataset.type==="income"?"Revenu":"Alimentation";});
[elements.search,elements.typeFilter,elements.categoryFilter].forEach(el=>el.addEventListener("input",render));
elements.transactionList.onclick=async event=>{const b=event.target.closest("[data-id]");if(!b)return;await deleteTransaction(b.dataset.id);state.transactions=state.transactions.filter(t=>t.id!==b.dataset.id);render();showToast("Opération supprimée");};
$("#exportData").onclick=exportData;$("#importData").onchange=e=>{importData(e.target.files[0]);e.target.value="";};
$("#themeToggle").onclick=()=>{const next=document.documentElement.dataset.theme==="dark"?"light":"dark";document.documentElement.dataset.theme=next;localStorage.setItem(THEME_KEY,next);};
$("#editBudget").onclick=()=>{elements.budgetInput.value=state.budgetLimit;elements.budgetModal.showModal();};
$("#closeBudgetModal").onclick=()=>elements.budgetModal.close();
$("#budgetForm").onsubmit=async e=>{e.preventDefault();state.budgetLimit=Number(elements.budgetInput.value)||0;await saveSetting("budgetLimit",state.budgetLimit);elements.budgetModal.close();render();showToast("Budget mis à jour");};
$("#monthPickerButton").onclick=()=>{elements.monthInput.value=state.selectedMonth;elements.monthModal.showModal();};$("#closeMonthModal").onclick=()=>elements.monthModal.close();
$("#monthForm").onsubmit=e=>{e.preventDefault();const current=new Date().toISOString().slice(0,7);if(elements.monthInput.value>current){showToast("Impossible de sélectionner un mois futur");return;}state.selectedMonth=elements.monthInput.value;elements.monthModal.close();render();};
document.querySelectorAll("#chartRange button").forEach(b=>b.onclick=()=>{state.chartRange=b.dataset.range;document.querySelectorAll("#chartRange button").forEach(x=>x.classList.toggle("active",x===b));renderTrendChart();});
document.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>{document.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x===b));const map={dashboard:".month-switcher",history:".search-heading",analytics:".chart-card",settings:".settings-card"};document.querySelector(map[b.dataset.section]).scrollIntoView({behavior:"smooth",block:"start"});});
document.querySelectorAll("[data-focus]").forEach(card=>card.onclick=()=>{elements.typeFilter.value=card.dataset.focus==="income"?"income":"expense";document.querySelector(".search-heading").scrollIntoView({behavior:"smooth"});render();});

window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();state.deferredPrompt=event;$("#installButton").hidden=false;});
$("#installButton").onclick=async()=>{if(!state.deferredPrompt)return;state.deferredPrompt.prompt();await state.deferredPrompt.userChoice;state.deferredPrompt=null;$("#installButton").hidden=true;};
window.addEventListener("appinstalled",()=>showToast("MyMobileApp est installée"));
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("service-worker.js").catch(()=>{}));

const savedTheme=localStorage.getItem(THEME_KEY);
document.documentElement.dataset.theme=savedTheme||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");
loadState().then(render).catch(error=>{console.error(error);showToast("Impossible de charger les données locales");render();});
