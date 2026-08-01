import { getSetting, saveSetting } from "./database.js?v=28";

const STORAGE_KEY = "carMaintenanceRecords";
const CATEGORIES = [
  "Vidange",
  "Pneus",
  "Freins",
  "Révision",
  "Contrôle technique",
  "Batterie",
  "Distribution",
  "Climatisation",
  "Carrosserie",
  "Assurance",
  "Autre"
];

const currency = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const number = new Intl.NumberFormat("fr-FR");
let records = [];

function $(selector) {
  return document.querySelector(selector);
}

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = String(value ?? "");
  return node.innerHTML;
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));
}

function normalizeRecord(item) {
  const price = Number(item?.price);
  const mileage = item?.mileage === "" || item?.mileage == null ? null : Number(item.mileage);
  if (
    !item || typeof item.id !== "string" || !item.id ||
    !CATEGORIES.includes(item.category) || !isValidDate(item.date) ||
    !Number.isFinite(price) || price < 0 || price > 1000000 ||
    (mileage !== null && (!Number.isFinite(mileage) || mileage < 0 || mileage > 5000000))
  ) return null;

  return {
    id: item.id,
    category: item.category,
    date: item.date,
    price: Math.round(price * 100) / 100,
    mileage: mileage === null ? null : Math.round(mileage),
    nextDate: isValidDate(item.nextDate) ? item.nextDate : "",
    note: String(item.note ?? "").slice(0, 240),
    createdAt: Number(item.createdAt) || Date.now()
  };
}

async function persist() {
  await saveSetting(STORAGE_KEY, records);
}

function updateSummary() {
  $("#carTotalCost").textContent = currency.format(records.reduce((sum, item) => sum + item.price, 0));
  $("#carMaintenanceCount").textContent = String(records.length);

  const today = localDateKey();
  const overdue = records
    .filter(item => item.nextDate && item.nextDate < today)
    .sort((a, b) => b.nextDate.localeCompare(a.nextDate))[0];
  const upcoming = records
    .filter(item => item.nextDate && item.nextDate >= today)
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate))[0];
  const next = overdue || upcoming;

  $("#carNextDue").textContent = next ? formatDate(next.nextDate) : "Aucune";
  $("#carNextDueDetail").textContent = next
    ? `${overdue ? "En retard · " : ""}${next.category}`
    : "Rien de planifié";
  $("#carNextDueDetail").classList.toggle("is-overdue", Boolean(overdue));
}

function filteredRecords() {
  const query = $("#carSearch").value.trim().toLowerCase();
  const category = $("#carCategoryFilter").value;
  return records
    .filter(item => category === "all" || item.category === category)
    .filter(item => !query || `${item.category} ${item.note}`.toLowerCase().includes(query))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

function render() {
  updateSummary();
  const list = filteredRecords();
  const container = $("#carMaintenanceList");
  $("#carEmptyState").hidden = list.length > 0;
  container.innerHTML = list.map(item => `
    <article class="car-maintenance-item">
      <div class="car-maintenance-icon">${escapeHtml(item.category.slice(0, 2).toUpperCase())}</div>
      <div class="car-maintenance-copy">
        <div class="car-maintenance-title">
          <strong>${escapeHtml(item.category)}</strong>
          <span>${currency.format(item.price)}</span>
        </div>
        <p>${formatDate(item.date)}${item.mileage !== null ? ` · ${number.format(item.mileage)} km` : ""}</p>
        ${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}
        ${item.nextDate ? `<div class="car-next-badge${item.nextDate < localDateKey() ? " is-overdue" : ""}">${item.nextDate < localDateKey() ? "Échéance dépassée" : "Prochaine échéance"} : ${formatDate(item.nextDate)}</div>` : ""}
      </div>
      <button class="delete-car-maintenance" type="button" data-car-id="${escapeHtml(item.id)}" aria-label="Supprimer cet entretien">×</button>
    </article>
  `).join("");
}

function openModal() {
  const form = $("#carMaintenanceForm");
  form.reset();
  $("#carMaintenanceCategory").value = CATEGORIES[0];
  $("#carMaintenanceDate").value = localDateKey();
  $("#carMaintenanceModal").showModal();
}

function closeModal() {
  $("#carMaintenanceForm").reset();
  $("#carMaintenanceModal").close();
}

export async function initializeMyCar(showToast) {
  const categoryInput = $("#carMaintenanceCategory");
  const categoryFilter = $("#carCategoryFilter");
  CATEGORIES.forEach(category => {
    categoryInput.add(new Option(category, category));
    categoryFilter.add(new Option(category, category));
  });

  await reloadMyCarData();

  $("#openCarMaintenanceModal").onclick = openModal;
  $("#closeCarMaintenanceModal").onclick = closeModal;
  $("#cancelCarMaintenance").onclick = closeModal;
  $("#carSearch").addEventListener("input", render);
  $("#carCategoryFilter").addEventListener("change", render);

  $("#carMaintenanceForm").addEventListener("submit", async event => {
    event.preventDefault();
    const price = Number($("#carMaintenancePrice").value);
    const mileageValue = $("#carMaintenanceMileage").value;
    const record = normalizeRecord({
      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      category: $("#carMaintenanceCategory").value,
      date: $("#carMaintenanceDate").value,
      price,
      mileage: mileageValue,
      nextDate: $("#carMaintenanceNextDate").value,
      note: $("#carMaintenanceNote").value.trim(),
      createdAt: Date.now()
    });

    if (!record) {
      showToast("Vérifie les informations de l’entretien");
      return;
    }

    try {
      records.push(record);
      await persist();
      closeModal();
      render();
      showToast("Entretien enregistré");
    } catch (error) {
      records = records.filter(item => item.id !== record.id);
      console.error(error);
      showToast("Enregistrement impossible");
    }
  });

  $("#carMaintenanceList").addEventListener("click", async event => {
    const button = event.target.closest("[data-car-id]");
    if (!button || !confirm("Supprimer cet entretien ?")) return;
    const previous = records;
    records = records.filter(item => item.id !== button.dataset.carId);
    try {
      await persist();
      render();
      showToast("Entretien supprimé");
    } catch (error) {
      records = previous;
      console.error(error);
      showToast("Suppression impossible");
    }
  });
}

export async function reloadMyCarData() {
  const stored = await getSetting(STORAGE_KEY, []);
  records = Array.isArray(stored) ? stored.map(normalizeRecord).filter(Boolean) : [];
  render();
}
