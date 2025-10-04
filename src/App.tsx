import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";

/** ---------- Types ---------- */
type Part = { id: string; sku: string; label: string; created_at?: string };
type Supplier = { id: string; name: string; site_url?: string | null; created_at?: string };
type SupplierRef = {
  id: string; part_id: string; supplier_id: string; supplier_ref: string;
  product_url?: string | null; created_at?: string; part?: Part; supplier?: Supplier;
};
type Offer = {
  id: number; supplier_part_ref_id: string; price: number; currency: string;
  qty_available?: number | null; noted_at: string;
  ref?: SupplierRef & { supplier?: Supplier; part?: Part };
};
type Order = {
  id: string; supplier_id?: string | null; site?: string | null;
  status: "draft" | "ordered" | "partially_received" | "received" | "cancelled";
  external_ref?: string | null; ordered_at?: string | null; created_at: string;
  supplier?: Supplier | null;
};
type OrderItem = {
  id: string; order_id: string; part_id: string | null; supplier_ref?: string | null;
  qty: number; unit_price?: number | null; currency?: string | null; created_at?: string;
  part?: Part | null;
};
type InventoryRow = {
  site: string;
  part_id: string;
  condition: "neuf" | "rec" | "occ";
  qty_on_hand: number;
  location: string | null;
  updated_at: string;
};
type SiteRow = { id: string; name: string; note?: string | null; created_at: string };

type PendingRef = {
  id: string;
  supplier_id: string;
  supplier_ref: string;
  product_url?: string | null;
  note?: string | null;
  created_by: string;
  created_at: string;
  supplier?: Supplier | null;
};

/** ---------- Mini toasts ---------- */
type ToastKind = "success" | "error" | "info";
type Toast = { id: string; kind: ToastKind; text: string };

function Toasts({ items, onClose }: { items: Toast[]; onClose: (id: string) => void }) {
  return (
    <div style={{ position: "fixed", right: 16, bottom: 16, display: "grid", gap: 8, zIndex: 9999, maxWidth: 360 }}>
      {items.map(t => (
        <div key={t.id}
          style={{
            padding: "10px 12px", borderRadius: 10,
            background: t.kind === "error" ? "#fee2e2" : t.kind === "success" ? "#e7f6ed" : "#eef2ff",
            color: "#111", boxShadow: "0 4px 14px rgba(0,0,0,.08)", border: "1px solid rgba(0,0,0,.06)"
          }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div><b style={{ textTransform: "capitalize" }}>{t.kind}</b> — {t.text}</div>
            <button onClick={() => onClose(t.id)} style={{ border: "none", background: "transparent", cursor: "pointer" }}>×</button>
          </div>
        </div>
      ))}
    </div>
  );
}
function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  function notify(text: string, kind: ToastKind = "info") {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, text, kind }]);
    setTimeout(() => dismiss(id), 3500);
  }
  function dismiss(id: string) { setToasts(prev => prev.filter(t => t.id !== id)); }
  return { toasts, notify, dismiss };
}

/** ---------- Utils ---------- */
function fmtDate(d: string | Date) { try { return new Date(d).toLocaleString(); } catch { return String(d); } }
type TabKey = "db" | "orders" | "transfer" | "inventory" | "admin";
const CONDITION_LABEL: Record<InventoryRow["condition"], string> = { neuf: "Neuf", rec: "Reconditionné", occ: "Occasion" };
const CONDITION_VALUES = ["neuf", "rec", "occ"] as const;

/** =========================================================
 *                         APP
 *  ========================================================= */
export default function App() {
  /** ---- Auth ---- */
  const [session, setSession] = useState<Session | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const { toasts, notify, dismiss } = useToasts();

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => { if (!cancelled) { setSession(data.session); setAuthReady(true); } });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => { setSession(sess); setAuthReady(true); });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);
  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!authEmail || !authPassword) return;
    setAuthLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    setAuthLoading(false);
    if (error) notify(error.message, "error");
  }
  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    if (!authEmail || !authPassword) return;
    setAuthLoading(true);
    const { error } = await supabase.auth.signUp({ email: authEmail, password: authPassword });
    setAuthLoading(false);
    if (error) notify(error.message, "error");
    else notify("Compte créé. Connecte-toi.", "success");
  }
  async function signOut() { await supabase.auth.signOut(); }

  /** ---- Profil / Admin ---- */
  const [isAdmin, setIsAdmin] = useState(false);
  const [mySite, setMySite] = useState("");

  /** ---- Onglet actif ---- */
  const [activeTab, setActiveTab] = useState<TabKey>("db");

  /** ---- Admin: users + suppliers + sites ---- */
  const [allUsers, setAllUsers] = useState<{ id: string; email: string | null; site: string | null }[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierName, setSupplierName] = useState("");
  const [supplierUrl, setSupplierUrl] = useState("");
  const [loadingSupplier, setLoadingSupplier] = useState(false);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteName, setSiteName] = useState("");
  const [siteNote, setSiteNote] = useState("");

  /** ---- Pièces & Références ---- */
  const [sku, setSku] = useState("");
  const [label, setLabel] = useState("");
  const [parts, setParts] = useState<Part[]>([]);
  const [loadingPart, setLoadingPart] = useState(false);
  const [partsQuery, setPartsQuery] = useState("");

  const [refs, setRefs] = useState<SupplierRef[]>([]);
  const [selectedPartId, setSelectedPartId] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [loadingRef, setLoadingRef] = useState(false);

  /** ---- Offres ---- */
  const [offers, setOffers] = useState<Offer[]>([]);
  const [offerPartId, setOfferPartId] = useState("");
  const [offerRefId, setOfferRefId] = useState("");
  const [offerPrice, setOfferPrice] = useState("");
  const [offerQty, setOfferQty] = useState("");
  const [loadingOffer, setLoadingOffer] = useState(false);

  /** ---- Commandes ---- */
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersQuery, setOrdersQuery] = useState("");
  const [newOrderSupplierId, setNewOrderSupplierId] = useState("");
  const [newOrderSite, setNewOrderSite] = useState("");
  const [newOrderExternalRef, setNewOrderExternalRef] = useState("");
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [activeOrderId, setActiveOrderId] = useState<string>("");

  /** ---- Lignes + Réception ---- */
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [receivedByItem, setReceivedByItem] = useState<Record<string, number>>({});
  const [oiPartId, setOiPartId] = useState("");
  const [oiSupplierRef, setOiSupplierRef] = useState("");
  const [oiQty, setOiQty] = useState("");
  const [oiUnitPrice, setOiUnitPrice] = useState("");
  const [addingItem] = useState(false); // désactive bouton si besoin, sans setter

  /** ---- Inventaire (avec état + emplacement) ---- */
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [receiveSite, setReceiveSite] = useState("");
  const [toReceive, setToReceive] = useState<Record<string, string>>({});
  const [receiveCondByItem, setReceiveCondByItem] = useState<Record<string, InventoryRow["condition"]>>({});
  const [receiveLocByPart, setReceiveLocByPart] = useState<Record<string, string>>({}); // key: `${site}|${part_id}`

  // Filtres & tri inventaire
  const [invSiteFilter, setInvSiteFilter] = useState<string>("");
  const [invQuery, setInvQuery] = useState<string>("");
  const [invCondFilter, setInvCondFilter] = useState<InventoryRow["condition"] | "">("");
  type InvSortKey = "site" | "part" | "condition" | "qty" | "location" | "updated";
  const [invSortKey] = useState<InvSortKey>("site");
  const [invSortDir] = useState<"asc" | "desc">("asc");

  // Groupes inventaire (pliés/dépliés)
  const [invExpanded, setInvExpanded] = useState<Record<string, boolean>>({});
  function toggleInvGroup(key: string) { setInvExpanded(prev => ({ ...prev, [key]: !prev[key] })); }

  /** ---- À référencer (admin) ---- */
  const [pendingRefs, setPendingRefs] = useState<PendingRef[]>([]);
  const [pendingNote, setPendingNote] = useState<Record<string, string>>({});
  const [pendingUrl, setPendingUrl] = useState<Record<string, string>>({});
  const [pendingPart, setPendingPart] = useState<Record<string, string>>({});

  /** ---------- Loaders ---------- */
  async function loadProfileAndMaybeUsers() {
    if (!session) return;
    const { data: isAdm } = await supabase.rpc("is_admin");
    setIsAdmin(!!isAdm);

    const { data: prof } = await supabase.from("profiles").select("admin, site").eq("id", session.user.id).single();
    if (prof) {
      setIsAdmin(isAdm ?? !!prof.admin);
      setMySite(prof.site || "");
      if (prof.site) { setNewOrderSite(prof.site); setReceiveSite(prev => prev || prof.site); }
    }
    if (isAdm) {
      const { data } = await supabase.rpc("list_users");
      if (data) setAllUsers(data as any);
      await loadPendingRefs();
    }
  }

  async function loadParts() {
    const { data, error } = await supabase.from("parts").select("*").order("created_at", { ascending: false });
    if (error) notify(error.message, "error"); else setParts((data || []) as Part[]);
  }
  async function addPart(e: React.FormEvent) {
    e.preventDefault();
    if (!sku.trim() || !label.trim()) return;
    setLoadingPart(true);
    const { error } = await supabase.from("parts").insert({ sku: sku.trim(), label: label.trim() });
    setLoadingPart(false);
    if (error) return notify(error.message, "error");
    setSku(""); setLabel(""); await loadParts(); notify("Pièce ajoutée", "success");
  }

  async function loadSuppliers() {
    const { data, error } = await supabase.from("suppliers").select("*").order("created_at", { ascending: false });
    if (error) notify(error.message, "error"); else setSuppliers((data || []) as Supplier[]);
  }
  async function addSupplier(e: React.FormEvent) {
    e.preventDefault(); if (!supplierName.trim()) return;
    setLoadingSupplier(true);
    const { error } = await supabase.from("suppliers").insert({ name: supplierName.trim(), site_url: supplierUrl || null });
    setLoadingSupplier(false);
    if (error) return notify(error.message, "error");
    setSupplierName(""); setSupplierUrl(""); await loadSuppliers(); notify("Fournisseur ajouté", "success");
  }

  async function loadSites() {
    const { data, error } = await supabase.from("sites").select("*").order("name");
    if (error) notify(error.message, "error"); else setSites((data || []) as SiteRow[]);
  }
  async function addSite(e: React.FormEvent) {
    e.preventDefault();
    if (!siteName.trim()) return;
    const { error } = await supabase.from("sites").insert({ name: siteName.trim(), note: siteNote || null });
    if (error) return notify(error.message, "error");
    setSiteName(""); setSiteNote("");
    await loadSites(); notify("Site ajouté", "success");
  }

  async function loadSupplierRefs() {
    const { data, error } = await supabase
      .from("supplier_part_refs")
      .select(`id, part_id, supplier_id, supplier_ref, product_url, created_at,
               part:parts(id, sku, label),
               supplier:suppliers(id, name, site_url)`)
      .order("created_at", { ascending: false });
    if (error) notify(error.message, "error"); else setRefs((data || []) as any);
  }
  async function addSupplierRef(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPartId || !selectedSupplierId || !supplierRef.trim()) return;
    setLoadingRef(true);
    const { error } = await supabase.from("supplier_part_refs").insert({
      part_id: selectedPartId, supplier_id: selectedSupplierId,
      supplier_ref: supplierRef.trim(), product_url: productUrl || null,
    });
    setLoadingRef(false);
    if (error) { notify(error.message, "error"); return; }
    setSupplierRef(""); setProductUrl(""); setSelectedSupplierId("");
    await loadSupplierRefs(); notify("Référence liée", "success");
  }

  async function loadOffers() {
    const { data, error } = await supabase
      .from("offers")
      .select(`id, supplier_part_ref_id, price, currency, qty_available, noted_at,
               ref:supplier_part_refs(id, supplier_ref, product_url,
                 part:parts(id, sku, label),
                 supplier:suppliers(id, name, site_url))`)
      .order("noted_at", { ascending: false });
    if (error) notify(error.message, "error"); else setOffers((data || []) as any);
  }

  async function loadOrders() {
    const { data, error } = await supabase
      .from("orders")
      .select(`id, supplier_id, site, status, external_ref, ordered_at, created_at,
               supplier:suppliers(id, name, site_url)`)
      .order("created_at", { ascending: false });
    if (error) notify(error.message, "error"); else setOrders((data || []) as any);
  }
  async function createOrder(e: React.FormEvent) {
    e.preventDefault();
    const siteToUse = mySite || newOrderSite;
    if (!newOrderSupplierId || !siteToUse) return;
    setCreatingOrder(true);
    const { data, error } = await supabase.from("orders")
      .insert({ supplier_id: newOrderSupplierId, site: siteToUse, external_ref: newOrderExternalRef || null, status: "draft" })
      .select("id").single();
    setCreatingOrder(false);
    if (error) return notify(error.message, "error");
    setNewOrderExternalRef(""); if (!mySite) setNewOrderSite(""); setNewOrderSupplierId("");
    await loadOrders(); if (data?.id) setActiveOrderId(data.id as string); notify("Commande créée", "success");
  }

  async function loadOrderItems(orderId: string) {
    if (!orderId) return setOrderItems([]);
    const { data, error } = await supabase
      .from("order_items")
      .select(`id, order_id, part_id, supplier_ref, qty, unit_price, currency, created_at,
               part:parts(id, sku, label)`)
      .eq("order_id", orderId).order("created_at", { ascending: true });
    if (error) return notify(error.message, "error");
    setOrderItems((data || []) as any);

    if ((data || []).length) {
      const ids = (data as any[]).map(d => d.id);
      const { data: recAgg } = await supabase.from("receipt_items").select("order_item_id, qty_received").in("order_item_id", ids);
      const map: Record<string, number> = {};
      (recAgg || []).forEach((r: any) => { map[r.order_item_id] = (map[r.order_item_id] || 0) + Number(r.qty_received || 0); });
      setReceivedByItem(map);
    } else setReceivedByItem({});
  }

  // ---- À référencer (admin visible via RLS) ----
  async function loadPendingRefs() {
    const { data, error } = await supabase
      .from("pending_refs")
      .select(`id, supplier_id, supplier_ref, product_url, note, created_by, created_at,
               supplier:suppliers(id, name, site_url)`)
      .order("created_at", { ascending: false });
    if (error) { notify(error.message, "error"); return; }
    setPendingRefs((data || []) as any);
  }
  async function createPendingRef(supplierId: string, supplierRefVal: string) {
    const { error } = await supabase.from("pending_refs").insert({
      supplier_id: supplierId,
      supplier_ref: supplierRefVal.trim(),
      created_by: session!.user.id,
    });
    if (error) notify(error.message, "error");
  }
  async function approvePendingRef(row: PendingRef) {
    const partId = pendingPart[row.id];
    if (!partId) { notify("Sélectionne une pièce.", "error"); return; }
    const url = (pendingUrl[row.id] || "").trim() || null;

    const { error: insErr } = await supabase.from("supplier_part_refs").insert({
      part_id: partId,
      supplier_id: row.supplier_id,
      supplier_ref: row.supplier_ref,
      product_url: url,
    });
    if (insErr) return notify(insErr.message, "error");

    const { error: delErr } = await supabase.from("pending_refs").delete().eq("id", row.id);
    if (delErr) return notify(delErr.message, "error");

    // Auto-lier lignes de commandes orphelines
    const { data: ordIdsData, error: ordErr } = await supabase
      .from("orders")
      .select("id")
      .eq("supplier_id", row.supplier_id);

    if (!ordErr && (ordIdsData?.length || 0) > 0) {
      const ordIds = (ordIdsData || []).map(o => o.id);
      const { data: updData, error: updErr } = await supabase
        .from("order_items")
        .update({ part_id: partId })
        .in("order_id", ordIds)
        .is("part_id", null)
        .eq("supplier_ref", row.supplier_ref)
        .select("id");

      if (updErr) {
        notify(`Réf validée. Auto-liaison échouée: ${updErr.message}`, "error");
      } else {
        const n = updData?.length || 0;
        notify(`Référence validée. ${n} ligne${n>1?"s":""} auto-liée${n>1?"s":""}.`, "success");
        if (activeOrderId) await loadOrderItems(activeOrderId);
      }
    } else {
      notify("Référence validée. Aucune commande concernée à relier.", "success");
    }

    await loadSupplierRefs();
    await loadPendingRefs();
  }

  async function addOrderItem(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrderId) return;

    const qtyNumber = Number(oiQty);
    if (!Number.isFinite(qtyNumber) || qtyNumber <= 0) return notify("La quantité doit être > 0", "error");
    const unitPriceNumber = oiUnitPrice === "" ? null : Number(oiUnitPrice);
    if (unitPriceNumber !== null && (!Number.isFinite(unitPriceNumber) || unitPriceNumber < 0)) return notify("Prix unitaire invalide", "error");

    let partIdToUse = oiPartId;

    if (!partIdToUse && oiSupplierRef.trim()) {
      if (!newOrderSupplierId) return notify("Sélectionne un fournisseur pour utiliser la réf fournisseur.", "error");

      const { data: foundRef, error: findErr } = await supabase
        .from("supplier_part_refs")
        .select("id, part_id")
        .eq("supplier_id", newOrderSupplierId)
        .eq("supplier_ref", oiSupplierRef.trim())
        .maybeSingle();
      if (findErr) return notify(findErr.message, "error");

      if (foundRef?.part_id) {
        partIdToUse = foundRef.part_id as string;
      } else {
        await createPendingRef(newOrderSupplierId, oiSupplierRef);
        notify("Réf inconnue : ajoutée à « À référencer » (admin).", "info");

        const { error: insErr } = await supabase.from("order_items").insert({
          order_id: activeOrderId,
          part_id: null,
          supplier_ref: oiSupplierRef,
          qty: qtyNumber,
          unit_price: unitPriceNumber,
          currency: "EUR",
        });
        if (insErr) return notify(insErr.message, "error");

        setOiPartId(""); setOiSupplierRef(""); setOiQty(""); setOiUnitPrice("");
        await loadOrderItems(activeOrderId);
        return notify("Ligne ajoutée (pièce à référencer).", "success");
      }
    }

    if (!partIdToUse) return notify("Choisis une pièce ou saisis une réf fournisseur.", "error");

    const { error } = await supabase.from("order_items").insert({
      order_id: activeOrderId,
      part_id: partIdToUse,
      supplier_ref: oiSupplierRef || null,
      qty: qtyNumber,
      unit_price: unitPriceNumber,
      currency: "EUR",
    });
    if (error) return notify(error.message, "error");

    setOiPartId(""); setOiSupplierRef(""); setOiQty(""); setOiUnitPrice("");
    await loadOrderItems(activeOrderId);
    notify("Ligne ajoutée", "success");
  }
  async function setOrderStatus(orderId: string, next: "draft" | "ordered") {
    const { error } = await supabase.from("orders").update({ status: next }).eq("id", orderId);
    if (error) notify(error.message, "error"); else { await loadOrders(); notify(`Commande → ${next}`, "success"); }
  }

  async function loadInventory() {
    const { data, error } = await supabase.from("inventory").select("*").order("updated_at", { ascending: false });
    if (error) notify(error.message, "error"); else setInventory((data || []) as any);
  }

  async function doTransfer(e: React.FormEvent) {
    e.preventDefault();
    notify("Transfert avec état à venir.", "info");
  }

  /** ---------- Admin actions ---------- */
  async function assignSite(userId: string, siteName: string) {
    if (!siteName) return notify("Choisis un site.", "error");
    const { error } = await supabase.rpc("set_user_site", { target_user: userId, target_site: siteName });
    if (error) return notify(error.message, "error");
    setAllUsers(prev => prev.map(u => u.id === userId ? { ...u, site: siteName } : u));
    if (session?.user.id === userId) { setMySite(siteName); setNewOrderSite(siteName); setReceiveSite(siteName); }
    notify("Site assigné", "success");
  }

  /** ---------- Helpers ---------- */
  const activeOrder = useMemo(() => orders.find(o => o.id === activeOrderId), [orders, activeOrderId]);

  const knownLocationBySitePart = useMemo(() => {
    const m: Record<string, string> = {};
    for (const row of inventory) {
      if (row.location) {
        const key = `${row.site}|${row.part_id}`;
        if (!m[key]) m[key] = row.location;
      }
    }
    return m;
  }, [inventory]);

  function remainingFor(item: OrderItem) {
    const rec = receivedByItem[item.id] ?? 0;
    return Math.max((item.qty || 0) - rec, 0);
  }

  async function createReceiptWithItems() {
    if (!activeOrderId) return;
    const site = mySite || receiveSite || activeOrder?.site || "";
    if (!site) { notify("Renseigne un site de réception.", "error"); return; }

    const lines: { oi: OrderItem; qty: number; cond: InventoryRow["condition"]; loc?: string }[] = [];
    for (const it of orderItems) {
      const raw = toReceive[it.id]; if (!raw) continue;
      const q = Number(raw); if (!Number.isFinite(q) || q <= 0) continue;
      const max = remainingFor(it);
      if (q > max) { notify(`Qté pour "${it.part?.sku}" dépasse le restant (${q} > ${max}).`, "error"); return; }
      const cond = receiveCondByItem[it.id] || "neuf";
      const locKey = `${site}|${it.part_id}`;
      const existingLoc = knownLocationBySitePart[locKey];
      const loc = existingLoc || (receiveLocByPart[locKey] || "").trim() || undefined;
      if (!existingLoc && !loc) { notify(`Emplacement requis pour ${it.part?.sku} au site ${site}.`, "error"); return; }
      lines.push({ oi: it, qty: q, cond, loc });
    }
    if (lines.length === 0) { notify("Renseigne au moins une quantité à réceptionner.", "error"); return; }

    const { data: receipt, error: recErr } = await supabase
      .from("receipts")
      .insert({ order_id: activeOrderId, site })
      .select("id")
      .single();
    if (recErr) return notify(recErr.message, "error");

    const payload = lines.map(l => ({
      receipt_id: receipt!.id,
      order_item_id: l.oi.id,
      qty_received: l.qty,
      condition: l.cond,
      location: l.loc ?? null,
    }));
    const { error: riErr } = await supabase.from("receipt_items").insert(payload);
    if (riErr) return notify(riErr.message, "error");

    await loadOrderItems(activeOrderId);
    await loadInventory();
    await loadOrders();
    setToReceive({});
    notify("Réception enregistrée", "success");
  }

  // Inventaire : recherche/tri
  function matchesQuery(row: InventoryRow, q: string) {
    if (!q) return true;
    const part = parts.find(p => p.id === row.part_id);
    const hay = [row.site, row.part_id, part?.sku ?? "", part?.label ?? "", row.location ?? ""].join(" ").toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  const inventoryView = useMemo(() => {
    let rows = inventory.filter(r =>
      (!invSiteFilter || r.site === invSiteFilter) &&
      (!invCondFilter || r.condition === invCondFilter) &&
      matchesQuery(r, invQuery.trim())
    );

    rows = [...rows].sort((a, b) => {
      const dir = invSortDir === "asc" ? 1 : -1;
      const partA = parts.find(p => p.id === a.part_id);
      const partB = parts.find(p => p.id === b.part_id);
      switch (invSortKey) {
        case "site": return dir * a.site.localeCompare(b.site);
        case "condition": return dir * a.condition.localeCompare(b.condition);
        case "qty": return dir * (a.qty_on_hand - b.qty_on_hand);
        case "location": return dir * ((a.location || "").localeCompare(b.location || ""));
        case "updated": return dir * (new Date(a.updated_at).valueOf() - new Date(b.updated_at).valueOf());
        case "part":
        default: {
          const la = `${partA?.sku ?? ""} ${partA?.label ?? ""}`.trim();
          const lb = `${partB?.sku ?? ""} ${partB?.label ?? ""}`.trim();
          return dir * la.localeCompare(lb);
        }
      }
    });

    const totals = rows.reduce<Record<string, number>>((acc, r) => {
      const key = `${r.site} | ${CONDITION_LABEL[r.condition]}`;
      acc[key] = (acc[key] || 0) + (r.qty_on_hand || 0);
      return acc;
    }, {});

    return { rows, totals };
  }, [inventory, parts, invSiteFilter, invCondFilter, invQuery, invSortKey, invSortDir]);

  // Groupement par (site, part_id) avec sous-lignes par état
  type InvGroup = {
    key: string;
    site: string;
    part_id: string;
    partSku: string;
    partLabel: string;
    totalQty: number;
    rows: InventoryRow[];
  };
  const inventoryGrouped = useMemo<InvGroup[]>(() => {
    const byKey: Record<string, InvGroup> = {};
    for (const r of inventoryView.rows) {
      const p = parts.find(pp => pp.id === r.part_id);
      const key = `${r.site}|${r.part_id}`;
      if (!byKey[key]) {
        byKey[key] = {
          key,
          site: r.site,
          part_id: r.part_id,
          partSku: p?.sku ?? r.part_id,
          partLabel: p?.label ?? "",
          totalQty: 0,
          rows: [],
        };
      }
      byKey[key].rows.push(r);
      byKey[key].totalQty += r.qty_on_hand || 0;
    }
    const groups = Object.values(byKey);
    const dir = invSortDir === "asc" ? 1 : -1;
    groups.sort((a, b) => {
      if (invSortKey === "site") return dir * a.site.localeCompare(b.site);
      if (invSortKey === "qty") return dir * (a.totalQty - b.totalQty);
      const la = `${a.partSku} ${a.partLabel}`.trim();
      const lb = `${b.partSku} ${b.partLabel}`.trim();
      return dir * la.localeCompare(lb);
    });
    for (const g of groups) g.rows.sort((x, y) => x.condition.localeCompare(y.condition));
    return groups;
  }, [inventoryView.rows, parts, invSortKey, invSortDir]);

  async function updateInventoryLocation(row: InventoryRow, newLoc: string) {
    const { error } = await supabase
      .from("inventory")
      .update({ location: newLoc || null })
      .eq("site", row.site)
      .eq("part_id", row.part_id)
      .eq("condition", row.condition);
    if (error) notify(error.message, "error");
    else { notify("Emplacement mis à jour.", "success"); await loadInventory(); }
  }

  function exportInventoryCSV() {
    const headers = ["Site","SKU","Libellé","État","Quantité","Emplacement","MAJ"];
    const lines = inventoryView.rows.map(r => {
      const p = parts.find(pp => pp.id === r.part_id);
      const arr = [
        r.site,
        p?.sku ?? r.part_id,
        p?.label ?? "",
        CONDITION_LABEL[r.condition],
        String(r.qty_on_hand ?? 0),
        r.location ?? "",
        new Date(r.updated_at).toISOString()
      ].map(v => `"${String(v).replace(/"/g,'""')}"`);
      return arr.join(",");
    });
    const blob = new Blob([[headers.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `inventaire_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  /** ---------- Lifecycle ---------- */
  useEffect(() => {
    if (!session) return;
    loadProfileAndMaybeUsers();
    loadParts(); loadSuppliers(); loadSupplierRefs(); loadOffers();
    loadOrders(); loadInventory(); loadSites();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (activeOrderId) { loadOrderItems(activeOrderId); setReceiveSite(activeOrder?.site || mySite || ""); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrderId]);

  /** ---------- Tabs list ---------- */
  const tabs: { key: TabKey; label: string }[] = (() => {
    const base: { key: TabKey; label: string }[] = [
      { key: "db",        label: "Base de données" },
      { key: "orders",    label: "Commandes" },
      { key: "transfer",  label: "Transfert" },
      { key: "inventory", label: "Inventaire" },
    ];
    if (isAdmin) base.push({ key: "admin", label: "Administration" });
    return base;
  })();

  /** ---------- Guards ---------- */
  if (!authReady) {
    return (<div style={{ maxWidth: 480, margin: "10vh auto", padding: 24 }}>Chargement…<Toasts items={toasts} onClose={dismiss} /></div>);
  }
  if (!session) {
    return (
      <div style={{ maxWidth: 480, margin: "10vh auto", padding: 24 }}>
        <h1>Connexion</h1>
        <form onSubmit={signInWithPassword} style={{ display: "grid", gap: 12 }}>
          <div><label>Email</label><input type="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="vous@exemple.com" style={{ width: "100%", padding: 10 }} /></div>
          <div><label>Mot de passe</label><input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="••••••••" style={{ width: "100%", padding: 10 }} /></div>
          <button disabled={authLoading} style={{ padding: "10px 16px" }}>{authLoading ? "Connexion..." : "Se connecter"}</button>
          <button onClick={signUp} type="button" style={{ padding: "10px 16px" }}>Créer un compte</button>
        </form>
        <Toasts items={toasts} onClose={dismiss} />
      </div>
    );
  }

  /** ---------- UI ---------- */
  function Nav() {
    return (
      <nav style={{ position: "sticky", top: 0, zIndex: 10, background: "white", borderBottom: "1px solid #eee", marginBottom: 16 }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "12px 24px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontWeight: 700 }}>Inventaire pièces</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: 16 }}>
            {tabs.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                style={{ padding: "8px 12px", borderRadius: 999, border: activeTab === t.key ? "1px solid #6b8afd" : "1px solid #e5e7eb", background: activeTab === t.key ? "#eef2ff" : "white", cursor: "pointer" }}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, opacity: 0.8 }}>
              {session?.user?.email ?? ""} {mySite ? <span style={{ background:"#eef", padding:"2px 6px", borderRadius:6, marginLeft:6 }}>{mySite}</span> : ""}
            </span>
            <button onClick={signOut} style={{ padding: "6px 10px" }}>Déconnexion</button>
          </div>
        </div>
      </nav>
    );
  }

  return (
    <div>
      <Nav />
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: 24 }}>

        {/* ---------- BASE DE DONNÉES ---------- */}
        {activeTab === "db" && (
          <>
            {/* Pièces */}
            <section style={{ marginTop: 0 }}>
              <div style={{ display: "flex", alignItems: "end", gap: 12, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0 }}>Pièces</h2>
                <div style={{ marginLeft: "auto" }}>
                  <input value={partsQuery} onChange={(e) => setPartsQuery(e.target.value)} placeholder="Rechercher (SKU, libellé)…" style={{ padding: 8, minWidth: 260 }} />
                </div>
              </div>
              <form onSubmit={addPart} style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 2fr auto", alignItems: "end", marginTop: 10 }}>
                <div><label>SKU</label><input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="ex: ABC123" style={{ width: "100%", padding: 8 }} /></div>
                <div><label>Libellé</label><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex: Courroie 12mm" style={{ width: "100%", padding: 8 }} /></div>
                <button disabled={loadingPart} style={{ padding: "10px 16px" }}>{loadingPart ? "Ajout..." : "Ajouter"}</button>
              </form>
              <ul style={{ padding: 0, listStyle: "none", marginTop: 12 }}>
                {parts
                  .filter(p => (p.sku + " " + p.label).toLowerCase().includes(partsQuery.trim().toLowerCase()))
                  .map((p) => (
                  <li key={p.id} style={{ padding: 12, border: "1px solid #eee", marginBottom: 8, borderRadius: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div><b>{p.sku}</b> — {p.label}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* Références fournisseur */}
            <section style={{ marginTop: 32 }}>
              <h2>Références fournisseur</h2>
              <form onSubmit={addSupplierRef} style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr 1fr 2fr auto", alignItems: "end" }}>
                <div><label>Pièce</label>
                  <select value={selectedPartId} onChange={(e) => setSelectedPartId(e.target.value)} style={{ width: "100%", padding: 8 }}>
                    <option value="">— choisir —</option>
                    {parts.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.label}</option>)}
                  </select>
                </div>
                <div><label>Fournisseur</label>
                  <select value={selectedSupplierId} onChange={(e) => setSelectedSupplierId(e.target.value)} style={{ width: "100%", padding: 8 }}>
                    <option value="">— choisir —</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div><label>Réf fournisseur</label>
                  <input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} placeholder="ex: X-789" style={{ width: "100%", padding: 8 }} />
                </div>
                <div><label>URL produit (opt.)</label>
                  <input value={productUrl} onChange={(e) => setProductUrl(e.target.value)} placeholder="https://..." style={{ width: "100%", padding: 8 }} />
                </div>
                <button disabled={loadingRef} style={{ padding: "10px 16px" }}>{loadingRef ? "Ajout..." : "Lier"}</button>
              </form>
            </section>

            {/* Offres */}
            <section style={{ marginTop: 32 }}>
              <h2>Offres (prix / stock){offers ? ` (${offers.length})` : ""}</h2>
              <form onSubmit={() => {}} style={{ display: "grid", gap: 8, gridTemplateColumns: "1.2fr 1.8fr 1fr 1fr auto", alignItems: "end" }}>
                <div><label>Pièce</label>
                  <select value={offerPartId} onChange={(e) => { setOfferPartId(e.target.value); setOfferRefId(""); }} style={{ width: "100%", padding: 8 }}>
                    <option value="">— choisir —</option>
                    {parts.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.label}</option>)}
                  </select>
                </div>
                <div><label>Réf fournisseur</label>
                  <select value={offerRefId} onChange={(e) => setOfferRefId(e.target.value)} style={{ width: "100%", padding: 8 }}>
                    <option value=""></option>
                    {(offerPartId ? (refs.filter(r => r.part_id === offerPartId)) : []).map((r) => (
                      <option key={r.id} value={r.id}>
                        {(suppliers.find(s => s.id === r.supplier_id)?.name) || "Fournisseur"} — {r.supplier_ref}
                      </option>
                    ))}
                  </select>
                </div>
                <div><label>Prix (EUR)</label>
                  <input type="number" step="0.01" min={0} value={offerPrice} onChange={(e) => setOfferPrice(e.target.value)} placeholder="ex: 12.50" style={{ width: "100%", padding: 8 }} />
                </div>
                <div><label>Qté dispo (opt.)</label>
                  <input type="number" step={1} min={0} value={offerQty} onChange={(e) => setOfferQty(e.target.value)} placeholder="ex: 30" style={{ width: "100%", padding: 8 }} />
                </div>
                <button onClick={async (e) => {
                  e.preventDefault();
                  if (!offerRefId || offerPrice === "") return;
                  const priceNumber = Number(offerPrice);
                  if (!Number.isFinite(priceNumber) || priceNumber < 0) return notify("Prix invalide", "error");
                  const qtyNumber = offerQty === "" ? null : Number(offerQty);
                  if (qtyNumber !== null && (!Number.isFinite(qtyNumber) || qtyNumber < 0)) return notify("Quantité invalide", "error");
                  setLoadingOffer(true);
                  const { error } = await supabase.from("offers").insert({ supplier_part_ref_id: offerRefId, price: priceNumber, qty_available: qtyNumber });
                  setLoadingOffer(false);
                  if (error) return notify(error.message, "error");
                  setOfferPrice(""); setOfferQty(""); await loadOffers(); notify("Offre enregistrée", "success");
                }} style={{ padding: "10px 16px" }}>{loadingOffer ? "Ajout..." : "Enregistrer"}</button>
              </form>
            </section>
          </>
        )}

        {/* ---------- COMMANDES ---------- */}
        {activeTab === "orders" && (
          <section>
            <div style={{ display: "flex", alignItems: "end", gap: 12, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0 }}>Commandes</h2>
              <div style={{ marginLeft: "auto" }}>
                <input
                  value={ordersQuery}
                  onChange={(e) => setOrdersQuery(e.target.value)}
                  placeholder="Rechercher (fournisseur, site, statut, n°)…"
                  style={{ padding: 8, minWidth: 300 }}
                />
              </div>
            </div>

            {/* Créer une commande */}
            <form onSubmit={createOrder} style={{ display: "grid", gap: 8, gridTemplateColumns: "1.5fr 1fr 1fr auto", alignItems: "end", marginTop: 10 }}>
              <div><label>Fournisseur</label>
                <select value={newOrderSupplierId} onChange={(e) => setNewOrderSupplierId(e.target.value)} style={{ width: "100%", padding: 8 }}>
                  <option value="">— choisir —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div><label>Site de livraison</label>
                {mySite ? <input value={mySite} disabled style={{ width: "100%", padding: 8, background: "#f7f7f7" }} /> : (
                  <select value={newOrderSite} onChange={(e) => setNewOrderSite(e.target.value)} style={{ width: "100%", padding: 8 }}>
                    <option value="">— choisir —</option>
                    {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                )}
              </div>
              <div><label>N° commande (opt.)</label><input value={newOrderExternalRef} onChange={(e) => setNewOrderExternalRef(e.target.value)} placeholder="ex: PO-2025-001" style={{ width: "100%", padding: 8 }} /></div>
              <button disabled={creatingOrder} style={{ padding: "10px 16px" }}>{creatingOrder ? "Création..." : "Créer commande"}</button>
            </form>

            {/* Liste des commandes */}
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {orders
                .filter(o =>
                  (o.supplier?.name || "").toLowerCase().includes(ordersQuery.trim().toLowerCase()) ||
                  (o.external_ref || "").toLowerCase().includes(ordersQuery.trim().toLowerCase()) ||
                  (o.site || "").toLowerCase().includes(ordersQuery.trim().toLowerCase()) ||
                  (o.status || "").toLowerCase().includes(ordersQuery.trim().toLowerCase())
                )
                .map((o) => (
                  <div key={o.id}
                       onClick={() => { setActiveOrderId(o.id); setReceiveSite(o.site || mySite || ""); }}
                       style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, cursor: "pointer",
                                background: activeOrderId === o.id ? "#f0f7ff" : "white" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <div><b>{o.supplier?.name || "—"}</b> · {o.site || "—"} {o.external_ref ? <> · <span>#{o.external_ref}</span></> : null}</div>
                      <div style={{ fontSize: 12, display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ opacity: 0.8 }}>{o.status}</span>
                        {o.status === "draft" && (
                          <button onClick={(e) => { e.stopPropagation(); setOrderStatus(o.id, "ordered"); }}>
                            Passer en “ordered”
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>Créée le {fmtDate(o.created_at)}</div>
                  </div>
                ))}
            </div>

            {/* Lignes + Réception */}
            {activeOrderId && (
              <div style={{ marginTop: 20 }}>
                <h3>Lignes de la commande sélectionnée</h3>

                {activeOrder?.status === "draft" ? (
                  <form onSubmit={addOrderItem} style={{ display: "grid", gap: 8, gridTemplateColumns: "1.5fr 1fr 0.8fr 0.8fr auto", alignItems: "end" }}>
                    <div><label>Pièce</label>
                      <select value={oiPartId} onChange={(e) => { setOiPartId(e.target.value); }} style={{ width: "100%", padding: 8 }}>
                        <option value="">— choisir —</option>
                        {parts.map(p => <option key={p.id} value={p.id}>{p.sku} — {p.label}</option>)}
                      </select>
                    </div>
                    <div><label>Réf fournisseur</label>
                      <input value={oiSupplierRef} onChange={(e) => setOiSupplierRef(e.target.value)} placeholder="ex: X-789" style={{ width: "100%", padding: 8 }} />
                    </div>
                    <div><label>Qté</label>
                      <input type="number" step={1} min={1} value={oiQty} onChange={(e) => setOiQty(e.target.value)} placeholder="ex: 10" style={{ width: "100%", padding: 8 }} />
                    </div>
                    <div><label>PU (EUR)</label>
                      <input type="number" step="0.01" min={0} value={oiUnitPrice} onChange={(e) => setOiUnitPrice(e.target.value)} placeholder="ex: 12.50" style={{ width: "100%", padding: 8 }} />
                    </div>
                    <button disabled={addingItem} style={{ padding: "10px 16px" }}>{addingItem ? "Ajout..." : "Ajouter la ligne"}</button>
                  </form>
                ) : (
                  <div style={{ marginTop: 12, opacity: 0.8 }}>Ajout de lignes désactivé (commande non “draft”).</div>
                )}

                {/* Réception avec état + emplacement */}
                <div style={{ marginTop: 12 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Pièce</th>
                        <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Qté cmd</th>
                        <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Déjà reçue</th>
                        <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Restant</th>
                        <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>État</th>
                        <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8, minWidth: 160 }}>Emplacement</th>
                        <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Qté à réceptionner</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderItems.map(oi => {
                        const rec = receivedByItem[oi.id] || 0;
                        const remaining = Math.max((oi.qty || 0) - rec, 0);
                        const siteUse = receiveSite || activeOrder?.site || mySite || "";
                        const locKey = `${siteUse}|${oi.part_id}`;
                        const existingLoc = knownLocationBySitePart[locKey];
                        return (
                          <tr key={oi.id}>
                            <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>
                              {oi.part ? (<>{oi.part?.sku} — {oi.part?.label}</>) : (<span style={{ color:"#a00" }}>À référencer</span>)}
                            </td>
                            <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8, textAlign: "right" }}>{oi.qty}</td>
                            <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8, textAlign: "right" }}>{rec}</td>
                            <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8, textAlign: "right" }}>{remaining}</td>
                            <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>
                              <select
                                value={receiveCondByItem[oi.id] || "neuf"}
                                onChange={(e) => setReceiveCondByItem({ ...receiveCondByItem, [oi.id]: e.target.value as InventoryRow["condition"] })}
                                style={{ padding: 6 }}
                              >
                                {CONDITION_VALUES.map(c => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
                              </select>
                            </td>
                            <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>
                              {existingLoc ? (
                                <input value={existingLoc} disabled style={{ width: "100%", padding: 6, background: "#f7f7f7" }} />
                              ) : (
                                <input
                                  value={receiveLocByPart[locKey] || ""}
                                  onChange={(e) => setReceiveLocByPart({ ...receiveLocByPart, [locKey]: e.target.value })}
                                  placeholder="ex: A-01-03"
                                  style={{ width: "100%", padding: 6 }}
                                />
                              )}
                            </td>
                            <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8, textAlign: "right" }}>
                              <input
                                type="number" step={1} min={0} max={remaining}
                                value={toReceive[oi.id] || ""}
                                onChange={(e) => setToReceive({ ...toReceive, [oi.id]: e.target.value })}
                                placeholder="0"
                                style={{ width: 90, padding: 6, textAlign: "right" }}
                              />
                            </td>
                          </tr>
                        );
                      })}
                      {orderItems.length === 0 && (
                        <tr><td colSpan={7} style={{ padding: 12, textAlign: "center", opacity: 0.7 }}>Aucune ligne pour l’instant.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: 16, display: "grid", gap: 8, gridTemplateColumns: "1fr auto" }}>
                  <div>
                    <label>Site de réception</label>
                    {mySite ? (
                      <input value={mySite} disabled style={{ width: "100%", padding: 8, background: "#f7f7f7" }} />
                    ) : (
                      <input value={receiveSite} onChange={(e) => setReceiveSite(e.target.value)} placeholder="ex: Atelier A" style={{ width: "100%", padding: 8 }} />
                    )}
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>(si un site t’est assigné, il est appliqué automatiquement)</div>
                  </div>
                  <div style={{ alignSelf: "end" }}>
                    <button onClick={createReceiptWithItems} style={{ padding: "10px 16px" }}>Enregistrer la réception</button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ---------- TRANSFERT ---------- */}
        {activeTab === "transfer" && (
          <section>
            <h2>Transfert de stock</h2>
            <p style={{ opacity: .8, marginTop: -6 }}>Transfert par état & validation d’emplacement — prochainement.</p>
            <form onSubmit={doTransfer} style={{ display: "grid", gap: 8, gridTemplateColumns: "1.5fr 1fr 1fr 0.8fr auto", alignItems: "end" }}>
              <div><label>Pièce</label><input disabled placeholder="—" style={{ width: "100%", padding: 8 }} /></div>
              <div><label>De</label><input disabled placeholder="—" style={{ width: "100%", padding: 8 }} /></div>
              <div><label>Vers</label><input disabled placeholder="—" style={{ width: "100%", padding: 8 }} /></div>
              <div><label>Qté</label><input disabled placeholder="—" style={{ width: "100%", padding: 8 }} /></div>
              <button disabled style={{ padding: "10px 16px" }}>Transférer</button>
            </form>
          </section>
        )}

        {/* ---------- INVENTAIRE ---------- */}
        {activeTab === "inventory" && (
          <section>
            <h2>Inventaire (par site · pièce · état)</h2>

            {/* Filtres */}
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr 1fr auto", alignItems: "end", marginTop: 8 }}>
              <div>
                <label>Site</label>
                <select value={invSiteFilter} onChange={(e) => setInvSiteFilter(e.target.value)} style={{ width: "100%", padding: 8 }}>
                  <option value="">Tous</option>
                  {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label>État</label>
                <select value={invCondFilter} onChange={(e) => setInvCondFilter(e.target.value as any)} style={{ width: "100%", padding: 8 }}>
                  <option value="">Tous</option>
                  {CONDITION_VALUES.map(c => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
                </select>
              </div>
              <div>
                <label>Recherche</label>
                <input value={invQuery} onChange={(e) => setInvQuery(e.target.value)} placeholder="SKU, libellé, emplacement…" style={{ width: "100%", padding: 8 }} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={exportInventoryCSV} style={{ padding: "10px 16px" }}>Exporter CSV</button>
              </div>
            </div>

            {/* Totaux */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {Object.entries(inventoryView.totals).map(([k, v]) => (
                <div key={k} style={{ padding: "6px 10px", background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 999, fontSize: 13 }}>
                  <b>{k}</b> : {v}
                </div>
              ))}
            </div>

            {/* Tableau groupé par pièce (sous-menu états) */}
            <div style={{ marginTop: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8, width: 40 }}></th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Site</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Pièce</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Total</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>État / Emplacement</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>MAJ</th>
                  </tr>
                </thead>
                <tbody>
                  {inventoryGrouped.map(group => {
                    const opened = !!invExpanded[group.key];
                    return (
                      <tr key={group.key}>
                        {/* LIGNE PARENTE */}
                        <td style={{ borderBottom: "1px solid #eee", padding: 8, verticalAlign: "top" }}>
                          <button
                            onClick={() => toggleInvGroup(group.key)}
                            aria-label={opened ? "Replier" : "Déplier"}
                            style={{ border: "1px solid #e5e7eb", background: "white", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}
                          >
                            {opened ? "−" : "+"}
                          </button>
                        </td>
                        <td style={{ borderBottom: "1px solid #eee", padding: 8, verticalAlign: "top" }}>{group.site}</td>
                        <td style={{ borderBottom: "1px solid #eee", padding: 8, verticalAlign: "top" }}>
                          <b>{group.partSku}</b> — {group.partLabel}
                        </td>
                        <td style={{ borderBottom: "1px solid #eee", padding: 8, textAlign: "right", verticalAlign: "top" }}>{group.totalQty}</td>
                        <td style={{ borderBottom: "1px solid #eee", padding: 0 }} colSpan={2}>
                          {/* sous-lignes */}
                          {opened && (
                            <table style={{ width: "100%" }}>
                              <tbody>
                                {group.rows.map((row, idx) => (
                                  <tr key={`${group.key}-${row.condition}-${idx}`}>
                                    <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8, width: "30%" }}>
                                      {CONDITION_LABEL[row.condition]}
                                    </td>
                                    <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8, width: "15%", textAlign: "right" }}>
                                      {row.qty_on_hand}
                                    </td>
                                    <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8, width: "35%" }}>
                                      <input
                                        defaultValue={row.location ?? ""}
                                        onBlur={(e) => {
                                          const v = e.target.value.trim();
                                          if (v !== (row.location ?? "")) updateInventoryLocation(row, v);
                                        }}
                                        placeholder="ex: A-01-03"
                                        style={{ width: "100%", padding: 6 }}
                                      />
                                    </td>
                                    <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8, width: "20%" }}>
                                      {fmtDate(row.updated_at)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          {!opened && (
                            <div style={{ padding: 8, color: "#6b7280" }}>
                              {group.rows.length} état{group.rows.length>1 ? "s" : ""} — cliquer pour détail
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {inventoryGrouped.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: 12, textAlign: "center", opacity: 0.7 }}>
                        Aucun résultat avec ces filtres.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ---------- ADMINISTRATION ---------- */}
        {activeTab === "admin" && isAdmin && (
          <section>
            <h2>Administration</h2>

            {/* Affectation des sites */}
            <div style={{ marginTop: 8 }}>
              <h3>Affectation des sites aux utilisateurs</h3>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Utilisateur</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Site actuel</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Nouveau site</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {allUsers.map(u => (
                    <tr key={u.id}>
                      <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>{u.email || u.id}</td>
                      <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>{u.site || "—"}</td>
                      <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>
                        <select id={`site-${u.id}`} defaultValue={u.site || ""} style={{ padding: 6, minWidth: 180 }}>
                          <option value="">— choisir —</option>
                          {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                        </select>
                      </td>
                      <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>
                        <button onClick={() => {
                          const sel = (document.getElementById(`site-${u.id}`) as HTMLSelectElement);
                          assignSite(u.id, sel.value);
                        }}>
                          Assigner
                        </button>
                      </td>
                    </tr>
                  ))}
                  {allUsers.length === 0 && (
                    <tr><td colSpan={4} style={{ padding: 12, opacity: 0.7 }}>Aucun utilisateur trouvé.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Sites */}
            <div style={{ marginTop: 28 }}>
              <h3>Sites</h3>
              <form onSubmit={addSite} style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 2fr auto", alignItems: "end" }}>
                <div><label>Nom du site</label><input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="ex: Atelier A" style={{ width: "100%", padding: 8 }} /></div>
                <div><label>Note (opt.)</label><input value={siteNote} onChange={(e) => setSiteNote(e.target.value)} placeholder="ex: étage -1" style={{ width: "100%", padding: 8 }} /></div>
                <button style={{ padding: "10px 16px" }}>Ajouter</button>
              </form>
              <ul style={{ padding: 0, listStyle: "none", marginTop: 12 }}>
                {sites.map((s) => (
                  <li key={s.id} style={{ padding: 12, border: "1px solid #eee", marginBottom: 8, borderRadius: 8 }}>
                    <b>{s.name}</b> {s.note ? <span style={{ opacity: 0.8 }}>— {s.note}</span> : null}
                  </li>
                ))}
                {sites.length === 0 && <li style={{ padding: 12, opacity: 0.7 }}>Aucun site pour l’instant.</li>}
              </ul>
            </div>

            {/* Fournisseurs */}
            <div style={{ marginTop: 28 }}>
              <h3>Fournisseurs</h3>
              <form onSubmit={addSupplier} style={{ display: "grid", gap: 8, gridTemplateColumns: "2fr 3fr auto", alignItems: "end" }}>
                <div><label>Nom</label><input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="ex: PiècesPro" style={{ width: "100%", padding: 8 }} /></div>
                <div><label>Site (opt.)</label><input value={supplierUrl} onChange={(e) => setSupplierUrl(e.target.value)} placeholder="https://..." style={{ width: "100%", padding: 8 }} /></div>
                <button disabled={loadingSupplier} style={{ padding: "10px 16px" }}>{loadingSupplier ? "Ajout..." : "Ajouter"}</button>
              </form>
              <ul style={{ padding: 0, listStyle: "none", marginTop: 12 }}>
                {suppliers.map((s) => (
                  <li key={s.id} style={{ padding: 12, border: "1px solid #eee", marginBottom: 8, borderRadius: 8 }}>
                    <b>{s.name}</b> {s.site_url ? <a href={s.site_url} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>{s.site_url}</a> : null}
                  </li>
                ))}
                {suppliers.length === 0 && <li style={{ padding: 12, opacity: 0.7 }}>Aucun fournisseur pour l’instant.</li>}
              </ul>
            </div>

            {/* À référencer (admin) */}
            <div style={{ marginTop: 28 }}>
              <h3>À référencer</h3>
              <p style={{ marginTop: -4, opacity: 0.8 }}>Références fournisseur saisies en commande mais inconnues.</p>

              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Fournisseur</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Réf fournisseur</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8, minWidth: 260 }}>Pièce</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8, minWidth: 220 }}>URL produit (opt.)</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Note (opt.)</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pendingRefs.map(row => (
                    <tr key={row.id}>
                      <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>
                        {row.supplier?.name || row.supplier_id}
                      </td>
                      <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>
                        <code>{row.supplier_ref}</code>
                      </td>
                      <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>
                        <select
                          value={pendingPart[row.id] || ""}
                          onChange={(e) => setPendingPart({ ...pendingPart, [row.id]: e.target.value })}
                          style={{ padding: 6, width: "100%" }}
                        >
                          <option value="">— choisir une pièce —</option>
                          {parts.map(p => (
                            <option key={p.id} value={p.id}>{p.sku} — {p.label}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>
                        <input
                          value={pendingUrl[row.id] ?? (row.product_url || "")}
                          onChange={(e) => setPendingUrl({ ...pendingUrl, [row.id]: e.target.value })}
                          placeholder="https://..."
                          style={{ width: "100%", padding: 6 }}
                        />
                      </td>
                      <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>
                        <input
                          value={pendingNote[row.id] ?? (row.note || "")}
                          onChange={(e) => setPendingNote({ ...pendingNote, [row.id]: e.target.value })}
                          placeholder="Notes internes…"
                          style={{ width: "100%", padding: 6 }}
                        />
                      </td>
                      <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>
                        <button onClick={() => approvePendingRef(row)}>Valider</button>
                      </td>
                    </tr>
                  ))}
                  {pendingRefs.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: 12, opacity: 0.7 }}>Aucune demande pour l’instant.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

      </div>
      <Toasts items={toasts} onClose={dismiss} />
    </div>
  );
}
