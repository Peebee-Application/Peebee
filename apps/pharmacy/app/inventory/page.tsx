"use client";

import {
  AlertCircle,
  Calendar,
  Check,
  ChevronRight,
  Filter,
  Package,
  Pill,
  Plus,
  Search,
  ShieldAlert,
  Tag,
  X,
} from "lucide-react";
import { useState } from "react";

const ugx = (val: number) => `UGX ${val.toLocaleString()}`;

interface MedicineItem {
  id: string;
  name: string;
  activeIngredient: string;
  category: string;
  dosageForm: string;
  strength: string;
  packSize: string;
  price: number;
  stock: number;
  batchNumber: string;
  expiryDate: string;
  rxRequired: boolean;
}

const INITIAL_MEDICINES: MedicineItem[] = [
  {
    id: "med_1",
    name: "Panadol Extra",
    activeIngredient: "Paracetamol 500mg, Caffeine 65mg",
    category: "Pain & Fever",
    dosageForm: "Tablets",
    strength: "500mg/65mg",
    packSize: "Pack of 24",
    price: 6500,
    stock: 120,
    batchNumber: "BX-2026-09",
    expiryDate: "11/2027",
    rxRequired: false,
  },
  {
    id: "med_2",
    name: "Amoxil (Amoxicillin)",
    activeIngredient: "Amoxicillin Trihydrate",
    category: "Antibiotics",
    dosageForm: "Capsules",
    strength: "500mg",
    packSize: "Strip of 20",
    price: 18000,
    stock: 45,
    batchNumber: "AMX-8812",
    expiryDate: "06/2027",
    rxRequired: true,
  },
  {
    id: "med_3",
    name: "Piriton Allergy Relief",
    activeIngredient: "Chlorpheniramine Maleate",
    category: "Cold & Allergy",
    dosageForm: "Tablets",
    strength: "4mg",
    packSize: "Strip of 30",
    price: 5000,
    stock: 85,
    batchNumber: "PRT-402",
    expiryDate: "03/2028",
    rxRequired: false,
  },
  {
    id: "med_4",
    name: "Ascoril Expectorant Syrup",
    activeIngredient: "Terbutaline, Guaiphenesin, Bromhexine",
    category: "Cold & Allergy",
    dosageForm: "Syrup",
    strength: "100ml",
    packSize: "Bottle of 100ml",
    price: 16000,
    stock: 35,
    batchNumber: "ASC-190",
    expiryDate: "08/2027",
    rxRequired: false,
  },
  {
    id: "med_5",
    name: "Amlodipine Besylate",
    activeIngredient: "Amlodipine",
    category: "Chronic Care",
    dosageForm: "Tablets",
    strength: "5mg",
    packSize: "Box of 28",
    price: 14500,
    stock: 60,
    batchNumber: "AML-991",
    expiryDate: "10/2027",
    rxRequired: true,
  },
  {
    id: "med_6",
    name: "Omeprazole Gastro-Resistant",
    activeIngredient: "Omeprazole",
    category: "Digestion",
    dosageForm: "Capsules",
    strength: "20mg",
    packSize: "Strip of 14",
    price: 10000,
    stock: 75,
    batchNumber: "OMP-514",
    expiryDate: "12/2027",
    rxRequired: false,
  },
  {
    id: "med_7",
    name: "Ventolin Evohaler",
    activeIngredient: "Salbutamol Sulfate",
    category: "Respiratory",
    dosageForm: "Inhaler",
    strength: "100mcg (200 Doses)",
    packSize: "1 Inhaler",
    price: 26000,
    stock: 22,
    batchNumber: "VNT-774",
    expiryDate: "05/2027",
    rxRequired: true,
  },
];

const CATEGORIES = [
  "All",
  "Pain & Fever",
  "Antibiotics",
  "Cold & Allergy",
  "Chronic Care",
  "Digestion",
  "Respiratory",
];

export default function PharmacyInventoryPage() {
  const [medicines, setMedicines] = useState<MedicineItem[]>(INITIAL_MEDICINES);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);

  // New Medicine form states
  const [newName, setNewName] = useState("");
  const [newIngredient, setNewIngredient] = useState("");
  const [newCategory, setNewCategory] = useState("Pain & Fever");
  const [newForm, setNewForm] = useState("Tablets");
  const [newStrength, setNewStrength] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newStock, setNewStock] = useState("");
  const [newBatch, setNewBatch] = useState("");
  const [newExpiry, setNewExpiry] = useState("");
  const [newRxRequired, setNewRxRequired] = useState(false);

  const toggleRxRequired = (id: string) => {
    setMedicines((prev) =>
      prev.map((m) => (m.id === id ? { ...m, rxRequired: !m.rxRequired } : m))
    );
  };

  const handleAddMedicine = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newPrice) return;

    const item: MedicineItem = {
      id: "med_" + Math.random().toString(36).substring(2, 7),
      name: newName,
      activeIngredient: newIngredient || newName,
      category: newCategory,
      dosageForm: newForm,
      strength: newStrength || "Standard",
      packSize: "Standard Unit",
      price: parseInt(newPrice, 10) || 5000,
      stock: parseInt(newStock, 10) || 50,
      batchNumber: newBatch || "BATCH-2026",
      expiryDate: newExpiry || "12/2027",
      rxRequired: newRxRequired,
    };

    setMedicines([item, ...medicines]);
    setAddModalOpen(false);

    // Reset form
    setNewName("");
    setNewIngredient("");
    setNewPrice("");
    setNewStock("");
    setNewBatch("");
    setNewExpiry("");
    setNewRxRequired(false);
  };

  const filtered = medicines.filter((m) => {
    const matchCat =
      selectedCategory === "All" || m.category === selectedCategory;
    const matchSearch =
      !search ||
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.activeIngredient.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div className="space-y-4">
      {/* Header & Add Button */}
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-black text-ink"><Pill className="h-7 w-7 text-gold" aria-hidden /> Medicines</h1>

        <button
          type="button"
          onClick={() => setAddModalOpen(true)}
          className="flex items-center gap-1.5 min-h-14 rounded-2xl bg-gold px-4 text-lg font-black text-ink-gold shadow-sm transition hover:opacity-95 active:scale-95"
        >
          <Plus className="h-4 w-4" />
          <span>Add</span>
        </button>
      </div>

      {/* Search Input */}
      <div className="field-box relative flex items-center rounded-2xl border border-[var(--border-faint)] px-3.5 py-2.5 shadow-sm">
        <Search className="h-4 w-4 text-ink-500 shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search medicines"
          className="w-full bg-transparent px-2.5 text-base text-ink placeholder:text-ink-500/60 focus:outline-none"
        />
        {search && (
          <button type="button" onClick={() => setSearch("")}>
            <X className="h-3.5 w-3.5 text-ink-500" />
          </button>
        )}
      </div>

      {/* Categories Bar */}
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        {CATEGORIES.map((c) => {
          const active = selectedCategory === c;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setSelectedCategory(c)}
              className={`shrink-0 rounded-2xl px-3.5 py-1.5 text-base font-bold transition active:scale-95 ${
                active
                  ? "bg-gold text-ink-gold font-black shadow-sm"
                  : "border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-ink-500"
              }`}
            >
              {c}
            </button>
          );
        })}
      </div>

      {/* Medicines List */}
      <div className="space-y-2.5">
        {(showAll ? filtered : filtered.slice(0, 8)).map((m) => (
          <article
            key={m.id}
            className="home-card !p-4 shadow-sm space-y-2.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-black text-ink">{m.name}</h2>
                  <span className="rounded-md bg-gold/15 px-1.5 py-0.5 text-sm font-black text-gold">
                    {m.dosageForm}
                  </span>
                </div>
                <p className="text-base font-semibold text-gold mt-0.5">
                  {m.activeIngredient}
                </p>
                <p className="text-sm text-ink-500 mt-0.5">
                  Strength: {m.strength} · {m.packSize}
                </p>
              </div>

              <div className="text-right shrink-0">
                <span className="font-mono text-lg font-black text-ink">
                  {ugx(m.price)}
                </span>
                <p className="text-sm text-ink-500 font-semibold mt-0.5">
                  {m.stock} in stock
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-2xl bg-[rgb(var(--surface-muted))] px-3 py-3 text-sm">
              <span className="text-ink-500">
                Batch: <strong className="text-ink">{m.batchNumber}</strong> · Exp:{" "}
                <strong className="text-ink">{m.expiryDate}</strong>
              </span>

              {/* Rx Required Toggle */}
              <button
                type="button"
                onClick={() => toggleRxRequired(m.id)}
                className={`flex min-h-12 items-center justify-center gap-1.5 rounded-full px-4 text-base font-black transition active:scale-95 ${
                  m.rxRequired
                    ? "bg-red-500/15 text-red-600"
                    : "bg-green-600/15 text-green-600"
                }`}
              >
                {m.rxRequired ? (
                  <>
                    <ShieldAlert className="h-3 w-3" />
                    <span>Rx only</span>
                  </>
                ) : (
                  <>
                    <Check className="h-3 w-3" />
                    <span>OTC</span>
                  </>
                )}
              </button>
            </div>
          </article>
        ))}
      </div>

      {filtered.length > 8 && !showAll && (
        <button type="button" onClick={() => setShowAll(true)} className="flex min-h-14 w-full items-center justify-center text-lg font-bold text-gold">Show all {filtered.length}</button>
      )}

      {/* Add Medicine Modal */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4 animate-fade-in backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-t-3xl sm:home-card !p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-[var(--border-faint)]">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gold/20 text-gold">
                  <Pill className="h-4 w-4" />
                </span>
                <h3 className="text-base font-black text-ink">Add New Medicine</h3>
              </div>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="rounded-full p-1.5 text-ink-500 hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAddMedicine} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-base font-bold text-ink-500">Brand / Medicine Name</label>
                <div className="field-box rounded-2xl border border-[var(--border-faint)]">
                  <input
                    type="text"
                    required
                    placeholder="e.g. Panadol Extra"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full bg-transparent px-3 py-2 text-base text-ink focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-base font-bold text-ink-500">Active Chemical / Ingredient</label>
                <div className="field-box rounded-2xl border border-[var(--border-faint)]">
                  <input
                    type="text"
                    placeholder="e.g. Paracetamol 500mg, Caffeine 65mg"
                    value={newIngredient}
                    onChange={(e) => setNewIngredient(e.target.value)}
                    className="w-full bg-transparent px-3 py-2 text-base text-ink focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-base font-bold text-ink-500">Therapeutic Category</label>
                  <div className="field-box rounded-2xl border border-[var(--border-faint)]">
                    <select
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      className="w-full bg-transparent px-3 py-2 text-base text-ink focus:outline-none"
                    >
                      {CATEGORIES.filter((c) => c !== "All").map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-base font-bold text-ink-500">Dosage Form</label>
                  <div className="field-box rounded-2xl border border-[var(--border-faint)]">
                    <select
                      value={newForm}
                      onChange={(e) => setNewForm(e.target.value)}
                      className="w-full bg-transparent px-3 py-2 text-base text-ink focus:outline-none"
                    >
                      <option value="Tablets">Tablets</option>
                      <option value="Capsules">Capsules</option>
                      <option value="Syrup">Syrup</option>
                      <option value="Inhaler">Inhaler</option>
                      <option value="Drops">Drops</option>
                      <option value="Topical Cream">Topical Cream</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-base font-bold text-ink-500">Retail Price (UGX)</label>
                  <div className="field-box rounded-2xl border border-[var(--border-faint)]">
                    <input
                      type="number"
                      required
                      placeholder="e.g. 6500"
                      value={newPrice}
                      onChange={(e) => setNewPrice(e.target.value)}
                      className="w-full bg-transparent px-3 py-2 text-base text-ink focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-base font-bold text-ink-500">Stock Quantity</label>
                  <div className="field-box rounded-2xl border border-[var(--border-faint)]">
                    <input
                      type="number"
                      placeholder="e.g. 100"
                      value={newStock}
                      onChange={(e) => setNewStock(e.target.value)}
                      className="w-full bg-transparent px-3 py-2 text-base text-ink focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-base font-bold text-ink-500">Batch Number</label>
                  <div className="field-box rounded-2xl border border-[var(--border-faint)]">
                    <input
                      type="text"
                      placeholder="e.g. BATCH-2026-X"
                      value={newBatch}
                      onChange={(e) => setNewBatch(e.target.value)}
                      className="w-full bg-transparent px-3 py-2 text-base text-ink focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-base font-bold text-ink-500">Expiry Date (MM/YYYY)</label>
                  <div className="field-box rounded-2xl border border-[var(--border-faint)]">
                    <input
                      type="text"
                      placeholder="e.g. 11/2027"
                      value={newExpiry}
                      onChange={(e) => setNewExpiry(e.target.value)}
                      className="w-full bg-transparent px-3 py-2 text-base text-ink focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Rx Required Switch */}
              <div className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
                <div>
                  <span className="text-base font-bold text-ink">Prescription Required (Rx Only)</span>
                  <p className="text-sm text-ink-500">
                    If enabled, customer must upload doctor slip before dispensing
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={newRxRequired}
                  onChange={(e) => setNewRxRequired(e.target.checked)}
                  className="h-5 w-5 accent-gold"
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-2xl bg-gold py-3 text-base font-black text-ink-gold shadow transition hover:opacity-95 active:scale-98"
              >
                Save to Pharmacy Inventory
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
