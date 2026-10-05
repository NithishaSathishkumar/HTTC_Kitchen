"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, CircleDollarSign, Clock3, CookingPot, FileSpreadsheet, FileText, HandCoins, LayoutDashboard, Leaf, LoaderCircle, LogOut, Mail, Menu, MessageSquare, Package, Phone, Plus, Search, ShieldCheck, Sparkles, Upload, UsersRound, X } from "lucide-react";
import { exportInventoryToExcel, exportInventoryToWord } from "@/lib/inventory-export";
import { InventoryImportDialog } from "@/app/components/inventory-import-dialog";
import {HelperMultiSelect} from "@/app/components/helper-multi-select";
import {convertInventoryQuantity, type ImportedInventoryItem} from "@/lib/inventory-import-data";

type InventoryItem = { id: string; name: string; quantity: number; unit: string; threshold: number; sourceIds?: string[] };
const findPantryItem = (inventory: InventoryItem[], id: string | null) => inventory.find(item => item.id === id || (id !== null && item.sourceIds?.includes(id)));
const stockQuantity = (quantity: number) => quantity.toLocaleString(undefined, {maximumFractionDigits: 4});
type Volunteer = { id: string; name: string; role: string; phone: string | null; email: string | null; hours: number; isActive: boolean };
type Shift = { id: string; volunteerId: string; volunteerName: string; date: string; startTime: string; endTime: string; assignment: string; checkedInAt: string | null; checkedOutAt: string | null };
type Expense = { id: string; description: string; category: string; amount: number; spentAt: string };
type KitchenRole = "admin" | "staff" | "viewer";
type KitchenAccess = { id: string; email: string; role: KitchenRole; createdAt: string };
type ChangeRequest = { id: string; requesterEmail: string; requesterName: string; message: string; status: "pending" | "handled" | "declined"; createdAt: string; updatedAt: string };
type CalendarEntry = { id: string; date: string; endDate?: string | null; entryType: "event" | "cooking"; title: string; details: string | null; mealPeriod: "morning" | "afternoon" | "evening" | null; volunteerId: string | null; cookName: string | null; eventKind?: "normal" | "festive"; festivePlan?: StoredFestivePlan | null };
type Data = { inventory: InventoryItem[]; volunteers: Volunteer[]; shifts: Shift[]; expenses: Expense[] };
type Section = "Overview" | "Calendar" | "Big Events" | "Inventory" | "Volunteers" | "Expenses" | "Access";
type FormKind = "inventory" | "volunteer" | "shift" | "expense";

const emptyData: Data = { inventory: [], volunteers: [], shifts: [], expenses: [] };
const navigation: { name: Section; icon: typeof LayoutDashboard }[] = [
  { name: "Overview", icon: LayoutDashboard }, { name: "Calendar", icon: CalendarDays }, { name: "Big Events", icon: Sparkles }, { name: "Inventory", icon: Package },
  { name: "Volunteers", icon: UsersRound }, { name: "Expenses", icon: HandCoins },
];
const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const shortDate = (v: string) => new Date(`${v.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const displayDate = (v: string, options: Intl.DateTimeFormatOptions = {month:"short", day:"numeric", year:"numeric"}) => new Date(`${v.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", options);
const endDateOf = (event: CalendarEntry) => event.endDate || event.date;
function dateRange(start: string, end: string) {
  const result: string[] = [];
  const cursor = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  while (cursor <= last && result.length < 366) {
    result.push(`${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,"0")}-${String(cursor.getDate()).padStart(2,"0")}`);
    cursor.setDate(cursor.getDate()+1);
  }
  return result;
}
const eventDateLabel = (event: CalendarEntry) => endDateOf(event) === event.date ? displayDate(event.date) : `${displayDate(event.date)} – ${displayDate(endDateOf(event))}`;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export default function Home() {
  const [supabase, setSupabase] = useState<ReturnType<typeof createBrowserClient> | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    async function initializeAuth() {
      try {
        const response = await fetch("/api/auth/config", { cache: "no-store" });
        const config = await response.json();
        if (!response.ok) throw new Error(config.error || "Supabase Auth is not configured yet.");
        const client = createBrowserClient(config.url, config.publishableKey);
        if (!active) return;
        setSupabase(client);
        const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
          if (active) {
            setUser(session?.user ?? null);
            setAuthLoading(false);
            setAuthError("");
          }
        });
        unsubscribe = () => subscription.unsubscribe();
        const { data, error } = await client.auth.getUser();
        if (!active) return;
        setUser(error ? null : data.user);
        setAuthLoading(false);
        if (new URLSearchParams(window.location.search).get("auth") === "error") {
          setAuthError("Google sign-in did not finish. Check the Supabase Google provider settings and try again.");
          window.history.replaceState({}, "", window.location.pathname);
        }
      } catch (error) {
        if (active) {
          setAuthError(error instanceof Error ? error.message : "Could not connect to Supabase Auth.");
          setAuthLoading(false);
        }
      }
    }
    void initializeAuth();
    return () => { active = false; unsubscribe(); };
  }, []);

  async function signInWithGoogle() {
    if (!supabase) return;
    setSigningIn(true);
    setAuthError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setAuthError(error.message);
      setSigningIn(false);
    }
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
  }

  if (authLoading) return <main className="auth-screen auth-loading-screen" role="status" aria-live="polite"><section className="auth-loading-card"><div className="auth-loading-mark"><CookingPot size={23}/></div><div className="auth-loading-copy"><span>HTTC Kitchen</span><p>Connecting securely</p><small>Preparing your kitchen workspace</small></div><div className="auth-loading-indicator"><LoaderCircle className="spin" size={20}/></div></section></main>;
  if (!user) return <SignInScreen error={authError} disabled={!supabase || signingIn} onSignIn={() => void signInWithGoogle()}/>;
  return <KitchenDashboard user={user} onSignOut={() => void signOut()}/>;
}

function SignInScreen({error, disabled, onSignIn}: {error: string; disabled: boolean; onSignIn: () => void}) {
  return <main className="auth-screen">
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="brand-mark"><CookingPot size={21}/></div>
      <p className="auth-kicker">Temple operations</p>
      <h1 id="auth-title">HTTC Kitchen</h1>
      <p className="auth-copy">Sign in with your Google account to manage kitchen inventory, volunteer shifts, and expenses.</p>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="google-signin" onClick={onSignIn} disabled={disabled}>
        <GoogleMark/><span>Continue with Google</span>
      </button>
      <p className="auth-note"><ShieldCheck size={14}/> Your kitchen records stay in the temple’s Supabase workspace.</p>
    </section>
  </main>;
}

function GoogleMark() {
  return <svg aria-hidden="true" viewBox="0 0 48 48" width="18" height="18"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.9c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.36 38.12 46.98 31.91 46.98 24.55Z"/><path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a23.93 23.93 0 0 0 0 21.56l7.98-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.73-6c-2.14 1.44-4.88 2.3-8.17 2.3-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg>;
}

function KitchenDashboard({user, onSignOut}: {user: User; onSignOut: () => void}) {
  const [section, setSection] = useState<Section>("Overview");
  const [data, setData] = useState<Data>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormKind | null>(null);
  const [inventoryImportOpen, setInventoryImportOpen] = useState(false);
  const [inventorySearch, setInventorySearch] = useState("");
  const [editingRecord, setEditingRecord] = useState<{kind: "inventory" | "expense"; record: InventoryItem | Expense} | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [role, setRole] = useState<KitchenRole>("viewer");
  const [accessPeople, setAccessPeople] = useState<KitchenAccess[]>([]);
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
  const [requestOpen, setRequestOpen] = useState(false);
  const [calendarEntries, setCalendarEntries] = useState<CalendarEntry[]>([]);
  const [calendarMonth, setCalendarMonth] = useState(() => { const date = new Date(); return new Date(date.getFullYear(), date.getMonth(), 1); });
  const [calendarDay, setCalendarDay] = useState<string | null>(null);
  const [calendarEditEventId, setCalendarEditEventId] = useState<string | null>(null);
  const [selectedBigEventId, setSelectedBigEventId] = useState<string | null>(null);

  useEffect(() => {
    try { setSidebarCollapsed(window.localStorage.getItem("httc-sidebar-collapsed") === "true"); }
    catch { /* The sidebar still works when browser storage is unavailable. */ }
  }, []);
  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try { window.localStorage.setItem("httc-sidebar-collapsed", String(next)); }
    catch { /* Keep the preference for this visit when storage is unavailable. */ }
  }

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/operations", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load kitchen records.");
      setData(payload);
      setRole(payload.role);
      setSection(current => payload.role === "staff"
        ? (["Calendar", "Big Events", "Inventory", "Expenses"].includes(current) ? current : "Calendar")
        : payload.role !== "admin" && ["Volunteers", "Access"].includes(current) ? "Overview" : current);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load kitchen records."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const refreshCalendar = useCallback(async () => {
    try {
      const response = await fetch("/api/calendar", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load the kitchen calendar.");
      setCalendarEntries(payload.entries);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load the kitchen calendar."); }
  }, []);
  useEffect(() => { if (section === "Calendar" || section === "Big Events") void refreshCalendar(); }, [section, refreshCalendar]);
  useEffect(() => {
    if (section !== "Access" || role !== "admin") return;
    Promise.all([fetch("/api/access", { cache: "no-store" }), fetch("/api/requests", { cache: "no-store" })]).then(async ([accessResponse, requestsResponse]) => {
      const [accessPayload, requestPayload] = await Promise.all([accessResponse.json(), requestsResponse.json()]);
      if (!accessResponse.ok) throw new Error(accessPayload.error || "Could not load access settings.");
      if (!requestsResponse.ok) throw new Error(requestPayload.error || "Could not load change requests.");
      setAccessPeople(accessPayload.people);
      setChangeRequests(requestPayload.requests);
      setError("");
    }).catch(e => setError(e instanceof Error ? e.message : "Could not load team access."));
  }, [section, role]);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { if (!notice) return; const t = window.setTimeout(() => setNotice(""), 3200); return () => window.clearTimeout(t); }, [notice]);

  const checkedIn = data.shifts.filter(s => s.checkedInAt && !s.checkedOutAt);
  const todaysShifts = data.shifts.filter(s => s.date === today());
  const lowStock = data.inventory.filter(i => i.quantity <= i.threshold);
  const searchTerms = inventorySearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filteredInventory = data.inventory.filter(item => {
    const text = `${item.name} ${item.unit}`.toLowerCase();
    return searchTerms.every(term => text.includes(term));
  });
  const monthStart = `${today().slice(0, 7)}-01`;
  const expensesThisMonth = data.expenses.filter(e => e.spentAt >= monthStart).reduce((sum, e) => sum + e.amount, 0);
  const greeting = mounted ? new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening" : "Welcome";

  async function mutate(url: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
    setSaving(true); setError("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save this update.");
      await refresh(); setNotice("Saved to the kitchen dashboard."); return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save this update."); return false; }
    finally { setSaving(false); }
  }

  async function saveRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!form || saving) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload = { ...values, type: form, quantity: values.quantity ? Number(values.quantity) : undefined, threshold: values.threshold ? Number(values.threshold) : undefined, amount: values.amount ? Number(values.amount) : undefined };
    const ok = editingRecord && editingRecord.kind === form
      ? await mutate("/api/operations", "PATCH", {...payload, action: form, id: editingRecord.record.id})
      : await mutate("/api/operations", "POST", payload);
    if (ok) { setForm(null); setEditingRecord(null); }
  }

  async function update(action: string, id: string, extras: Record<string, unknown> = {}) {
    const ok = await mutate("/api/operations", "PATCH", { action, id, ...extras });
    if (!ok) return;
  }

  async function importInventory(items: ImportedInventoryItem[]) {
    const response = await fetch("/api/operations", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({type: "inventory-import", items})});
    const payload = await response.json() as {error?: string; inventory: InventoryItem[]; imported: number; combined: number};
    if (!response.ok) throw new Error(payload.error || "Could not import the inventory. Please try again.");
    setData(current => ({...current, inventory: payload.inventory}));
    setInventoryImportOpen(false);
    setNotice(`${payload.imported} ${payload.imported === 1 ? "row" : "rows"} imported${payload.combined ? ` · ${payload.combined} combined with matching items` : ""}.`);
  }

  async function saveAccess(method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>) {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/access", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save access settings.");
      const list = await fetch("/api/access", { cache: "no-store" });
      const updated = await list.json();
      if (!list.ok) throw new Error(updated.error || "Could not refresh access settings.");
      setAccessPeople(updated.people);
      setNotice("Access settings saved.");
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save access settings."); return false; }
    finally { setSaving(false); }
  }

  async function addAccessPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const values = Object.fromEntries(new FormData(formElement).entries());
    if (await saveAccess("POST", values)) formElement.reset();
  }

  async function saveChangeRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const values = Object.fromEntries(new FormData(formElement).entries());
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not send your request.");
      setRequestOpen(false);
      setNotice("Your request was sent to the kitchen Admin.");
      formElement.reset();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send your request."); }
    finally { setSaving(false); }
  }

  async function reviewChangeRequest(id: string, action: "handled" | "declined" | "grant-staff") {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/requests", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not review this request.");
      const [requestResponse, accessResponse] = await Promise.all([fetch("/api/requests", { cache: "no-store" }), action === "grant-staff" ? fetch("/api/access", { cache: "no-store" }) : Promise.resolve(null)]);
      const requestPayload = await requestResponse.json();
      if (!requestResponse.ok) throw new Error(requestPayload.error || "Could not refresh change requests.");
      setChangeRequests(requestPayload.requests);
      if (accessResponse) {
        const accessPayload = await accessResponse.json();
        if (accessResponse.ok) setAccessPeople(accessPayload.people);
      }
      setNotice(action === "grant-staff" ? "Staff access granted and request handled." : action === "declined" ? "Request declined." : "Request marked handled.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not review this request."); }
    finally { setSaving(false); }
  }

  async function saveCalendarEntry(method: "POST" | "PUT" | "DELETE", body: Record<string, unknown>) {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/calendar", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save the calendar update.");
      await refreshCalendar();
      if (method === "POST" && body.eventKind === "festive" && typeof payload.id === "string") {
        setSelectedBigEventId(payload.id);
        setSection("Big Events");
        setCalendarDay(null);
        setCalendarEditEventId(null);
      }
      setNotice(method === "DELETE" ? "Calendar entry removed." : body.action === "update-meal" ? "Meal changes saved." : body.action === "update-event" ? body.festivePlan ? "Big event meal plan saved." : "Event updated." : method === "PUT" ? "Cooking assignment saved." : "Event added to the calendar.");
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the calendar update."); return false; }
    finally { setSaving(false); }
  }

  const openForm = (kind: FormKind) => { setError(""); setForm(kind); };
  const canEdit = role === "admin" || role === "staff";
  const addAction = section === "Inventory" ? ["inventory", "Add item"] as const : section === "Volunteers" ? ["volunteer", "Add volunteer"] as const : section === "Expenses" ? ["expense", "Add expense"] as const : ["inventory", "Add item"] as const;
  const visibleNavigation = role === "admin"
    ? [...navigation, { name: "Access" as Section, icon: ShieldCheck }]
    : role === "staff"
      ? navigation.filter(({name}) => name === "Calendar" || name === "Big Events" || name === "Inventory" || name === "Expenses")
      : navigation.filter(({name}) => name !== "Volunteers");

  return <div className={`app-shell ${sidebarCollapsed ? "sidebar-is-collapsed" : ""}`}>
    <aside id="kitchen-sidebar" className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
      <div className="brand"><div className="brand-mark"><CookingPot size={20} strokeWidth={1.9}/></div><div className="brand-copy"><strong>HTTC Kitchen</strong><span>Temple operations</span></div><button className="sidebar-collapse-button" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!sidebarCollapsed} aria-controls="kitchen-sidebar">{sidebarCollapsed ? <ChevronRight size={17}/> : <ChevronLeft size={17}/>}</button><button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={18}/></button></div>
      <div className="side-label">WORKSPACE</div>
      <nav aria-label="Kitchen sections">{visibleNavigation.map(({name, icon: Icon}) => <button key={name} onClick={() => { setSection(name); setMobileNav(false); }} className={`nav-link ${section === name ? "active" : ""}`} aria-label={name} aria-current={section === name ? "page" : undefined} title={name}><Icon size={18} aria-hidden="true"/><span>{name}</span>{name === "Inventory" && lowStock.length > 0 && <b className="nav-badge">{lowStock.length}</b>}</button>)}</nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-note"><div className="note-icon"><Leaf size={17}/></div><strong>Serving with care</strong><p>Thank you for nourishing our community.</p></div>
      <div className="profile"><div className="profile-avatar">{(user.user_metadata.full_name || user.email || "K").slice(0, 1).toUpperCase()}</div><div className="profile-copy"><strong>{user.user_metadata.full_name || user.email}</strong><span>{role === "admin" ? "Admin" : role === "staff" ? "Kitchen staff" : "View only"}</span></div><button className="signout-button" onClick={onSignOut} title="Sign out" aria-label="Sign out"><LogOut size={15}/></button></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20}/></button><div className="crumb">Temple kitchen <span>/</span> <strong>{section}</strong></div><div className="topbar-right"><span className="today-chip"><CalendarDays size={15}/>{mounted ? new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "Today"}</span><button className="avatar-button" title={user.email || "Signed-in user"}>{(user.user_metadata.full_name || user.email || "K").slice(0, 1).toUpperCase()}</button></div></header>
      <div className="content">
        <div className="welcome-row"><div><p className="eyebrow">{greeting}, kitchen team</p><h1>{section === "Overview" ? "Kitchen overview" : section === "Access" ? "Team access" : section}</h1><p className="subtitle">{section === "Access" ? "Choose who can manage records and who can view them." : section === "Calendar" ? "Plan kitchen events and who is cooking each meal." : section === "Big Events" ? "Choose an event and a day, then plan its three meals." : "A calm, clear view of what your kitchen needs today."}</p></div>{role === "viewer" && <button className="primary-button" onClick={() => { setError(""); setRequestOpen(true); }}><MessageSquare size={16}/>Request a change</button>}<div className="welcome-actions">{section === "Inventory" && <>{canEdit && <button className="outline-button" onClick={() => setInventoryImportOpen(true)}><Upload size={15}/>Import Excel</button>}<button className="outline-button" aria-label="Export inventory to Excel" onClick={() => exportInventoryToExcel(data.inventory)}><FileSpreadsheet size={15}/>Excel</button><button className="outline-button" aria-label="Export inventory to Word" onClick={() => exportInventoryToWord(data.inventory)}><FileText size={15}/>Word</button></>}{canEdit && section !== "Access" && section !== "Calendar" && section !== "Big Events" && <button className="primary-button" onClick={() => openForm(addAction[0] as FormKind)}><Plus size={17}/>{addAction[1]}</button>}</div></div>
        {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => section === "Calendar" ? void refreshCalendar() : void refresh()}>Try again</button></div>}

        {section === "Overview" && <>
          <section className="metric-grid" aria-label="Kitchen at a glance">
            <Metric icon={<UsersRound size={18}/>} label="Here right now" value={checkedIn.length} suffix={checkedIn.length === 1 ? "volunteer" : "volunteers"} tone="sage" detail={todaysShifts.length ? `${todaysShifts.length} shifts scheduled today` : "No shifts scheduled today"}/>
            <Metric icon={<Package size={18}/>} label="Items to restock" value={lowStock.length} suffix={lowStock.length === 1 ? "item" : "items"} tone="amber" detail={data.inventory.length ? `Of ${data.inventory.length} tracked items` : "Add your first pantry item"}/>
            <Metric icon={<CircleDollarSign size={18}/>} label="Kitchen spend" value={money(expensesThisMonth)} suffix="" tone="blue" detail={`${data.expenses.filter(e => e.spentAt >= monthStart).length} purchases recorded`}/>
          </section>

          <div className="overview-grid">
            <section className="card service-card"><CardHeading title="Today in the kitchen" detail={`${todaysShifts.length} volunteer ${todaysShifts.length === 1 ? "shift" : "shifts"}`} action={role === "admin" ? <button className="text-action" onClick={() => setSection("Volunteers")}>View team <ArrowUpRight size={14}/></button> : undefined}/>
              {todaysShifts.length ? <div className="shift-list">{todaysShifts.map(s => <div className="shift-row" key={s.id}><div className={`shift-status ${s.checkedInAt && !s.checkedOutAt ? "is-here" : ""}`}>{s.checkedInAt && !s.checkedOutAt ? <Check size={14}/> : <Clock3 size={14}/>}</div><div className="shift-main"><strong>{s.volunteerName}</strong><span>{s.assignment}</span></div><span className="shift-time">{s.startTime} – {s.endTime}</span>{canEdit && <button className={`small-button ${s.checkedInAt && !s.checkedOutAt ? "checked" : ""}`} onClick={() => void update(s.checkedInAt && !s.checkedOutAt ? "check-out" : "check-in", s.id)}>{s.checkedInAt && !s.checkedOutAt ? "Check out" : "Check in"}</button>}</div>)}</div> : <Empty icon={<UsersRound size={20}/>} title="No shifts on the schedule" text="Schedule a volunteer so everyone knows where they’re needed." button={canEdit ? "Schedule a shift" : undefined} onClick={canEdit ? () => openForm("shift") : undefined}/>}
            </section>
            <section className="card stock-card"><CardHeading title="Pantry watch" detail={lowStock.length ? `${lowStock.length} need attention` : "Stock levels"} action={<button className="text-action" onClick={() => setSection("Inventory")}>All inventory <ArrowUpRight size={14}/></button>}/>
              {data.inventory.length ? <div className="stock-list">{(lowStock.length ? lowStock : data.inventory).slice(0, 5).map(item => <div className="stock-row" key={item.id}><div className={`stock-dot ${item.quantity <= item.threshold ? "low" : ""}`}/><div className="stock-main"><strong>{item.name}</strong></div><div className="stock-amount"><strong>{item.quantity} <small>{item.unit}</small></strong><span>min {item.threshold}</span></div></div>)}</div> : <Empty icon={<Package size={20}/>} title="No pantry items yet" text="Track staples and get a heads-up before you run low." button={canEdit ? "Add an item" : undefined} onClick={canEdit ? () => openForm("inventory") : undefined}/>}
            </section>
            <section className="card expenses-card"><CardHeading title="Recent expenses" detail="Latest kitchen purchases" action={<button className="text-action" onClick={() => setSection("Expenses")}>View expenses <ArrowUpRight size={14}/></button>}/>
              {data.expenses.length ? <div className="record-list">{data.expenses.slice(0, 4).map(e => <div className="record-row" key={e.id}><div className="record-icon"><CircleDollarSign size={16}/></div><div className="record-main"><strong>{e.description}</strong><span>{e.category}</span></div><div className="record-amount"><strong>{money(e.amount)}</strong><span>{shortDate(e.spentAt)}</span></div></div>)}</div> : <Empty icon={<CircleDollarSign size={20}/>} title="No expenses recorded" text="Log groceries and kitchen costs in one shared place." button={canEdit ? "Add an expense" : undefined} onClick={canEdit ? () => openForm("expense") : undefined}/>}
            </section>
          </div>
        </>}

        {section === "Calendar" && <CalendarView
          month={calendarMonth}
          entries={calendarEntries}
          canEdit={canEdit}
          onMonthChange={setCalendarMonth}
          onOpenDay={setCalendarDay}
        />}

        {section === "Big Events" && <BigEventsSection
          events={calendarEntries.filter(entry => entry.entryType === "event" && entry.eventKind === "festive")}
          calendarEntries={calendarEntries}
          inventory={data.inventory}
          volunteers={data.volunteers.filter(volunteer => volunteer.isActive !== false)}
          selectedId={selectedBigEventId}
          canEdit={canEdit}
          saving={saving}
          error={error}
          onSelect={setSelectedBigEventId}
          onSaveMeal={(event, date, period, patch) => saveCalendarEntry("PUT", { action: "update-meal", id: event.id, date, mealPeriod: period, patch })}
          onSaveCook={(event, date, period, volunteerId) => {
            const assignment = calendarEntries.find(entry => entry.date === date && entry.entryType === "cooking" && entry.mealPeriod === period);
            if (volunteerId) return saveCalendarEntry("PUT", { date, mealPeriod: period, volunteerId });
            return assignment ? saveCalendarEntry("DELETE", { id: assignment.id }) : Promise.resolve(true);
          }}
          onAddEvent={() => { setSection("Calendar"); setCalendarDay(today()); }}
        />}

        {section === "Inventory" && <section className="inventory-list">
          <div className="inventory-toolbar"><div className="inventory-search" role="search"><Search size={16} aria-hidden="true"/><input type="search" aria-label="Search inventory" placeholder="Search items or units" value={inventorySearch} onChange={e => setInventorySearch(e.target.value)}/>{inventorySearch && <button type="button" aria-label="Clear inventory search" onClick={() => setInventorySearch("")}><X size={15}/></button>}</div><span className="inventory-result-count" role="status" aria-live="polite">{searchTerms.length ? `${filteredInventory.length} of ${data.inventory.length}` : data.inventory.length} {data.inventory.length === 1 ? "item" : "items"}</span></div>
          {data.inventory.length ? filteredInventory.length ? <div className="table-scroll"><table><thead><tr><th>Item</th><th>In stock</th><th>Restock at</th><th>Status</th>{canEdit && <th></th>}</tr></thead><tbody>{filteredInventory.map(item => <tr key={item.id}><td><strong>{item.name}</strong></td><td title={`${item.quantity} ${item.unit}`}>{stockQuantity(item.quantity)} {item.unit}</td><td>{stockQuantity(item.threshold)} {item.unit}</td><td><span className={`status-pill ${item.quantity <= item.threshold ? "status-low" : "status-good"}`}>{item.quantity <= item.threshold ? "Restock soon" : "In stock"}</span></td>{canEdit && <td><button className="row-action" disabled={saving} onClick={() => { setEditingRecord({kind: "inventory", record: item}); openForm("inventory"); }}>Edit item</button></td>}</tr>)}</tbody></table></div> : <Empty icon={<Search size={20}/>} title="No matching items" text="Try another item name or unit." button="Clear search" onClick={() => setInventorySearch("")}/> : <Empty icon={<Package size={20}/>} title="Start your pantry list" text="Add the staples you use so the whole kitchen can see what needs restocking." button={canEdit ? "Add first item" : undefined} onClick={canEdit ? () => openForm("inventory") : undefined}/>}
        </section>}

        {section === "Volunteers" && role === "admin" && <section className="volunteer-roster">
          {data.volunteers.length ? <div className="table-scroll"><table className="volunteer-table"><thead><tr><th>Volunteer</th><th>Role</th><th>Contact</th><th>Status</th>{canEdit && <th></th>}</tr></thead><tbody>{data.volunteers.map(v => <tr key={v.id}><td><strong>{v.name}</strong></td><td>{v.role || "Kitchen volunteer"}</td><td><div className="contact-details">{v.phone && <a href={`tel:${v.phone}`}><Phone size={13}/>{v.phone}</a>}{v.email && <a href={`mailto:${v.email}`}><Mail size={13}/>{v.email}</a>}{!v.phone && !v.email && <span className="contact-missing">No contact details</span>}</div></td><td><span className={`status-pill ${v.isActive !== false ? "status-good" : "status-neutral"}`}>{v.isActive !== false ? "Active" : "Inactive"}</span></td>{canEdit && <td><button className="row-action" disabled={saving} onClick={() => void update("volunteer-status", v.id, { isActive: v.isActive === false })}>{v.isActive !== false ? "Mark inactive" : "Reactivate"}</button></td>}</tr>)}</tbody></table></div> : <Empty icon={<UsersRound size={20}/>} title="Build your volunteer team" text="Add the people who help keep the kitchen running, along with their roles and contact details." button={canEdit ? "Add a volunteer" : undefined} onClick={canEdit ? () => openForm("volunteer") : undefined}/>}
        </section>}


        {section === "Expenses" && <>
          <section className="finance-summary expenses-summary"><div className="finance-tile spend"><span><ArrowUpRight size={16}/> Expenses this month</span><strong>{money(expensesThisMonth)}</strong></div></section>
          <section className="card table-card"><CardHeading title="Kitchen expenses" detail={`${data.expenses.length} records`} action={canEdit ? <button className="outline-button" onClick={() => openForm("expense")}><Plus size={15}/> Add expense</button> : undefined}/>{data.expenses.length ? <div className="table-scroll"><table><thead><tr><th>Purchase</th><th>Category</th><th>Date</th><th>Amount</th>{canEdit && <th></th>}</tr></thead><tbody>{data.expenses.map(e => <tr key={e.id}><td><strong>{e.description}</strong></td><td>{e.category}</td><td>{shortDate(e.spentAt)}</td><td><strong>{money(e.amount)}</strong></td>{canEdit && <td><button className="row-action" onClick={() => { setEditingRecord({kind: "expense", record: e}); openForm("expense"); }}>Edit</button></td>}</tr>)}</tbody></table></div> : <Empty icon={<CircleDollarSign size={20}/>} title="No expenses recorded" text="Log groceries and kitchen costs in one shared place." button={canEdit ? "Add an expense" : undefined} onClick={canEdit ? () => openForm("expense") : undefined}/>}</section>
        </>}

        {section === "Access" && role === "admin" && <section className="access-panel">
          <form className="access-add-form" onSubmit={addAccessPerson}>
            <label className="field"><span>Email address</span><input name="email" type="email" placeholder="name@example.com" required/></label>
            <label className="field"><span>Access level</span><select name="role" defaultValue="staff"><option value="admin">Admin — manage access and records</option><option value="staff">Staff — add and update records</option><option value="viewer">View only — read dashboard</option></select></label>
            <button className="primary-button" type="submit" disabled={saving}><Plus size={16}/> Add access</button>
          </form>
          <div className="access-list">
            <div className="access-list-heading"><strong>People with access</strong><span>{accessPeople.length} accounts</span></div>
            {accessPeople.map(person => <div className="access-row" key={person.id}>
              <div className="access-person"><strong>{person.email}</strong><span>{person.email === user.email?.toLowerCase() ? "You" : "Kitchen team"}</span></div>
              <select aria-label={`Role for ${person.email}`} value={person.role} onChange={event => void saveAccess("PATCH", { id: person.id, role: event.target.value })} disabled={saving}>
                <option value="admin">Admin</option><option value="staff">Staff</option><option value="viewer">View only</option>
              </select>
              <button className="row-action access-remove" disabled={saving || (person.role === "admin" && accessPeople.filter(p => p.role === "admin").length < 2)} onClick={() => { if (window.confirm(`Remove dashboard access for ${person.email}?`)) void saveAccess("DELETE", { id: person.id }); }}>Remove</button>
            </div>)}
          </div>
          <div className="request-inbox">
            <div className="access-list-heading"><strong>Change requests</strong><span>{changeRequests.filter(item => item.status === "pending").length} pending</span></div>
            {changeRequests.length ? <div className="request-list">{changeRequests.map(item => <article className="request-row" key={item.id}>
              <div className="request-copy"><div className="request-meta"><strong>{item.requesterName}</strong><span>{item.requesterEmail}</span><time dateTime={item.createdAt}>{shortDate(item.createdAt)}</time><span className={`status-pill ${item.status === "pending" ? "status-low" : item.status === "handled" ? "status-good" : "status-neutral"}`}>{item.status === "pending" ? "Pending" : item.status === "handled" ? "Handled" : "Declined"}</span></div><p>{item.message}</p></div>
              {item.status === "pending" && <div className="request-actions"><button className="small-button" disabled={saving} onClick={() => void reviewChangeRequest(item.id, "grant-staff")}>Grant Staff</button><button className="row-action" disabled={saving} onClick={() => void reviewChangeRequest(item.id, "handled")}>Mark handled</button><button className="row-action access-remove" disabled={saving} onClick={() => void reviewChangeRequest(item.id, "declined")}>Decline</button></div>}
            </article>)}</div> : <p className="request-empty">No change requests yet.</p>}
          </div>
        </section>}

        <footer className="footer-note"><span><span className="live-dot"/> Shared kitchen records</span><span>Keeping service organized, together</span></footer>
        {loading && <div className="loading-indicator"><LoaderCircle size={15} className="spin"/> Loading kitchen records</div>}
      </div>
    </main>
    {mobileNav && <button className="nav-scrim" aria-label="Close menu" onClick={() => setMobileNav(false)}/>}
    {notice && <div className="toast" role="status"><Check size={16}/>{notice}<button aria-label="Dismiss" onClick={() => setNotice("")}><X size={14}/></button></div>}
    {form && <FormDialog kind={form} initialRecord={editingRecord?.kind === form ? editingRecord.record : null} volunteers={data.volunteers} saving={saving} error={error} onClose={() => { setForm(null); setEditingRecord(null); setError(""); }} onSubmit={saveRecord}/>}
    {inventoryImportOpen && canEdit && <InventoryImportDialog existing={data.inventory} onClose={() => setInventoryImportOpen(false)} onImport={importInventory}/>}
    {requestOpen && <RequestDialog saving={saving} error={error} onClose={() => { setRequestOpen(false); setError(""); }} onSubmit={saveChangeRequest}/>}
    {calendarDay && <CalendarDayDialog
      key={`${calendarDay}-${calendarEditEventId ?? "new"}`}
      date={calendarDay}
      entries={calendarEntries.filter(entry => entry.entryType === "event" ? entry.date <= calendarDay && endDateOf(entry) >= calendarDay : entry.date === calendarDay)}
      volunteers={data.volunteers.filter(volunteer => volunteer.isActive !== false)}
      canEdit={canEdit}
      initialEventId={calendarEditEventId}
      saving={saving}
      error={error}
      onClose={() => { setCalendarDay(null); setCalendarEditEventId(null); setError(""); }}
      onSaveEvent={(id, values) => saveCalendarEntry(id ? "PUT" : "POST", { ...(id ? { action: "update-event", id } : { date: calendarDay }), ...values })}
      onOpenBigEvent={id => { setCalendarDay(null); setCalendarEditEventId(null); setSelectedBigEventId(id); setSection("Big Events"); }}
      onSaveCook={(mealPeriod, volunteerId) => saveCalendarEntry("PUT", { date: calendarDay, mealPeriod, volunteerId })}
      onDelete={(id) => saveCalendarEntry("DELETE", { id })}
    />}
  </div>;
}

function Metric({icon, label, value, suffix, tone, detail}: {icon: ReactNode; label: string; value: string | number; suffix: string; tone: string; detail: string}) {
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`}>{icon}</span></div><div className="metric-value">{value}{suffix && <small>{suffix}</small>}</div><div className="metric-detail">{detail}</div></div>;
}

type MealPeriod = "morning" | "afternoon" | "evening";
type FestiveIngredient = { id: string; inventoryItemId: string | null; name: string; requiredQuantity: number; unit: string };
type FestiveMeal = { cookVolunteerId: string | null; cookName: string | null; helperVolunteerIds: string[]; helperVolunteers: { id: string; name: string }[]; dishes: string; ingredients: FestiveIngredient[] };
type FestivePlan = Record<MealPeriod, FestiveMeal>;
type StoredFestivePlan = FestivePlan | { days: Record<string, FestivePlan> };
type EventFormValues = { date: string; endDate: string; title: string; details: string; eventKind: "normal" | "festive"; festivePlan: StoredFestivePlan | null };
const mealPeriods: { id: MealPeriod; label: string }[] = [
  { id: "morning", label: "Morning" }, { id: "afternoon", label: "Afternoon" }, { id: "evening", label: "Evening" },
];
const calendarDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
function getPlanForDate(event: CalendarEntry, date: string): FestivePlan {
  const stored = event.festivePlan;
  if (!stored) return blankFestivePlan();
  if ("days" in stored) return stored.days[date] ?? blankFestivePlan();
  return date === event.date ? stored : blankFestivePlan();
}
function getPlansForEvent(event: CalendarEntry): Record<string, FestivePlan> {
  const dates = dateRange(event.date, endDateOf(event));
  const stored = event.festivePlan;
  const existing = stored && "days" in stored ? stored.days : stored ? {[event.date]: stored} : {};
  return Object.fromEntries(dates.map(date => [date, existing[date] ?? blankFestivePlan()]));
}
function CalendarView({month, entries, canEdit, onMonthChange, onOpenDay}: {month: Date; entries: CalendarEntry[]; canEdit: boolean; onMonthChange: (date: Date) => void; onOpenDay: (date: string) => void}) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const leadingDays = (first.getDay() + 6) % 7;
  const gridStart = new Date(month.getFullYear(), month.getMonth(), 1 - leadingDays);
  const visibleDays = Math.ceil((leadingDays + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7) * 7;
  const days = Array.from({length: visibleDays}, (_, index) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index));
  const monthLabel = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const moveMonth = (amount: number) => onMonthChange(new Date(month.getFullYear(), month.getMonth() + amount, 1));
  const now = new Date();
  const addEventDate = now.getFullYear() === month.getFullYear() && now.getMonth() === month.getMonth() ? today() : calendarDateKey(month);
  return <section className="calendar-surface" aria-label="Kitchen calendar">
    <div className="calendar-toolbar"><div className="calendar-month-control"><button className="calendar-icon-button" onClick={() => moveMonth(-1)} aria-label="Previous month"><ChevronLeft size={19}/></button><h2>{monthLabel}</h2><button className="calendar-icon-button" onClick={() => moveMonth(1)} aria-label="Next month"><ChevronRight size={19}/></button></div><div className="calendar-toolbar-actions"><button className="outline-button" onClick={() => onMonthChange(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button>{canEdit && <button className="primary-button" onClick={() => onOpenDay(addEventDate)}><Plus size={16}/>Add event</button>}</div></div>
    <div className="calendar-grid-wrap"><div className="calendar-grid">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => <div className="calendar-weekday" key={day}>{day}</div>)}
      {days.map(date => {
        const key = calendarDateKey(date);
        const dayEntries = entries.filter(entry => entry.entryType === "event" ? entry.date <= key && endDateOf(entry) >= key : entry.date === key);
        const events = dayEntries.filter(entry => entry.entryType === "event");
        const cooking = mealPeriods.map(period => ({period, entry: dayEntries.find(entry => entry.entryType === "cooking" && entry.mealPeriod === period.id)}));
        const assignedCooks = cooking.filter(item => item.entry);
        return <button type="button" className={`calendar-day ${date.getMonth() !== month.getMonth() ? "outside-month" : ""} ${key === today() ? "is-today" : ""}`} key={key} onClick={() => onOpenDay(key)} aria-label={`${date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}${events.length ? `, ${events.length} events` : ""}`}>
          <span className="calendar-day-number">{date.getDate()}</span>
          <span className="calendar-cell-entries">
            {events.slice(0, 2).map(event => <span className={`calendar-event-pill ${event.eventKind === "festive" ? "is-festive-event" : ""}`} key={event.id} title={`${event.title} · ${eventDateLabel(event)}`}>{event.eventKind === "festive" ? `Big · ${event.title}` : event.title}</span>)}
            {events.length > 2 && <span className="calendar-more">+{events.length - 2} events</span>}
            {assignedCooks.map(({period, entry}) => <span className={`calendar-cook calendar-cook-${period.id} has-cook`} key={period.id} title={`${period.label}: ${entry?.cookName}`} aria-label={`${period.label} cook: ${entry?.cookName}`}><b>{period.label.slice(0, 1)}</b><span>{entry?.cookName}</span></span>)}
          </span>
        </button>;
      })}
    </div></div>
    <div className="calendar-legend"><span><i className="legend-event"/>Kitchen event</span><span><b className="legend-period legend-morning">M</b>Morning</span><span><b className="legend-period legend-afternoon">A</b>Afternoon</span><span><b className="legend-period legend-evening">E</b>Evening</span></div>
  </section>;
}

function BigEventsSection({events, calendarEntries, inventory, volunteers, selectedId, canEdit, saving, error, onSelect, onAddEvent, onSaveMeal, onSaveCook}: {
  events: CalendarEntry[]; calendarEntries: CalendarEntry[]; inventory: InventoryItem[]; volunteers: Volunteer[]; selectedId: string | null; canEdit: boolean; saving: boolean; error: string;
  onSelect: (id: string) => void; onAddEvent: () => void; onSaveMeal: (event: CalendarEntry, date: string, period: MealPeriod, patch: MealPatch) => Promise<boolean>;
  onSaveCook: (event: CalendarEntry, date: string, period: MealPeriod, volunteerId: string) => Promise<boolean>;
}) {
  const [view, setView] = useState<"daily" | "shopping">("daily");
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [pendingSaves, setPendingSaves] = useState(0);
  const [ingredientsDirty, setIngredientsDirty] = useState<Record<string, boolean>>({});
  const [selectedDate, setSelectedDate] = useState("");
  const event = events.find(item => item.id === selectedId) ?? events[0];
  useEffect(() => { setView("daily"); setIngredientsDirty({}); setSelectedDate(event?.date ?? ""); }, [event?.id]);
  const eventDays = event ? dateRange(event.date, endDateOf(event)) : [];
  const activeDate = eventDays.includes(selectedDate) ? selectedDate : event?.date ?? "";
  const plan = event ? getPlanForDate(event, activeDate) : blankFestivePlan();
  const allPlans = event ? getPlansForEvent(event) : {};
  const shopping = getShoppingList(aggregatePlans(allPlans), inventory);
  const cooksAssigned = mealPeriods.filter(({id}) => calendarEntries.some(entry => entry.date === activeDate && entry.entryType === "cooking" && entry.mealPeriod === id)).length;
  const dishesPlanned = mealPeriods.filter(({id}) => plan[id].dishes.trim()).length;
  const sortedEvents = [...events].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const hasUnsavedIngredients = Object.values(ingredientsDirty).some(Boolean);
  const locked = saving || pendingSaves > 0 || hasUnsavedIngredients;
  function saveMeal(period: MealPeriod, patch: MealPatch) {
    if (!event) return Promise.resolve(false);
    setPendingSaves(count => count + 1);
    const result = saveQueue.current.then(() => onSaveMeal(event, activeDate, period, patch));
    saveQueue.current = result.catch(() => false);
    return result.finally(() => setPendingSaves(count => count - 1));
  }
  return <section className="big-events-layout">
    {event ? <article className="big-event-detail">
      <header className="big-event-detail-header"><div><span className="dialog-kicker">Big event · {eventDays.length} {eventDays.length === 1 ? "day" : "days"}</span><h2>{event.title}</h2><p className="event-range"><CalendarDays size={15}/>{eventDateLabel(event)}</p>{event.details && <p>{event.details}</p>}</div><span className="event-scope-note">One meal plan for each day</span></header>
      <div className="big-event-view-switch" role="tablist" aria-label="Event view"><button role="tab" aria-selected={view === "daily"} className={view === "daily" ? "active" : ""} disabled={locked} onClick={() => setView("daily")}><CookingPot size={16}/>Daily meal plan</button><button role="tab" aria-selected={view === "shopping"} className={view === "shopping" ? "active" : ""} disabled={locked} onClick={() => setView("shopping")}><Package size={16}/>Shopping for whole event{shopping.length > 0 && <span>{shopping.length}</span>}</button></div>
      {view === "shopping" ? <BigEventShopping plans={allPlans} inventory={inventory} dateLabel={eventDateLabel(event)}/> : <>
        {eventDays.length > 1 && <div className="event-day-selector"><div className="event-day-selector-heading"><strong>Choose a day</strong><span>{hasUnsavedIngredients ? "Save or cancel ingredient changes to switch days." : "Each day has its own cooks, dishes and helpers."}</span></div><div className={`big-event-day-tabs ${eventDays.length <= 7 ? "few-days" : ""}`} role="tablist" aria-label="Event days">{eventDays.map((date, index) => <button key={date} role="tab" aria-selected={date === activeDate} disabled={locked} className={date === activeDate ? "active" : ""} onClick={() => setSelectedDate(date)}><span>Day {index + 1}</span><strong>{displayDate(date,{weekday:"short",month:"short",day:"numeric"})}</strong></button>)}</div></div>}
        <div className="daily-plan-heading"><div><span className="dialog-kicker">Meal plan for</span><h3>{displayDate(activeDate,{weekday:"long",month:"long",day:"numeric"})}</h3><p>{`${cooksAssigned}/3 cooks assigned · ${dishesPlanned}/3 meals have dishes`}</p></div>{canEdit && <div className="day-plan-heading-actions"><span className="calendar-sync-note"><Check size={13}/>Cooks, dishes and helpers save automatically</span></div>}</div>
        <div className="daily-meal-list">{mealPeriods.map(({id,label}) => <BigEventDailyMeal key={`${event.id}:${activeDate}:${id}`} label={label} period={id} meal={plan[id]} allPlans={allPlans} date={activeDate} cook={calendarEntries.find(entry => entry.date === activeDate && entry.entryType === "cooking" && entry.mealPeriod === id)} inventory={inventory} volunteers={volunteers} canEdit={canEdit} disabled={saving || pendingSaves > 0} onSaveCook={volunteerId => onSaveCook(event,activeDate,id,volunteerId)} onSaveMeal={patch => saveMeal(id,patch)} onIngredientsDirty={dirty => setIngredientsDirty(current => current[id] === dirty ? current : {...current,[id]:dirty})}/>)}</div>
        {error && <p className="meal-plan-error" role="alert">{error}</p>}
      </>}
    </article> : <article className="big-event-detail big-event-no-selection"><Sparkles size={24}/><strong>Plan your next big event</strong><p>Add a Big event in Calendar. Then choose each day's cooks, dishes, helpers and ingredients here.</p></article>}
    <aside className="big-event-list-panel" aria-label="Big events">
      <div className="big-event-list-heading"><div><h2>Events</h2><p>{events.length} {events.length === 1 ? "event" : "events"}</p></div>{canEdit && <button className="outline-button" disabled={locked} onClick={onAddEvent}><Plus size={14}/>Add event</button>}</div>
      {sortedEvents.length ? <div className="big-event-list">{sortedEvents.map(item => <button key={item.id} className={`big-event-list-item ${event?.id === item.id ? "selected" : ""}`} aria-pressed={event?.id === item.id} disabled={locked} onClick={() => onSelect(item.id)}><strong>{item.title}</strong><span className="big-event-list-date"><CalendarDays size={13}/>{eventDateLabel(item)}</span><span className="big-event-list-duration">{dateRange(item.date,endDateOf(item)).length} {item.date === endDateOf(item) ? "day" : "days"}{event?.id === item.id && <span>Selected</span>}</span></button>)}</div> : <p className="big-event-list-empty">Add an event to start planning.</p>}
      {hasUnsavedIngredients && <p className="big-event-list-hint">Save or cancel ingredient changes before selecting another event.</p>}
    </aside>
  </section>;
}

type MealPatch = Partial<Pick<FestiveMeal, "dishes" | "helperVolunteerIds" | "ingredients">>;

function BigEventDailyMeal({label, period, meal, allPlans, date, cook, inventory, volunteers, canEdit, disabled, onSaveCook, onSaveMeal, onIngredientsDirty}: {
  label: string; period: MealPeriod; meal: FestiveMeal; allPlans: Record<string, FestivePlan>; date: string; cook?: CalendarEntry; inventory: InventoryItem[]; volunteers: Volunteer[]; canEdit: boolean; disabled: boolean;
  onSaveCook: (volunteerId: string) => Promise<boolean>; onSaveMeal: (patch: MealPatch) => Promise<boolean>; onIngredientsDirty: (dirty: boolean) => void;
}) {
  const [dishes, setDishes] = useState(meal.dishes);
  const storedHelperIds = meal.helperVolunteers.map(person => person.id);
  const helperKey = JSON.stringify(storedHelperIds);
  const ingredientKey = JSON.stringify(meal.ingredients);
  const [helperIds, setHelperIds] = useState(storedHelperIds);
  const [ingredients, setIngredients] = useState(meal.ingredients);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const failedPatch = useRef<MealPatch | null>(null);
  useEffect(() => setDishes(meal.dishes), [meal.dishes]);
  useEffect(() => setHelperIds(JSON.parse(helperKey)), [helperKey]);
  useEffect(() => setIngredients(JSON.parse(ingredientKey)), [ingredientKey]);
  const ingredientDirty = JSON.stringify(ingredients) !== ingredientKey;
  useEffect(() => { onIngredientsDirty(ingredientDirty); }, [ingredientDirty, onIngredientsDirty]);
  const assignedCook = cook?.volunteerId ? volunteers.find(person => person.id === cook.volunteerId) : null;
  const helpers = [...volunteers, ...meal.helperVolunteers.filter(person => !volunteers.some(active => active.id === person.id))];
  const draftPlans = {...allPlans, [date]: {...allPlans[date], [period]: {...meal, ingredients}}};
  async function save(patch: MealPatch) {
    setSaveState("saving");
    const update = {...failedPatch.current, ...patch};
    const saved = await onSaveMeal(update);
    failedPatch.current = saved ? null : update;
    setSaveState(saved ? "saved" : "error");
    return saved;
  }
  function selectHelpers(next: string[]) {
    setHelperIds(next);
    void save({helperVolunteerIds: next});
  }
  return <section className={`daily-meal-card period-${period}`} aria-label={`${label} meal`}>
    <header className="daily-meal-header"><span className={`meal-period-icon meal-${period}`}>{label[0]}</span><h4>{label}</h4><span className={`meal-plan-status ${cook && meal.dishes ? "has-plan" : ""}`}>{!cook ? "Cook needed" : !meal.dishes ? "Dishes needed" : "Cook & dishes set"}</span></header>
    <div className="daily-meal-facts">
      <div><label htmlFor={`event-cook-${period}`}>Cook</label>{canEdit ? <select id={`event-cook-${period}`} aria-label={`${label} cook`} value={cook?.volunteerId ?? ""} disabled={disabled} onChange={e => void onSaveCook(e.target.value)}><option value="">Choose a cook</option>{cook?.volunteerId && !assignedCook && <option value={cook.volunteerId}>{cook.cookName ?? "Assigned cook"} (inactive)</option>}{volunteers.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select> : <strong className={!cook ? "unplanned" : ""}>{cook?.cookName ?? "Not assigned"}</strong>}</div>
      <div><label htmlFor={`event-dishes-${period}`}>Dishes</label>{canEdit ? <><textarea id={`event-dishes-${period}`} aria-label={`${label} dishes`} value={dishes} rows={3} maxLength={500} placeholder="Add dishes or meal notes" disabled={disabled} onChange={e => {setDishes(e.target.value); setSaveState("idle");}} onBlur={() => {if (dishes.trim() !== meal.dishes) void save({dishes});}}/><small className="inline-field-hint">Saves when you leave this field</small></> : <strong className={!meal.dishes ? "unplanned" : ""}>{meal.dishes || "No dishes added"}</strong>}</div>
      <div><span id={`event-helpers-${period}`}>Helpers</span>{canEdit ? <HelperMultiSelect label={label} options={helpers.map(person => ({...person, inactive: !volunteers.some(active => active.id === person.id)}))} selectedIds={helperIds} disabled={disabled} onChange={selectHelpers}/> : <strong className={!meal.helperVolunteers.length ? "unplanned" : ""}>{meal.helperVolunteers.map(person => person.name).join(", ") || "No helpers assigned"}</strong>}</div>
    </div>
    {canEdit && saveState !== "idle" && <div className={`inline-save-state ${saveState}`} role="status">{saveState === "saving" ? <><LoaderCircle size={12} className="spin"/>Saving…</> : saveState === "saved" ? <><Check size={12}/>Saved</> : <>Changes not saved.<button type="button" disabled={disabled} onClick={() => {if (failedPatch.current) void save(failedPatch.current);}}>Retry</button></>}</div>}
    {canEdit ? <details className="daily-ingredient-preview"><summary>Ingredients and pantry check <span>{ingredients.length} items</span><ChevronRight size={14}/></summary><form className="inline-ingredient-form" onSubmit={async e => {e.preventDefault(); if (!disabled) await save({ingredients});}}><fieldset disabled={disabled}><MealIngredients meal={{...meal,ingredients}} plan={aggregatePlans(draftPlans)} inventory={inventory} onChange={next => setIngredients(next.ingredients)}/></fieldset>{ingredientDirty && <div className="inline-ingredient-actions"><span>Unsaved ingredients</span><button type="button" className="cancel-button" disabled={disabled} onClick={() => setIngredients(meal.ingredients)}>Cancel</button><button type="submit" className="primary-button" disabled={disabled}>Save ingredients</button></div>}</form></details> : meal.ingredients.length ? <details className="daily-ingredient-preview"><summary>Ingredients and pantry check <span>{meal.ingredients.length} items</span><ChevronRight size={14}/></summary><div className="big-event-ingredient-list">{meal.ingredients.map(item => {
      const stock = findPantryItem(inventory, item.inventoryItemId);
      return <div className="big-event-ingredient" key={item.id}><div><strong>{item.name}</strong><span>Needed for this meal: {item.requiredQuantity} {item.unit}</span></div><span>{stock ? `Pantry: ${stock.quantity} ${stock.unit}` : "Not in pantry"}</span></div>;
    })}</div><p className="pantry-scope-note">The whole-event shopping list combines all meals and subtracts pantry stock once.</p></details> : <div className="daily-ingredient-empty"><Package size={14}/><span>No ingredients added</span></div>}
  </section>;
}

function BigEventShopping({plans, inventory, dateLabel}: {plans: Record<string, FestivePlan>; inventory: InventoryItem[]; dateLabel: string}) {
  const list = getShoppingList(aggregatePlans(plans), inventory);
  const totalIngredients = Object.values(plans).reduce((count, plan) => count + mealPeriods.reduce((n, period) => n + plan[period.id].ingredients.length, 0), 0);
  return <section className="big-event-shopping"><div className="big-event-shopping-heading"><div><span className="dialog-kicker">All event days · {dateLabel}</span><h3>What needs to be bought</h3><p>{!totalIngredients ? "Add ingredients to the daily meals to build this list." : `${totalIngredients} ingredient entries across all days, compared with current pantry stock.`}</p></div>{totalIngredients > 0 && <span>{list.length} items to buy</span>}</div>{list.length ? <ul>{list.map(item => <li key={`${item.inventoryItemId ?? item.name}-${item.unit}`}><span>{item.name}</span><strong>Buy {item.quantity} {item.unit}</strong></li>)}</ul> : <div className={`shopping-empty ${!totalIngredients ? "not-planned" : ""}`}>{totalIngredients ? <Check size={22}/> : <Package size={22}/>}<div><strong>{totalIngredients ? "No shopping needed for the ingredients listed" : "No ingredients planned yet"}</strong><p>{totalIngredients ? "Current pantry stock covers the combined needs of all event days." : "Open a meal’s Ingredients and pantry check to add ingredients for that day."}</p></div></div>}</section>;
}

function blankFestivePlan(): FestivePlan {
  return Object.fromEntries(mealPeriods.map(({id}) => [id, {cookVolunteerId: null, cookName: null, helperVolunteerIds: [], helperVolunteers: [], dishes: "", ingredients: []}])) as FestivePlan;
}

function aggregatePlans(plans: Record<string, FestivePlan>): FestivePlan {
  const aggregate = blankFestivePlan();
  for (const plan of Object.values(plans)) for (const {id} of mealPeriods) {
    aggregate[id].ingredients.push(...plan[id].ingredients);
  }
  return aggregate;
}

function CalendarDayDialog({date, entries, volunteers, canEdit, initialEventId, saving, error, onClose, onSaveEvent, onOpenBigEvent, onSaveCook, onDelete}: {
  date: string; entries: CalendarEntry[]; volunteers: Volunteer[]; canEdit: boolean; initialEventId: string | null; saving: boolean; error: string;
  onClose: () => void; onSaveEvent: (id: string | null, values: EventFormValues) => Promise<boolean>;
  onOpenBigEvent: (id: string) => void;
  onSaveCook: (mealPeriod: MealPeriod, volunteerId: string) => Promise<boolean>; onDelete: (id: string) => Promise<boolean>;
}) {
  const [selectedCooks, setSelectedCooks] = useState<Record<MealPeriod, string>>(() => Object.fromEntries(mealPeriods.map(({id}) => [id, entries.find(entry => entry.entryType === "cooking" && entry.mealPeriod === id)?.volunteerId ?? ""])) as Record<MealPeriod, string>);
  const [editingEvent, setEditingEvent] = useState<CalendarEntry | null>(() => entries.find(entry => entry.id === initialEventId) ?? null);
  const [showEventForm, setShowEventForm] = useState(Boolean(initialEventId));
  const dayTitle = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const events = entries.filter(entry => entry.entryType === "event");
  async function saveEvent(id: string | null, values: EventFormValues) {
    const saved = await onSaveEvent(id, values);
    if (saved) { setEditingEvent(null); setShowEventForm(false); }
    return saved;
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="dialog calendar-day-dialog" role="dialog" aria-modal="true" aria-labelledby="calendar-day-title">
    <div className="dialog-heading"><div><span className="dialog-kicker">Kitchen calendar</span><h2 id="calendar-day-title">{dayTitle}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={16}/></button></div>
    <section className="day-cooks"><div className="day-section-heading"><div><h3>Who’s cooking?</h3><p>Set the cook for each meal period.</p></div></div><div className="cook-slot-list">{mealPeriods.map(({id, label}) => {
      const assignment = entries.find(entry => entry.entryType === "cooking" && entry.mealPeriod === id);
      const currentCookMissing = assignment?.volunteerId && !volunteers.some(volunteer => volunteer.id === assignment.volunteerId);
      return <div className="cook-slot-row" key={id}><div className={`meal-period-icon meal-${id}`}>{label.slice(0, 1)}</div><div className="meal-period-label"><strong>{label}</strong><span>{saving && selectedCooks[id] !== (assignment?.volunteerId ?? "") ? "Saving assignment…" : assignment?.cookName || "No cook assigned"}</span></div>{canEdit && <div className="cook-slot-controls"><select aria-label={`${label} cook`} value={selectedCooks[id]} onChange={event => {
        const volunteerId = event.target.value;
        setSelectedCooks(current => ({...current, [id]: volunteerId}));
        if (volunteerId) void onSaveCook(id, volunteerId).then(saved => {
          if (!saved) setSelectedCooks(current => ({...current, [id]: assignment?.volunteerId ?? ""}));
        });
      }} disabled={saving}>
        <option value="">Choose active volunteer</option>{currentCookMissing && <option value={assignment.volunteerId!}>{assignment?.cookName} (inactive)</option>}{volunteers.map(volunteer => <option value={volunteer.id} key={volunteer.id}>{volunteer.name}</option>)}
      </select>{assignment && <button className="row-action access-remove" disabled={saving} onClick={() => void onDelete(assignment.id)}>Clear</button>}</div>}</div>;
    })}</div>{canEdit && volunteers.length === 0 && <p className="calendar-help">Add an active volunteer to the roster before assigning cooks.</p>}</section>
    <section className="day-events"><div className="day-section-heading"><div><h3>Events</h3><p>Kitchen gatherings, service days, and other dates.</p></div>{canEdit && !showEventForm && !editingEvent && <button className="outline-button" onClick={() => setShowEventForm(true)}><Plus size={14}/>Add event</button>}</div>
      {events.length ? <div className="day-event-list">{events.map(item => <article className="day-event-row" key={item.id}><div className="event-mark"><CalendarDays size={16}/></div><div className="day-event-copy"><div className="event-title-line"><strong>{item.title}</strong><span className={`event-kind-pill ${item.eventKind === "festive" ? "is-festive" : ""}`}>{item.eventKind === "festive" ? "Big event" : "Event"}</span></div><p className="event-date-note">{eventDateLabel(item)}</p>{item.details && <p>{item.details}</p>}{item.eventKind === "festive" && <p className="event-plan-note">Meal team, dishes, ingredients, and shopping list</p>}</div><div className="day-event-actions">{item.eventKind === "festive" && <button className="row-action" disabled={saving} onClick={() => onOpenBigEvent(item.id)}>View big event</button>}{canEdit && <><button className="row-action" disabled={saving} onClick={() => { setShowEventForm(true); setEditingEvent(item); }}>Edit</button><button className="row-action access-remove" disabled={saving} onClick={() => void onDelete(item.id)}>Remove</button></>}</div></article>)}</div> : <p className="calendar-help">No events for this date.</p>}
      {canEdit && (showEventForm || editingEvent) && <CalendarEventEditor key={editingEvent?.id ?? "new-event"} event={editingEvent} date={date} saving={saving} error={error} onCancel={() => { setEditingEvent(null); setShowEventForm(false); }} onSave={values => saveEvent(editingEvent?.id ?? null, values)}/>}
    </section>
    {!canEdit && error && <p className="dialog-error" role="alert">{error}</p>}
  </section></div>;
}

function CalendarEventEditor({event, date, saving, error, onCancel, onSave}: {
  event: CalendarEntry | null; date: string; saving: boolean; error: string;
  onCancel: () => void; onSave: (values: EventFormValues) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(event?.title ?? "");
  const [details, setDetails] = useState(event?.details ?? "");
  const [kind, setKind] = useState<"normal" | "festive">(event?.eventKind === "festive" ? "festive" : "normal");
  const [eventDate, setEventDate] = useState(event?.date ?? date);
  const [eventEndDate, setEventEndDate] = useState(event ? endDateOf(event) : date);
  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    await onSave({date: eventDate, endDate: eventEndDate, title, details, eventKind: kind, festivePlan: null});
  }
  return <form className="calendar-event-editor" onSubmit={submit}>
    <div className="event-editor-heading"><div><h3>{event ? "Edit event" : "Add an event"}</h3><p>Choose an event type. Add big event meals in the Big Events section.</p></div><button type="button" className="icon-button" onClick={onCancel} aria-label="Close event form"><X size={15}/></button></div>
    <div className="event-basics"><label className="field"><span>Event name</span><input value={title} onChange={e => setTitle(e.target.value)} maxLength={180} placeholder="e.g. Community lunch" required/></label><label className="field"><span>Event type</span><select value={kind} onChange={e => setKind(e.target.value === "festive" ? "festive" : "normal")}><option value="normal">Event</option><option value="festive">Big event</option></select></label><label className="field"><span>Starts</span><input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} required/></label><label className="field"><span>Ends</span><input type="date" value={eventEndDate} min={eventDate} onChange={e => setEventEndDate(e.target.value)} required/></label><label className="field event-details-field"><span>Details <small>(optional)</small></span><input value={details} onChange={e => setDetails(e.target.value)} maxLength={500} placeholder="Add a short note"/></label></div>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" className="cancel-button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving…" : event ? "Save event" : "Add event"}</button></div>
  </form>;
}

function MealIngredients({meal, plan, inventory, onChange}: {
  meal: FestiveMeal; plan: FestivePlan; inventory: InventoryItem[]; onChange: (meal: FestiveMeal) => void;
}) {
  const [ingredientSources, setIngredientSources] = useState<Record<string, "inventory" | "new">>({});
  function changeIngredient(id: string, patch: Partial<FestiveIngredient>) {
    onChange({...meal, ingredients: meal.ingredients.map(item => item.id === id ? {...item, ...patch} : item)});
  }
  function addIngredient() {
    if (meal.ingredients.length >= 40) return;
    const id = crypto.randomUUID();
    setIngredientSources(current => ({...current, [id]: "inventory"}));
    onChange({...meal, ingredients: [...meal.ingredients, {id, inventoryItemId: null, name: "", requiredQuantity: 0, unit: ""}]});
  }
  return (
    <div className="ingredient-planner"><div className="ingredient-heading"><div><strong>Ingredients and pantry check</strong><span>Select an ingredient or choose New item in the dropdown.</span></div><button type="button" className="outline-button" disabled={meal.ingredients.length >= 40} onClick={addIngredient}><Plus size={13}/>Add ingredient</button></div>
      {meal.ingredients.length > 0 && <div className="ingredient-rows">{meal.ingredients.map(item => {
        const stockItem = findPantryItem(inventory, item.inventoryItemId);
        const isNewItem = !stockItem && (ingredientSources[item.id] ?? (item.inventoryItemId ? "inventory" : "new")) === "new";
        const sameIngredient = (other: FestiveIngredient) => item.inventoryItemId ? (findPantryItem(inventory, other.inventoryItemId)?.id ?? other.inventoryItemId) === (stockItem?.id ?? item.inventoryItemId) : !other.inventoryItemId && other.name.trim().toLowerCase() === item.name.trim().toLowerCase() && other.unit.trim().toLowerCase() === item.unit.trim().toLowerCase();
        const totalNeeded = mealPeriods.reduce((total, {id}) => total + plan[id].ingredients.filter(sameIngredient).reduce((sum, ingredient) => sum + (convertInventoryQuantity(ingredient.requiredQuantity, ingredient.unit, stockItem?.unit ?? item.unit) ?? ingredient.requiredQuantity), 0), 0);
        const shortage = stockItem ? Math.max(0, totalNeeded - stockItem.quantity) : totalNeeded;
        return <div className={`ingredient-row ${isNewItem ? "ingredient-new-item" : ""}`} key={item.id}><label className="field"><span>Ingredient</span><select required value={stockItem?.id ?? (isNewItem ? "__new__" : "")} onChange={e => {
          setIngredientSources(current => ({...current, [item.id]: e.target.value === "__new__" ? "new" : "inventory"}));
          const selected = inventory.find(pantryItem => pantryItem.id === e.target.value);
          changeIngredient(item.id, {inventoryItemId: selected?.id ?? null, name: selected?.name ?? "", unit: selected?.unit ?? ""});
        }}><option value="" disabled>Choose a pantry item</option><option value="__new__">＋ New item (not in inventory)</option>{inventory.map(pantryItem => <option key={pantryItem.id} value={pantryItem.id}>{pantryItem.name} · {stockQuantity(pantryItem.quantity)} {pantryItem.unit}</option>)}</select></label>{isNewItem && <label className="field"><span>New item name</span><input value={item.name} onChange={e => changeIngredient(item.id, {name: e.target.value})} placeholder="e.g. Fresh curry leaves" maxLength={120} required/></label>}<label className="field ingredient-quantity"><span>Needed</span><input type="number" min="0.1" step="any" value={item.requiredQuantity || ""} onChange={e => changeIngredient(item.id, {requiredQuantity: Number(e.target.value) || 0})} required/></label><label className="field ingredient-unit"><span>Unit</span><input value={item.unit} onChange={e => changeIngredient(item.id, {unit: e.target.value})} placeholder="kg, bags" maxLength={32} required/></label><span className={`ingredient-status ${shortage > 0 ? "needs-shopping" : "available-stock"}`}>{item.requiredQuantity <= 0 ? "Enter quantity" : shortage > 0 ? `Buy ${stockQuantity(shortage)} ${stockItem?.unit ?? (item.unit || "unit")}` : `In stock · ${stockQuantity(stockItem?.quantity ?? 0)} ${stockItem?.unit ?? item.unit}`}</span><button type="button" className="ingredient-remove" onClick={() => onChange({...meal, ingredients: meal.ingredients.filter(value => value.id !== item.id)})} aria-label={`Remove ${item.name || "ingredient"}`}><X size={14}/></button>{isNewItem && <p className="ingredient-new-note">Not in pantry · included in the shopping list after saving.</p>}</div>;
      })}</div>}
      {meal.ingredients.length === 0 && <p className="ingredient-empty">Add the ingredients this meal needs to check pantry stock.</p>}
    </div>
  );
}

function getShoppingList(plan: FestivePlan, inventory: InventoryItem[]) {
  const needs = new Map<string, {name: string; unit: string; quantity: number; inventoryItemId: string | null}>();
  for (const {id} of mealPeriods) for (const ingredient of plan[id].ingredients) {
    const pantryItem = findPantryItem(inventory, ingredient.inventoryItemId);
    const pantryId = pantryItem?.id ?? ingredient.inventoryItemId;
    const unit = pantryItem?.unit ?? ingredient.unit;
    const quantity = convertInventoryQuantity(ingredient.requiredQuantity, ingredient.unit, unit) ?? ingredient.requiredQuantity;
    const key = pantryId ?? `custom:${ingredient.name.trim().toLowerCase()}:${ingredient.unit.trim().toLowerCase()}`;
    const current = needs.get(key);
    if (current) current.quantity += quantity;
    else needs.set(key, {name: ingredient.name, unit, quantity, inventoryItemId: pantryId});
  }
  return [...needs.values()].flatMap(need => {
    const stock = findPantryItem(inventory, need.inventoryItemId)?.quantity ?? 0;
    const quantity = Math.max(0, need.quantity - stock);
    return quantity > 0 ? [{...need, quantity}] : [];
  });
}

function CardHeading({title, detail, action}: {title: string; detail: string; action?: ReactNode}) {
  return <div className="card-heading"><div><h2>{title}</h2><p>{detail}</p></div>{action}</div>;
}
function Empty({icon, title, text, button, onClick}: {icon: ReactNode; title: string; text: string; button?: string; onClick?: () => void}) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><strong>{title}</strong><p>{text}</p>{button && onClick && <button onClick={onClick}>{button}</button>}</div>;
}

function RequestDialog({saving, error, onClose, onSubmit}: {saving: boolean; error: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void}) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="request-dialog-title">
    <div className="dialog-heading"><div><span className="dialog-kicker">Kitchen team</span><h2 id="request-dialog-title">Request a change</h2></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={16}/></button></div>
    <form className="dialog-form" onSubmit={onSubmit}><label className="field"><span>What would you like changed?</span><textarea name="message" required minLength={10} maxLength={500} rows={5} placeholder="Tell the Admin what you need and why…"/><small>Your request will be sent to a kitchen Admin for review.</small></label>{error && <p className="dialog-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="cancel-button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? "Sending…" : "Send request"}</button></div></form>
  </section></div>;
}

function FormDialog({kind, initialRecord, volunteers, saving, error, onClose, onSubmit}: {kind: FormKind; initialRecord: InventoryItem | Expense | null; volunteers: Volunteer[]; saving: boolean; error: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void}) {
  const editingInventory = kind === "inventory" && initialRecord ? initialRecord as InventoryItem : null;
  const editingExpense = kind === "expense" && initialRecord ? initialRecord as Expense : null;
  const heading: Record<FormKind, string> = {inventory: editingInventory ? "Edit pantry item" : "Add pantry item", volunteer: "Add a volunteer", shift: "Schedule a shift", expense: editingExpense ? "Edit expense" : "Add an expense"};
  const [from] = useState(today);
  const dateField = (name: string, label = "Date") => <Field name={name} label={label} type="date" defaultValue={editingExpense?.spentAt ?? from} required/>;
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="dialog-heading"><div><span className="dialog-kicker">HTTC kitchen</span><h2 id="dialog-title">{heading[kind]}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18}/></button></div>
    <form onSubmit={onSubmit} className="dialog-form">
      {kind === "inventory" && <><div className="form-row"><Field name="name" label="Item name" placeholder="e.g. Basmati rice" defaultValue={editingInventory?.name} required/><Field name="unit" label="Unit" placeholder="kg, bags, cans" defaultValue={editingInventory?.unit} required/></div><div className="form-row"><Field name="quantity" label={editingInventory ? "Current quantity" : "Quantity to add"} type="number" min="0" step="any" placeholder="0" defaultValue={editingInventory ? String(editingInventory.quantity) : undefined} required/><Field name="threshold" label="Restock when below" type="number" min="0" step="any" placeholder="0" defaultValue={editingInventory ? String(editingInventory.threshold) : undefined} required/></div></>}
      {kind === "inventory" && !editingInventory && <p className="import-validation-note">If the name and unit match an existing item, this quantity is added to its stock.</p>}
      {kind === "volunteer" && <><Field name="name" label="Full name" placeholder="Volunteer name" required/><Field name="role" label="Kitchen role" placeholder="Serving, cleanup, coordination"/><div className="form-row"><Field name="phone" label="Phone" type="tel" placeholder="Optional"/><Field name="email" label="Email" type="email" placeholder="Optional"/></div></>}
      {kind === "shift" && <><label className="field"><span>Volunteer</span><select name="volunteerId" required defaultValue=""><option value="" disabled>Choose a volunteer</option>{volunteers.filter(v => v.isActive !== false).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select>{volunteers.filter(v => v.isActive !== false).length === 0 && <small>Add an active volunteer first, then schedule a shift.</small>}</label>{dateField("date")}<div className="form-row"><Field name="startTime" label="Starts" type="time" required/><Field name="endTime" label="Ends" type="time" required/></div><Field name="assignment" label="Assignment" placeholder="Serving, cleanup, deliveries" required/></>}
      {kind === "expense" && <><Field name="description" label="Purchase" placeholder="e.g. Vegetables for lunch" defaultValue={editingExpense?.description} required/><div className="form-row"><Field name="category" label="Category" placeholder="Groceries, supplies" defaultValue={editingExpense?.category}/><Field name="amount" label="Amount ($)" type="number" min="0.01" step="0.01" placeholder="0.00" defaultValue={editingExpense ? String(editingExpense.amount) : undefined} required/></div>{dateField("date", "Purchase date")}</>}
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="cancel-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving || (kind === "shift" && !volunteers.some(v => v.isActive !== false))}>{saving ? <LoaderCircle size={16} className="spin"/> : <Plus size={16}/>} {initialRecord ? "Save changes" : "Save record"}</button></div>
    </form></section></div>;
}
function Field({name, label, type = "text", placeholder, required, defaultValue, min, step}: {name: string; label: string; type?: string; placeholder?: string; required?: boolean; defaultValue?: string; min?: string; step?: string}) {
  return <label className="field"><span>{label}</span><input name={name} type={type} placeholder={placeholder} required={required} defaultValue={defaultValue} min={min} step={step}/></label>;
}
