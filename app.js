const STORAGE_KEY = "myMobileApp.data.v1";
const THEME_KEY = "myMobileApp.theme";

const state = {
  selectedMonth: new Date().toISOString().slice(0, 7),
  budgetLimit: 1500,
  transactions: []
};

const elements = {
  monthLabel: document.querySelector("#currentMonthLabel"),
  incomeTotal: document.querySelector("#incomeTotal"),
  expenseTotal: document.querySelector("#expenseTotal"),
  balanceTotal: document.querySelector("#balanceTotal"),
  budgetStatus: document.querySelector("#budgetStatus"),
  budgetPercent: document.querySelector("#budgetPercent"),
  budgetProgress: document.querySelector("#budgetProgress"),
  transactionList: document.querySelector("#transactionList"),
  emptyState: document.querySelector("#emptyState"),
  modal: document.querySelector("#transactionModal"),
  form: document.querySelector("#transactionForm"),
  type: document.querySelector("#transactionType"),
  label: document.querySelector("#transactionLabel"),
  amount: document.querySelector("#transactionAmount"),
  category: document.querySelector("#transactionCategory"),
  date: document.querySelector("#transactionDate")
};

const currency = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR"
});

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  try {
    const saved = JSON.parse(raw);
    state.budgetLimit = Number(saved.budgetLimit) || 1500;
    state.transactions = Array.isArray(saved.transactions) ? saved.transactions : [];
  } catch {
    console.warn("Sauvegarde locale invalide.");
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    budgetLimit: state.budgetLimit,
    transactions: state.transactions
  }));
}

function formatMonth(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric"
  }).format(new Date(year, month - 1, 1));
}

function getMonthTransactions() {
  return state.transactions
    .filter(transaction => transaction.date.startsWith(state.selectedMonth))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

function render() {
  const transactions = getMonthTransactions();
  const income = transactions
    .filter(item => item.type === "income")
    .reduce((sum, item) => sum + item.amount, 0);

  const expenses = transactions
    .filter(item => item.type === "expense")
    .reduce((sum, item) => sum + item.amount, 0);

  const balance = income - expenses;
  const percent = state.budgetLimit > 0
    ? Math.min((expenses / state.budgetLimit) * 100, 100)
    : 0;

  elements.monthLabel.textContent = formatMonth(state.selectedMonth);
  elements.incomeTotal.textContent = currency.format(income);
  elements.expenseTotal.textContent = currency.format(expenses);
  elements.balanceTotal.textContent = currency.format(balance);
  elements.budgetStatus.textContent = `${currency.format(expenses)} sur ${currency.format(state.budgetLimit)}`;
  elements.budgetPercent.textContent = `${Math.round(percent)}%`;
  elements.budgetProgress.style.width = `${percent}%`;

  elements.transactionList.innerHTML = "";
  elements.emptyState.hidden = transactions.length > 0;

  transactions.forEach(transaction => {
    const item = document.createElement("article");
    item.className = "transaction-item";

    const sign = transaction.type === "income" ? "+" : "−";
    const icon = transaction.type === "income" ? "↗" : "↘";

    item.innerHTML = `
      <div class="transaction-icon">${icon}</div>
      <div class="transaction-copy">
        <strong>${escapeHtml(transaction.label)}</strong>
        <small>${escapeHtml(transaction.category)} · ${formatDate(transaction.date)}</small>
      </div>
      <div>
        <div class="amount ${transaction.type}">
          ${sign}${currency.format(transaction.amount)}
        </div>
        <button class="delete-transaction" data-id="${transaction.id}" aria-label="Supprimer">✕</button>
      </div>
    `;

    elements.transactionList.appendChild(item);
  });
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short"
  }).format(new Date(`${date}T12:00:00`));
}

function changeMonth(offset) {
  const [year, month] = state.selectedMonth.split("-").map(Number);
  const next = new Date(year, month - 1 + offset, 1);
  state.selectedMonth = next.toISOString().slice(0, 7);
  render();
}

function openModal() {
  elements.date.value = `${state.selectedMonth}-${String(new Date().getDate()).padStart(2, "0")}`;
  if (!elements.date.value.startsWith(state.selectedMonth)) {
    elements.date.value = `${state.selectedMonth}-01`;
  }
  elements.modal.showModal();
}

function closeModal() {
  elements.form.reset();
  elements.modal.close();
}

function exportData() {
  const payload = {
    app: "MyMobileApp",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      budgetLimit: state.budgetLimit,
      transactions: state.transactions
    }
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `MyMobileApp-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importData(file) {
  if (!file) return;

  try {
    const payload = JSON.parse(await file.text());
    const imported = payload.data ?? payload;

    if (!Array.isArray(imported.transactions)) {
      throw new Error("Format invalide");
    }

    state.budgetLimit = Number(imported.budgetLimit) || 1500;
    state.transactions = imported.transactions;
    saveState();
    render();
    alert("Import terminé.");
  } catch {
    alert("Impossible d'importer ce fichier JSON.");
  }
}

elements.form.addEventListener("submit", event => {
  event.preventDefault();

  const transaction = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    type: elements.type.value,
    label: elements.label.value.trim(),
    amount: Number(elements.amount.value),
    category: elements.category.value,
    date: elements.date.value,
    createdAt: Date.now()
  };

  if (!transaction.label || transaction.amount <= 0 || !transaction.date) {
    return;
  }

  state.transactions.push(transaction);
  saveState();
  closeModal();
  render();
});

document.querySelector("#prevMonth").addEventListener("click", () => changeMonth(-1));
document.querySelector("#nextMonth").addEventListener("click", () => changeMonth(1));
document.querySelector("#openTransactionModal").addEventListener("click", openModal);
document.querySelector("#closeTransactionModal").addEventListener("click", closeModal);
document.querySelector("#cancelTransaction").addEventListener("click", closeModal);
document.querySelector("#exportData").addEventListener("click", exportData);

document.querySelector("#importData").addEventListener("change", event => {
  importData(event.target.files[0]);
  event.target.value = "";
});

document.querySelector("#resetData").addEventListener("click", () => {
  if (!confirm("Supprimer toutes les données locales ?")) return;
  state.transactions = [];
  saveState();
  render();
});

elements.transactionList.addEventListener("click", event => {
  const button = event.target.closest("[data-id]");
  if (!button) return;

  state.transactions = state.transactions.filter(item => item.id !== button.dataset.id);
  saveState();
  render();
});

document.querySelector("#themeToggle").addEventListener("click", () => {
  const current = document.documentElement.dataset.theme;
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
});

const savedTheme = localStorage.getItem(THEME_KEY);
if (savedTheme) {
  document.documentElement.dataset.theme = savedTheme;
} else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
  document.documentElement.dataset.theme = "dark";
}

loadState();
render();
