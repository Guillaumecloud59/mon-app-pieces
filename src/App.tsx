import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";

/** Types **/
type Part = { id: string; sku: string; label: string; created_at?: string };
type Supplier = { id: string; name: string; site_url?: string | null; created_at?: string };
type SupplierRef = {
  id: string;
  part_id: string;
  supplier_id: string;
  supplier_ref: string;
  product_url?: string | null;
  created_at?: string;
  part?: Part;
  supplier?: Supplier;
};
type Offer = {
  id: number;
  supplier_part_ref_id: string;
  price: number;
  currency: string;
  qty_available?: number | null;
  noted_at: string;
  ref?: SupplierRef & { supplier?: Supplier; part?: Part };
};
type Order = {
  id: string;
  supplier_id?: string | null;
  site?: string | null;
  status: "draft" | "ordered" | "partially_received" | "received" | "cancelled";
  external_ref?: string | null;
  ordered_at?: string | null;
  created_at: string;
  supplier?: Supplier | null;
};
type OrderItem = {
  id: string;
  order_id: string;
  part_id: string | null;
  supplier_ref?: string | null;
  qty: number;
  unit_price?: number | null;
  currency?: string | null;
  created_at?: string;
  part?: Part | null;
};
type InventoryRow = { site: string; part_id: string; qty_on_hand: number; updated_at: string };
type SiteRow = { id: string; name: string; note?: string | null; created_at: string };

export default function App() {
  /** ----------------------- AUTH ----------------------- **/
  const [session, setSession] = useState<Session | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!authEmail || !authPassword) return;
    setAuthLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    setAuthLoading(false);
    if (error) alert(error.message);
  }
  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    if (!authEmail || !authPassword) return;
    setAuthLoading(true);
    const { error } = await supabase.auth.signUp({ email: authEmail, password: authPassword });
    setAuthLoading(false);
    if (error) alert(error.message);
    else alert("Compte créé. Connecte-toi (ou vérifie tes emails si la confirmation est activée).");
  }
  async function signOut() {
    await supabase.auth.signOut();
  }

  if (!session) {
    return (
      <div style={{ maxWidth: 480, margin: "10vh auto", padding: 24 }}>
        <h1>Connexion</h1>
        <form onSubmit={signInWithPassword} style={{ display: "grid", gap: 12 }}>
          <div>
            <label>Email</label>
            <input type="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)}
                   placeholder="vous@exemple.com" style={{ width: "100%", padding: 10 }} />
          </div>
          <div>
            <label>Mot de passe</label>
            <input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)}
                   placeholder="••••••••" style={{ width: "100%", padding: 10 }} />
          </div>
          <button disabled={authLoading} style={{ padding: "10px 16px" }}>
            {authLoading ? "Connexion..." : "Se connecter"}
          </button>
          <button onClick={signUp} type="button" style={{ padding: "10px 16px" }}>
            Créer un compte
          </button>
        </form>
        <div style={{ marginTop: 16, fontSize: 12, opacity: 0.7 }}>
          (Supabase Auth → Email activé, ajoute tes Redirect URLs. Pour tests rapides, tu peux désactiver “Confirm email”.)
        </div>
      </div>
    );
  }

  /** ----------------------- ÉTATS APP ----------------------- **/
  // Pièces
  const [sku, setSku] = useState(""); const [label, setLabel] = useState("");
  const [parts, setParts] = useState<Part[]>([]); const [loadingPart, setLoadingPart] = useState(false);

  // Fournisseurs
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierName, setSupplierName] = useState(""); const [supplierUrl, setSupplierUrl] = useState("");
  const [loadingSupplier, setLoadingSupplier] = useState(false);

  // Références fournisseur
  const [refs, setRefs] = useState<SupplierRef[]>([]);
  const [selectedPartId, setSelectedPartId] = useState(""); const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [supplierRef, setSupplierRef] = useState(""); const [productUrl, setProductUrl] = useState("");
  const [loadingRef, setLoadingRef] = useState(false);

  // Offres
  const [offers, setOffers] = useState<Offer[]>([]);
  const [offerPartId, setOfferPartId] = useState(""); const [offerRefId, setOfferRefId] = useState("");
  const [offerPrice, setOfferPrice] = useState(""); const [offerQty, setOfferQty] = useState("");
  const [loadingOffer, setLoadingOffer] = useState(false);

  // Commandes
  const [orders, setOrders] = useState<Order[]>([]);
  const [newOrderSupplierId, setNewOrderSupplierId] = useState(""); const [newOrderSite, setNewOrderSite] = useState("");
  const [newOrderExternalRef, setNewOrderExternalRef] = useState(""); const [creatingOrder, setCreatingOrder] = useState(false);
  const [activeOrderId, setActiveOrderId] = useState<string>("");

  // Lignes + réception
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [receivedByItem, setReceivedByItem] = useState<Record<string, number>>({});
  const [oiPartId, setOiPartId] = useState(""); const [oiSupplierRef, setOiSupplierRef] = useState("");
  const [oiQty, setOiQty] = useState(""); const [oiUnitPrice, setOiUnitPrice] = useState("");
  const [addingItem, setAddingItem] = useState(false);

  // Inventaire
  const [inventory, setInventory] = useState<InventoryRow[]>([]);

  // Réception
  const [receiveSite, setReceiveSite] = useState("");
  const [toReceive, setToReceive] = useState<Record<string, string>>({});

  // Sites + transferts
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteName, setSiteName] = useState(""); const [siteNote, setSiteNote] = useState("");
  const [transferPartId, setTransferPartId] = useState("");
  const [transferFrom, setTransferFrom] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferQty, setTransferQty] = useState("");

  /** ----------------------- LOADERS ----------------------- **/
  async function loadParts() {
    const { data, error } = await supabase.from("parts").select("*").order("created_at", { ascending: false });
    if (error) return console.error(error);
    setParts((data || []) as Part[]);
  }
  async function addPart(e: React.FormEvent) {
    e.preventDefault();
    if (!sku.trim() || !label.trim()) return;
    setLoadingPart(true);
    const { error } = await supabase.from("parts").insert({ sku: sku.trim(), label: label.trim() });
    setLoadingPart(false);
    if (error) return alert(error.message);
    setSku(""); setLabel(""); loadParts();
  }

  async function loadSuppliers() {
    const { data, error } = await supabase.from("suppliers").select("*").order("created_at", { ascending: false });
    if (error) return console.error(error);
    setSuppliers((data || []) as Supplier[]);
  }
  async function addSupplier(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierName.trim()) return;
    setLoadingSupplier(true);
    const { error } = await supabase.from("suppliers").insert({ name: supplierName.trim(), site_url: supplierUrl || null });
    setLoadingSupplier(false);
    if (error) return alert(error.message);
    setSupplierName(""); setSupplierUrl(""); loadSuppliers();
  }

  async function loadSupplierRefs() {
    const { data, error } = await supabase
      .from("supplier_part_refs")
      .select(`
        id, part_id, supplier_id, supplier_ref, product_url, created_at,
        part:parts(id, sku, label),
        supplier:suppliers(id, name, site_url)
      `)
      .order("created_at", { ascending: false });
    if (error) return console.error(error);
    setRefs((data || []) as any);
  }
  async function addSupplierRef(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPartId || !selectedSupplierId || !supplierRef.trim()) return;
    setLoadingRef(true);
    const { error } = await supabase.from("supplier_part_refs").insert({
      part_id: selectedPartId,
      supplier_id: selectedSupplierId,
      supplier_ref: supplierRef.trim(),
      product_url: productUrl || null,
    });
    setLoadingRef(false);
    if (error) {
      // @ts-ignore
      if (error.code === "23505") alert("Déjà une réf pour ce fournisseur et cette pièce (contrainte unique).");
      else alert(error.message);
      return;
    }
    setSupplierRef(""); setProductUrl("");
    loadSupplierRefs();
  }

  async function loadOffers() {
    const { data, error } = await supabase
      .from("offers")
      .select(`
        id, supplier_part_ref_id, price, currency, qty_available, noted_at,
        ref:supplier_part_refs(
          id, supplier_ref, product_url,
          part:parts(id, sku, label),
          supplier:suppliers(id, name, site_url)
        )
      `)
      .order("noted_at", { ascending: false });
    if (error) return console.error(error);
    setOffers((data || []) as any);
  }
  async function addOffer(e: React.FormEvent) {
    e.preventDefault();
    if (!offerRefId || offerPrice === "") return;
    const priceNumber = Number(offerPrice);
    if (!Number.isFinite(priceNumber) || priceNumber < 0) return alert("Prix invalide");
    const qtyNumber = offerQty === "" ? null : Number(offerQty);
    if (qtyNumber !== null && (!Number.isFinite(qtyNumber) || qtyNumber < 0)) return alert("Qté invalide");

    setLoadingOffer(true);
    const { error } = await supabase.from("offers").insert({
      supplier_part_ref_id: offerRefId,
      price: priceNumber,
      qty_available: qtyNumber,
    });
    setLoadingOffer(false);
    if (error) return alert(error.message);
    setOfferPrice(""); setOfferQty("");
    loadOffers();
  }

  async function loadOrders() {
    const { data, error } = await supabase
      .from("orders")
      .select(`
        id, supplier_id, site, status, external_ref, ordered_at, created_at,
        supplier:suppliers(id, name, site_url)
      `)
      .order("created_at", { ascending: false });
    if (error) return console.error(error);
    setOrders((data || []) as any);
  }
  async function createOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!newOrderSupplierId || !newOrderSite) return;
    setCreatingOrder(true);
    const { data, error } = await supabase
      .from("orders")
      .insert({
        supplier_id: newOrderSupplierId,
        site: newOrderSite,
        external_ref: newOrderExternalRef || null,
        status: "draft",
      })
      .select("id")
      .single();
    setCreatingOrder(false);
    if (error) return alert(error.message);
    setNewOrderExternalRef(""); setNewOrderSite(""); setNewOrderSupplierId("");
    await loadOrders();
    if (data?.id) setActiveOrderId(data.id as string);
  }

  async function loadOrderItems(orderId: string) {
    if (!orderId) return setOrderItems([]);
    const { data, error } = await supabase
      .from("order_items")
      .select(`
        id, order_id, part_id, supplier_ref, qty, unit_price, currency, created_at,
        part:parts(id, sku, label)
      `)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    if (error) return alert(error.message);
    setOrderItems((data || []) as any);

    // total déjà reçu par ligne
    if ((data || []).length) {
      const ids = (data as any[]).map(d => d.id);
      const { data: recAgg } = await supabase
        .from("receipt_items")
        .select("order_item_id, qty_received")
        .in("order_item_id", ids);
      const map: Record<string, number> = {};
      (recAgg || []).forEach((r: any) => {
        map[r.order_item_id] = (map[r.order_item_id] || 0) + Number(r.qty_received || 0);
      });
      setReceivedByItem(map);
    } else {
      setReceivedByItem({});
    }
  }
  async function addOrderItem(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrderId || !oiPartId) return;
    const qtyNumber = Number(oiQty);
    if (!Number.isFinite(qtyNumber) || qtyNumber <= 0) return alert("La quantité doit être > 0");
    const unitPriceNumber = oiUnitPrice === "" ? null : Number(oiUnitPrice);
    if (unitPriceNumber !== null && (!Number.isFinite(unitPriceNumber) || unitPriceNumber < 0)) return alert("Prix unitaire invalide");

    setAddingItem(true);
    const { error } = await supabase.from("order_items").insert({
      order_id: activeOrderId,
      part_id: oiPartId,
      supplier_ref: oiSupplierRef || null,
      qty: qtyNumber,
      unit_price: unitPriceNumber,
      currency: "EUR",
    });
    setAddingItem(false);
    if (error) return alert(error.message);
    setOiPartId(""); setOiSupplierRef(""); setOiQty(""); setOiUnitPrice("");
    loadOrderItems(activeOrderId);
  }
  async function setOrderStatus(orderId: string, next: "draft" | "ordered") {
    const { error } = await supabase.from("orders").update({ status: next }).eq("id", orderId);
    if (error) return alert(error.message);
    await loadOrders();
  }

  async function loadInventory() {
    const { data, error } = await supabase.from("inventory").select("*").order("updated_at", { ascending: false });
    if (error) return console.error(error);
    setInventory((data || []) as any);
  }

  async function loadSites() {
    const { data, error } = await supabase.from("sites").select("*").order("name");
    if (error) return console.error(error);
    setSites((data || []) as any);
  }
  async function addSite(e: React.FormEvent) {
    e.preventDefault();
    if (!siteName.trim()) return;
    const { error } = await supabase.from("sites").insert({ name: siteName.trim(), note: siteNote || null });
    if (error) return alert(error.message);
    setSiteName(""); setSiteNote("");
    loadSites();
  }

  async function doTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!transferPartId || !transferFrom || !transferTo || !transferQty) return;
    const qty = Number(transferQty);
    if (!Number.isFinite(qty) || qty <= 0) return alert("Quantité invalide");
    const { error } = await supabase.rpc("stock_transfer", {
      site_from: transferFrom,
      site_to: transferTo,
      part_id_in: transferPartId,
      qty_in: qty,
    });
    if (error) return alert(error.message);
    setTransferQty("");
    await loadInventory();
    alert("Transfert effectué ✅");
  }

  /** ----------------------- HELPERS ----------------------- **/
  const refsByPart = useMemo(() => {
    const m: Record<string, SupplierRef[]> = {};
    for (const r of refs) (m[r.part_id] ||= []).push(r);
    return m;
  }, [refs]);

  const bestOfferByPart = useMemo(() => {
    const best: Record<string, Offer | undefined> = {};
    for (const o of offers) {
      const pid = o.ref?.part?.id;
      if (!pid) continue;
      const current = best[pid];
      if (!current || o.price < current.price) best[pid] = o;
    }
    return best;
  }, [offers]);

  const activeOrder = useMemo(() => orders.find(o => o.id === activeOrderId), [orders, activeOrderId]);

  function remainingFor(item: OrderItem) {
    const rec = receivedByItem[item.id] ?? 0;
    return Math.max((item.qty || 0) - rec, 0);
  }

  async function createReceiptWithItems() {
    if (!activeOrderId) return;
    const site = receiveSite || activeOrder?.site || "";
    if (!site) { alert("Renseigne un site de réception."); return; }

    const lines: { order_item_id: string; qty_received: number }[] = [];
    for (const it of orderItems) {
      const raw = toReceive[it.id];
      if (!raw) continue;
      const q = Number(raw);
      if (!Number.isFinite(q) || q <= 0) continue;
      const max = remainingFor(it);
      if (q > max) { alert(`La quantité pour "${it.part?.sku}" dépasse le restant (${q} > ${max}).`); return; }
      lines.push({ order_item_id: it.id, qty_received: q });
    }
    if (lines.length === 0) { alert("Renseigne au moins une quantité à réceptionner."); return; }

    const { data: receipt, error: recErr } = await supabase
      .from("receipts")
      .insert({ order_id: activeOrderId, site })
      .select("id")
      .single();
    if (recErr) return alert(recErr.message);

    const payload = lines.map(l => ({ receipt_id: receipt!.id, order_item_id: l.order_item_id, qty_received: l.qty_received }));
    const { error: riErr } = await supabase.from("receipt_items").insert(payload);
    if (riErr) return alert(riErr.message);

    await loadOrderItems(activeOrderId);
    await loadInventory();
    await loadOrders();
    setToReceive({});
    alert("Réception enregistrée ✅");
  }

  /** ----------------------- LIFECYCLE ----------------------- **/
  useEffect(() => {
    loadParts();
    loadSuppliers();
    loadSupplierRefs();
    loadOffers();
    loadOrders();
    loadInventory();
    loadSites();
  }, []);
  useEffect(() => {
    if (activeOrderId) {
      loadOrderItems(activeOrderId);
      setReceiveSite(activeOrder?.site || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrderId]);

  /** ----------------------- UI ----------------------- **/
  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Inventaire pièces (MVP)</h1>
        <div>
          <span style={{ marginRight: 8, fontSize: 12, opacity: 0.7 }}>{session.user.email}</span>
          <button onClick={signOut}>Se déconnecter</button>
        </div>
      </div>

      {/* PIÈCES */}
      <section style={{ marginTop: 16 }}>
        <h2>Pièces</h2>
        <form onSubmit={addPart} style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 2fr auto", alignItems: "end" }}>
          <div><label>SKU</label><input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="ex: ABC123" style={{ width: "100%", padding: 8 }} /></div>
          <div><label>Libellé</label><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex: Courroie 12mm" style={{ width: "100%", padding: 8 }} /></div>
          <button disabled={loadingPart} style={{ padding: "10px 16px" }}>{loadingPart ? "Ajout..." : "Ajouter"}</button>
        </form>

        <ul style={{ padding: 0, listStyle: "none", marginTop: 12 }}>
          {parts.map((p) => (
            <li key={p.id} style={{ padding: 12, border: "1px solid #eee", marginBottom: 8, borderRadius: 8 }}>
              <b>{p.sku}</b> — {p.label}
              {bestOfferByPart[p.id] && (
                <div style={{ marginTop: 6, fontSize: 14 }}>
                  <span style={{ background: "#eef8ee", padding: "2px 6px", borderRadius: 6 }}>
                    Meilleure offre : {bestOfferByPart[p.id]!.price.toFixed(2)} {bestOfferByPart[p.id]!.currency}
                    {" · "} {bestOfferByPart[p.id]!.ref?.supplier?.name}
                    {bestOfferByPart[p.id]!.ref?.supplier_ref ? ` · réf ${bestOfferByPart[p.id]!.ref!.supplier_ref}` : ""}
                  </span>
                </div>
              )}
            </li>
          ))}
          {parts.length === 0 && <li>Aucune pièce pour l’instant.</li>}
        </ul>
      </section>

      {/* FOURNISSEURS */}
      <section style={{ marginTop: 32 }}>
        <h2>Fournisseurs</h2>
        <form onSubmit={addSupplier} style={{ display: "grid", gap: 8, gridTemplateColumns: "2fr 3fr auto", alignItems: "end" }}>
          <div><label>Nom</label><input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="ex: PiècesPro" style={{ width: "100%", padding: 8 }} /></div>
          <div><label>Site (optionnel)</label><input value={supplierUrl} onChange={(e) => setSupplierUrl(e.target.value)} placeholder="https://..." style={{ width: "100%", padding: 8 }} /></div>
          <button disabled={loadingSupplier} style={{ padding: "10px 16px" }}>{loadingSupplier ? "Ajout..." : "Ajouter"}</button>
        </form>
      </section>

      {/* SITES */}
      <section style={{ marginTop: 32 }}>
        <h2>Sites</h2>
        <form onSubmit={addSite} style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 2fr auto", alignItems: "end" }}>
          <div>
            <label>Nom du site</label>
            <input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="ex: Atelier A"
                   style={{ width: "100%", padding: 8 }} />
          </div>
          <div>
            <label>Note (optionnel)</label>
            <input value={siteNote} onChange={(e) => setSiteNote(e.target.value)} placeholder="ex: étage -1"
                   style={{ width: "100%", padding: 8 }} />
          </div>
          <button style={{ padding: "10px 16px" }}>Ajouter</button>
        </form>

        <ul style={{ padding: 0, listStyle: "none", marginTop: 12 }}>
          {sites.map((s) => (
            <li key={s.id} style={{ padding: 12, border: "1px solid #eee", marginBottom: 8, borderRadius: 8 }}>
              <b>{s.name}</b> {s.note ? <span style={{ opacity: 0.8 }}>— {s.note}</span> : null}
            </li>
          ))}
          {sites.length === 0 && <li>Aucun site pour l’instant.</li>}
        </ul>
      </section>

      {/* RÉFÉRENCES FOURNISSEUR */}
      <section style={{ marginTop: 32 }}>
        <h2>Références fournisseur</h2>
        <form onSubmit={addSupplierRef} style={{ display: "grid", gap: 8, gridTemplateColumns: "1.2fr 1.2fr 1fr 2fr auto", alignItems: "end" }}>
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
          <div><label>Réf fournisseur</label><input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} placeholder="ex: X-789" style={{ width: "100%", padding: 8 }} /></div>
          <div><label>URL produit (opt.)</label><input value={productUrl} onChange={(e) => setProductUrl(e.target.value)} placeholder="https://..." style={{ width: "100%", padding: 8 }} /></div>
          <button disabled={loadingRef} style={{ padding: "10px 16px" }}>{loadingRef ? "Ajout..." : "Lier"}</button>
        </form>
      </section>

      {/* OFFRES */}
      <section style={{ marginTop: 32 }}>
        <h2>Offres (prix / stock)</h2>
        <form onSubmit={addOffer} style={{ display: "grid", gap: 8, gridTemplateColumns: "1.2fr 1.8fr 1fr 1fr auto", alignItems: "end" }}>
          <div><label>Pièce</label>
            <select value={offerPartId} onChange={(e) => { setOfferPartId(e.target.value); setOfferRefId(""); }} style={{ width: "100%", padding: 8 }}>
              <option value="">— choisir —</option>
              {parts.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.label}</option>)}
            </select>
          </div>
          <div><label>Réf fournisseur</label>
            <select value={offerRefId} onChange={(e) => setOfferRefId(e.target.value)} style={{ width: "100%", padding: 8 }}>
              <option value=""></option>
              {(offerPartId ? (refsByPart[offerPartId] || []) : []).map((r) => (
                <option key={r.id} value={r.id}>
                  {(suppliers.find(s => s.id === r.supplier_id)?.name) || "Fournisseur"} — {r.supplier_ref}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Prix (EUR)</label>
            <input type="number" step="0.01" min={0} value={offerPrice}
              onChange={(e) => setOfferPrice(e.target.value)} placeholder="ex: 12.50" style={{ width: "100%", padding: 8 }} />
          </div>
          <div>
            <label>Qté dispo (opt.)</label>
            <input type="number" step={1} min={0} value={offerQty}
              onChange={(e) => setOfferQty(e.target.value)} placeholder="ex: 30" style={{ width: "100%", padding: 8 }} />
          </div>
          <button disabled={loadingOffer} style={{ padding: "10px 16px" }}>{loadingOffer ? "Ajout..." : "Enregistrer"}</button>
        </form>
      </section>

      {/* COMMANDES */}
      <section style={{ marginTop: 32 }}>
        <h2>Commandes</h2>

        {/* Créer une commande */}
        <form onSubmit={createOrder} style={{ display: "grid", gap: 8, gridTemplateColumns: "1.5fr 1fr 1fr auto", alignItems: "end" }}>
          <div>
            <label>Fournisseur</label>
            <select value={newOrderSupplierId} onChange={(e) => setNewOrderSupplierId(e.target.value)} style={{ width: "100%", padding: 8 }}>
              <option value="">— choisir —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label>Site de livraison</label>
            <select value={newOrderSite} onChange={(e) => setNewOrderSite(e.target.value)} style={{ width: "100%", padding: 8 }}>
              <option value="">— choisir —</option>
              {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label>N° commande (opt.)</label>
            <input value={newOrderExternalRef} onChange={(e) => setNewOrderExternalRef(e.target.value)} placeholder="ex: PO-2025-001" style={{ width: "100%", padding: 8 }} />
          </div>
          <button disabled={creatingOrder} style={{ padding: "10px 16px" }}>{creatingOrder ? "Création..." : "Créer commande"}</button>
        </form>

        {/* Liste des commandes */}
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          {orders.map((o) => (
            <div key={o.id}
                 onClick={() => { setActiveOrderId(o.id); setReceiveSite(o.site || ""); }}
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
              <div style={{ fontSize: 12, opacity: 0.8 }}>Créée le {new Date(o.created_at).toLocaleString()}</div>
            </div>
          ))}
          {orders.length === 0 && <div>Aucune commande pour l’instant.</div>}
        </div>

        {/* Lignes + Réception */}
        {activeOrderId && (
          <div style={{ marginTop: 20 }}>
            <h3>Lignes de la commande sélectionnée</h3>

            {/* Ajout de ligne si DRAFT */}
            {activeOrder?.status === "draft" ? (
              <form onSubmit={addOrderItem} style={{ display: "grid", gap: 8, gridTemplateColumns: "1.5fr 1fr 0.8fr 0.8fr auto", alignItems: "end" }}>
                <div>
                  <label>Pièce</label>
                  <select value={oiPartId} onChange={(e) => { setOiPartId(e.target.value); setOiSupplierRef(""); }} style={{ width: "100%", padding: 8 }}>
                    <option value="">— choisir —</option>
                    {parts.map(p => <option key={p.id} value={p.id}>{p.sku} — {p.label}</option>)}
                  </select>
                  {oiPartId && bestOfferByPart[oiPartId] && (
                    <div style={{ fontSize: 12, marginTop: 4, opacity: 0.8 }}>
                      Suggestion prix : {bestOfferByPart[oiPartId]!.price.toFixed(2)} {bestOfferByPart[oiPartId]!.currency}
                      {" · "} {bestOfferByPart[oiPartId]!.ref?.supplier?.name}
                    </div>
                  )}
                </div>
                <div>
                  <label>Réf fournisseur (opt.)</label>
                  <input value={oiSupplierRef} onChange={(e) => setOiSupplierRef(e.target.value)} placeholder="ex: X-789" style={{ width: "100%", padding: 8 }} />
                </div>
                <div>
                  <label>Qté</label>
                  <input type="number" step={1} min={1} value={oiQty}
                         onChange={(e) => setOiQty(e.target.value)} placeholder="ex: 10" style={{ width: "100%", padding: 8 }} />
                </div>
                <div>
                  <label>PU (EUR)</label>
                  <input type="number" step="0.01" min={0} value={oiUnitPrice}
                         onChange={(e) => setOiUnitPrice(e.target.value)} placeholder="ex: 12.50" style={{ width: "100%", padding: 8 }} />
                </div>
                <button disabled={addingItem} style={{ padding: "10px 16px" }}>{addingItem ? "Ajout..." : "Ajouter la ligne"}</button>
              </form>
            ) : (
              <div style={{ marginTop: 12, opacity: 0.8 }}>Ajout de lignes désactivé (commande non “draft”).</div>
            )}

            {/* Tableau des lignes & restant */}
            <div style={{ marginTop: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Pièce</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Qté commandée</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Déjà reçue</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Restant</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Réception (maintenant)</th>
                  </tr>
                </thead>
                <tbody>
                  {orderItems.map(oi => {
                    const rec = receivedByItem[oi.id] || 0;
                    const remaining = Math.max((oi.qty || 0) - rec, 0);
                    return (
                      <tr key={oi.id}>
                        <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>{oi.part?.sku} — {oi.part?.label}</td>
                        <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8, textAlign: "right" }}>{oi.qty}</td>
                        <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8, textAlign: "right" }}>{rec}</td>
                        <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8, textAlign: "right" }}>{remaining}</td>
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
                    <tr><td colSpan={5} style={{ padding: 12, textAlign: "center", opacity: 0.7 }}>Aucune ligne pour l’instant.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Bloc Réception */}
            <div style={{ marginTop: 16, display: "grid", gap: 8, gridTemplateColumns: "1fr auto" }}>
              <div>
                <label>Site de réception</label>
                <input value={receiveSite} onChange={(e) => setReceiveSite(e.target.value)} placeholder="ex: Atelier A"
                       style={{ width: "100%", padding: 8 }} />
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                  (laissé vide → on utilisera le site de la commande)
                </div>
              </div>
              <div style={{ alignSelf: "end" }}>
                <button onClick={createReceiptWithItems} style={{ padding: "10px 16px" }}>
                  Enregistrer la réception
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* TRANSFERT */}
      <section style={{ marginTop: 32 }}>
        <h2>Transfert de stock</h2>
        <form onSubmit={doTransfer} style={{ display: "grid", gap: 8, gridTemplateColumns: "1.5fr 1fr 1fr 0.8fr auto", alignItems: "end" }}>
          <div>
            <label>Pièce</label>
            <select value={transferPartId} onChange={(e) => setTransferPartId(e.target.value)} style={{ width: "100%", padding: 8 }}>
              <option value="">— choisir —</option>
              {parts.map(p => <option key={p.id} value={p.id}>{p.sku} — {p.label}</option>)}
            </select>
          </div>
          <div>
            <label>De</label>
            <select value={transferFrom} onChange={(e) => setTransferFrom(e.target.value)} style={{ width: "100%", padding: 8 }}>
              <option value="">— site source —</option>
              {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label>Vers</label>
            <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)} style={{ width: "100%", padding: 8 }}>
              <option value="">— site destination —</option>
              {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label>Qté</label>
            <input type="number" min={1} step={1} value={transferQty}
                   onChange={(e) => setTransferQty(e.target.value)} placeholder="ex: 5" style={{ width: "100%", padding: 8 }} />
          </div>
          <button style={{ padding: "10px 16px" }}>Transférer</button>
        </form>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
          (Le stock du site source diminue et celui du site destination augmente.)
        </div>
      </section>

      {/* INVENTAIRE */}
      <section style={{ marginTop: 32 }}>
        <h2>Inventaire (par site & pièce)</h2>
        <div style={{ marginTop: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Site</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Pièce</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Stock</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>MAJ</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((row, i) => {
                const part = parts.find(p => p.id === row.part_id);
                return (
                  <tr key={`${row.site}-${row.part_id}-${i}`}>
                    <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>{row.site}</td>
                    <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>{part ? `${part.sku} — ${part.label}` : row.part_id}</td>
                    <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8, textAlign: "right" }}>{row.qty_on_hand}</td>
                    <td style={{ borderBottom: "1px solid #f2f2f2", padding: 8 }}>{new Date(row.updated_at).toLocaleString()}</td>
                  </tr>
                );
              })}
              {inventory.length === 0 && (
                <tr><td colSpan={4} style={{ padding: 12, textAlign: "center", opacity: 0.7 }}>Aucun stock enregistré.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
