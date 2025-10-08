/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useMemo, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";

// ---------- Supabase client ----------
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const supabase = createClient(supabaseUrl, supabaseKey);
// --- Base de données (Pièces / Fournisseurs / Sites) ---
const [newPartSku, setNewPartSku] = useState("");
const [newPartLabel, setNewPartLabel] = useState("");

const [newSupplierName, setNewSupplierName] = useState("");
const [newSupplierUrl, setNewSupplierUrl] = useState("");

const [newSiteName, setNewSiteName] = useState("");

// --- Administration ---
type UserRow = { id: string; email: string | null; is_admin: boolean; site: string | null };
const [users, setUsers] = useState<UserRow[]>([]);
const [pendingRefs, setPendingRefs] = useState<any[]>([]);

// ---------- Types (adaptés à l'app) ----------
type Profile = {
  id: string;
  email?: string | null;
  is_admin?: boolean;
  site?: string | null; // site assigné à l'utilisateur
};
type TabKey = "db" | "orders" | "transfer" | "inventory" | "admin";

type Part = {
  id: string;
  sku: string;
  label: string;
};

type Supplier = {
  id: string;
  name: string;
  site_url?: string | null;
};

type Site = {
  id: string;
  name: string; // nom logique (utilisé dans orders.site)
};

type InventoryRow = {
  site: string;
  part_id: string;
  condition: "neuf" | "rec" | "occ";
  location: string | null;
  qty: number;
};

type OrderOverview = {
  id: string;
  supplier_id?: string | null;
  supplier_name?: string | null;
  site?: string | null;
  status: "draft" | "ordered" | "partially_received" | "received" | "cancelled";
  external_ref?: string | null;
  ordered_at?: string | null;
  created_at: string;
  qty_ordered: number;
  qty_received: number;
  part_skus?: string | null;
  supplier_refs?: string | null;
};

type OrderItem = {
  id: string;
  order_id: string;
  part_id: string | null;
  supplier_ref?: string | null;
  qty: number;
  unit_price?: number | null;
  part?: Part | null;
};

// ---------- App ----------
export default function App() {
  // Auth
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  // Référentiels
  const [parts, setParts] = useState<Part[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [sites, setSites] = useState<Site[]>([]);

  // Inventaire (pour connaître les emplacements existants)
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const knownLocationBySitePart = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of inventory) {
      // On mémorise l’emplacement du premier enregistrement trouvé
      const key = `${row.site}|${row.part_id}`;
      if (!map[key] && row.location) map[key] = row.location;
    }
    return map;
  }, [inventory]);

  // Commandes (overview via vue)
  const [orders, setOrders] = useState<OrderOverview[]>([]);
  const [ordersQuery, setOrdersQuery] = useState("");

  // Commande active
  const [activeOrderId, setActiveOrderId] = useState<string>("");
  const activeOrder = useMemo(
    () => orders.find((o) => o.id === activeOrderId),
    [orders, activeOrderId]
  );

  // Lignes de la commande active
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [receivedByItem, setReceivedByItem] = useState<Record<string, number>>({}); // déjà reçu (agrégé)
  const [toReceive, setToReceive] = useState<Record<string, string>>({}); // saisie utilisateur
  const [receiveSite, setReceiveSite] = useState<string>("");
  const [receiveCondByItem, setReceiveCondByItem] =
    useState<Record<string, InventoryRow["condition"]>>({});
  const [receiveLocByPart, setReceiveLocByPart] =
    useState<Record<string, string>>({});

  // Création commande
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [newOrderSupplierId, setNewOrderSupplierId] = useState("");
  const [newOrderSite, setNewOrderSite] = useState("");
  const [newOrderExternalRef, setNewOrderExternalRef] = useState("");

  // Ajout de ligne
  const [oiPartId, setOiPartId] = useState("");
  const [oiSupplierRef, setOiSupplierRef] = useState("");
  const [oiQty, setOiQty] = useState("");
  const [oiUnitPrice, setOiUnitPrice] = useState("");

// ------ CRUD Base de données ------
async function addPart(e: React.FormEvent) {
  e.preventDefault();
  if (!newPartSku.trim() || !newPartLabel.trim()) return notify("SKU et libellé requis.", "error");
  const { error } = await supabase.from("parts").insert({
    sku: newPartSku.trim(),
    label: newPartLabel.trim(),
  });
  if (error) return notify(error.message, "error");
  setNewPartSku(""); setNewPartLabel("");
  await loadParts();
  notify("Pièce ajoutée.", "success");
}

async function deletePart(id: string) {
  if (!confirm("Supprimer cette pièce ?")) return;
  const { error } = await supabase.from("parts").delete().eq("id", id);
  if (error) return notify(error.message, "error");
  await loadParts();
  notify("Pièce supprimée.", "success");
}

async function addSupplier(e: React.FormEvent) {
  e.preventDefault();
  if (!newSupplierName.trim()) return notify("Nom fournisseur requis.", "error");
  const { error } = await supabase.from("suppliers").insert({
    name: newSupplierName.trim(),
    site_url: newSupplierUrl.trim() || null,
  });
  if (error) return notify(error.message, "error");
  setNewSupplierName(""); setNewSupplierUrl("");
  await loadSuppliers();
  notify("Fournisseur ajouté.", "success");
}

async function deleteSupplier(id: string) {
  if (!confirm("Supprimer ce fournisseur ?")) return;
  const { error } = await supabase.from("suppliers").delete().eq("id", id);
  if (error) return notify(error.message, "error");
  await loadSuppliers();
  notify("Fournisseur supprimé.", "success");
}

async function addSite(e: React.FormEvent) {
  e.preventDefault();
  if (!newSiteName.trim()) return notify("Nom de site requis.", "error");
  const { error } = await supabase.from("sites").insert({ name: newSiteName.trim() });
  if (error) return notify(error.message, "error");
  setNewSiteName("");
  await loadSites();
  notify("Site ajouté.", "success");
}

async function deleteSite(id: string) {
  if (!confirm("Supprimer ce site ?")) return;
  const { error } = await supabase.from("sites").delete().eq("id", id);
  if (error) return notify(error.message, "error");
  await loadSites();
  notify("Site supprimé.", "success");
}

// ------ Administration : utilisateurs & pending refs ------
async function loadUsersIfAdmin() {
  if (!profile?.is_admin) return;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, is_admin, site")
    .order("email");
  if (error) return notify(error.message, "error");
  setUsers((data || []) as UserRow[]);
}

async function setUserSite(userId: string, site: string | null) {
  const { error } = await supabase.from("profiles").update({ site }).eq("id", userId);
  if (error) return notify(error.message, "error");
  setUsers(u => u.map(x => x.id === userId ? { ...x, site } : x));
  notify("Affectation mise à jour.", "success");
}

async function toggleUserAdmin(userId: string, value: boolean) {
  const { error } = await supabase.from("profiles").update({ is_admin: value }).eq("id", userId);
  if (error) return notify(error.message, "error");
  setUsers(u => u.map(x => x.id === userId ? { ...x, is_admin: value } : x));
  notify("Rôle admin mis à jour.", "success");
}

async function loadPendingRefs() {
  if (!profile?.is_admin) return;
  const { data, error } = await supabase
    .from("pending_refs")
    .select(`
      id, created_at, supplier_id, supplier_ref, part_id, product_url,
      part:parts(id, sku, label),
      supplier:suppliers(id, name)
    `)
    .order("created_at", { ascending: false });
  if (error) return notify(error.message, "error");

  const normalized = (data || []).map((r: any) => ({
    ...r,
    part: Array.isArray(r.part) ? r.part[0] : r.part,
    supplier: Array.isArray(r.supplier) ? r.supplier[0] : r.supplier,
  }));
  setPendingRefs(normalized);
}

async function approvePendingRef(p: any) {
  // crée la référence fournisseur et supprime la pending
  const { error: insErr } = await supabase.from("supplier_part_refs").insert({
    part_id: p.part_id,
    supplier_id: p.supplier_id,
    supplier_ref: p.supplier_ref,
    product_url: p.product_url || null,
  });
  if (insErr) return notify(insErr.message, "error");
  const { error: delErr } = await supabase.from("pending_refs").delete().eq("id", p.id);
  if (delErr) return notify(delErr.message, "error");
  setPendingRefs(prev => prev.filter(x => x.id !== p.id));
  notify("Référence approuvée.", "success");
}

async function rejectPendingRef(id: string) {
  const { error } = await supabase.from("pending_refs").delete().eq("id", id);
  if (error) return notify(error.message, "error");
  setPendingRefs(prev => prev.filter(x => x.id !== id));
  notify("Référence rejetée.", "success");
}

  
  // UI
  const [activeTab, setActiveTab] = useState<TabKey>("orders");
  const mySite = profile?.site || ""; // le site de l'utilisateur, si assigné

  // ---------- Utils ----------
  function notify(msg: string, kind: "info" | "success" | "error" = "info") {
    // très simple : alert. Remplace par un toast si tu veux.
    if (kind === "error") console.error(msg);
    // eslint-disable-next-line no-alert
    // alert désactivée pour éviter les pop-ups gênants en prod; log console à la place
    console.log(`[${kind}] ${msg}`);
  }

  // ---------- Auth & profil ----------
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);
useEffect(() => {
  if (profile?.is_admin && activeTab === "admin") {
    loadUsersIfAdmin();
    loadPendingRefs();
  }
}, [profile?.is_admin, activeTab]);

  useEffect(() => {
    if (!session) return;
    loadProfile();
    loadParts();
    loadSuppliers();
    loadSites();
    loadInventory();
    loadOrders();
  }, [session]);

  async function loadProfile() {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, is_admin, site")
      .eq("id", session!.user.id)
      .maybeSingle();
    if (error) {
      notify(error.message, "error");
      return;
    }
    setProfile(data || null);
  }

  // ---------- Loads référentiels ----------
  async function loadParts() {
    const { data, error } = await supabase.from("parts").select("id, sku, label").order("sku");
    if (error) return notify(error.message, "error");
    setParts((data || []) as Part[]);
  }

  async function loadSuppliers() {
    const { data, error } = await supabase.from("suppliers").select("id, name, site_url").order("name");
    if (error) return notify(error.message, "error");
    setSuppliers((data || []) as Supplier[]);
  }

  async function loadSites() {
    const { data, error } = await supabase.from("sites").select("id, name").order("name");
    if (error) return notify(error.message, "error");
    setSites((data || []) as Site[]);
  }

  async function loadInventory() {
    const { data, error } = await supabase
      .from("inventory")
      .select("site, part_id, condition, location, qty");
    if (error) return notify(error.message, "error");
    setInventory((data || []) as InventoryRow[]);
  }

  // ---------- Loads commandes ----------
  async function loadOrders() {
    const { data, error } = await supabase
      .from("order_overview_v")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return notify(error.message, "error");
    setOrders((data || []) as OrderOverview[]);
  }

  async function loadOrderItems(orderId: string) {
    // On récupère les lignes + la quantité déjà reçue (via receipt_items)
    const { data, error } = await supabase
      .from("order_items")
      .select(`
        id, order_id, part_id, supplier_ref, qty, unit_price,
        part:parts(id, sku, label)
      `)
      .eq("order_id", orderId)
      .order("id", { ascending: true });
    if (error) {
      notify(error.message, "error");
      return;
    }

    const items = (data || []).map((r: any) => ({
      id: r.id,
      order_id: r.order_id,
      part_id: r.part_id,
      supplier_ref: r.supplier_ref,
      qty: r.qty,
      unit_price: r.unit_price,
      part: Array.isArray(r.part) ? r.part[0] : r.part,
    })) as OrderItem[];

    setOrderItems(items);

    // récupère les quantités déjà reçues par ligne
    const ids = items.map((i) => i.id);
    if (ids.length) {
      const { data: recs, error: recErr } = await supabase
        .from("receipt_items")
        .select("order_item_id, qty_received");
      if (recErr) notify(recErr.message, "error");
      const agg: Record<string, number> = {};
      (recs || []).forEach((ri) => {
        const k = ri.order_item_id as string;
        agg[k] = (agg[k] || 0) + (ri.qty_received || 0);
      });
      setReceivedByItem(agg);
    } else {
      setReceivedByItem({});
    }
  }

  // ---------- Création commande & lignes ----------
  async function createOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!newOrderSupplierId) return notify("Choisis un fournisseur.", "error");

    // site : si profil a un site assigné, on l’utilise; sinon le champ saisi
    const siteToUse = mySite || newOrderSite;
    if (!siteToUse) return notify("Renseigne le site de livraison.", "error");

    setCreatingOrder(true);
    const { data, error } = await supabase
      .from("orders")
      .insert({
        supplier_id: newOrderSupplierId,
        site: siteToUse,
        status: "draft",
        external_ref: newOrderExternalRef || null,
      })
      .select("id")
      .single();
    setCreatingOrder(false);

    if (error) return notify(error.message, "error");
    notify("Commande créée", "success");
    setNewOrderSupplierId("");
    setNewOrderSite("");
    setNewOrderExternalRef("");

    await loadOrders();
    if (data?.id) {
      setActiveOrderId(data.id);
      setReceiveSite(siteToUse);
      await loadOrderItems(data.id);
    }
  }

  async function addOrderItem(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrderId) return notify("Aucune commande sélectionnée.", "error");
    if (!oiPartId) return notify("Choisis une pièce.", "error");
    const q = parseInt(oiQty || "0", 10);
    if (!q || q <= 0) return notify("Quantité invalide.", "error");

    const unit = oiUnitPrice ? parseFloat(oiUnitPrice) : null;

    const { error } = await supabase.from("order_items").insert({
      order_id: activeOrderId,
      part_id: oiPartId,
      supplier_ref: oiSupplierRef || null,
      qty: q,
      unit_price: unit,
    });
    if (error) return notify(error.message, "error");

    setOiPartId("");
    setOiSupplierRef("");
    setOiQty("");
    setOiUnitPrice("");

    await loadOrderItems(activeOrderId);
    await loadOrders(); // mettre à jour agrégats qty_ordered
  }

  // ---------- Réception ----------
  function remainingFor(item: OrderItem) {
    const rec = receivedByItem[item.id] || 0;
    return Math.max((item.qty || 0) - rec, 0);
  }

  async function createReceiptWithItems() {
    if (!activeOrderId) return notify("Aucune commande active.", "error");
    const siteUse = mySite || receiveSite || activeOrder?.site || "";
    if (!siteUse) return notify("Le site de réception est requis.", "error");

    // on prépare les lignes à réceptionner
    const entries = orderItems
      .map((oi) => {
        const qtyStr = toReceive[oi.id];
        const qty = qtyStr ? parseInt(qtyStr, 10) : 0;
        if (!qty || qty <= 0) return null;
        const rest = remainingFor(oi);
        if (qty > rest) return null;
        const cond = receiveCondByItem[oi.id] || "neuf";
        const locKey = `${siteUse}|${oi.part_id}`;
        const location = knownLocationBySitePart[locKey] || receiveLocByPart[locKey] || null;
        return { oi, qty, cond, location };
      })
      .filter(Boolean) as { oi: OrderItem; qty: number; cond: InventoryRow["condition"]; location: string | null }[];

    if (!entries.length) return notify("Aucune quantité à réceptionner.", "error");

    // 1) créer un reçu
    const { data: rec, error: rErr } = await supabase
      .from("receipts")
      .insert({
        order_id: activeOrderId,
        site: siteUse,
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (rErr) return notify(rErr.message, "error");

    const receiptId = rec!.id as string;

    // 2) insérer les lignes de réception + stock_moves et inventaire
    for (const ent of entries) {
      const { oi, qty, cond, location } = ent;

      // 2.a) receipt_items
      const { error: riErr } = await supabase.from("receipt_items").insert({
        receipt_id: receiptId,
        order_item_id: oi.id,
        qty_received: qty,
        condition: cond,
        location: location,
      });
      if (riErr) return notify(riErr.message, "error");

      // 2.b) stock_moves (entrée)
      const { error: smErr } = await supabase.from("stock_moves").insert({
        part_id: oi.part_id,
        site_from: null,
        site_to: siteUse,
        qty: qty,
        reason: "receipt",
        related_order_id: activeOrderId,
        condition: cond,
      });
      if (smErr) return notify(smErr.message, "error");

      // 2.c) inventaire: upsert (site, part_id, condition) + location si inconnu
      // On suppose une contrainte unique (site, part_id, condition)
      const { error: invErr } = await supabase
        .from("inventory")
        .upsert(
          {
            site: siteUse,
            part_id: oi.part_id,
            condition: cond,
            location: location,
            qty: qty, // on utilise onConflict + expression pour incrémenter si possible
          },
          { onConflict: "site,part_id,condition", ignoreDuplicates: false }
        );
      if (invErr) {
        // Si ton Postgres ne permet pas un upsert additif directement,
        // on fait une update additive manuelle :
        const { data: invRow } = await supabase
          .from("inventory")
          .select("qty, location")
          .eq("site", siteUse)
          .eq("part_id", oi.part_id)
          .eq("condition", cond)
          .maybeSingle();

        if (invRow) {
          const { error: upErr } = await supabase
            .from("inventory")
            .update({
              qty: (invRow.qty || 0) + qty,
              location: invRow.location || location || null,
            })
            .eq("site", siteUse)
            .eq("part_id", oi.part_id)
            .eq("condition", cond);
          if (upErr) return notify(upErr.message, "error");
        } else {
          const { error: insErr } = await supabase.from("inventory").insert({
            site: siteUse,
            part_id: oi.part_id,
            condition: cond,
            location,
            qty,
          });
          if (insErr) return notify(insErr.message, "error");
        }
      }
    }

    notify("Réception enregistrée.", "success");

    // Nettoyage du formulaire
    setToReceive({});
    setReceiveLocByPart({});
    setReceiveCondByItem({});

    // Rechargements
    await loadOrderItems(activeOrderId);
    await loadOrders();
    await loadInventory();

    // Marquages auto
    await maybeMarkOrderPartial(activeOrderId);
    await maybeMarkOrderReceived(activeOrderId);
  }

  async function maybeMarkOrderPartial(orderId: string) {
    const { data, error } = await supabase
      .from("order_overview_v")
      .select("qty_ordered, qty_received, status")
      .eq("id", orderId)
      .maybeSingle();
    if (error || !data) return;
    const qTot = data.qty_ordered || 0;
    const qRec = data.qty_received || 0;
    if (qTot > 0 && qRec > 0 && qRec < qTot && data.status !== "partially_received") {
      await supabase.from("orders").update({ status: "partially_received" }).eq("id", orderId);
      await loadOrders();
    }
  }

  async function maybeMarkOrderReceived(orderId: string) {
    const { data, error } = await supabase
      .from("order_overview_v")
      .select("qty_ordered, qty_received, status")
      .eq("id", orderId)
      .maybeSingle();
    if (error || !data) return;
    const allReceived = (data.qty_ordered || 0) > 0 && (data.qty_received || 0) >= (data.qty_ordered || 0);
    if (allReceived && data.status !== "received") {
      await supabase.from("orders").update({ status: "received" }).eq("id", orderId);
      await loadOrders();
    }
  }

  // ---------- UI: onglets ----------
  const tabs: { key: TabKey; label: string }[] = useMemo(() => {
  const base: { key: TabKey; label: string }[] = [
    { key: "db",        label: "Base de données" },
    { key: "orders",    label: "Commandes" },
    { key: "transfer",  label: "Transferts" },
    { key: "inventory", label: "Inventaire" },
  ];
  if (profile?.is_admin) base.push({ key: "admin", label: "Administration" });
  return base;
}, [profile?.is_admin]);


  // ---------- Auth UI minimal ----------
  if (!session) {
    return (
      <div style={{ maxWidth: 900, margin: "32px auto", padding: 16 }}>
        <h1>Mon app pièces</h1>
        <p>Connecte-toi pour continuer.</p>
        <button
          onClick={async () => {
            const email = prompt("Entre ton email :");
            if (!email) return;
            const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
            if (error) notify(error.message, "error");
            else notify("Lien magique envoyé. Consulte ta boîte mail.", "success");
          }}
        >
          Se connecter par email
        </button>
      </div>
    );
  }

  // ---------- Render ----------
  return (
    <div style={{ maxWidth: 1200, margin: "24px auto", padding: "0 16px 48px" }}>
      {/* Header */}
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Mon app pièces</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>
            {profile?.email} {mySite ? `· ${mySite}` : ""}
            {profile?.is_admin ? " · admin" : ""}
          </span>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              setSession(null);
            }}
          >
            Se déconnecter
          </button>
        </div>
      </header>

      {/* Tabs */}
      <nav style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: activeTab === t.key ? "#eaf3ff" : "white",
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Onglet: Commandes */}
      {activeTab === "orders" && (
        <section>
          {/* Header + recherche */}
          <div style={{ display: "flex", alignItems: "end", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>Commandes</h2>
            <div style={{ marginLeft: "auto" }}>
              <input
                value={ordersQuery}
                onChange={(e) => setOrdersQuery(e.target.value)}
                placeholder="Rechercher (fournisseur, site, statut, n°, SKU, réf fournisseur)…"
                style={{ padding: 8, minWidth: 320 }}
              />
            </div>
          </div>

          {/* Créer commande */}
          <form
            onSubmit={createOrder}
            style={{ display: "grid", gap: 8, gridTemplateColumns: "1.5fr 1fr 1fr auto", alignItems: "end", marginTop: 10 }}
          >
            <div>
              <label>Fournisseur</label>
              <select
                value={newOrderSupplierId}
                onChange={(e) => setNewOrderSupplierId(e.target.value)}
                style={{ width: "100%", padding: 8 }}
              >
                <option value="">— choisir —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Site de livraison</label>
              {mySite ? (
                <input value={mySite} disabled style={{ width: "100%", padding: 8, background: "#f7f7f7" }} />
              ) : (
                <select
                  value={newOrderSite}
                  onChange={(e) => setNewOrderSite(e.target.value)}
                  style={{ width: "100%", padding: 8 }}
                >
                  <option value="">— choisir —</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label>N° commande (opt.)</label>
              <input
                value={newOrderExternalRef}
                onChange={(e) => setNewOrderExternalRef(e.target.value)}
                placeholder="ex: PO-2025-001"
                style={{ width: "100%", padding: 8 }}
              />
            </div>
            <button disabled={creatingOrder} style={{ padding: "10px 16px" }}>
              {creatingOrder ? "Création..." : "Créer commande"}
            </button>
          </form>

          {/* Listes En cours / Terminées */}
          {(() => {
            const q = ordersQuery.trim().toLowerCase();
            const match = (o: OrderOverview) =>
              !q ||
              (o.supplier_name || "").toLowerCase().includes(q) ||
              (o.external_ref || "").toLowerCase().includes(q) ||
              (o.site || "").toLowerCase().includes(q) ||
              (o.status || "").toLowerCase().includes(q) ||
              (o.part_skus || "").toLowerCase().includes(q) ||
              (o.supplier_refs || "").toLowerCase().includes(q);

            const ordersActive = orders.filter((o) =>
              ["draft", "ordered", "partially_received"].includes(o.status)
            );
            const ordersDone = orders.filter((o) =>
              ["received", "cancelled"].includes(o.status)
            );

            return (
              <div>
                {/* EN COURS */}
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>En cours</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {ordersActive.filter(match).map((o) => (
                      <div
                        key={o.id}
                        onClick={() => {
                          setActiveOrderId(o.id);
                          setReceiveSite(o.site || mySite || "");
                          loadOrderItems(o.id);
                        }}
                        style={{
                          border: "1px solid #eee",
                          borderRadius: 8,
                          padding: 12,
                          cursor: "pointer",
                          background: activeOrderId === o.id ? "#f0f7ff" : "white",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                          <div>
                            <b>{o.supplier_name || "—"}</b> · {o.site || "—"}
                            {o.external_ref ? (
                              <>
                                {" "}
                                · <span>#{o.external_ref}</span>
                              </>
                            ) : null}
                            <div style={{ fontSize: 12, opacity: 0.8 }}>
                              Reçu {o.qty_received} / {o.qty_ordered}
                            </div>
                          </div>
                          <div style={{ fontSize: 12, display: "flex", gap: 8, alignItems: "center" }}>
                            <span style={{ opacity: 0.8 }}>{o.status}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {ordersActive.filter(match).length === 0 && (
                      <div style={{ opacity: 0.7 }}>Aucune commande en cours.</div>
                    )}
                  </div>
                </div>

                {/* TERMINÉES repliables */}
                <DoneOrdersBlock ordersDone={ordersDone} match={match} />
              </div>
            );
          })()}

          {/* Lignes + Réception de la commande active */}
          {activeOrderId ? (
            <div style={{ marginTop: 20 }}>
              <h3>Lignes de la commande sélectionnée</h3>

              {activeOrder?.status === "draft" ? (
                <form
                  onSubmit={addOrderItem}
                  style={{
                    display: "grid",
                    gap: 8,
                    gridTemplateColumns: "1.5fr 1fr 0.8fr 0.8fr auto",
                    alignItems: "end",
                  }}
                >
                  <div>
                    <label>Pièce</label>
                    <select
                      value={oiPartId}
                      onChange={(e) => {
                        setOiPartId(e.target.value);
                      }}
                      style={{ width: "100%", padding: 8 }}
                    >
                      <option value="">— choisir —</option>
                      {parts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} — {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>Réf fournisseur</label>
                    <input
                      value={oiSupplierRef}
                      onChange={(e) => setOiSupplierRef(e.target.value)}
                      placeholder="ex: X-789"
                      style={{ width: "100%", padding: 8 }}
                    />
                  </div>
                  <div>
                    <label>Qté</label>
                    <input
                      type="number"
                      step={1}
                      min={1}
                      value={oiQty}
                      onChange={(e) => setOiQty(e.target.value)}
                      placeholder="ex: 10"
                      style={{ width: "100%", padding: 8 }}
                    />
                  </div>
                  <div>
                    <label>PU (EUR)</label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={oiUnitPrice}
                      onChange={(e) => setOiUnitPrice(e.target.value)}
                      placeholder="ex: 12.50"
                      style={{ width: "100%", padding: 8 }}
                    />
                  </div>
                  <button style={{ padding: "10px 16px" }}>Ajouter la ligne</button>
                </form>
              ) : (
                <div style={{ marginTop: 12, opacity: 0.8 }}>
                  Ajout de lignes désactivé (commande non “draft”).
                </div>
              )}

              {/* Tableau réception */}
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
                    {orderItems.map((oi) => {
                      const rec = receivedByItem[oi.id] || 0;
                      const remaining = remainingFor(oi);
                      const siteUse = mySite || receiveSite || activeOrder?.site || "";
                      const locKey = `${siteUse}|${oi.part_id}`;
                      const existingLoc = knownLocationBySitePart[locKey];

                      return (
                        <tr key={oi.id}>
                          <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>
                            {oi.part ? (
                              <>
                                {oi.part.sku} — {oi.part.label}
                              </>
                            ) : (
                              <span style={{ color: "#a00" }}>À référencer</span>
                            )}
                            {oi.supplier_ref ? (
                              <div style={{ fontSize: 12, opacity: 0.75 }}>
                                Réf fournisseur: <code>{oi.supplier_ref}</code>
                              </div>
                            ) : null}
                          </td>
                          <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8, textAlign: "right" }}>
                            {oi.qty}
                          </td>
                          <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8, textAlign: "right" }}>
                            {rec}
                          </td>
                          <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8, textAlign: "right" }}>
                            {remaining}
                          </td>
                          <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>
                            <select
                              value={receiveCondByItem[oi.id] || "neuf"}
                              onChange={(e) =>
                                setReceiveCondByItem({
                                  ...receiveCondByItem,
                                  [oi.id]: e.target.value as InventoryRow["condition"],
                                })
                              }
                              style={{ padding: 6 }}
                            >
                              <option value="neuf">Neuf</option>
                              <option value="rec">Reconditionné</option>
                              <option value="occ">Occasion</option>
                            </select>
                          </td>
                          <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>
                            {existingLoc ? (
                              <input
                                value={existingLoc}
                                disabled
                                style={{ width: "100%", padding: 6, background: "#f7f7f7" }}
                              />
                            ) : (
                              <input
                                value={receiveLocByPart[locKey] || ""}
                                onChange={(e) =>
                                  setReceiveLocByPart({ ...receiveLocByPart, [locKey]: e.target.value })
                                }
                                placeholder="ex: A-01-03"
                                style={{ width: "100%", padding: 6 }}
                              />
                            )}
                          </td>
                          <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8, textAlign: "right" }}>
                            <input
                              type="number"
                              step={1}
                              min={0}
                              max={remaining}
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
                      <tr>
                        <td colSpan={7} style={{ padding: 12, textAlign: "center", opacity: 0.7 }}>
                          Aucune ligne pour cette commande.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Zone de réception globale */}
              <div style={{ marginTop: 16, display: "grid", gap: 8, gridTemplateColumns: "1fr auto" }}>
                <div>
                  <label>Site de réception</label>
                  {mySite ? (
                    <input
                      value={mySite}
                      disabled
                      style={{ width: "100%", padding: 8, background: "#f7f7f7" }}
                    />
                  ) : (
                    <input
                      value={receiveSite}
                      onChange={(e) => setReceiveSite(e.target.value)}
                      placeholder="ex: Atelier A"
                      style={{ width: "100%", padding: 8 }}
                    />
                  )}
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                    (si un site t’est assigné, il est appliqué automatiquement)
                  </div>
                </div>
                <div style={{ alignSelf: "end" }}>
                  <button
                    onClick={async () => {
                      await createReceiptWithItems();
                    }}
                    style={{ padding: "10px 16px" }}
                  >
                    Enregistrer la réception
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      )}

      {/* Onglet: Base de données (squelette non bloquant) */}
      {activeTab === "db" && (
  <DbTab
    parts={parts}
    suppliers={suppliers}
    sites={sites}
    newPartSku={newPartSku}
    setNewPartSku={setNewPartSku}
    newPartLabel={newPartLabel}
    setNewPartLabel={setNewPartLabel}
    addPart={addPart}
    deletePart={deletePart}
    newSupplierName={newSupplierName}
    setNewSupplierName={setNewSupplierName}
    newSupplierUrl={newSupplierUrl}
    setNewSupplierUrl={setNewSupplierUrl}
    addSupplier={addSupplier}
    deleteSupplier={deleteSupplier}
    newSiteName={newSiteName}
    setNewSiteName={setNewSiteName}
    addSite={addSite}
    deleteSite={deleteSite}
  />
)}


      {/* Onglet: Inventaire (squelette non bloquant) */}
      {activeTab === "inventory" && (
        <section>
          <h2>Inventaire</h2>
          <p style={{ opacity: 0.8 }}>Affichage compact (à améliorer ultérieurement).</p>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Site</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Pièce</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>État</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Emplacement</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Qté</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((r, idx) => {
                const p = parts.find((pp) => pp.id === r.part_id);
                return (
                  <tr key={`${r.site}|${r.part_id}|${r.condition}|${idx}`}>
                    <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>{r.site}</td>
                    <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>
                      {p ? `${p.sku} — ${p.label}` : r.part_id}
                    </td>
                    <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>{r.condition}</td>
                    <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>{r.location || "—"}</td>
                    <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8, textAlign: "right" }}>{r.qty}</td>
                  </tr>
                );
              })}
              {inventory.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 12, textAlign: "center", opacity: 0.7 }}>
                    Inventaire vide.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {/* Onglet: Transferts (placeholder) */}
      {activeTab === "transfer" && (
        <section>
          <h2>Transferts</h2>
          <p style={{ opacity: 0.8 }}>À implémenter (mouvements entre sites).</p>
        </section>
      )}

      {/* Onglet: Administration (visible si admin) */}
     {activeTab === "admin" && profile?.is_admin && (
  <AdminTab
    users={users}
    sites={sites}
    pendingRefs={pendingRefs}
    setUsers={setUsers}
    setUserSite={setUserSite}
    toggleUserAdmin={toggleUserAdmin}
    approvePendingRef={approvePendingRef}
    rejectPendingRef={rejectPendingRef}
  />
)}
    {/* Affectations utilisateurs */}
    <div style={{ marginTop: 12 }}>
      <h3>Utilisateurs</h3>
      <p style={{ opacity: .8, marginTop: 0 }}>Assigner un site et/ou basculer un compte en admin.</p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Email</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Site</th>
            <th style={{ textAlign: "center", padding: 8, borderBottom: "1px solid #eee" }}>Admin</th>
            <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>{u.email || u.id}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>
                <select
                  value={u.site || ""}
                  onChange={(e) => setUsers(prev => prev.map(x => x.id === u.id ? { ...x, site: e.target.value || null } : x))}
                  style={{ padding: 6, minWidth: 160 }}
                >
                  <option value="">— aucun —</option>
                  {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2", textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={u.is_admin}
                  onChange={(e) => setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_admin: e.target.checked } : x))}
                />
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2", textAlign: "right" }}>
                <button
                  onClick={async () => {
                    await setUserSite(u.id, u.site || null);
                    await toggleUserAdmin(u.id, u.is_admin);
                  }}
                >
                  Enregistrer
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr><td colSpan={4} style={{ padding: 12, textAlign: "center", opacity: .7 }}>Aucun utilisateur.</td></tr>
          )}
        </tbody>
      </table>
    </div>

    {/* Références en attente (à référencer) */}
    <div style={{ marginTop: 24 }}>
      <h3>Références en attente</h3>
      <p style={{ opacity: .8, marginTop: 0 }}>Issues des commandes lorsqu'une réf fournisseur n'était pas liée à une pièce.</p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Créée</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Fournisseur</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Réf fournisseur</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Pièce</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>URL</th>
            <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {pendingRefs.map(p => (
            <tr key={p.id}>
              <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>{new Date(p.created_at).toLocaleString()}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>{p.supplier?.name || p.supplier_id}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>
                <code>{p.supplier_ref}</code>
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>
                {p.part ? `${p.part.sku} — ${p.part.label}` : p.part_id}
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>
                {p.product_url ? <a href={p.product_url} target="_blank" rel="noreferrer">{p.product_url}</a> : "—"}
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2", textAlign: "right" }}>
                <button onClick={() => approvePendingRef(p)} style={{ marginRight: 8 }}>Approuver</button>
                <button onClick={() => rejectPendingRef(p.id)} style={{ color: "#a00" }}>Rejeter</button>
              </td>
            </tr>
          ))}
          {pendingRefs.length === 0 && (
            <tr><td colSpan={6} style={{ padding: 12, textAlign: "center", opacity: .7 }}>Aucune référence en attente.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  </section>
)}


// ---------- Sous-composant: bloc repliable des commandes terminées ----------
function DoneOrdersBlock({
  ordersDone,
  match,
}: {
  ordersDone: OrderOverview[];
  match: (o: OrderOverview) => boolean;
}) {
  const [open, setOpen] = useState(false);
  // Les fonctions utilisées viennent de App (portée du composant parent via React “closure”),
  // mais ici on reste totalement indépendant pour éviter les erreurs de JSX.
  // On relit setActiveOrderId / setReceiveSite / loadOrderItems via window.AppBridge si besoin,
  // mais dans ce fichier on garde un composant purement d’affichage.
  // => On remonte les clics au parent en émettant un CustomEvent simple.
  function openOrder(id: string) {
    const evt = new CustomEvent("open-order", { detail: { id } });
    window.dispatchEvent(evt);
  }

  useEffect(() => {
    // Pas de mémoire globale: le parent écoute cet event pour sélectionner la commande
    return () => {};
  }, []);

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ fontWeight: 700 }}>Terminées</div>
        <button onClick={() => setOpen((v) => !v)} style={{ padding: "4px 8px" }}>
          {open ? "Masquer" : "Afficher"}
        </button>
      </div>

      {open ? (
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          {ordersDone.filter(match).map((o) => (
            <div
              key={o.id}
              onClick={() => openOrder(o.id)}
              style={{
                border: "1px solid #eee",
                borderRadius: 8,
                padding: 12,
                cursor: "pointer",
                background: "white",
                opacity: 0.9,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <b>{o.supplier_name || "—"}</b> · {o.site || "—"}
                  {o.external_ref ? (
                    <>
                      {" "}
                      · <span>#{o.external_ref}</span>
                    </>
                  ) : null}
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    Reçu {o.qty_received} / {o.qty_ordered}
                  </div>
                </div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>{o.status}</div>
              </div>
            </div>
          ))}
          {ordersDone.filter(match).length === 0 && (
            <div style={{ opacity: 0.7 }}>Aucune commande terminée.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
// ======================
// DB TAB (Pièces/Fournisseurs/Sites)
// ======================
function DbTab(props: {
  parts: { id: string; sku: string; label: string }[];
  suppliers: { id: string; name: string; site_url?: string | null }[];
  sites: { id: string; name: string }[];

  newPartSku: string;
  setNewPartSku: (v: string) => void;
  newPartLabel: string;
  setNewPartLabel: (v: string) => void;
  addPart: (e: React.FormEvent) => Promise<void>;
  deletePart: (id: string) => Promise<void>;

  newSupplierName: string;
  setNewSupplierName: (v: string) => void;
  newSupplierUrl: string;
  setNewSupplierUrl: (v: string) => void;
  addSupplier: (e: React.FormEvent) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;

  newSiteName: string;
  setNewSiteName: (v: string) => void;
  addSite: (e: React.FormEvent) => Promise<void>;
  deleteSite: (id: string) => Promise<void>;
}) {
  const {
    parts, suppliers, sites,
    newPartSku, setNewPartSku, newPartLabel, setNewPartLabel, addPart, deletePart,
    newSupplierName, setNewSupplierName, newSupplierUrl, setNewSupplierUrl, addSupplier, deleteSupplier,
    newSiteName, setNewSiteName, addSite, deleteSite,
  } = props;

  return (
    <section>
      <h2>Base de données</h2>

      {/* Pièces */}
      <div style={{ marginTop: 12 }}>
        <h3>Pièces</h3>
        <form onSubmit={addPart} style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 8, alignItems: "end" }}>
          <div>
            <label>SKU</label>
            <input value={newPartSku} onChange={(e) => setNewPartSku(e.target.value)} placeholder="ex: ABC-123" style={{ width: "100%", padding: 8 }} />
          </div>
          <div>
            <label>Libellé</label>
            <input value={newPartLabel} onChange={(e) => setNewPartLabel(e.target.value)} placeholder="ex: Filtre à huile" style={{ width: "100%", padding: 8 }} />
          </div>
          <button>Ajouter</button>
        </form>

        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>SKU</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Libellé</th>
              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {parts.map(p => (
              <tr key={p.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>{p.sku}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>{p.label}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2", textAlign: "right" }}>
                  <button type="button" onClick={() => void deletePart(p.id)} style={{ color: "#a00" }}>Supprimer</button>
                </td>
              </tr>
            ))}
            {parts.length === 0 && (
              <tr><td colSpan={3} style={{ padding: 12, opacity: .7, textAlign: "center" }}>Aucune pièce.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Fournisseurs */}
      <div style={{ marginTop: 24 }}>
        <h3>Fournisseurs</h3>
        <form onSubmit={addSupplier} style={{ display: "grid", gridTemplateColumns: "2fr 2fr auto", gap: 8, alignItems: "end" }}>
          <div>
            <label>Nom</label>
            <input value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} placeholder="ex: PiècesPro" style={{ width: "100%", padding: 8 }} />
          </div>
          <div>
            <label>URL (optionnel)</label>
            <input value={newSupplierUrl} onChange={(e) => setNewSupplierUrl(e.target.value)} placeholder="https://..." style={{ width: "100%", padding: 8 }} />
          </div>
          <button>Ajouter</button>
        </form>

        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Nom</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Site</th>
              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map(s => (
              <tr key={s.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>{s.name}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>
                  {s.site_url ? <a href={s.site_url} target="_blank" rel="noreferrer">{s.site_url}</a> : "—"}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2", textAlign: "right" }}>
                  <button type="button" onClick={() => void deleteSupplier(s.id)} style={{ color: "#a00" }}>Supprimer</button>
                </td>
              </tr>
            ))}
            {suppliers.length === 0 && (
              <tr><td colSpan={3} style={{ padding: 12, opacity: .7, textAlign: "center" }}>Aucun fournisseur.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Sites */}
      <div style={{ marginTop: 24 }}>
        <h3>Sites</h3>
        <form onSubmit={addSite} style={{ display: "grid", gridTemplateColumns: "2fr auto", gap: 8, alignItems: "end" }}>
          <div>
            <label>Nom du site</label>
            <input value={newSiteName} onChange={(e) => setNewSiteName(e.target.value)} placeholder="ex: Atelier A" style={{ width: "100%", padding: 8 }} />
          </div>
        <button>Ajouter</button>
        </form>

        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Nom</th>
              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sites.map(s => (
              <tr key={s.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>{s.name}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2", textAlign: "right" }}>
                  <button type="button" onClick={() => void deleteSite(s.id)} style={{ color: "#a00" }}>Supprimer</button>
                </td>
              </tr>
            ))}
            {sites.length === 0 && (
              <tr><td colSpan={2} style={{ padding: 12, opacity: .7, textAlign: "center" }}>Aucun site.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ======================
// ADMIN TAB (Affectations + Pending refs)
// ======================
function AdminTab(props: {
  users: { id: string; email: string | null; is_admin: boolean; site: string | null }[];
  sites: { id: string; name: string }[];
  pendingRefs: any[];
  setUsers: React.Dispatch<React.SetStateAction<{ id: string; email: string | null; is_admin: boolean; site: string | null }[]>>;
  setUserSite: (userId: string, site: string | null) => Promise<void>;
  toggleUserAdmin: (userId: string, value: boolean) => Promise<void>;
  approvePendingRef: (p: any) => Promise<void>;
  rejectPendingRef: (id: string) => Promise<void>;
}) {
  const {
    users, sites, pendingRefs,
    setUsers, setUserSite, toggleUserAdmin,
    approvePendingRef, rejectPendingRef,
  } = props;

  return (
    <section>
      <h2>Administration</h2>

      {/* Utilisateurs */}
      <div style={{ marginTop: 12 }}>
        <h3>Utilisateurs</h3>
        <p style={{ opacity: .8, marginTop: 0 }}>Assigner un site et/ou basculer un compte en admin.</p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Email</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Site</th>
              <th style={{ textAlign: "center", padding: 8, borderBottom: "1px solid #eee" }}>Admin</th>
              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>{u.email || u.id}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>
                  <select
                    value={u.site || ""}
                    onChange={(e) => setUsers(prev => prev.map(x => x.id === u.id ? { ...x, site: e.target.value || null } : x))}
                    style={{ padding: 6, minWidth: 160 }}
                  >
                    <option value="">— aucun —</option>
                    {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={u.is_admin}
                    onChange={(e) => setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_admin: e.target.checked } : x))}
                  />
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2", textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => Promise.all([
                      setUserSite(u.id, u.site || null),
                      toggleUserAdmin(u.id, u.is_admin),
                    ]).then(() => void 0)}
                  >
                    Enregistrer
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={4} style={{ padding: 12, textAlign: "center", opacity: .7 }}>Aucun utilisateur.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Références en attente */}
      <div style={{ marginTop: 24 }}>
        <h3>Références en attente</h3>
        <p style={{ opacity: .8, marginTop: 0 }}>Issues des commandes lorsqu'une réf fournisseur n'était pas liée à une pièce.</p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Créée</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Fournisseur</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Réf fournisseur</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Pièce</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>URL</th>
              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pendingRefs.map(p => (
              <tr key={p.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>
                  {p.created_at ? new Date(p.created_at).toLocaleString() : "—"}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>
                  {p.supplier?.name || p.supplier_id}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>
                  <code>{p.supplier_ref}</code>
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>
                  {p.part ? `${p.part.sku} — ${p.part.label}` : p.part_id}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>
                  {p.product_url ? <a href={p.product_url} target="_blank" rel="noreferrer">{p.product_url}</a> : "—"}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2", textAlign: "right" }}>
                  <button type="button" onClick={() => void approvePendingRef(p)} style={{ marginRight: 8 }}>Approuver</button>
                  <button type="button" onClick={() => void rejectPendingRef(p.id)} style={{ color: "#a00" }}>Rejeter</button>
                </td>
              </tr>
            ))}
            {pendingRefs.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 12, textAlign: "center", opacity: .7 }}>Aucune référence en attente.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function DbTab(props: {
  parts: { id: string; sku: string; label: string }[];
  suppliers: { id: string; name: string; site_url?: string | null }[];
  sites: { id: string; name: string }[];

  newPartSku: string;
  setNewPartSku: (v: string) => void;
  newPartLabel: string;
  setNewPartLabel: (v: string) => void;
  addPart: (e: React.FormEvent) => Promise<void>;
  deletePart: (id: string) => Promise<void>;

  newSupplierName: string;
  setNewSupplierName: (v: string) => void;
  newSupplierUrl: string;
  setNewSupplierUrl: (v: string) => void;
  addSupplier: (e: React.FormEvent) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;

  newSiteName: string;
  setNewSiteName: (v: string) => void;
  addSite: (e: React.FormEvent) => Promise<void>;
  deleteSite: (id: string) => Promise<void>;
}) {
  const {
    parts, suppliers, sites,
    newPartSku, setNewPartSku, newPartLabel, setNewPartLabel, addPart, deletePart,
    newSupplierName, setNewSupplierName, newSupplierUrl, setNewSupplierUrl, addSupplier, deleteSupplier,
    newSiteName, setNewSiteName, addSite, deleteSite,
  } = props;

  return (
    <section>
      <h2>Base de données</h2>

      {/* Pièces */}
      <div style={{ marginTop: 12 }}>
        <h3>Pièces</h3>
        <form onSubmit={addPart} style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 8, alignItems: "end" }}>
          <div>
            <label>SKU</label>
            <input value={newPartSku} onChange={(e) => setNewPartSku(e.target.value)} placeholder="ex: ABC-123" style={{ width: "100%", padding: 8 }} />
          </div>
          <div>
            <label>Libellé</label>
            <input value={newPartLabel} onChange={(e) => setNewPartLabel(e.target.value)} placeholder="ex: Filtre à huile" style={{ width: "100%", padding: 8 }} />
          </div>
          <button>Ajouter</button>
        </form>

        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>SKU</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Libellé</th>
              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {parts.map(p => (
              <tr key={p.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>{p.sku}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>{p.label}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2", textAlign: "right" }}>
                  <button type="button" onClick={() => void deletePart(p.id)} style={{ color: "#a00" }}>Supprimer</button>
                </td>
              </tr>
            ))}
            {parts.length === 0 && (
              <tr><td colSpan={3} style={{ padding: 12, opacity: .7, textAlign: "center" }}>Aucune pièce.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Fournisseurs */}
      <div style={{ marginTop: 24 }}>
        <h3>Fournisseurs</h3>
        <form onSubmit={addSupplier} style={{ display: "grid", gridTemplateColumns: "2fr 2fr auto", gap: 8, alignItems: "end" }}>
          <div>
            <label>Nom</label>
            <input value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} placeholder="ex: PiècesPro" style={{ width: "100%", padding: 8 }} />
          </div>
          <div>
            <label>URL (optionnel)</label>
            <input value={newSupplierUrl} onChange={(e) => setNewSupplierUrl(e.target.value)} placeholder="https://..." style={{ width: "100%", padding: 8 }} />
          </div>
          <button>Ajouter</button>
        </form>

        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Nom</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Site</th>
              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map(s => (
              <tr key={s.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>{s.name}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>
                  {s.site_url ? <a href={s.site_url} target="_blank" rel="noreferrer">{s.site_url}</a> : "—"}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2", textAlign: "right" }}>
                  <button type="button" onClick={() => void deleteSupplier(s.id)} style={{ color: "#a00" }}>Supprimer</button>
                </td>
              </tr>
            ))}
            {suppliers.length === 0 && (
              <tr><td colSpan={3} style={{ padding: 12, opacity: .7, textAlign: "center" }}>Aucun fournisseur.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Sites */}
      <div style={{ marginTop: 24 }}>
        <h3>Sites</h3>
        <form onSubmit={addSite} style={{ display: "grid", gridTemplateColumns: "2fr auto", gap: 8, alignItems: "end" }}>
          <div>
            <label>Nom du site</label>
            <input value={newSiteName} onChange={(e) => setNewSiteName(e.target.value)} placeholder="ex: Atelier A" style={{ width: "100%", padding: 8 }} />
          </div>
          <button>Ajouter</button>
        </form>

        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Nom</th>
              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sites.map(s => (
              <tr key={s.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>{s.name}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2", textAlign: "right" }}>
                  <button type="button" onClick={() => void deleteSite(s.id)} style={{ color: "#a00" }}>Supprimer</button>
                </td>
              </tr>
            ))}
            {sites.length === 0 && (
              <tr><td colSpan={2} style={{ padding: 12, opacity: .7, textAlign: "center" }}>Aucun site.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function AdminTab(props: {
  users: { id: string; email: string | null; is_admin: boolean; site: string | null }[];
  sites: { id: string; name: string }[];
  pendingRefs: any[];
  setUsers: React.Dispatch<React.SetStateAction<{ id: string; email: string | null; is_admin: boolean; site: string | null }[]>>;
  setUserSite: (userId: string, site: string | null) => Promise<void>;
  toggleUserAdmin: (userId: string, value: boolean) => Promise<void>;
  approvePendingRef: (p: any) => Promise<void>;
  rejectPendingRef: (id: string) => Promise<void>;
}) {
  const {
    users, sites, pendingRefs,
    setUsers, setUserSite, toggleUserAdmin,
    approvePendingRef, rejectPendingRef,
  } = props;

  return (
    <section>
      <h2>Administration</h2>

      {/* Utilisateurs */}
      <div style={{ marginTop: 12 }}>
        <h3>Utilisateurs</h3>
        <p style={{ opacity: .8, marginTop: 0 }}>Assigner un site et/ou basculer un compte en admin.</p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Email</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Site</th>
              <th style={{ textAlign: "center", padding: 8, borderBottom: "1px solid #eee" }}>Admin</th>
              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>{u.email || u.id}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>
                  <select
                    value={u.site || ""}
                    onChange={(e) => setUsers(prev => prev.map(x => x.id === u.id ? { ...x, site: e.target.value || null } : x))}
                    style={{ padding: 6, minWidth: 160 }}
                  >
                    <option value="">— aucun —</option>
                    {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={u.is_admin}
                    onChange={(e) => setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_admin: e.target.checked } : x))}
                  />
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2", textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => Promise.all([
                      setUserSite(u.id, u.site || null),
                      toggleUserAdmin(u.id, u.is_admin),
                    ]).then(() => void 0)}
                  >
                    Enregistrer
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={4} style={{ padding: 12, textAlign: "center", opacity: .7 }}>Aucun utilisateur.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Références en attente */}
      <div style={{ marginTop: 24 }}>
        <h3>Références en attente</h3>
        <p style={{ opacity: .8, marginTop: 0 }}>Issues des commandes lorsqu'une réf fournisseur n'était pas liée à une pièce.</p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Créée</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Fournisseur</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Réf fournisseur</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Pièce</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>URL</th>
              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pendingRefs.map(p => (
              <tr key={p.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>
                  {p.created_at ? new Date(p.created_at).toLocaleString() : "—"}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>
                  {p.supplier?.name || p.supplier_id}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>
                  <code>{p.supplier_ref}</code>
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>
                  {p.part ? `${p.part.sku} — ${p.part.label}` : p.part_id}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2" }}>
                  {p.product_url ? <a href={p.product_url} target="_blank" rel="noreferrer">{p.product_url}</a> : "—"}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #f2f2f2", textAlign: "right" }}>
                  <button type="button" onClick={() => void approvePendingRef(p)} style={{ marginRight: 8 }}>Approuver</button>
                  <button type="button" onClick={() => void rejectPendingRef(p.id)} style={{ color: "#a00" }}>Rejeter</button>
                </td>
              </tr>
            ))}
            {pendingRefs.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 12, textAlign: "center", opacity: .7 }}>Aucune référence en attente.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------- Pont simple pour “ouvrir” une commande terminée depuis DoneOrdersBlock ----------
declare global {
  interface Window {
    __openOrderFromDone?: (id: string) => void;
  }
}

// On met en place un listener au montage du module pour faire le lien
// (App écoute cet event et fait le setActiveOrderId + loadOrderItems)
(function wireOpenOrderBridge() {
  window.addEventListener("open-order", (ev: Event) => {
    const detail = (ev as CustomEvent).detail as { id: string };
    // On cherche le noeud React “App” courant :
    // plus simple : déclencher une fonction globale que App définit au montage.
    if (window.__openOrderFromDone) {
      window.__openOrderFromDone(detail.id);
    }
  });
})();
