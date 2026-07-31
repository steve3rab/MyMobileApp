import {
  addTransaction,
  deleteTransaction,
  getAllSettings,
  getAllTransactions,
  getSetting,
  migrateLegacyLocalStorage,
  replaceAppData,
  saveSetting,
  purgeDatabase
} from "./database.js?v=25";
import { initializeMyCar, reloadMyCarData } from "./mycar.js?v=25";

const LEGACY_STORAGE_KEY = "myMobileApp.data.v3";
const THEME_KEY = "myMobileApp.theme";
const EXPENSE_DRAFT_KEY = "myMobileApp.expenseDraft";
const LAST_EXPORT_KEY = "myMobileApp.lastExport";
const DEFAULT_BUDGET = 2000;
const CATEGORIES = ["Alimentation", "Loyer", "Crédit immobilier", "Électricité", "Eau", "Gaz", "Internet", "Téléphone", "Assurance habitation", "Réparation maison", "Transport", "Carburant", "Péage", "Parking", "Entretien voiture", "Réparation voiture", "Assurance voiture", "Contrôle technique", "Factures", "Santé", "Pharmacie", "Mutuelle", "École", "Crèche", "Vêtements", "Courses", "Restaurant", "Loisirs", "Abonnements", "Amazon", "Netflix", "Épargne", "Impôts", "Frais bancaires", "Cadeaux", "Voyage", "Maman", "Papa", "Fils", "Femme", "Fille", "Frère", "Sœur", "Autres"];
const CATEGORY_COLORS = ["#4f46e5", "#ef4444", "#f97316", "#f59e0b", "#22c55e", "#06b6d4", "#8b5cf6", "#ec4899", "#3b82f6", "#14b8a6", "#d946ef", "#f43f5e", "#0ea5e9", "#a855f7", "#64748b"];

const $ = selector => document.querySelector(selector);
function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
const currentMonthKey = () => localDateKey().slice(0, 7);
const budgetKey = month => `budgetLimit:${month}`;
const RECURRING_KEY = "recurringExpenses";
const AGENDA_KEY = "weeklyAgenda";
const AGENDA_PEOPLE = ["Parent 1", "Parent 2", "Enfant 1"];
const AGENDA_DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];

const state = {
  selectedMonth: currentMonthKey(),
  budgetLimit: DEFAULT_BUDGET,
  transactions: [],
  chartRange: "monthly",
  deferredPrompt: null,
  busy: false,
  recurringExpenses: [],
  agenda: {},
  chartRenderId: 0
};

const elements = {
  monthLabel: $("#currentMonthLabel"),
  budgetMonthTotal: $("#budgetMonthTotal"),
  expenseTotal: $("#expenseTotal"),
  balanceTotal: $("#balanceTotal"),
  budgetStatus: $("#budgetStatus"),
  budgetPercent: $("#budgetPercent"),
  budgetProgress: $("#budgetProgress"),
  transactionList: $("#transactionList"),
  emptyState: $("#emptyState"),
  modal: $("#transactionModal"),
  form: $("#transactionForm"),
  label: $("#transactionLabel"),
  amount: $("#transactionAmount"),
  category: $("#transactionCategory"),
  date: $("#transactionDate"),
  note: $("#transactionNote"),
  recurring: $("#transactionRecurring"),
  search: $("#searchInput"),
  categoryFilter: $("#categoryFilter"),
  trendChart: $("#trendChart"),
  chartTooltip: $("#chartTooltip"),
  donut: $("#donutChart"),
  donutTotal: $("#donutTotal"),
  categoryLegend: $("#categoryLegend"),
  budgetModal: $("#budgetModal"),
  budgetInput: $("#budgetInput"),
  monthModal: $("#monthModal"),
  monthInput: $("#monthInput"),
  toast: $("#toast"),
  todayMonth: $("#todayMonth"),
  agendaGrid: $("#agendaGrid"),
  agendaTimeline: $("#agendaTimeline"),
  saveAgenda: $("#saveAgenda"),
  purgeDatabaseButton: $("#purgeDatabase"),
  lastExportInfo: $("#lastExportInfo")
};

const currency = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const compactCurrency = value => `${new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(value)} €`;

function assertElement(value, name) {
  if (!value) throw new Error(`Élément introuvable : ${name}`);
  return value;
}
Object.entries(elements).forEach(([name, value]) => assertElement(value, name));

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = String(value ?? "");
  return node.innerHTML;
}

function formatMonth(key) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function formatDate(value) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function isValidDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function shiftMonth(key, offset) {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { elements.toast.hidden = true; }, 2200);
}

function updateLastExportInfo() {
  const savedAt = localStorage.getItem(LAST_EXPORT_KEY);
  if (!savedAt) {
    elements.lastExportInfo.textContent = "Aucun export effectué sur cet appareil.";
    return;
  }
  const date = new Date(savedAt);
  elements.lastExportInfo.textContent = Number.isNaN(date.getTime())
    ? "Dernier export : date inconnue."
    : `Dernier export : ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(date)}`;
}

function selectedExpenses(month = state.selectedMonth) {
  return state.transactions.filter(item => item.type === "expense" && item.date?.startsWith(month));
}

function expenseTotal(month = state.selectedMonth) {
  return selectedExpenses(month).reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

async function loadBudget(month) {
  const monthly = await getSetting(budgetKey(month), null);
  if (monthly !== null) return Math.max(0, Number(monthly) || 0);
  const legacyGlobal = await getSetting("budgetLimit", DEFAULT_BUDGET);
  return Math.max(0, Number(legacyGlobal) || DEFAULT_BUDGET);
}

function createId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function daysInMonth(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

function recurringDate(template, monthKey) {
  const day = Math.min(Number(template.day) || 1, daysInMonth(monthKey));
  return `${monthKey}-${String(day).padStart(2, "0")}`;
}

function isMonthOnOrAfter(month, startMonth) {
  return month >= startMonth;
}

async function loadRecurringExpenses() {
  const stored = await getSetting(RECURRING_KEY, []);
  state.recurringExpenses = Array.isArray(stored)
    ? stored.filter(item => item && item.id && item.label && Number(item.amount) > 0 && /^\d{4}-\d{2}$/.test(item.startMonth || ""))
    : [];
}

async function saveRecurringExpenses() {
  await saveSetting(RECURRING_KEY, state.recurringExpenses);
}

async function materializeRecurringExpenses(month) {
  const existingIds = new Set(state.transactions.map(item => item.id));
  const generated = [];

  for (const template of state.recurringExpenses) {
    if (!isMonthOnOrAfter(month, template.startMonth)) continue;

    const id = `recurring:${template.id}:${month}`;
    if (existingIds.has(id)) continue;

    const transaction = await addTransaction({
      id,
      type: "expense",
      label: template.label,
      amount: template.amount,
      category: template.category,
      date: recurringDate(template, month),
      note: template.note,
      recurringId: template.id,
      isRecurring: true,
      createdAt: Date.now()
    });

    state.transactions.push(transaction);
    generated.push(transaction);
  }

  return generated;
}

async function removeRecurringExpense(recurringId) {
  state.recurringExpenses = state.recurringExpenses.filter(item => item.id !== recurringId);
  await saveRecurringExpenses();
}

async function selectMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month) || month > currentMonthKey()) {
    showToast("Période invalide");
    return;
  }
  state.selectedMonth = month;
  state.budgetLimit = await loadBudget(month);
  await materializeRecurringExpenses(month);
  render();
}

function render() {
  const spent = expenseTotal();
  const previousSpent = expenseTotal(shiftMonth(state.selectedMonth, -1));
  const monthlyDifference = spent - previousSpent;
  const remaining = state.budgetLimit - spent;
  const usedPercent = state.budgetLimit > 0 ? Math.min(100, (spent / state.budgetLimit) * 100) : 0;
  const availablePercent = state.budgetLimit > 0 ? Math.max(0, (remaining / state.budgetLimit) * 100) : 0;

  elements.monthLabel.textContent = formatMonth(state.selectedMonth);
  elements.budgetMonthTotal.textContent = currency.format(state.budgetLimit);
  elements.expenseTotal.textContent = currency.format(spent);
  elements.balanceTotal.textContent = currency.format(remaining);
  $("#expenseDelta").textContent = monthlyDifference === 0
    ? "Identique au mois précédent"
    : `${currency.format(Math.abs(monthlyDifference))} ${monthlyDifference > 0 ? "de plus" : "de moins"} que le mois précédent`;
  $("#expenseDelta").classList.toggle("delta-up", monthlyDifference > 0);
  $("#expenseDelta").classList.toggle("delta-down", monthlyDifference < 0);
  $("#remainingRate").textContent = `Disponible ${Math.round(availablePercent)}%`;
  elements.budgetStatus.textContent = `${currency.format(spent)} sur ${currency.format(state.budgetLimit)}`;
  elements.budgetPercent.textContent = `${Math.round(usedPercent)}%`;
  elements.budgetProgress.style.width = `${usedPercent}%`;
  elements.budgetProgress.classList.toggle("over-budget", spent > state.budgetLimit);

  elements.todayMonth.hidden = state.selectedMonth === currentMonthKey();
  $("#nextMonth").disabled = state.selectedMonth >= currentMonthKey();

  renderTransactions();
  void renderTrendChart();
  renderDonut();
}

function filteredTransactions() {
  const query = elements.search.value.trim().toLowerCase();
  const category = elements.categoryFilter.value;
  return selectedExpenses()
    .filter(item => category === "all" || item.category === category)
    .filter(item => !query || [item.label, item.category, item.note].some(value => String(value ?? "").toLowerCase().includes(query)))
    .sort((a, b) => b.date.localeCompare(a.date) || Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function categoryIcon(category) {
  const icons = {
    Alimentation:"🛒", Courses:"🛒", Loyer:"⌂", "Crédit immobilier":"⌂",
    Électricité:"⚡", Eau:"💧", Gaz:"◌", Internet:"⌁", Téléphone:"☎",
    "Assurance habitation":"⌂", "Réparation maison":"🔧", Transport:"▣",
    Carburant:"⛽", Péage:"⇥", Parking:"P", "Entretien voiture":"🔧",
    "Réparation voiture":"🔧", "Assurance voiture":"▣", "Contrôle technique":"✓",
    Factures:"⌁", Santé:"✚", Pharmacie:"✚", Mutuelle:"✚", École:"▤",
    Crèche:"◉", Vêtements:"♢", Restaurant:"◒", Loisirs:"◉",
    Abonnements:"↻", Amazon:"a", Netflix:"N", Épargne:"◇", Impôts:"§",
    "Frais bancaires":"€", Cadeaux:"🎁", Voyage:"✈", Maman:"♡", Papa:"♙",
    Fils:"♟", Femme:"♥", Fille:"✿", Frère:"◆", Sœur:"❀", Autres:"•"
  };
  return icons[category] ?? "•";
}

function renderTransactions() {
  const list = filteredTransactions();
  elements.transactionList.replaceChildren();
  elements.emptyState.hidden = list.length > 0;
  list.forEach((item, index) => {
    const article = document.createElement("article");
    article.className = "transaction-item";
    article.style.animationDelay = `${Math.min(index * 35, 210)}ms`;
    article.innerHTML = `<div class="transaction-icon">${categoryIcon(item.category)}</div><div class="transaction-copy"><strong>${escapeHtml(item.label)}${item.isRecurring ? ' <span class="recurring-badge">Mensuel</span>' : ''}</strong><small>${escapeHtml(item.category)} · ${formatDate(item.date)}${item.note ? ` · ${escapeHtml(item.note)}` : ""}</small></div><div><div class="amount expense">−${currency.format(item.amount)}</div><button class="delete-transaction" data-id="${escapeHtml(item.id)}" data-recurring-id="${escapeHtml(item.recurringId ?? '')}" aria-label="Supprimer">✕</button></div>`;
    elements.transactionList.appendChild(article);
  });
}

async function budgetForChart(month) {
  return loadBudget(month);
}

async function renderTrendChart() {
  const renderId = ++state.chartRenderId;
  const selectedMonth = state.selectedMonth;
  const selectedRange = state.chartRange;
  const annual = state.chartRange === "annual";
  const data = [];
  if (annual) {
    const currentYear = Number(selectedMonth.slice(0, 4));
    for (let offset = 5; offset >= 0; offset--) {
      const year = currentYear - offset;
      const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
      const budgets = await Promise.all(months.map(budgetForChart));
      data.push({ label: String(year), budget: budgets.reduce((a,b)=>a+b,0), expense: months.reduce((sum, month)=>sum+expenseTotal(month),0) });
    }
  } else {
    for (let offset = 5; offset >= 0; offset--) {
      const month = shiftMonth(selectedMonth, -offset);
      data.push({ label: new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(new Date(`${month}-01T12:00:00`)), budget: await budgetForChart(month), expense: expenseTotal(month) });
    }
  }
  if (renderId !== state.chartRenderId || selectedMonth !== state.selectedMonth || selectedRange !== state.chartRange) return;
  const svg = elements.trendChart, width=640, height=260, pad={l:42,r:16,t:20,b:34};
  const max = Math.max(100, ...data.flatMap(item => [item.budget, item.expense])) * 1.12;
  const x = i => pad.l + i * ((width-pad.l-pad.r)/(data.length-1||1));
  const y = value => height-pad.b-(value/max)*(height-pad.t-pad.b);
  const points = key => data.map((item,i)=>`${x(i)},${y(item[key])}`).join(" ");
  let html="";
  for(let i=0;i<4;i++){const yy=pad.t+i*((height-pad.t-pad.b)/3);html+=`<line class="chart-grid" x1="${pad.l}" y1="${yy}" x2="${width-pad.r}" y2="${yy}"/><text class="chart-label" x="0" y="${yy+4}">${compactCurrency(max*(1-i/3))}</text>`;}
  data.forEach((item,i)=>{html+=`<text class="chart-label" text-anchor="middle" x="${x(i)}" y="${height-8}">${item.label}</text>`;});
  html+=`<polyline class="line-income" points="${points("budget")}"/><polyline class="line-expense" points="${points("expense")}"/>`;
  data.forEach((item,i)=>{html+=`<circle class="chart-point point-income" data-index="${i}" data-type="budget" cx="${x(i)}" cy="${y(item.budget)}" r="5"/><circle class="chart-point point-expense" data-index="${i}" data-type="expense" cx="${x(i)}" cy="${y(item.expense)}" r="5"/>`;});
  svg.innerHTML=html;
  svg.querySelectorAll(".chart-point").forEach(point=>point.addEventListener("pointerenter",()=>{const item=data[Number(point.dataset.index)],type=point.dataset.type;elements.chartTooltip.innerHTML=`<strong>${item.label}</strong><br>${type==="budget"?"Budget":"Dépenses"} : ${currency.format(item[type])}`;elements.chartTooltip.style.left=`${point.cx.baseVal.value/640*100}%`;elements.chartTooltip.style.top=`${point.cy.baseVal.value/260*100}%`;elements.chartTooltip.hidden=false;}));
  svg.onpointerleave=()=>{elements.chartTooltip.hidden=true;};
}

function renderDonut() {
  const expenses = selectedExpenses();
  const total = expenseTotal();
  const sums = CATEGORIES.map((category,index)=>({category,value:expenses.filter(item=>item.category===category).reduce((sum,item)=>sum+item.amount,0),color:CATEGORY_COLORS[index]})).filter(item=>item.value>0).sort((a,b)=>b.value-a.value);
  let start=0;
  const segments=sums.map(item=>{const end=start+(item.value/total*100||0);const part=`${item.color} ${start}% ${end}%`;start=end;return part;});
  elements.donut.style.background=segments.length?`conic-gradient(${segments.join(",")})`:"conic-gradient(var(--border) 0 100%)";
  elements.donutTotal.textContent=currency.format(total);
  elements.categoryLegend.innerHTML=sums.slice(0,6).map(item=>`<div class="category-row"><i class="category-color" style="background:${item.color}"></i><span>${item.category}</span><span>${Math.round(item.value/total*100)}%</span></div>`).join("")||'<span class="muted">Aucune dépense ce mois-ci.</span>';
}

function openExpenseModal() {
  elements.form.reset();
  elements.category.value="Alimentation";
  elements.date.value=state.selectedMonth===currentMonthKey()?localDateKey():`${state.selectedMonth}-01`;
  try {
    const draft = JSON.parse(sessionStorage.getItem(EXPENSE_DRAFT_KEY) || "null");
    if (draft && typeof draft === "object") {
      elements.label.value = String(draft.label ?? "").slice(0, 60);
      elements.amount.value = String(draft.amount ?? "");
      if (CATEGORIES.includes(draft.category)) elements.category.value = draft.category;
      if (isValidDateKey(draft.date)) elements.date.value = draft.date;
      elements.note.value = String(draft.note ?? "").slice(0, 120);
      elements.recurring.checked = Boolean(draft.recurring);
    }
  } catch {
    sessionStorage.removeItem(EXPENSE_DRAFT_KEY);
  }
  elements.modal.showModal();
  setTimeout(()=>elements.label.focus(),120);
}
function saveExpenseDraft() {
  const draft = {
    label: elements.label.value,
    amount: elements.amount.value,
    category: elements.category.value,
    date: elements.date.value,
    note: elements.note.value,
    recurring: elements.recurring.checked
  };
  const hasContent = draft.label.trim() || draft.amount || draft.note.trim() || draft.recurring;
  if (hasContent) sessionStorage.setItem(EXPENSE_DRAFT_KEY, JSON.stringify(draft));
  else sessionStorage.removeItem(EXPENSE_DRAFT_KEY);
}
function closeExpenseModal(){saveExpenseDraft();elements.form.reset();elements.modal.close();}
function clearExpenseDraft(){sessionStorage.removeItem(EXPENSE_DRAFT_KEY);}
function openBudgetModal(){elements.budgetInput.value=String(state.budgetLimit);elements.budgetModal.showModal();setTimeout(()=>elements.budgetInput.focus(),100);}


function createEmptyAgenda() {
  return Object.fromEntries(
    AGENDA_PEOPLE.map(person => [
      person,
      Object.fromEntries(
        AGENDA_DAYS.map(day => [day, { start: "", end: "" }])
      )
    ])
  );
}

function normalizeAgenda(value) {
  const normalized = createEmptyAgenda();
  if (!value || typeof value !== "object") return normalized;

  for (const person of AGENDA_PEOPLE) {
    for (const day of AGENDA_DAYS) {
      const entry = value?.[person]?.[day];
      if (!entry || typeof entry !== "object") continue;
      normalized[person][day] = {
        start: /^([01]\d|2[0-3]):[0-5]\d$/.test(entry.start || "") ? entry.start : "",
        end: /^([01]\d|2[0-3]):[0-5]\d$/.test(entry.end || "") ? entry.end : ""
      };
    }
  }
  return normalized;
}

function renderAgenda() {
  elements.agendaGrid.innerHTML = `
    <div class="agenda-table" role="table" aria-label="Comparaison des horaires de la semaine">
      <div class="agenda-table-row agenda-table-header" role="row">
        <div class="agenda-day-heading" role="columnheader">Jour</div>
        ${AGENDA_PEOPLE.map(person => `<div role="columnheader">${escapeHtml(person)}</div>`).join("")}
      </div>
      ${AGENDA_DAYS.map((day, dayIndex) => `
        <div class="agenda-table-row" role="row">
          <div class="agenda-day-heading" role="rowheader">${day}</div>
          ${AGENDA_PEOPLE.map((person, personIndex) => {
            const value = state.agenda[person][day];
            return `
              <div class="agenda-time-cell" role="cell">
                <label>
                  <span>Entrée</span>
                  <input type="time" aria-label="${escapeHtml(person)}, ${day}, heure d’entrée" data-person="${personIndex}" data-day="${dayIndex}" data-field="start" value="${value.start}">
                </label>
                <span class="agenda-time-arrow" aria-hidden="true">→</span>
                <label>
                  <span>Sortie</span>
                  <input type="time" aria-label="${escapeHtml(person)}, ${day}, heure de sortie" data-person="${personIndex}" data-day="${dayIndex}" data-field="end" value="${value.end}">
                </label>
              </div>`;
          }).join("")}
        </div>
      `).join("")}
    </div>`;
  renderAgendaTimeline(state.agenda);
}

function agendaFromForm() {
  const nextAgenda = createEmptyAgenda();
  elements.agendaGrid.querySelectorAll("input[type=time]").forEach(input => {
    const person = AGENDA_PEOPLE[Number(input.dataset.person)];
    const day = AGENDA_DAYS[Number(input.dataset.day)];
    const field = input.dataset.field;
    if (person && day && ["start", "end"].includes(field)) {
      nextAgenda[person][day][field] = input.value;
    }
  });
  return nextAgenda;
}

function timeToMinutes(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || "")) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function renderAgendaTimeline(agenda) {
  const entries = [];
  for (const person of AGENDA_PEOPLE) {
    for (const day of AGENDA_DAYS) {
      const start = timeToMinutes(agenda?.[person]?.[day]?.start);
      const end = timeToMinutes(agenda?.[person]?.[day]?.end);
      if (start !== null && end !== null && end > start) entries.push({ start, end });
    }
  }

  if (!entries.length) {
    elements.agendaTimeline.innerHTML = '<p class="agenda-timeline-empty">Renseigne une heure d’entrée et de sortie pour afficher la comparaison.</p>';
    return;
  }

  const firstHour = Math.max(0, Math.floor(Math.min(...entries.map(item => item.start)) / 60) - 1);
  const lastHour = Math.min(24, Math.ceil(Math.max(...entries.map(item => item.end)) / 60) + 1);
  const range = Math.max(1, (lastHour - firstHour) * 60);
  const ticks = Array.from({ length: lastHour - firstHour + 1 }, (_, index) => firstHour + index);

  elements.agendaTimeline.innerHTML = `
    <div class="timeline-scale" style="--tick-count:${ticks.length - 1}">
      <div></div>
      <div class="timeline-ticks">
        ${ticks.map(hour => `<span style="left:${((hour - firstHour) / (lastHour - firstHour)) * 100}%">${String(hour).padStart(2, "0")}h</span>`).join("")}
      </div>
    </div>
    ${AGENDA_DAYS.map(day => `
      <article class="timeline-day">
        <strong>${day}</strong>
        <div class="timeline-day-tracks" style="--tick-count:${ticks.length - 1}">
          ${AGENDA_PEOPLE.map((person, personIndex) => {
            const startValue = agenda?.[person]?.[day]?.start || "";
            const endValue = agenda?.[person]?.[day]?.end || "";
            const start = timeToMinutes(startValue);
            const end = timeToMinutes(endValue);
            const valid = start !== null && end !== null && end > start;
            const left = valid ? ((start - firstHour * 60) / range) * 100 : 0;
            const width = valid ? ((end - start) / range) * 100 : 0;
            return `
              <div class="timeline-track">
                <span class="timeline-person-label">${escapeHtml(person)}</span>
                ${valid ? `<div class="timeline-bar person-${personIndex + 1}" style="left:${left}%;width:${width}%" title="${escapeHtml(person)} : ${startValue}–${endValue}"><span>${startValue}–${endValue}</span></div>` : '<span class="timeline-missing">—</span>'}
              </div>`;
          }).join("")}
        </div>
      </article>
    `).join("")}`;
}

async function saveAgendaFromForm() {
  const nextAgenda = agendaFromForm();

  for (const person of AGENDA_PEOPLE) {
    for (const day of AGENDA_DAYS) {
      const { start, end } = nextAgenda[person][day];
      if (start && end && start >= end) {
        showToast(`${person} : l’heure de fin doit être après le début (${day})`);
        return;
      }
    }
  }

  try {
    await saveSetting(AGENDA_KEY, nextAgenda);
    state.agenda = nextAgenda;
    showToast("Agenda enregistré");
  } catch (error) {
    console.error(error);
    showToast("Impossible d’enregistrer l’agenda");
  }
}

async function confirmAndPurgeDatabase() {
  const confirmed = confirm("Supprimer définitivement toutes les dépenses, budgets, récurrences, horaires et entretiens de voiture enregistrés sur ce téléphone ?");
  if (!confirmed) return;

  const secondConfirmation = confirm("Cette action est irréversible. Continuer ?");
  if (!secondConfirmation) return;

  try {
    await purgeDatabase();
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    showToast("Base locale purgée");
    setTimeout(() => location.reload(), 500);
  } catch (error) {
    console.error(error);
    showToast(error?.message || "Purge impossible");
  }
}

function normalizeImportedTransaction(item) {
  const amount = Number(item?.amount);
  if (
    !item || item.type === "income" ||
    typeof item.label !== "string" || !item.label.trim() || item.label.trim().length > 60 ||
    !Number.isFinite(amount) || amount <= 0 || amount > 100000000 ||
    !isValidDateKey(item.date) || !CATEGORIES.includes(item.category) ||
    String(item.note ?? "").length > 120
  ) return null;

  return {
    ...item,
    id: typeof item.id === "string" && item.id ? item.id : createId(),
    type: "expense",
    label: item.label.trim(),
    amount: Math.round(amount * 100) / 100,
    note: String(item.note ?? "").trim(),
    createdAt: Number(item.createdAt) || Date.now()
  };
}

function normalizeImportedRecurrence(item) {
  const amount = Number(item?.amount);
  if (
    !item || typeof item.id !== "string" || !item.id ||
    typeof item.label !== "string" || !item.label.trim() || item.label.trim().length > 60 ||
    !Number.isFinite(amount) || amount <= 0 || amount > 100000000 ||
    !CATEGORIES.includes(item.category) || !/^\d{4}-\d{2}$/.test(item.startMonth || "") ||
    Number(item.day) < 1 || Number(item.day) > 31 || String(item.note ?? "").length > 120
  ) return null;

  return {
    ...item,
    label: item.label.trim(),
    amount: Math.round(amount * 100) / 100,
    day: Number(item.day),
    note: String(item.note ?? "").trim()
  };
}

function importedSettings(data) {
  const settings = [];
  const budgets = data.budgets && typeof data.budgets === "object"
    ? data.budgets
    : Number.isFinite(Number(data.budgetLimit))
      ? { [state.selectedMonth]: data.budgetLimit }
      : {};

  for (const [month, rawValue] of Object.entries(budgets)) {
    const value = Number(rawValue);
    if (/^\d{4}-\d{2}$/.test(month) && Number.isFinite(value) && value >= 0) {
      settings.push({ key: budgetKey(month), value: Math.round(value * 100) / 100 });
    }
  }
  if (Array.isArray(data.carMaintenanceRecords)) {
    settings.push({ key: "carMaintenanceRecords", value: data.carMaintenanceRecords });
  }
  return settings;
}

async function exportData() {
  try {
    const settings = await getAllSettings();
    const carMaintenanceRecords = await getSetting("carMaintenanceRecords", []);
    const budgets = Object.fromEntries(
      settings
        .filter(item => item.key.startsWith("budgetLimit:"))
        .map(item => [item.key.slice("budgetLimit:".length), item.value])
    );
    const payload = {
      app: "MyMobileApp",
      version: 25,
      exportedAt: new Date().toISOString(),
      data: { transactions: state.transactions, budgets, recurringExpenses: state.recurringExpenses, agenda: state.agenda, carMaintenanceRecords }
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `MyMobileApp-${localDateKey()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    localStorage.setItem(LAST_EXPORT_KEY, new Date().toISOString());
    updateLastExportInfo();
    showToast("Sauvegarde complète exportée");
  } catch (error) {
    console.error(error);
    showToast("Export impossible");
  }
}

async function importData(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const data = payload.data ?? payload;
    if (!Array.isArray(data.transactions)) throw new Error("Transactions manquantes");

    const expenses = data.transactions.map(normalizeImportedTransaction);
    if (expenses.some(item => item === null)) throw new Error("Transaction invalide");
    if (new Set(expenses.map(item => item.id)).size !== expenses.length) {
      throw new Error("Identifiants de transactions dupliqués");
    }

    const recurringExpenses = Array.isArray(data.recurringExpenses)
      ? data.recurringExpenses.map(normalizeImportedRecurrence)
      : [];
    if (recurringExpenses.some(item => item === null)) throw new Error("Récurrence invalide");
    if (new Set(recurringExpenses.map(item => item.id)).size !== recurringExpenses.length) {
      throw new Error("Identifiants de récurrences dupliqués");
    }

    const agenda = normalizeAgenda(data.agenda);
    const settings = [
      ...importedSettings(data),
      { key: RECURRING_KEY, value: recurringExpenses },
      { key: AGENDA_KEY, value: agenda }
    ];

    if (!confirm("Remplacer toutes les données locales par cette sauvegarde ?")) return;
    await replaceAppData(expenses, settings);

    state.transactions = expenses;
    state.recurringExpenses = recurringExpenses;
    state.agenda = agenda;
    state.budgetLimit = await loadBudget(state.selectedMonth);
    await reloadMyCarData();
    renderAgenda();
    render();
    showToast("Données restaurées");
  } catch (error) {
    console.error(error);
    showToast("Sauvegarde invalide");
  }
}

CATEGORIES.forEach(category=>{elements.category.add(new Option(category,category));elements.categoryFilter.add(new Option(category,category));});
elements.form.addEventListener("input", saveExpenseDraft);
elements.form.addEventListener("change", saveExpenseDraft);

elements.form.addEventListener("submit", async event => {
  event.preventDefault();
  if (state.busy) return;

  const label = elements.label.value.trim();
  const amount = Number(elements.amount.value);
  const date = elements.date.value;
  const category = elements.category.value;
  const note = elements.note.value.trim();

  if (!label || label.length > 60 || !Number.isFinite(amount) || amount <= 0 || amount > 100000000 || !isValidDateKey(date) || !CATEGORIES.includes(category)) {
    showToast("Vérifie les informations saisies");
    return;
  }

  try {
    state.busy = true;
    const roundedAmount = Math.round(amount * 100) / 100;
    const recurrenceId = elements.recurring.checked ? createId() : null;

    const saved = await addTransaction({
      id: recurrenceId ? `recurring:${recurrenceId}:${date.slice(0, 7)}` : createId(),
      type: "expense",
      label,
      amount: roundedAmount,
      category,
      date,
      note,
      recurringId: recurrenceId,
      isRecurring: Boolean(recurrenceId),
      createdAt: Date.now()
    });

    if (recurrenceId) {
      state.recurringExpenses.push({
        id: recurrenceId,
        label,
        amount: roundedAmount,
        category,
        note,
        day: Number(date.slice(8, 10)),
        startMonth: date.slice(0, 7),
        createdAt: Date.now()
      });
      await saveRecurringExpenses();
    }

    state.transactions.push(saved);
    clearExpenseDraft();
    elements.form.reset();
    elements.modal.close();
    render();
    showToast(recurrenceId ? "Dépense mensuelle ajoutée" : "Dépense ajoutée");
  } catch (error) {
    console.error(error);
    showToast("Enregistrement impossible");
  } finally {
    state.busy = false;
  }
});

$("#prevMonth").onclick=()=>selectMonth(shiftMonth(state.selectedMonth,-1));
$("#nextMonth").onclick=()=>selectMonth(shiftMonth(state.selectedMonth,1));
elements.todayMonth.onclick=()=>selectMonth(currentMonthKey());
$("#openTransactionModal").onclick=openExpenseModal;
$("#floatingAdd").onclick=openExpenseModal;
$("#closeTransactionModal").onclick=closeExpenseModal;
$("#cancelTransaction").onclick=closeExpenseModal;
document.querySelector('[data-action="expense"]').onclick=openExpenseModal;
document.querySelector('[data-action="budget"]').onclick=()=>{closeExpenseModal();openBudgetModal();};
[elements.search,elements.categoryFilter].forEach(element=>element.addEventListener("input",render));

elements.transactionList.onclick = async event => {
  const button = event.target.closest("[data-id]");
  if (!button || state.busy) return;

  const recurringId = button.dataset.recurringId;
  const message = recurringId
    ? "Supprimer cette dépense et arrêter sa répétition mensuelle ?"
    : "Supprimer cette dépense ?";
  if (!confirm(message)) return;

  try {
    state.busy = true;
    await deleteTransaction(button.dataset.id);
    if (recurringId) await removeRecurringExpense(recurringId);
    state.transactions = state.transactions.filter(item => item.id !== button.dataset.id);
    render();
    showToast(recurringId ? "Répétition mensuelle arrêtée" : "Dépense supprimée");
  } catch (error) {
    console.error(error);
    showToast("Suppression impossible");
  } finally {
    state.busy = false;
  }
};

elements.saveAgenda.onclick=saveAgendaFromForm;
elements.agendaGrid.addEventListener("input", () => renderAgendaTimeline(agendaFromForm()));
elements.purgeDatabaseButton.onclick=confirmAndPurgeDatabase;
$("#exportData").onclick=exportData;
$("#importData").onchange=event=>{importData(event.target.files?.[0]);event.target.value="";};
$("#themeToggle").onclick=()=>{const next=document.documentElement.dataset.theme==="dark"?"light":"dark";document.documentElement.dataset.theme=next;localStorage.setItem(THEME_KEY,next);};
$("#editBudget").onclick=openBudgetModal;
$("#budgetSummaryCard").onclick=openBudgetModal;
$("#closeBudgetModal").onclick=()=>elements.budgetModal.close();
$("#budgetForm").onsubmit=async event=>{event.preventDefault();const value=Number(elements.budgetInput.value);if(!Number.isFinite(value)||value<0){showToast("Budget invalide");return;}try{state.budgetLimit=Math.round(value*100)/100;await saveSetting(budgetKey(state.selectedMonth),state.budgetLimit);elements.budgetModal.close();render();showToast("Budget du mois mis à jour");}catch(error){console.error(error);showToast("Mise à jour impossible");}};
$("#monthPickerButton").onclick=()=>{elements.monthInput.value=state.selectedMonth;elements.monthModal.showModal();};
$("#closeMonthModal").onclick=()=>elements.monthModal.close();
$("#monthForm").onsubmit=async event=>{event.preventDefault();await selectMonth(elements.monthInput.value);elements.monthModal.close();};
document.querySelectorAll("#chartRange button").forEach(button=>button.onclick=()=>{state.chartRange=button.dataset.range;document.querySelectorAll("#chartRange button").forEach(item=>item.classList.toggle("active",item===button));void renderTrendChart();});
const budgetSections = {
  dashboard: $("#periodSection"),
  analytics: $("#statsSection"),
  history: $("#historySection"),
  settings: $("#settingsSection")
};

function setActiveNavigation(section) {
  document.querySelectorAll(".nav-item").forEach(item => {
    const active = item.dataset.section === section;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
}

document.querySelectorAll(".nav-item").forEach(button=>button.onclick=()=>{
  const section = button.dataset.section;
  const target = budgetSections[section];
  if (!target) return;
  setActiveNavigation(section);
  const desiredTop = window.scrollY + target.getBoundingClientRect().top - 112;
  const maximumTop = document.documentElement.scrollHeight - window.innerHeight;
  window.scrollTo({ top: Math.max(0, Math.min(desiredTop, maximumTop)), behavior: "auto" });
});
document.querySelector('[data-focus="expense"]').onclick=()=>{document.querySelector(".search-heading")?.scrollIntoView({behavior:"smooth"});};

window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();state.deferredPrompt=event;$("#installButton").hidden=false;});
$("#installButton").onclick=async()=>{if(!state.deferredPrompt)return;state.deferredPrompt.prompt();await state.deferredPrompt.userChoice;state.deferredPrompt=null;$("#installButton").hidden=true;};
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("service-worker.js?v=25").catch(console.error));


function showPortal(){
  $("#portalSection").hidden=false;
  $("#budgetModule").hidden=true;
  $("#agendaModule").hidden=true;
  $("#carModule").hidden=true;
  $("#settingsModule").hidden=true;
  $("#budgetNav").hidden=true;
  $("#floatingAdd").hidden=true;
  $("#backToPortal").hidden=true;
  $("#pageTitle").innerHTML='Mes applications <span class="title-owner">- Stevens</span>';
  window.scrollTo({top:0,behavior:"smooth"});
}
function openModule(name){
  $("#portalSection").hidden=true;
  $("#budgetModule").hidden=name!=="budget";
  $("#agendaModule").hidden=name!=="agenda";
  $("#carModule").hidden=name!=="car";
  $("#settingsModule").hidden=name!=="budget";
  $("#budgetNav").hidden=name!=="budget";
  $("#floatingAdd").hidden=name!=="budget";
  $("#backToPortal").hidden=false;
  const titles={budget:"MyBudget",agenda:"MyAgenda",car:"MyCar"};
  $("#pageTitle").innerHTML=`${titles[name] ?? "MyMobileApp"} <span class="title-owner">- Stevens</span>`;
  if(name==="budget") setActiveNavigation("dashboard");
  window.scrollTo({top:0,behavior:"smooth"});
}
$("#openBudgetModule").addEventListener("click",()=>openModule("budget"));
$("#openAgendaModule").addEventListener("click",()=>openModule("agenda"));
$("#openCarModule").addEventListener("click",()=>openModule("car"));
$("#backToPortal").addEventListener("click",showPortal);

async function initialize(){try{updateLastExportInfo();await migrateLegacyLocalStorage(LEGACY_STORAGE_KEY);await loadRecurringExpenses();state.agenda=normalizeAgenda(await getSetting(AGENDA_KEY,null));renderAgenda();await initializeMyCar(showToast);state.transactions=(await getAllTransactions()).filter(item=>item.type!=="income");await materializeRecurringExpenses(state.selectedMonth);state.budgetLimit=await loadBudget(state.selectedMonth);render();showPortal();}catch(error){console.error(error);showToast("Impossible de charger les données locales");render();showPortal();}}

["gesturestart", "gesturechange", "gestureend"].forEach(eventName => {
  document.addEventListener(eventName, event => event.preventDefault(), { passive: false });
});

const savedTheme=localStorage.getItem(THEME_KEY);document.documentElement.dataset.theme=savedTheme||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");
initialize();
