export type CatalogItem = { id: string; name: string; price: number; category: string };

const KEY = "mokhtar_catalog_v1";

export function loadCatalog(): CatalogItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultCatalog();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultCatalog();
    return parsed;
  } catch {
    return defaultCatalog();
  }
}

export function saveCatalog(items: CatalogItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

function defaultCatalog(): CatalogItem[] {
  const seed = [
    { name: "Screen Protector", price: 5, category: "Accessories" },
    { name: "Charger", price: 10, category: "Accessories" },
    { name: "Repair (small)", price: 15, category: "Repair" },
    { name: "Wish Transfer", price: 1, category: "Wish Money" },
  ];
  return seed.map((s, i) => ({ id: `seed-${i}`, ...s }));
}
