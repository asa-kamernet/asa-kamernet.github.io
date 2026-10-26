"use strict";
// Kamernet Live. The whole search happens here, on four tabs:
//   Find      every listing (filters, location + distance, list or map); "Select" to act on several at once
//   My leads  places you're in touch with, grouped by what happens next, each with one next-step button
//   Inbox     messages waiting to be sent, new landlord messages, messages that need a listing
//   More      alerts and health, facts about you, add a place, lock
// Tapping any listing opens its page: status, your message, the conversation, the landlord, the deal, the AI summary.
// NOTHING here sends to a landlord except "Send for me" (one message) and "Send all" in Inbox (every ready email and Kamernet
// draft; Asa, 25 Oct 2026), each after an "Are you sure?": email goes out through
// the Gmail script, Kamernet through the "Kamernet Live sender" helper in Chrome on Asa's PC (kamernet-sender-extension).

// ---- Settings (public values only; the passcode is typed on the site and never stored in this file) ----
const SUPA = "https://sldfjyrpopypzbmhvbkq.supabase.co";
const PAGE = 30;
const STAGES = ["none","applied","replied","booked","viewed","offer","signed"];
const STAGE_LABEL = { none: "Not contacted", applied: "Applied", replied: "They replied", booked: "Viewing booked", viewed: "Viewed", offer: "Offer", signed: "Signed" };
const OPINIONS = [["want","★ Want it"],["interested","Interested"],["hold","Hold off"],["no","Not for me"]];
const OP_LABEL = Object.fromEntries(OPINIONS);
const CLOSED_LABEL = { them_no: "They said no", me_no: "I said no", gone: "Listing gone", scam: "Scam" };
const CITIES = ["Rotterdam","Amsterdam","Den Haag","Utrecht","Delft","Nijmegen"];
const CHAN = { kamernet: "Kamernet", site: "The ad's site", whatsapp: "WhatsApp", email: "Email", other: "Other" };
const USD_EUR = 0.93;

// ---- Tags: how they are grouped in Filters and coloured on cards ----
const GROUPS = [
  { label: "Language",     tags: ["dutch-only","dutch-preferred","english-ok","internationals-welcome","ad-in-dutch"] },
  { label: "Registration", tags: ["registration-ok","no-registration"] },
  { label: "Who can rent", tags: ["women-only","men-only","students-only","no-students","no-couples","working-professionals","expat-friendly"] },
  { label: "Stay",         tags: ["short-term","fixed-end-date","open-ended","sublet"] },
  { label: "Costs",        tags: ["bills-included","bills-extra","high-deposit"] },
  { label: "House",        tags: ["furnished","live-in-landlord","no-pets","no-smoking","quiet"] },
  { label: "Watch out",    tags: ["offsite-contact","scam-risk"] },
];
const GROUP_OF = {}; GROUPS.forEach((g, i) => g.tags.forEach((t) => (GROUP_OF[t] = i)));
const TONE = {
  good: ["registration-ok","english-ok","internationals-welcome","bills-included","furnished","open-ended","expat-friendly","dutch-preferred"],
  bad:  ["no-registration","dutch-only","offsite-contact","scam-risk","high-deposit"],
  warn: ["women-only","men-only","students-only","no-students","no-couples","sublet","short-term","live-in-landlord","working-professionals"],
};
const toneOf = (t) => TONE.good.includes(t) ? "good" : TONE.bad.includes(t) ? "bad" : TONE.warn.includes(t) ? "warn" : "";
const SPECIAL = { "english-ok": "English OK", "ad-in-dutch": "Ad in Dutch", "registration-ok": "Registration OK", "no-registration": "No registration", "dutch-only": "Dutch only", "dutch-preferred": "Dutch preferred" };
const label = (t) => SPECIAL[t] || (t.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()));

// ---- Small helpers ----
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const eur = (n) => "€" + Number(n).toLocaleString("en-GB");
const euro = (usd) => { const e = Number(usd || 0) * USD_EUR; return "€" + (e < 0.1 ? e.toFixed(3) : e.toFixed(2)); };
const cap = (s) => String(s ?? "").replace(/^./, (c) => c.toUpperCase());
const store = { get(k){ try { return localStorage.getItem(k); } catch { return null; } }, set(k,v){ try { localStorage.setItem(k,v); } catch {} } };
const when = (t) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const day = (s) => s ? new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(s.slice(0, 4) !== String(new Date().getFullYear()) ? { year: "numeric" } : {}) }) : "";
const dayTxt = (t) => new Date(t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const ago = (t) => { const m = Math.round((Date.now() - Date.parse(t)) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : Math.round(m / 1440) === 1 ? "yesterday" : `${Math.round(m / 1440)} days ago`; };
const fresh = (t, min) => !!t && Date.now() - Date.parse(t) < min * 60000;
const toLocalInput = (iso) => { if (!iso) return ""; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const plural = (n, one, many = one + "s") => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

// ---- Saved filters and view (this device only) ----
const S = Object.assign({
  kindF: {}, regF: {}, srcF: {}, max: 900, q: "", dist: "any", cheap: "hide", hideContacted: false,
  depMax: 0, depLegal: false, depKnown: false, // deposit: max € (0 = any), hide above 2 months' rent, hide when not stated
  tags: {}, // tag -> "in" (must have) | "out" (hide these)
  sort: "per_person", dir: "asc", ppl: 4,
  loc: null,    // {name, lat, lng, km, city?, r?}: km 0 = only that city; otherwise a circle of km around the point
  view: "list", tab: "find",
}, (() => { try { return JSON.parse(store.get("kn_state") || "{}"); } catch { return {}; } })());
{ // older versions: City chips became Location; "hide these" for type and registration became simple choices; lead filters moved to My leads
  const c = Object.keys(S.cityF || {}).find((k) => S.cityF[k] === "in");
  if (c && !S.loc) S.loc = { name: c, city: c, km: 0 };
  S.srcF ||= {};
  for (const m of [S.kindF, S.regF]) for (const k of Object.keys(m)) if (m[k] !== "in") delete m[k];
  for (const k of ["cityF", "msgf", "stageF", "opF", "closedF"]) delete S[k];
  if (S.sort.includes(".")){ const [k, d] = S.sort.split("."); S.sort = k; S.dir = d; } // sort used to hold its direction too
}
// what you can sort by: label, the direction it starts in, and what up / down mean for it
const SORTS = {
  per_person: ["Price", "asc", "Lowest price first", "Highest price first"],
  first_seen_at: ["Date found", "desc", "Oldest first", "Newest first"],
  "raw->>publishDate": ["Date posted", "desc", "Oldest first", "Newest first"],
  size_m2: ["Size", "desc", "Smallest first", "Biggest first"],
  available_from: ["Available from", "asc", "Soonest first", "Latest first"],
  status: ["Status", "desc", "Just contacted first", "Furthest along first"],
};
if (!SORTS[S.sort]) S.sort = "per_person";
const orderBy = () => S.sort === "status" ? "first_seen_at.desc" : `${S.sort}.${S.dir}.nullslast`;
// Status sort: places you're in touch with come first (furthest along or just started), then everything else, newest first
const statusRank = (id) => STAGES.indexOf(stageOf(String(id))) * 10 + ({ want: 3, interested: 2, hold: 1 }[stOf(String(id)).opinion] ?? 0);
const statusIds = () => Object.keys(statuses).filter((id) => !isClosed(id) && statusRank(id) > 0);
function drawSortDir(){
  const s = SORTS[S.sort], txt = S.dir === "asc" ? s[2] : s[3];
  $("sortdir").textContent = S.dir === "asc" ? "↑" : "↓";
  $("sortdir").title = txt; $("sortdir").setAttribute("aria-label", "Order: " + txt + ". Tap to flip.");
}
function persist(){ store.set("kn_state", JSON.stringify(S)); }

// ---- What we know ----
let pass = store.get("kn_pass") || "";
let statuses = {}, threads = {}, deals = {}, contacts = {}, drafts = [], inbox = null, facts = [], cityList = [], tagCounts = [];
const cache = {};                // listing id -> row (from any list, kept for My leads, Inbox and the listing page)
let loaded = [], total = 0, offset = 0, topN = 0;
const stOf = (id) => statuses[id] || {};
// what the landlord said in messages (my_status.msg_facts) goes on top of the ad's values; r._ad keeps the ad itself
const MF_KEYS = ["price", "deposit", "available_from", "available_until", "people", "utilities_incl"];
const MF_LABEL = { price: "Rent", deposit: "Deposit", available_from: "Available from", available_until: "Available until", people: "People allowed", utilities_incl: "Bills included" };
function eff(r){
  const mf = r && stOf(String(r.id)).msg_facts;
  if (!mf) return r;
  const o = { ...r, _ad: r, _mf: mf };
  for (const k of MF_KEYS) if (mf[k]) o[k] = mf[k].v;
  return o;
}
// a booked viewing whose time has passed counts as viewed
const stageOf = (id) => { const x = stOf(id), sg = x.stage || "none"; return sg === "booked" && x.viewing_at && Date.parse(x.viewing_at) < Date.now() ? "viewed" : sg; };
const isClosed = (id) => !!stOf(id).closed || stOf(id).opinion === "no";
const unsent = () => drafts.filter((d) => d.send_status !== "sent");
const draftOf = (id) => unsent().find((d) => String(d.listing_id) === String(id));
const needsReply = (id) => threads[id]?.last_dir === "in" && !isClosed(id);
const needsVerdict = (id) => !isClosed(id) && stageOf(id) === "viewed" && !stOf(id).opinion;
const payToApprove = (id) => (deals[id]?.payments || []).some((p) => p.status === "proposed");
const SENDING = ["queued", "sending", "kn_queued", "kn_sending"]; // kn_ = on its way through Kamernet (the PC helper)
const isSending = (d) => SENDING.includes(d?.send_status);
const draftReady = (id) => { const d = draftOf(id); return !!d && !isSending(d) && !isClosed(id); };
// the Kamernet sender in Chrome on the PC asked for work in the 3 minutes before the health was loaded
const knOnline = () => { const p = inbox?.health?.kn_sender_ping; return !!p && (inbox.at || Date.now()) - Date.parse(p) < 180000; };
const yourMove = (id) => needsReply(id) || needsVerdict(id) || draftReady(id) || (!isClosed(id) && payToApprove(id));
const divisor = (r) => r.people == null ? null : r.people > 1 ? Math.max(1, Math.min(S.ppl, r.people)) : 1;
const ppOf = (r) => { const d = divisor(r); return d ? Math.round(r.price / d) : null; };
const dealStarted = (id) => !!deals[id] || ["offer", "signed"].includes(stageOf(String(id)));
const viewingDone = (id) => !!stOf(id).viewing_at && Date.parse(stOf(id).viewing_at) < Date.now();

// ---- Server calls ----
function lockOut(msg){
  pass = ""; store.set("kn_pass", ""); statuses = {};
  for (const d of document.querySelectorAll("dialog[open]")) d.close();
  $("app").hidden = true; $("lock").hidden = false;
  $("gatemsg").textContent = msg || "Private tool. Enter the passcode to open it.";
}
// all data goes through the passcode-protected "data" function; nothing is publicly readable
async function rest(path, extra = {}){
  const i = path.indexOf("?"), table = i < 0 ? path : path.slice(0, i), q = i < 0 ? "" : path.slice(i + 1);
  const res = await fetch(`${SUPA}/functions/v1/data?table=${table}${q ? "&" + q : ""}`, { headers: { "x-passcode": pass, ...extra } });
  if (res.status === 401){ lockOut("Wrong passcode. Try again."); throw new Error("Wrong passcode"); }
  if (!res.ok) throw new Error(`database ${res.status}`);
  return res;
}
async function fn(name, opts = {}){
  const res = await fetch(`${SUPA}/functions/v1/${name}`, { ...opts, headers: { "x-passcode": pass, "content-type": "application/json", ...(opts.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) lockOut("Wrong passcode. Try again.");
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}
const post = (name, body) => fn(name, { method: "POST", body: JSON.stringify(body) });
const countOf = (res, n) => Number((res.headers.get("content-range") || "").split("/")[1]) || n;

// ---- Toast (with Undo or another action) and "Are you sure?" ----
let toastT;
function toast(text, action, isErr){
  const t = $("toast"), top = [...document.querySelectorAll("dialog[open]")].pop();
  (top || document.body).appendChild(t); // a modal page sits on top of everything, so the toast goes inside it
  $("toastText").textContent = text; t.classList.toggle("err", !!isErr);
  const b = $("toastUndo"); b.hidden = !action; b.textContent = action?.label || "Undo";
  b.onclick = action ? async () => { t.hidden = true; try { await action.fn(); } catch (e) { toast("Couldn't do that: " + e.message, null, true); } } : null;
  t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, action ? 7000 : 4000);
}
const fail = (e) => toast("Couldn't save: " + (e?.message || e), null, true);
function confirmBox({ title, body = "", ok = "OK", danger = false }){
  const d = $("cfDlg");
  $("cfTitle").textContent = title; $("cfBody").innerHTML = body;
  $("cfYes").textContent = ok; $("cfYes").classList.toggle("danger", danger); $("cfYes").classList.toggle("ghost", danger);
  d.showModal();
  return new Promise((res) => {
    $("cfYes").onclick = () => { d.close(); res(true); };
    $("cfNo").onclick = () => { d.close(); res(false); };
    d.oncancel = () => res(false);
  });
}

// ---- Tabs ----
function showTab(tab){
  S.tab = tab; persist();
  for (const v of ["find", "leads", "inbox", "more"]) $("v-" + v).hidden = v !== tab;
  document.querySelectorAll(".tabs button").forEach((b) => { if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  if (tab !== "find") setSelect(false);
  if (tab === "leads") renderLeads();
  if (tab === "inbox") renderInbox();
  if (tab === "more"){ drawHealth(); drawSites(); loadSites(); loadFacts(); }
  if (tab === "find" && S.view === "map" && map) setTimeout(() => map.invalidateSize(), 0);
  window.scrollTo(0, 0);
}
document.querySelector(".tabs").onclick = (e) => { const b = e.target.closest("button[data-tab]"); if (b) showTab(b.dataset.tab); };
function renderBadges(){
  const ids = leadIds(), move = ids.filter(yourMove).length;
  const inb = unsent().filter((d) => !isClosed(String(d.listing_id))).length + (inbox?.open.length || 0);
  const tb = (id, n) => { $(id).hidden = !n; $(id).textContent = n > 99 ? "99+" : n; };
  tb("tb-leads", move); tb("tb-inbox", inb);
  $("tb-more").hidden = !healthBroken();
}

// =====================================================================================
// FIND
// =====================================================================================
function filters(){
  // reposts of an older live ad are hidden (dup_of). Ads taken off Kamernet are hidden too, unless you are still in contact.
  const p = ["dup_of=is.null"];
  const known = Object.keys(statuses), activeIds = known.filter((id) => !isClosed(id));
  p.push(activeIds.length ? `or=(gone_at.is.null,id.in.(${activeIds.join(",")}))` : "gone_at=is.null");
  const ins = (m) => Object.keys(m).filter((k) => m[k] === "in");
  const quote = (c) => `"${c}"`, regCol = { ok: "yes", not: "no", unknown: "unknown" };
  if (S.loc?.city && !nearOn()) p.push(`city=in.(${quote(S.loc.city)})`); // "Only this city" (or a city whose middle point isn't known yet); a distance goes through base()
  if (ins(S.kindF).length) p.push(`kind=in.(${ins(S.kindF).join(",")})`);
  if (ins(S.srcF).length) p.push(`source=in.(${ins(S.srcF).join(",")})`);
  if (ins(S.regF).length) p.push(`reg=in.(${ins(S.regF).map((k) => regCol[k]).join(",")})`);
  const ands = [];
  // 2 or 3 people sharing: hide places that allow fewer people ("Up to 4" and "Just me" hide nothing; unknown stays)
  if (S.ppl > 1 && S.ppl < 4) ands.push(`or(people.is.null,people.gte.${S.ppl})`);
  if (S.max < 2500){
    // price / min(people sharing, people allowed) <= max, written out for each number of people allowed.
    // Unknown number of people counts as 1, so its whole price must fit.
    const alts = [`and(people.is.null,price.lte.${S.max})`, `and(people.lte.1,price.lte.${S.max})`];
    for (let k = 2; k < S.ppl; k++) alts.push(`and(people.eq.${k},price.lte.${S.max * k})`);
    alts.push(`and(people.gte.${Math.max(2, S.ppl)},price.lte.${S.max * S.ppl})`);
    ands.push(`or(${alts.join(",")})`);
  }
  if (S.cheap !== "show") ands.push("or(per_person.gte.250,per_person.is.null)"); // prices under €250 are almost always typos
  if (S.depMax > 0){ if (S.depKnown) p.push(`deposit=lte.${S.depMax}`); else ands.push(`or(deposit.is.null,deposit.lte.${S.depMax})`); }
  else if (S.depKnown) p.push("deposit=not.is.null");
  if (S.depLegal) p.push("all_tags=not.cs.{high-deposit}"); // the reader marks deposits above about 2 months' rent
  const q = S.q.trim().replace(/[(),*"]/g, " ").trim();
  if (q) ands.push(`or(street.ilike.*${q}*,city.ilike.*${q}*)`);
  if (S.dist === "yes") p.push("distilled_at=not.is.null");
  if (S.dist === "no") p.push("distilled_at=is.null");
  const inc = Object.keys(S.tags).filter((t) => S.tags[t] === "in"), out = Object.keys(S.tags).filter((t) => S.tags[t] === "out");
  if (inc.length) p.push(`all_tags=cs.{${inc.join(",")}}`);
  for (const t of out) p.push(`all_tags=not.cs.{${t}}`);
  const hide = known.filter((id) => isClosed(id) || (S.hideContacted && stageOf(id) !== "none")); // closed ones live in My leads
  if (hide.length) p.push(`id=not.in.(${hide.join(",")})`);
  if (ands.length) p.push(`and=(${ands.join(",")})`);
  return p;
}
const SELECT = "id,url,kind,city,street,title,price,people,per_person,size_m2,utilities_incl,deposit,available_from,available_until,tags,distill_tags,reg,distilled_at,distill_model,distilled,photos,first_seen_at,gone_at,source,posted:raw->>publishDate,pc:facts->>postcode,lat:facts->>lat,lng:facts->>lng,check_reasons,dup_of,dup_ignore";
const qs = (extra) => [...filters(), `order=${orderBy()}`, ...extra].join("&");
// with a Location and a distance, only listings within that many km (a city + distance = the whole city plus that far around it)
const nearOn = () => S.loc && S.loc.km > 0 && S.loc.lat != null;
const areaKm = () => S.loc.city ? (S.loc.r || 0) + S.loc.km : S.loc.km;
const base = () => nearOn() ? `rpc/listings_near?clat=${S.loc.lat}&clng=${S.loc.lng}&km=${areaKm()}${S.loc.city ? "&ccity=" + encodeURIComponent(S.loc.city) : ""}&` : "listings?";
const locLabel = () => S.loc.city ? S.loc.name + " centre" : S.loc.name === "Near me" ? "you" : S.loc.name === "Map area" ? "the map centre" : S.loc.name.split(",")[0];
function kmBetween(a, b, c, d){
  const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}
function distTxt(r){
  if (!S.loc || S.loc.lat == null || r.lat == null) return "";
  const k = kmBetween(S.loc.lat, S.loc.lng, Number(r.lat), Number(r.lng));
  return `${k < 1 ? Math.round(k * 1000 / 50) * 50 + " m" : k.toFixed(1) + " km"} from ${locLabel()}`;
}

// ---- Cards ----
function badgeList(r){
  const all = [...new Set([...(r.tags || []), ...(r.distill_tags || [])])];
  if (r.reg === "yes" && !all.includes("registration-ok")) all.push("registration-ok");
  if (r.reg === "no" && !all.includes("no-registration")) all.push("no-registration");
  const rank = (t) => ({ bad: 0, good: 1, warn: 2 }[toneOf(t)] ?? 3);
  return all.filter((t) => !["no-pets", "no-smoking"].includes(t)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
const avail = (r) => r.available_from ? (r.available_from <= new Date().toISOString().slice(0, 10) ? "Available now" : "From " + day(r.available_from)) + (r.available_until ? " until " + day(r.available_until) : "") : r.available_until ? "Until " + day(r.available_until) : "";
function postedTxt(p){
  if (!p) return "";
  const d = Math.floor((Date.now() - Date.parse(p.slice(0, 10) + "T12:00:00Z")) / 86400000);
  return d <= 0 ? "Posted today" : d === 1 ? "Posted yesterday" : d < 14 ? `Posted ${d} days ago` : "Posted " + day(p.slice(0, 10));
}
function priceHtml(r){
  r = eff(r);
  const pp = ppOf(r);
  return `<span class="price">${eur(pp ?? r.price)}<small>${pp != null && divisor(r) > 1 ? " pp" : pp != null ? " /mo" : " total"}</small></span>`;
}
function statePill(id){
  id = String(id);
  if (isClosed(id)) return `<span class="badge bad">${esc(stOf(id).closed ? CLOSED_LABEL[stOf(id).closed] : "Not for me")}</span>`;
  const sg = stageOf(id), op = stOf(id).opinion;
  return (sg !== "none" ? `<span class="badge stage">${STAGE_LABEL[sg]}</span>` : "") + (op === "want" ? `<span class="badge ai">★ Want it</span>` : op ? `<span class="badge stage">${esc(OP_LABEL[op])}</span>` : "");
}
// "Something's not right" (rules on the server, no AI): a short badge; once the AI has read the ad, its verdict
const CHECK_SHORT = [[/under €250|less than half/, "Price unusually low"], [/WhatsApp/, "WhatsApp contact"], [/abroad/, "Landlord abroad"], [/money app/, "Money app"], [/post/, "Keys by post"], [/before a viewing/, "Pay before viewing"]];
const scammy = (r) => [...(r.tags || []), ...(r.distill_tags || [])].includes("scam-risk") || (r.distilled?.red_flags || []).length > 0;
function checkBadge(r){
  if (!(r.check_reasons || []).length && !scammy(r)) return "";
  if (r.distilled_at){
    if ([...(r.tags || []), ...(r.distill_tags || [])].includes("scam-risk")) return '<span class="badge bad">⚠ Likely scam</span>';
    return scammy(r) ? '<span class="badge bad">⚠ AI found a problem</span>' : '<span class="badge good">✓ AI checked: looks OK</span>';
  }
  const short = (CHECK_SHORT.find(([re]) => re.test(r.check_reasons[0])) || [0, "Looks odd"])[1];
  return `<span class="badge warn">⚠ ${esc(short)}</span>`;
}
function thumb(r){
  return r.photos?.[0] ? `<div class="thumb" style="background-image:url('${esc(r.photos[0])}')"><span class="tick">✓</span></div>` : `<div class="thumb none">No photo<span class="tick">✓</span></div>`;
}
function cardHtml(r){
  const dt = distTxt(r), bl = badgeList(r).slice(0, 4);
  return `<article class="card${picked.has(r.id) ? " picked" : ""}" data-id="${r.id}" tabindex="0" role="button" aria-label="${esc(r.street)}">
    ${thumb(r)}
    <div class="cardtop"><span class="street">${esc(r.street)}</span>${priceHtml(r)}</div>
    <div class="meta"><span>${esc(r.city)}</span><span>${esc(cap(r.kind))}${r.size_m2 ? " · " + r.size_m2 + " m²" : ""}</span>${avail(r) ? `<span>${esc(avail(r))}</span>` : ""}${dt ? `<span class="dist">${esc(dt)}</span>` : ""}</div>
    <div class="badges">${checkBadge(r)}${statePill(r.id)}${r.distilled_at ? '<span class="badge ai">AI summary</span>' : ""}${r.source === "manual" ? '<span class="badge stage">Added by you</span>' : r.source !== "kamernet" ? `<span class="badge stage">${esc(siteName(r.source))}</span>` : ""}${bl.map((t) => `<span class="badge ${toneOf(t)}">${esc(label(t))}</span>`).join("")}</div>
    ${r.distilled?.summary ? `<div class="cardsum">${esc(r.distilled.summary)}</div>` : ""}
    ${(r.distilled?.red_flags || []).length ? `<div class="cardsum flags">⚠ ${esc(r.distilled.red_flags.join(" · "))}</div>` : ""}
  </article>`;
}
function renderList(){
  if (S.sort === "per_person"){ const dir = S.dir === "desc" ? -1 : 1, k = (r) => ppOf(r) ?? dir * 1e9; loaded.sort((a, b) => dir * (k(a) - k(b))); }
  $("list").innerHTML = loaded.length ? loaded.map(cardHtml).join("")
    : `<div class="empty"><b>Nothing matches.</b><span>Try a bigger distance, a higher price, or fewer filters.</span>${activeFilters().length ? '<button class="btn ghost" type="button" data-act="reset">Reset all filters</button>' : ""}</div>`;
  $("count").textContent = `${plural(total, "listing")}${loaded.length < total ? ` · showing ${loaded.length}` : ""}`;
  $("more").hidden = loaded.length >= total || S.view === "map";
  renderActive(); syncSelect();
}
// what's filtering the list right now, as chips you can tap away
function activeFilters(){
  const f = [];
  if (S.max < 2500) f.push({ t: `Up to ${eur(S.max)}${S.ppl > 1 ? " pp" : ""}`, clear: () => { S.max = 2500; } });
  if (S.ppl < 4) f.push({ t: S.ppl === 1 ? "Just me" : `${S.ppl} people`, clear: () => { S.ppl = 4; } });
  for (const k of Object.keys(S.kindF)) f.push({ t: cap(k) + "s", clear: () => delete S.kindF[k] });
  for (const k of Object.keys(S.srcF)) f.push({ t: k === "manual" ? "Added by you" : "From " + siteName(k), clear: () => delete S.srcF[k] });
  for (const k of Object.keys(S.regF)) f.push({ t: { ok: "Registration OK", unknown: "Registration unknown", not: "No registration" }[k], clear: () => delete S.regF[k] });
  if (S.dist !== "any") f.push({ t: S.dist === "yes" ? "Has AI summary" : "No AI summary", clear: () => { S.dist = "any"; } });
  if (S.hideContacted) f.push({ t: "Not contacted yet", clear: () => { S.hideContacted = false; } });
  if (S.depMax) f.push({ t: `Deposit up to ${eur(S.depMax)}`, clear: () => { S.depMax = 0; } });
  if (S.depLegal) f.push({ t: "Deposit max 2 months", clear: () => { S.depLegal = false; } });
  if (S.depKnown) f.push({ t: "Deposit stated", clear: () => { S.depKnown = false; } });
  if (S.q.trim()) f.push({ t: `“${S.q.trim()}”`, clear: () => { S.q = ""; } });
  if (S.cheap === "show") f.push({ t: "Incl. under €250", clear: () => { S.cheap = "hide"; } });
  for (const [t, v] of Object.entries(S.tags)) f.push({ t: (v === "in" ? "✓ " : "✕ ") + label(t), out: v === "out", clear: () => delete S.tags[t] });
  return f;
}
function renderActive(){
  const f = activeFilters();
  $("activef").innerHTML = f.map((x, i) => `<button class="fchip${x.out ? " out" : ""}" type="button" data-i="${i}" aria-label="Remove filter ${esc(x.t)}"><b>${esc(x.t)}</b><span aria-hidden="true">×</span></button>`).join("")
    + (f.length > 1 ? '<button class="linkbtn" type="button" data-act="reset">Clear all</button>' : "");
  $("filtbtn").textContent = f.length ? `Filters · ${f.length}` : "Filters";
}
$("activef").onclick = (e) => {
  const b = e.target.closest("[data-i]");
  if (b){ activeFilters()[+b.dataset.i]?.clear(); persist(); filtersChanged(); }
};
document.addEventListener("click", (e) => { if (e.target.closest("[data-act=reset]")) resetFilters(); });
function resetFilters(){
  Object.assign(S, { kindF: {}, regF: {}, srcF: {}, max: 2500, q: "", dist: "any", cheap: "hide", hideContacted: false, tags: {}, ppl: 4, depMax: 0, depLegal: false, depKnown: false });
  persist(); filtersChanged(); if ($("filtDlg").open) renderFilters();
}
function filtersChanged(){ load(true); }

// ---- Loading the list ----
let loadToken = 0;
// keep > 0 = quiet refresh: ask the server again for the same number of rows, so places that no longer match the
// filters (just summarized, marked closed, contacted...) drop out and new ones appear, without losing your place
async function load(reset, keep = 0){
  const my = ++loadToken;
  const quiet = reset && keep > 0;
  if (reset && !quiet){ offset = 0; topN = 0; loaded = []; if (picked.size){ picked.clear(); } }
  try {
    const off = reset ? 0 : offset;
    const ids = S.sort === "status" ? statusIds() : [];
    let top = [];
    if (ids.length && reset){ // your leads that match the filters, in status order
      top = await (await rest(`${base()}select=${SELECT}&${qs([`id=in.(${ids.join(",")})`])}`)).json();
      const k = (r) => statusRank(r.id) * (S.dir === "asc" ? -1 : 1);
      top.sort((a, b) => k(b) - k(a));
    }
    const res = await rest(`${base()}select=${SELECT}&${qs([...(ids.length ? [`id=not.in.(${ids.join(",")})`] : []), `limit=${quiet ? keep : PAGE}`, `offset=${off}`])}`, { Prefer: "count=exact" });
    const rows = await res.json();
    if (my !== loadToken) return;
    if (reset){ loaded = []; topN = top.length; }
    total = topN + countOf(res, rows.length);
    for (const r of [...top, ...rows]) cache[r.id] = r;
    loaded = loaded.concat(top, rows); offset = off + rows.length;
    if (quiet && picked.size){ const still = new Set(loaded.map((r) => r.id)); for (const id of [...picked]) if (!still.has(id)) picked.delete(id); syncSelect(); }
    const y = scrollY;
    renderList();
    if (quiet) scrollTo(0, y);
    if ($("filtDlg").open) $("filtDone").textContent = `Show ${plural(total, "listing")}`;
    if (reset && S.view === "map") loadMap();
  } catch (e) { if (!quiet) $("count").textContent = "Couldn't load listings: " + e.message; }
}
const reloadList = () => load(true, Math.max(PAGE, loaded.length - topN));
$("more").onclick = () => load(false);
$("sort").onchange = (e) => { S.sort = e.target.value; S.dir = SORTS[S.sort][1]; drawSortDir(); persist(); load(true); };
$("sortdir").onclick = () => { S.dir = S.dir === "asc" ? "desc" : "asc"; drawSortDir(); persist(); load(true); toast(SORTS[S.sort][S.dir === "asc" ? 2 : 3]); };
async function headline(){
  try {
    const n = countOf(await rest("listings?select=id&gone_at=is.null&dup_of=is.null&limit=1", { Prefer: "count=exact" }), 0);
    const nd = countOf(await rest("listings?select=id&gone_at=is.null&dup_of=is.null&distilled_at=not.is.null&limit=1", { Prefer: "count=exact" }), 0);
    $("sub").textContent = `${plural(n, "listing")} from ${siteList()} · ${nd.toLocaleString("en-GB")} with an AI summary`;
  } catch { $("sub").textContent = "Live listings"; }
}

// tapping a card opens it, or selects it in select mode
function cardTap(e){
  const c = e.target.closest(".card"); if (!c) return;
  if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  const id = Number(c.dataset.id);
  if (selecting){ picked.has(id) ? picked.delete(id) : picked.add(id); c.classList.toggle("picked", picked.has(id)); syncSelect(); }
  else openListing(id);
}
$("list").addEventListener("click", cardTap);
$("list").addEventListener("keydown", cardTap);

// ---- Filters sheet ----
$("filtbtn").onclick = () => { renderFilters(); $("filtDone").textContent = `Show ${plural(total, "listing")}`; $("filtDlg").showModal(); };
$("filtDone").onclick = () => $("filtDlg").close();
$("filtReset").onclick = () => resetFilters();
let tagMenu = null; // the tag whose "Must have / Hide / Any" choice is open
function renderFilters(){
  const n = Object.fromEntries(tagCounts.map((t) => [t.tag, t.n]));
  const on = (m, k) => `aria-pressed="${m[k] === "in"}"`;
  const pplTxt = S.ppl >= 4 ? "Up to 4" : S.ppl === 1 ? "Just me" : `${S.ppl} people`;
  const tagChip = (t) => `<button class="tagchip ${S.tags[t] || ""}" type="button" data-tag="${esc(t)}">${S.tags[t] === "in" ? "✓ " : S.tags[t] === "out" ? "✕ " : ""}${esc(label(t))}${n[t] != null ? `<small>${n[t]}</small>` : ""}</button>`;
  const menu = (t) => tagMenu === t ? `<div class="tagmenu"><b>${esc(label(t))}:</b>
      <button class="btn small${S.tags[t] === "in" ? "" : " ghost"}" type="button" data-tagset="in">Must have</button>
      <button class="btn small${S.tags[t] === "out" ? "" : " ghost"}" type="button" data-tagset="out">Hide these</button>
      <button class="btn small${!S.tags[t] ? "" : " ghost"}" type="button" data-tagset="">Either</button></div>` : "";
  const groups = GROUPS.map((g) => {
    const tags = g.tags.filter((t) => n[t] > 0 || S.tags[t]);
    return tags.length ? `<div class="fsec"><h3 class="lbl">${g.label}</h3><div class="fchips">${tags.map(tagChip).join("")}</div>${tags.includes(tagMenu) ? menu(tagMenu) : ""}</div>` : "";
  });
  const extra = tagCounts.filter((t) => !(t.tag in GROUP_OF) && t.n >= 2).sort((a, b) => b.n - a.n).map((t) => t.tag).slice(0, 24);
  for (const t of Object.keys(S.tags)) if (!(t in GROUP_OF) && !extra.includes(t)) extra.push(t);
  if (extra.length) groups.push(`<div class="fsec"><h3 class="lbl">Features and more</h3><div class="fchips">${extra.map(tagChip).join("")}</div>${extra.includes(tagMenu) ? menu(tagMenu) : ""}</div>`);
  $("filtBody").innerHTML = `
    <div class="fsec"><h3 class="lbl">Price</h3>
      <label class="rng">People sharing<input type="range" id="fPpl" min="1" max="4" step="1" value="${S.ppl}"><output id="fPplo">${pplTxt}</output></label>
      <label class="rng">Max per person<input type="range" id="fMax" min="300" max="2500" step="25" value="${S.max}"><output id="fMaxo">${S.max >= 2500 ? "No limit" : eur(S.max)}</output></label>
      <p class="why">A whole place for several people is split over the people sharing (never more than the ad allows). With 2 or 3 people, places that allow fewer people are hidden.</p>
      <label class="toggle"><input type="checkbox" id="fCheap" ${S.cheap === "show" ? "checked" : ""}> Also show prices under €250 (usually typos)</label></div>
    <div class="fsec"><h3 class="lbl">Deposit</h3>
      <label class="rng">Max deposit<input type="range" id="fDep" min="0" max="5000" step="250" value="${S.depMax}"><output id="fDepo">${S.depMax ? eur(S.depMax) : "Any"}</output></label>
      <label class="toggle"><input type="checkbox" id="fDepLegal" ${S.depLegal ? "checked" : ""}> Hide deposits above 2 months' rent (not allowed in new contracts)</label>
      <label class="toggle"><input type="checkbox" id="fDepKnown" ${S.depKnown ? "checked" : ""}> Hide listings that don't state a deposit</label></div>
    <div class="fsec"><h3 class="lbl">Type</h3><div class="fchips" data-m="kindF">${[["room","Rooms"],["studio","Studios"],["apartment","Apartments"]].map(([k, t]) => `<button class="chip" type="button" data-k="${k}" ${on(S.kindF, k)}>${t}</button>`).join("")}</div></div>
    <div class="fsec"><h3 class="lbl">Site</h3><div class="fchips" data-m="srcF">${[...(sites?.sites || [{ site: "kamernet", name: "Kamernet" }]).map((x) => [x.site, x.name]), ["manual", "Added by you"]].map(([k, t]) => `<button class="chip" type="button" data-k="${esc(k)}" ${on(S.srcF, k)}>${esc(t)}</button>`).join("")}</div></div>
    <div class="fsec"><h3 class="lbl">Registration at the address</h3><div class="fchips" data-m="regF">${[["ok","Allowed"],["unknown","Not stated"],["not","Not allowed"]].map(([k, t]) => `<button class="chip" type="button" data-k="${k}" ${on(S.regF, k)}>${t}</button>`).join("")}</div></div>
    <div class="fsec"><h3 class="lbl">AI summary</h3><div class="fchips" data-one="dist">${[["any","Any"],["yes","Has one"],["no","Not yet"]].map(([k, t]) => `<button class="chip" type="button" data-k="${k}" aria-pressed="${S.dist === k}">${t}</button>`).join("")}</div></div>
    <div class="fsec"><label class="toggle"><input type="checkbox" id="fFresh" ${S.hideContacted ? "checked" : ""}> Only places I haven't contacted yet</label>
      <label class="field">Street or city name contains<input type="search" id="fQ" value="${esc(S.q)}" placeholder="e.g. Kralingse"></label></div>
    <div class="fsec"><h3 class="lbl">Rules, language and features</h3><p class="why">Tap one to choose: <b>Must have</b> (green ✓) or <b>Hide these</b> (red ✕). Numbers are how many listings have it.</p></div>
    ${groups.join("")}`;
}
$("filtBody").addEventListener("click", (e) => {
  const tag = e.target.closest("[data-tag]"), set = e.target.closest("[data-tagset]");
  if (tag){ tagMenu = tagMenu === tag.dataset.tag ? null : tag.dataset.tag; renderFilters(); return; }
  if (set){ const v = set.dataset.tagset; if (v) S.tags[tagMenu] = v; else delete S.tags[tagMenu]; tagMenu = null; persist(); renderFilters(); filtersChanged(); return; }
  const c = e.target.closest(".chip"); if (!c) return;
  const box = c.parentElement;
  if (box.dataset.m){ const m = S[box.dataset.m], k = c.dataset.k; m[k] ? delete m[k] : (m[k] = "in"); }
  else if (box.dataset.one) S[box.dataset.one] = c.dataset.k;
  persist(); renderFilters(); filtersChanged();
});
$("filtBody").addEventListener("input", (e) => {
  if (e.target.id === "fPpl"){ S.ppl = +e.target.value; $("fPplo").textContent = S.ppl >= 4 ? "Up to 4" : S.ppl === 1 ? "Just me" : `${S.ppl} people`; }
  if (e.target.id === "fMax"){ S.max = +e.target.value; $("fMaxo").textContent = S.max >= 2500 ? "No limit" : eur(S.max); }
  if (e.target.id === "fDep"){ S.depMax = +e.target.value; $("fDepo").textContent = S.depMax ? eur(S.depMax) : "Any"; }
  if (e.target.id === "fQ"){ S.q = e.target.value; clearTimeout(renderFilters.t); renderFilters.t = setTimeout(() => { persist(); filtersChanged(); }, 400); }
});
$("filtBody").addEventListener("change", (e) => {
  if (e.target.id === "fCheap") S.cheap = e.target.checked ? "show" : "hide";
  if (e.target.id === "fFresh") S.hideContacted = e.target.checked;
  if (e.target.id === "fDepLegal") S.depLegal = e.target.checked;
  if (e.target.id === "fDepKnown") S.depKnown = e.target.checked;
  if (["fPpl", "fMax", "fCheap", "fFresh", "fDep", "fDepLegal", "fDepKnown"].includes(e.target.id)){ persist(); filtersChanged(); }
});
async function loadTags(){ try { tagCounts = await (await rest("tag_counts?select=tag,n&order=n.desc&limit=200")).json(); } catch {} }

// ---- Location: one place + a distance, like Kamernet. Places come from our own cities and from PDOK
//      (the Dutch government's free address search: towns, neighbourhoods, streets, postcodes, addresses). ----
const KMS = [1, 2, 5, 10, 20, 30];
const PDOK_TYPE = { woonplaats: "town", wijk: "district", buurt: "neighbourhood", weg: "street", postcode: "postcode", adres: "address" };
async function loadCities(){
  try { cityList = await (await rest("city_counts?select=city,n,lat,lng,r&order=n.desc")).json(); } catch { return; }
  if (S.loc?.city && (S.loc.lat == null || S.loc.r == null)){ // a city picked before its middle point was known
    const c = cityList.find((x) => x.city === S.loc.city);
    if (c){ Object.assign(S.loc, { lat: c.lat, lng: c.lng, r: c.r }); persist(); if (S.loc.km > 0) load(true); }
  }
  renderLoc();
}
function renderLoc(){
  const L0 = S.loc, inp = $("locq");
  if (document.activeElement !== inp) inp.value = L0 ? L0.name : "";
  inp.classList.toggle("set", !!L0);
  const opts = L0 ? [] : [["", "Anywhere"]];
  if (L0?.city) opts.push(["0", "Only this city"]);
  const kms = [...KMS]; if (L0?.km > 0 && !kms.includes(L0.km)) kms.push(L0.km); kms.sort((a, b) => a - b);
  for (const k of kms) opts.push([String(k), L0?.city ? `+ ${k} km around` : `Within ${k} km`]);
  $("locr").innerHTML = opts.map(([v, t]) => `<option value="${v}" ${String(L0 ? L0.km : "") === v ? "selected" : ""}>${t}</option>`).join("");
  $("locr").disabled = !L0;
  const quick = CITIES.filter((c) => !cityList.length || cityList.some((x) => x.city === c));
  $("cities").innerHTML = `<button class="chip" type="button" data-c="@me" aria-pressed="${L0?.name === "Near me"}">📍 Near me</button>`
    + quick.map((c) => `<button class="chip" type="button" data-c="${esc(c)}" aria-pressed="${L0?.city === c}">${esc(c)}</button>`).join("")
    + (L0 ? `<button class="chip" type="button" data-c="">✕ Anywhere</button>` : "");
}
function setLoc(p){
  const prev = KMS.includes(S.loc?.km) ? S.loc.km : null; // keep the distance you chose, but not an odd "Search this area" one
  S.loc = p && { name: p.name, lat: p.lat, lng: p.lng, ...(p.city ? { city: p.city, r: p.r } : {}), km: p.km ?? prev ?? (p.city ? 0 : 2) };
  persist(); renderLoc(); load(true);
}
$("cities").onclick = (e) => {
  const b = e.target.closest(".chip"); if (!b) return; const c = b.dataset.c;
  if (c === "@me") return nearMe(b);
  if (!c || S.loc?.city === c) return setLoc(null);
  const x = cityList.find((y) => y.city === c);
  setLoc({ name: c, city: c, lat: x?.lat, lng: x?.lng, r: x?.r });
};
$("locr").onchange = (e) => { if (!S.loc) return; S.loc.km = Number(e.target.value); persist(); renderLoc(); load(true); };
function nearMe(b){
  if (!navigator.geolocation) return toast("This browser can't share your location.", null, true);
  b.textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition(
    (pos) => setLoc({ name: "Near me", lat: +pos.coords.latitude.toFixed(5), lng: +pos.coords.longitude.toFixed(5) }),
    () => { renderLoc(); toast("Couldn't get your location. Allow location for this site, or type a place.", null, true); },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
}
let sugTimer, sugSeq = 0, sugItems = [];
const hideSugg = () => { $("locsugg").hidden = true; sugItems = []; };
function showSugg(items, busy){
  sugItems = items;
  $("locsugg").innerHTML = items.map((x, i) => `<button type="button" role="option" data-i="${i}"><span>${esc(x.name)}</span><small>${esc(x.sub || "")}</small></button>`).join("")
    || `<button type="button" disabled><span>${busy ? "Searching…" : "No place found"}</span></button>`;
  $("locsugg").hidden = false;
}
async function suggest(q){
  const my = ++sugSeq, lq = q.toLowerCase();
  const local = cityList.filter((c) => c.city.toLowerCase().includes(lq))
    .sort((a, b) => (b.city.toLowerCase().startsWith(lq) - a.city.toLowerCase().startsWith(lq)) || b.n - a.n).slice(0, 4)
    .map((c) => ({ name: c.city, city: c.city, lat: c.lat, lng: c.lng, r: c.r, sub: plural(c.n, "listing") }));
  showSugg(local, true);
  let far = [];
  try {
    const u = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/suggest?rows=7&fl=weergavenaam,type,centroide_ll,woonplaatsnaam&fq="
      + encodeURIComponent("type:(woonplaats OR wijk OR buurt OR weg OR postcode OR adres)") + "&q=" + encodeURIComponent(q);
    const d = await (await fetch(u)).json();
    far = (d.response?.docs || []).map((x) => {
      const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(x.centroide_ll || "");
      if (!m || (x.type === "woonplaats" && local.some((l) => l.city === x.woonplaatsnaam))) return null;
      return { name: x.type === "woonplaats" ? x.woonplaatsnaam : x.weergavenaam, lat: +(+m[2]).toFixed(5), lng: +(+m[1]).toFixed(5), sub: PDOK_TYPE[x.type] || x.type };
    }).filter(Boolean);
  } catch {}
  if (my !== sugSeq) return;
  showSugg([...local, ...far], false);
}
$("locq").addEventListener("input", (e) => {
  clearTimeout(sugTimer); const q = e.target.value.trim();
  if (!q){ hideSugg(); if (S.loc) setLoc(null); return; }
  sugTimer = setTimeout(() => suggest(q), 220);
});
$("locq").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && sugItems.length){ e.preventDefault(); const p = sugItems[0]; hideSugg(); $("locq").blur(); setLoc(p); }
  if (e.key === "Escape"){ hideSugg(); $("locq").blur(); }
});
$("locq").addEventListener("blur", () => setTimeout(() => { hideSugg(); renderLoc(); }, 200));
$("locsugg").addEventListener("pointerdown", (e) => e.preventDefault()); // keep the box focused until the tap lands
$("locsugg").onclick = (e) => { const b = e.target.closest("button[data-i]"); if (!b) return; const p = sugItems[+b.dataset.i]; hideSugg(); $("locq").blur(); setLoc(p); };

// ---- Map: every listing that matches as a price pin (Leaflet + OpenStreetMap, loaded the first time you open it) ----
let mapLib = null, map = null, pins = null, area = null, mapKey = "", fitting = false, mapToken = 0;
const MAPSEL = "id,price,people,per_person,street,city,kind,size_m2,photos,lat:facts->>lat,lng:facts->>lng";
const NL = [52.15, 5.3];
function cdn(tag, attrs){ return new Promise((ok, bad) => { const e = document.createElement(tag); Object.assign(e, attrs); e.onload = ok; e.onerror = () => bad(new Error("the map didn't load")); document.head.appendChild(e); }); }
function ensureLeaflet(){
  const C = "https://cdnjs.cloudflare.com/ajax/libs/";
  return mapLib ||= (async () => {
    cdn("link", { rel: "stylesheet", href: C + "leaflet/1.9.4/leaflet.css" }).catch(() => {});
    cdn("link", { rel: "stylesheet", href: C + "leaflet.markercluster/1.5.3/MarkerCluster.css" }).catch(() => {});
    await cdn("script", { src: C + "leaflet/1.9.4/leaflet.js" });
    await cdn("script", { src: C + "leaflet.markercluster/1.5.3/leaflet.markercluster.js" });
  })().catch((e) => { mapLib = null; throw e; });
}
const isDark = () => document.documentElement.dataset.theme === "dark" || (document.documentElement.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
async function initMap(){
  await ensureLeaflet();
  if (map) return;
  map = L.map("map", { center: NL, zoom: 7, zoomSnap: 0.5 });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  $("map").classList.toggle("darkmap", isDark()); // OpenStreetMap has no dark tiles: the dark look is a colour filter
  pins = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45, spiderfyOnMaxZoom: true,
    iconCreateFunction: (c) => L.divIcon({ html: `<div class="clu">${c.getChildCount()}</div>`, className: "", iconSize: [36, 36] }) }).addTo(map);
  area = L.layerGroup().addTo(map);
  map.on("dragend", () => { $("maparea").hidden = false; }); // after you move the map yourself, offer to search exactly there
  map.on("zoomend", () => { if (!fitting) $("maparea").hidden = false; });
  map.on("popupopen", (e) => { const b = e.popup.getElement()?.querySelector(".mopen"); if (b) b.onclick = () => openListing(Number(b.dataset.id)); });
}
function pinClass(id){
  id = String(id);
  if (isClosed(id)) return "shut";
  if (stOf(id).opinion === "want") return "want";
  return STAGES.indexOf(stageOf(id)) >= 1 ? "lead" : "";
}
function popHtml(r){
  r = eff(r);
  const pp = ppOf(r), d = divisor(r), t = distTxt(r);
  return `<div class="mpop">${r.photos?.[0] ? `<div class="ph" style="background-image:url('${esc(r.photos[0])}')"></div>` : ""}
    <b>${esc(r.street || "A listing")}</b><span>${esc([r.city, cap(r.kind || ""), r.size_m2 ? r.size_m2 + " m²" : ""].filter(Boolean).join(" · "))}</span>
    <span><span class="pp">${eur(pp ?? r.price)}</span>${d > 1 ? ` per person (${eur(r.price)} for ${d})` : r.people == null ? "" : " a month"}</span>
    ${t ? `<small class="dist">${esc(t)}</small>` : ""}
    <button class="btn small mopen" type="button" data-id="${r.id}">Open</button></div>`;
}
async function loadMap(force){
  const my = ++mapToken, key = base() + qs([]) + S.ppl;
  try {
    await initMap();
    setTimeout(() => map.invalidateSize(), 0);
    if (!force && key === mapKey) return; // same filters as what's drawn: keep the map where it is
    $("mapnote").textContent = "Loading the map…";
    const res = await rest(`${base()}select=${MAPSEL}&${qs(["limit=3000"])}`, { Prefer: "count=exact" });
    const rows = await res.json();
    if (my !== mapToken) return;
    drawMap(rows.filter((r) => r.lat != null && r.lng != null), countOf(res, rows.length));
    mapKey = key;
  } catch (e) { if (my === mapToken) $("mapnote").textContent = "Couldn't load the map: " + e.message; }
}
function drawMap(rows, all){
  pins.clearLayers(); area.clearLayers(); map.closePopup();
  pins.addLayers(rows.map((r) => {
    const p = ppOf(eff(r)) ?? eff(r).price;
    return L.marker([+r.lat, +r.lng], { title: r.street || "", icon: L.divIcon({ className: "pinw", iconSize: [0, 0], html: `<span class="pin ${pinClass(r.id)}">${p != null ? eur(p) : "?"}</span>` }) })
      .bindPopup(() => popHtml(r), { maxWidth: 260, minWidth: 220, autoPanPadding: [16, 16] });
  }));
  let b = null;
  if (nearOn()) b = L.circle([S.loc.lat, S.loc.lng], { radius: areaKm() * 1000, color: cssVar("--accent"), weight: 1.5, fillOpacity: 0.05, interactive: false }).addTo(area).getBounds();
  if (S.loc?.lat != null) L.marker([S.loc.lat, S.loc.lng], { interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: '<div class="here"></div>', iconSize: [14, 14] }) }).addTo(area);
  if (!b && rows.length) b = pins.getBounds();
  fitting = true; $("maparea").hidden = true;
  if (b?.isValid()) map.fitBounds(b, { padding: [24, 24], maxZoom: 15 }); else map.setView(NL, 7);
  setTimeout(() => { fitting = false; }, 700);
  const missing = all - rows.length;
  $("mapnote").textContent = `${rows.length.toLocaleString("en-GB")} on the map${missing > 0 ? ` · ${missing} without an address aren't shown (see List)` : ""}`;
}
$("maparea").onclick = () => {
  const c = map.getCenter(), b = map.getBounds();
  const m = Math.min(c.distanceTo([b.getNorth(), c.lng]), c.distanceTo([c.lat, b.getEast()]));
  setLoc({ name: "Map area", lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5), km: Math.max(0.5, Math.round(m / 100) / 10) });
};
function applyView(){
  const v = S.view;
  $("viewList").setAttribute("aria-pressed", String(v === "list")); $("viewMap").setAttribute("aria-pressed", String(v === "map"));
  $("mapwrap").hidden = v !== "map"; $("list").hidden = v === "map"; $("more").hidden = v === "map" || loaded.length >= total;
  if (v === "map") loadMap();
}
$("viewList").onclick = () => { S.view = "list"; persist(); applyView(); };
$("viewMap").onclick = () => { S.view = "map"; persist(); setSelect(false); applyView(); };

// ---- Selecting several listings: write messages for them, or get AI summaries ----
const picked = new Set();
let selecting = false, eligible = [];
const MAX_WRITE = 60, MAX_AI = 25;
const BLOCKING = "students-only,women-only,dutch-only,offsite-contact,scam-risk";
function setSelect(on){
  selecting = on; document.body.classList.toggle("selecting", on);
  $("selbar").hidden = !on; $("selbtn").textContent = on ? "Done" : "Select";
  if (!on){ picked.clear(); document.querySelectorAll(".card.picked").forEach((c) => c.classList.remove("picked")); }
  else { if (S.view === "map"){ S.view = "list"; persist(); applyView(); } refreshEligible(); }
  syncSelect();
}
$("selbtn").onclick = () => setSelect(!selecting);
$("selcancel").onclick = () => setSelect(false);
function syncSelect(){
  if (!selecting) return;
  const n = picked.size;
  const toWrite = [...picked].filter((id) => !isClosed(String(id)) && stageOf(String(id)) === "none").length;
  $("selcount").textContent = n ? `${plural(n, "listing")} selected` : "Tap listings to select them";
  $("selhint").innerHTML = n
    ? `${toWrite < n ? `${n - toWrite} already contacted (skipped). ` : ""}${toWrite > MAX_WRITE ? `Messages are written for the first ${MAX_WRITE}. ` : ""}Nothing is sent.`
    : `Or <button class="linkbtn" type="button" id="selall">select all ${Math.min(loaded.length, 300)} shown</button>.`;
  $("selwrite").textContent = toWrite ? `Write ${Math.min(toWrite, MAX_WRITE)} message${toWrite === 1 ? "" : "s"}` : "Write messages";
  $("selwrite").disabled = !toWrite;
  const noAi = n ? [...picked].filter((id) => !cache[id]?.distilled_at).length : 0;
  $("selai").textContent = n ? (noAi ? `AI summary for ${Math.min(noAi, MAX_AI)}` : "All have AI summaries") : "AI summary: next 25";
  $("selai").disabled = n > 0 && !noAi;
  $("selpick").textContent = eligible.length ? `Pick ${Math.min(10, eligible.length)} good matches` : "No good matches here";
  $("selpick").disabled = !eligible.length;
}
$("selhint").addEventListener("click", (e) => {
  if (e.target.id !== "selall") return;
  for (const r of loaded) picked.add(r.id);
  renderList();
});
async function refreshEligible(){
  try {
    const rows = await (await rest(`${base()}select=id&${qs(["distilled_at=not.is.null", `all_tags=not.ov.{${BLOCKING}}`, "people=lte.2", "limit=80"])}`)).json();
    eligible = rows.map((r) => r.id).filter((id) => stageOf(String(id)) === "none" && !isClosed(String(id)));
  } catch { eligible = []; }
  syncSelect();
}
$("selpick").onclick = () => {
  const ids = eligible.filter((id) => !picked.has(id)).slice(0, 10);
  ids.forEach((id) => picked.add(id)); renderList();
  toast(`Selected ${plural(ids.length, "good match", "good matches")}: they have an AI summary, you haven't contacted them, they're for 1–2 people and not students-only, women-only, Dutch-only or risky. Untick any you don't want.`);
};
$("selwrite").onclick = async () => {
  const todo = [...picked].filter((id) => !isClosed(String(id)) && stageOf(String(id)) === "none").slice(0, MAX_WRITE);
  const ok = await confirmBox({ title: `Write ${plural(todo.length, "message")}?`, ok: "Write them",
    body: `<p>Claude writes a first message for each, in your style (about ${euro(todo.length * 0.0012)} in total). <b>Nothing is sent.</b> They land in your Inbox, where you check each one and send it yourself.</p>${todo.some((id) => draftOf(id)) ? "<p class='why'>Places that already have a message keep it.</p>" : ""}` });
  if (!ok) return;
  await writeFor(todo);
};
async function writeFor(ids){
  let done = 0, bad = 0, cost = 0, lastErr = "";
  for (let i = 0; i < ids.length; i += 10){
    toast(`Writing messages ${i + 1}–${Math.min(i + 10, ids.length)} of ${ids.length}…`);
    try {
      const r = await post("apply", { ids: ids.slice(i, i + 10), reuse: true });
      for (const d of r.drafts || []) { if (d.error){ bad++; lastErr = d.error; } else done++; }
      cost += r.total_cost_usd || 0;
    } catch (e) { bad += Math.min(10, ids.length - i); lastErr = e.message; }
  }
  await loadDrafts(); setSelect(false); renderAll();
  toast(`${plural(done, "message")} ready in your Inbox${bad ? `, ${bad} failed (${lastErr})` : ""} · cost ${euro(cost)}`, done ? { label: "Open Inbox", fn: () => showTab("inbox") } : null, !!bad && !done);
}
$("selai").onclick = async () => {
  let ids = picked.size ? [...picked].filter((id) => !cache[id]?.distilled_at).slice(0, MAX_AI) : null;
  if (!ids){
    try { ids = (await (await rest(`${base()}select=id&${qs(["distilled_at=is.null", `limit=${MAX_AI}`])}`)).json()).map((r) => r.id); } catch (e) { return fail(e); }
    if (!ids.length) return toast("Everything in this list already has an AI summary.");
  }
  const ok = await confirmBox({ title: `AI summary for ${plural(ids.length, "listing")}?`, ok: "Read them",
    body: `<p>The AI reads each ad and sorts everything it says into requirements, house rules, costs, features and red flags, so you can compare quickly. About ${euro(ids.length * 0.002)}, ${Math.max(10, ids.length)} seconds.</p>` });
  if (!ok) return;
  await summarize(ids);
  setSelect(false);
};
async function summarize(ids){
  toast(`Reading ${plural(ids.length, "listing")}…`);
  try {
    const r = await post("distill", { ids });
    await Promise.all([reloadList(), headline(), loadTags()]);
    for (const id of ids) if (cache[id]) await refreshRow(id);
    toast(`${plural(r.distilled, "AI summary", "AI summaries")} done${r.failed?.length ? `, ${r.failed.length} failed (${r.failed[0].error})` : ""} · cost ${euro(r.total_cost_usd)}`, null, !!r.failed?.length && !r.distilled);
  } catch (e) { toast("AI summary failed: " + e.message, null, true); }
}

// =====================================================================================
// MY LEADS
// =====================================================================================
function leadIds(){
  return [...new Set([...Object.keys(statuses), ...Object.keys(threads), ...Object.keys(deals), ...unsent().map((d) => String(d.listing_id))])];
}
async function ensureRows(ids){
  const need = ids.filter((id) => !cache[id]);
  for (let i = 0; i < need.length; i += 80){
    try { for (const r of await (await rest(`listings?select=${SELECT}&id=in.(${need.slice(i, i + 80).join(",")})`)).json()) cache[r.id] = r; } catch {}
  }
}
async function refreshRows(ids){ // fetch these cards again (an AI summary or a check may have changed them)
  for (let i = 0; i < ids.length; i += 80){
    try { for (const r of await (await rest(`listings?select=${SELECT}&id=in.(${ids.slice(i, i + 80).join(",")})`)).json()) cache[r.id] = r; } catch {}
  }
}
async function refreshRow(id){
  try { const [r] = await (await rest(`listings?select=${SELECT}&id=eq.${id}`)).json(); if (r) cache[r.id] = r; } catch {}
}
const lastAt = (id) => Math.max(Date.parse(threads[id]?.last_at || 0) || 0, Date.parse(stOf(id).updated_at || 0) || 0);
function moveReason(id){
  if (needsVerdict(id)) return ["You viewed it " + (stOf(id).viewing_at ? dayTxt(stOf(id).viewing_at) : "") + ". How was it?", "How was it?", "status"];
  if (needsReply(id)) return [`They wrote ${ago(threads[id].last_at)}: “${threads[id].last_body.slice(0, 110)}${threads[id].last_body.length > 110 ? "…" : ""}”`, draftOf(id) ? "Check my reply" : "Reply", "draft"];
  if (payToApprove(id)) return ["A payment is waiting for your OK.", "Check the payment", "deal"];
  if (draftReady(id)) return [draftOf(id).kind === "reply" ? "Your reply is written and ready to send." : "Your first message is written and ready to send.", "Check and send", "draft"];
  return ["", "Open", ""];
}
function leadCard(id, why, btn, sec, cls = ""){
  const r = cache[id] || { id, street: "A listing", city: "" };
  return `<article class="lead ${cls}" data-id="${id}" data-sec="${sec}" tabindex="0" role="button">
    ${thumb(r)}
    <div class="cardtop"><span class="street">${esc(r.street)}</span>${r.price ? priceHtml(r) : ""}</div>
    <div class="badges">${statePill(id)}<span class="badge">${esc(r.city || "")}</span></div>
    ${why ? `<div class="why">${esc(why)}</div>` : ""}
    ${btn ? `<button class="btn small nextb" type="button">${esc(btn)}</button>` : ""}
  </article>`;
}
function agendaItems(){
  const now = Date.now(), items = [];
  for (const [id, x] of Object.entries(statuses)) {
    if (isClosed(id) || !x.viewing_at) continue;
    const t = Date.parse(x.viewing_at);
    if (t > now - 2 * 3600000 && t < now + 14 * 86400000) items.push({ id, t, what: "Viewing", sec: "status" });
  }
  for (const [id, d] of Object.entries(deals)) {
    if (isClosed(id)) continue;
    for (const p of d.payments || []) if (p.status !== "paid" && p.due) items.push({ id, t: Date.parse(p.due + "T12:00:00"), day: true, what: `Pay ${eur(p.amount)} ${p.what}${p.status === "approved" ? "" : " (needs your OK)"}`, sec: "deal" });
    if (d.after?.reg_appt && !d.after?.registered) items.push({ id, t: Date.parse(d.after.reg_appt), what: "Registration appointment", sec: "deal" });
    if (d.after?.move_in) items.push({ id, t: Date.parse(d.after.move_in + "T12:00:00"), day: true, what: "Move in", sec: "deal" });
  }
  return items.filter((i) => i.day ? i.t > now - 86400000 : true).sort((a, b) => a.t - b.t).slice(0, 15);
}
let leadsToken = 0;
async function renderLeads(){
  const my = ++leadsToken, ids = leadIds();
  await ensureRows(ids);
  if (my !== leadsToken) return;
  const open = ids.filter((id) => !isClosed(id));
  const move = open.filter(yourMove).sort((a, b) => lastAt(b) - lastAt(a));
  const rest_ = open.filter((id) => !move.includes(id));
  const dealsL = rest_.filter((id) => ["offer", "signed"].includes(stageOf(id)));
  const waiting = rest_.filter((id) => ["applied", "replied", "booked", "viewed"].includes(stageOf(id))).sort((a, b) => lastAt(b) - lastAt(a));
  const saved = rest_.filter((id) => stageOf(id) === "none" && !dealsL.includes(id));
  const closed = ids.filter(isClosed).sort((a, b) => lastAt(b) - lastAt(a));
  const ag = agendaItems(), views = ag.filter((i) => i.what === "Viewing");
  const group = (title, note, html) => html ? `<section class="group"><h2>${title}${note ? ` <small>${note}</small>` : ""}</h2>${html}</section>` : "";
  const waitWhy = (id) => {
    const t = threads[id], sg = stageOf(id);
    if (sg === "booked" && stOf(id).viewing_at) return `Viewing ${when(stOf(id).viewing_at)}`;
    return t ? `You wrote ${ago(t.last_at)}. Waiting for their answer.` : `${STAGE_LABEL[sg]}${stOf(id).updated_at ? " · " + ago(stOf(id).updated_at) : ""}`;
  };
  $("leadsub").textContent = `${plural(open.length, "open lead")}${move.length ? ` · ${move.length} need you` : ""}`;
  $("leads").innerHTML =
    group("Your move", move.length ? "" : null, move.map((id) => { const [w, b, s] = moveReason(id); return leadCard(id, w, b, s, "move"); }).join(""))
    + group("Coming up", "", ag.map((i) => {
        const r = cache[i.id] || {}, clash = i.what === "Viewing" && views.some((v) => v !== i && Math.abs(v.t - i.t) < 90 * 60000);
        return `<div class="agrow${clash ? " clash" : ""}" data-id="${i.id}" data-sec="${i.sec}" role="button" tabindex="0"><b>${esc(i.day ? dayTxt(i.t) : when(i.t))}</b><span>${esc(i.what)}: ${esc(r.street || "a listing")}${r.city ? ", " + esc(r.city) : ""}${clash ? " · <b>clashes with another viewing</b>" : ""}</span></div>`;
      }).join(""))
    + group("Offers and deals", "", dealsL.map((id) => leadCard(id, stageOf(id) === "signed" ? "Signed. Next: move in and register." : "They offered it. Check the contract and payments before you sign.", "Open the deal", "deal")).join(""))
    + group("Waiting on them", `${waiting.length}`, waiting.map((id) => leadCard(id, waitWhy(id), "", "conv")).join(""))
    + group("Saved", "you liked these but haven't written yet", saved.map((id) => leadCard(id, "", draftOf(id) ? "" : "Write a message", "draft")).join(""))
    + (closed.length ? `<details class="group"><summary>Closed (${closed.length})</summary>${closed.map((id) => leadCard(id, CLOSED_LABEL[stOf(id).closed] || "Not for me", "", "status")).join("")}</details>` : "")
    || `<div class="empty"><b>No leads yet.</b><span>Find a place, open it and write them a message. It shows up here.</span><button class="btn" type="button" data-goto="find">Find a place</button></div>`;
  renderBadges();
}
function leadTap(e){
  const g = e.target.closest("[data-goto]"); if (g) return showTab(g.dataset.goto);
  const c = e.target.closest("[data-id]"); if (!c) return;
  if (e.type === "keydown" && e.key !== "Enter") return;
  openListing(Number(c.dataset.id), c.dataset.sec);
}
$("leads").addEventListener("click", leadTap); $("leads").addEventListener("keydown", leadTap);

// =====================================================================================
// INBOX
// =====================================================================================
async function renderInbox(){
  const ds = unsent().filter((d) => !isClosed(String(d.listing_id)));
  await ensureRows(ds.map((d) => String(d.listing_id)));
  const latest = Object.entries(threads).filter(([id, t]) => t.last_dir === "in" && !isClosed(id)).sort((a, b) => Date.parse(b[1].last_at) - Date.parse(a[1].last_at)).slice(0, 15);
  await ensureRows(latest.map(([id]) => id));
  const sending = ds.filter(isSending);
  $("inboxsub").textContent = `${plural(ds.length - sending.length, "message")} to send${inbox?.open.length ? ` · ${inbox.open.length} to sort` : ""}`;
  const dcard = (d) => {
    const r = cache[d.listing_id] || {}, ch = chanOf(d), st = isSending(d) ? (d.send_status.startsWith("kn_") ? `Sending (${CHAN[ch] || ch})…` : "Sending by email…") : d.send_status === "failed" ? "Couldn't send: open it" : `${d.kind === "reply" ? "Reply" : "First message"} · ${CHAN[ch] || ch}`;
    return `<article class="lead${d.send_status === "failed" ? " move" : ""}" data-id="${d.listing_id}" data-sec="draft" tabindex="0" role="button">${thumb(r)}
      <div class="cardtop"><span class="street">${esc(r.street || "A listing")}</span></div>
      <div class="badges"><span class="badge stage">${esc(st)}</span><span class="badge">${esc(r.city || "")}</span></div>
      <div class="why">${esc(d.draft.slice(0, 140))}${d.draft.length > 140 ? "…" : ""}</div></article>`;
  };
  const src = (i) => i.source === "whatsapp" ? `WhatsApp from ${esc(i.sender)}` : i.source === "email" ? `Email from ${esc(i.sender)}` : `Kamernet email${i.subject ? ": " + esc(i.subject) : ""}`;
  $("inboxv").innerHTML = [
    inbox?.open.length ? `<section class="group"><h2>Which place is this about?</h2><p class="why">These messages came in but couldn't be matched to a place. Find it, tap it, and Claude files it and writes a reply.</p>${inbox.open.map((i) => `<div class="ib" data-iid="${i.id}">
      <div><b>${src(i)}</b> · ${esc(when(i.created_at))}${i.summary ? " · " + esc(i.summary) : ""}</div>
      ${i.state === "error" ? `<div>Couldn't read it automatically. Picking the place tries again.</div>` : ""}
      <div class="body">${esc(i.body || "")}</div>
      <div class="row"><input class="ifind" placeholder="Street name"><button class="btn small ifindb" type="button">Find</button></div>
      <div class="btnrow icands"></div><div class="btnrow"><button class="btn ghost small danger iign" type="button">Not about housing</button><small class="ist why"></small></div></div>`).join("")}</section>` : "",
    `<section class="group"><h2>Ready to send <small>${ds.length ? "check each one, then send it" : ""}</small></h2>${sendAllPlan(ds).go.length ? `<div class="btnrow"><button class="btn small sendall" type="button">Send all (${sendAllPlan(ds).go.length})</button></div>` : ""}${ds.length ? ds.map(dcard).join("") : '<p class="why">Nothing waiting. Messages Claude writes for you land here.</p>'}</section>`,
    latest.length ? `<section class="group"><h2>Latest from landlords</h2>${latest.map(([id, t]) => leadCard(id, `${ago(t.last_at)} via ${CHAN[t.last_channel] || t.last_channel}: “${t.last_body.slice(0, 120)}${t.last_body.length > 120 ? "…" : ""}”`, "", "conv")).join("")}</section>` : "",
  ].join("");
  renderBadges();
}
// Send all (Asa, 25 Oct 2026): one tap sends EVERY ready draft. Email through the Gmail script; Kamernet, WhatsApp (WhatsApp
// Web; Asa accepts the ban risk) and the ad's own contact form through the helper in Chrome on his PC, one at a time. Drafts with
// [YOUR ANSWER …] are filled in by Claude first (replydraft fill). Only a draft with no way to reach the landlord stays.
function sendAllPlan(ds){
  const go = [], skip = [];
  for (const d of ds){
    if (isSending(d)) continue;
    const ch = chanOf(d), text = draftEdits[d.id] ?? d.draft, c = contacts[d.listing_id] || {};
    if (ch === "email" && c.email || ch === "kamernet" || ch === "whatsapp" && c.phone || ch === "site" && cache[d.listing_id]?.url) go.push([d, ch, text]);
    else skip.push([d, "no email, phone or link saved for the landlord"]);
  }
  return { go, skip };
}
async function sendAll(){
  const { go, skip } = sendAllPlan(unsent().filter((d) => !isClosed(String(d.listing_id))));
  if (!go.length) return toast("Nothing here can be sent: add the landlord's email or phone first.");
  const nm = (n) => plural(go.filter(([, ch]) => ch === n).length, "message");
  const pc = go.some(([, ch]) => ch !== "email"), fills = go.filter(([, , t]) => /\[YOUR ANSWER/i.test(t)).length;
  const parts = [["email", "by email"], ["kamernet", "on Kamernet"], ["whatsapp", "on WhatsApp"], ["site", "through the ad's own site"]].filter(([k]) => go.some(([, ch]) => ch === k)).map(([k, w]) => `${nm(k)} ${w}`);
  if (!await confirmBox({ title: `Send all ${go.length}?`, ok: "Send them all", body: `<p>${parts.join(", ")}. Email goes from your Gmail within a minute; the rest from Chrome on your PC, one every 20-40 seconds${pc && !knOnline() ? " (<b>your PC seems off</b>, so they go out once it's on)" : ""}.</p>${fills ? `<p>${plural(fills, "message")} still had [YOUR ANSWER …] parts: Claude fills them in from your facts first, or writes around what it doesn't know.</p>` : ""}${skip.length ? `<p class="why">Can't be sent, no way to reach the landlord saved: ${skip.map(([d]) => esc(cache[d.listing_id]?.street || "a listing")).join(", ")}.</p>` : ""}` })) return;
  let ok = 0; const bad = [];
  toast(`Sending ${plural(go.length, "message")}…`);
  for (let [d, ch, text] of go){
    try {
      if (/\[YOUR ANSWER/i.test(text)){
        await saveDraftNow(d.id);
        text = (await post("replydraft", { action: "redo", application_id: d.id, fill: true })).message;
      }
      await post(ch === "email" ? "deal" : "kn-send", ch === "email" ? { action: "send_email", application_id: d.id, draft: text } : { action: "queue", application_id: d.id, draft: text, channel: ch });
      delete draftEdits[d.id]; ok++;
    } catch (err) { bad.push(`${cache[d.listing_id]?.street || "a listing"}: ${err.message}`); }
  }
  if (pc) window.postMessage({ type: "kn-sender-poke" }, location.origin);
  await loadDrafts(); renderAll(); watchSending();
  toast(`${plural(ok, "message")} on the way.${bad.length ? " Couldn't send: " + bad.join("; ") : ""}${skip.length ? ` ${skip.length} have no landlord contact saved.` : ""}`, null, !!bad.length);
}
$("inboxv").addEventListener("click", async (e) => {
  if (e.target.closest(".sendall")) return sendAll();
  const it = e.target.closest(".ib");
  if (!it){ const c = e.target.closest("[data-id]"); if (c) openListing(Number(c.dataset.id), c.dataset.sec); return; }
  const iid = Number(it.dataset.iid), st = it.querySelector(".ist"), cands = it.querySelector(".icands");
  if (e.target.closest(".ifindb")){
    const q = it.querySelector(".ifind").value.trim(); if (!q) return;
    st.textContent = "Searching…";
    try {
      const r = await fn(`status?find=${encodeURIComponent(q)}`);
      st.textContent = r.candidates.length ? "Tap the right one:" : "No place with that street. Try part of the name.";
      cands.innerHTML = r.candidates.map((c) => `<button class="btn ghost small icand" data-lid="${c.id}" data-name="${esc(c.street)}" type="button">${esc(c.street)}, ${esc(c.city)} · ${eur(c.price)}${c.gone_at ? " · gone" : ""}</button>`).join("");
    } catch (err) { st.textContent = "Couldn't search: " + err.message; }
  } else if (e.target.closest(".icand")){
    const b = e.target.closest(".icand");
    if (!await confirmBox({ title: `File it under ${b.dataset.name}?`, ok: "Yes, file it", body: "<p>Claude adds it to that place's conversation and writes a reply for you to check. Nothing is sent.</p>" })) return;
    st.textContent = "Filing it and writing a reply…";
    try {
      await post("inbox", { action: "assign", inbox_id: iid, listing_id: Number(b.dataset.lid) });
      await Promise.all([loadStatuses(), loadThreads(), loadDrafts(), loadInbox()]); renderAll(); toast("Filed. The reply is in Ready to send.");
    } catch (err) { st.textContent = "Couldn't file it: " + err.message; }
  } else if (e.target.closest(".iign")){
    if (!await confirmBox({ title: "Not about housing?", ok: "Hide it", danger: true, body: "<p>It disappears from here for good.</p>" })) return;
    try { await post("inbox", { action: "ignore", inbox_id: iid }); await loadInbox(); renderInbox(); }
    catch (err) { st.textContent = "Couldn't hide it: " + err.message; }
  }
});
$("inboxv").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.closest(".ifind")) e.target.closest(".ib").querySelector(".ifindb").click();
  else if (e.key === "Enter" && e.target.closest("article[data-id]")) openListing(Number(e.target.closest("article").dataset.id), "draft");
});

// =====================================================================================
// THE LISTING PAGE: everything about one place
// =====================================================================================
let lpId = null;
const threadCache = {}, draftEdits = {};
async function openListing(id, sec){
  id = String(id); lpId = id;
  if (!cache[id]) await refreshRow(id);
  if (!cache[id]) return toast("Couldn't open that listing.", null, true);
  if (!$("lp").open) $("lp").showModal();
  $("lp").scrollTop = 0;
  if (location.hash !== `#l=${id}`) history.replaceState(null, "", `#l=${id}`);
  lpRender();
  loadThread(id); liveCheck(id);
  if (sec) setTimeout(() => { const el = $("lp-" + sec); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); }, 60);
}
$("lpBack").onclick = () => $("lp").close();
$("lp").addEventListener("close", () => { lpId = null; history.replaceState(null, "", location.pathname + location.search); renderAll(); reloadList(); });
function lpRender(){
  const id = lpId; if (!id) return;
  const r = eff(cache[id]), x = stOf(id), sg = stageOf(id), closed = isClosed(id), dl = r.distilled;
  const body = $("lp"), top = body.scrollTop;
  const open = [...$("lpBody").querySelectorAll("details[data-k][open]")].map((d) => d.dataset.k);
  $("lpTitle").textContent = r.street;
  const dt = distTxt(r), pp = ppOf(r), dv = divisor(r);
  $("lpBody").innerHTML = `
    ${(r.photos || []).length ? `<div class="photos">${r.photos.slice(0, 12).map((p) => `<img src="${esc(p)}" alt="" loading="lazy">`).join("")}</div>` : ""}
    <div class="lphead">
      <div class="lpprice">${priceHtml(r)}${r._mf?.price ? mfTag() : ""}${dv > 1 ? `<span class="why">${eur(r.price)} a month for ${dv}${dv < r.people ? ` (up to ${r.people} allowed)` : ""}</span>` : r.people == null ? '<span class="why">People allowed not stated</span>' : '<span class="why">a month</span>'}${r.deposit > 0 ? `<span class="why">· deposit ${eur(r.deposit)}</span>` : ""}</div>
      <div class="lpmeta"><span>${esc(r.city)}</span><span>${esc(cap(r.kind))}${r.size_m2 ? " · " + r.size_m2 + " m²" : ""}</span>${avail(r) ? `<span>${esc(avail(r))}${r._mf?.available_from || r._mf?.available_until ? " ✉" : ""}</span>` : ""}${r.posted ? `<span>${esc(postedTxt(r.posted))}</span>` : ""}${dt ? `<span class="dist">${esc(dt)}</span>` : ""}${r.gone_at && r.source !== "manual" ? `<span>No longer on ${esc(siteName(r.source))}</span>` : ""}</div>
      <div class="badges">${checkBadge(r)}${badgeList(r).map((t) => `<span class="badge ${toneOf(t)}">${esc(label(t))}</span>`).join("")}${r.reg === "unknown" ? '<span class="badge">Registration not stated</span>' : ""}</div>
      <div id="lpLive">${liveHtml(id)}</div>
      <div class="links"><a href="${esc(mapUrl(r))}" target="_blank" rel="noopener">Map ↗</a>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${r.source === "manual" ? "The ad ↗" : `On ${esc(siteName(r.source))} ↗`}</a>` : ""}</div>
      <div id="lpDups">${dupsHtml(id)}</div>
    </div>
    ${msgFactsHtml(r)}
    ${closed ? `<div class="closedbar"><span>Closed: ${esc(x.closed ? CLOSED_LABEL[x.closed] : "Not for me")}</span><button class="btn small ghost" type="button" data-a="reopen">Reopen</button></div>` : ""}
    ${needsVerdict(id) ? `<section class="sec hi" id="lp-verdict"><h3>You viewed it ${x.viewing_at ? esc(when(x.viewing_at)) : ""}. How was it?</h3>
      <div class="opts">${OPINIONS.map(([k, t], i) => `<button class="btn${i ? " ghost" : ""}" type="button" data-verdict="${k}">${t}</button>`).join("")}</div></section>` : ""}
    <section class="sec" id="lp-status"><h3>Where it stands</h3>
      <div class="stepper" role="group" aria-label="Progress">${STAGES.slice(1).map((k, i) => `<button type="button" class="step${i + 1 < STAGES.indexOf(sg) ? " done" : ""}${k === sg ? " now" : ""}" data-stage="${k}">${STAGE_LABEL[k]}</button>`).join("")}</div>
      <p class="why">${sg === "none" ? "Not contacted yet. This moves by itself when you send a message or they answer; tap a step to set it yourself." : "Moves by itself with your messages. Tap a step to correct it."}</p>
      <div><span class="lbl">My opinion</span><div class="opts">${OPINIONS.map(([k, t]) => `<button type="button" class="chip" data-op="${k}" aria-pressed="${x.opinion === k}">${t}</button>`).join("")}</div></div>
      <label class="field">Viewing (date and time)<div class="btnrow"><input type="datetime-local" id="lpView" value="${toLocalInput(x.viewing_at)}" style="flex:1">${x.viewing_at ? '<button class="btn ghost small" type="button" data-a="noview">Clear</button>' : ""}</div></label>
      ${closed ? "" : `<details data-k="close"${open.includes("close") ? " open" : ""}><summary>Close this lead…</summary><div class="opts" style="margin-top:6px">${Object.entries(CLOSED_LABEL).map(([k, t]) => `<button class="btn ghost small danger" type="button" data-close="${k}">${t}</button>`).join("")}</div></details>`}
    </section>
    <section class="sec" id="lp-draft">${draftSection(id)}</section>
    <section class="sec" id="lp-conv"><h3>Conversation${threads[id] ? ` <small class="why">${plural(threads[id].n, "message")}</small>` : ""}</h3>
      <div class="msgs" id="lpMsgs">${threadHtml(id)}</div>
      <details data-k="log"${open.includes("log") ? " open" : ""}><summary>Add a message you sent or got somewhere else</summary>
        <div class="draft" style="margin-top:6px"><textarea id="logBody" rows="3" placeholder="Paste the message here"></textarea>
        <div class="btnrow"><select id="logDir" style="width:auto"><option value="in">They wrote this</option><option value="out">I sent this</option></select>
          <select id="logChan" style="width:auto">${Object.entries(CHAN).map(([k, v]) => `<option value="${k}" ${(threads[id]?.last_channel || (r.source === "manual" ? (contacts[id]?.email ? "email" : "whatsapp") : r.source === "kamernet" ? "kamernet" : "site")) === k ? "selected" : ""}>${v}</option>`).join("")}</select>
          <button class="btn ghost" type="button" data-a="log">Add it</button></div>
        <div id="logWho"></div>
        <p class="why" style="margin:6px 0 0">Old WhatsApp messages: in WhatsApp open the chat, ⋮ › More › Export chat › Without media, copy the text and paste it here. Every message comes in with its own time.</p></div></details>
    </section>
    <section class="sec" id="lp-contact">${contactSection(id)}</section>
    ${dealStarted(id) ? `<section class="sec okb" id="lp-deal">${dealSection(r)}</section>` : ""}
    <section class="sec" id="lp-ai"><h3>What the ad says ${r.distilled_at ? '<span class="badge ai">AI summary</span>' : ""}</h3>
      ${(r.check_reasons || []).length ? `<div class="warns" style="list-style:none;padding-left:10px"><b>Checked automatically because:</b> ${esc(r.check_reasons.join(" · "))}${r.distilled_at ? "" : ". The AI reads it within 15 minutes."}</div>` : ""}
      ${dl?.summary ? `<p style="margin:0">${esc(dl.summary)}</p>` : ""}
      ${(dl?.red_flags || []).length ? `<div class="flags">⚠ ${esc(dl.red_flags.join(" · "))}</div>` : ""}
      ${buckets(r)}
      <details data-k="full"${open.includes("full") ? " open" : ""}><summary>Full ad text</summary><div class="full" id="lpFull">${esc(fullText[id] ?? "Loading…")}</div></details>
    </section>
    <section class="btnrow">
      <button class="btn ghost" type="button" data-a="ask">Tell Claude about this place</button>
      ${dealStarted(id) ? "" : '<button class="btn ghost" type="button" data-a="startdeal">They offered it to me</button>'}
      ${r.source === "manual" ? '<button class="btn ghost danger" type="button" data-a="remove">Remove this place</button>' : ""}
    </section>`;
  body.scrollTop = top;
  if (open.includes("full")) loadFull(id);
  loadDups(id);
}
// ---- what the landlord told you in messages (my_status.msg_facts): shown on top of the ad, with what the ad said ----
const mfTag = () => `<button class="mftag" type="button" data-a="mf">✉ from their message</button>`;
function mfVal(k, v){
  if (v == null || v === "") return "not stated";
  if (k === "price" || k === "deposit") return eur(v);
  if (k === "available_from" || k === "available_until") return day(v);
  if (k === "utilities_incl") return v ? "yes" : "no";
  return String(v);
}
function msgFactsHtml(r){
  const mf = r._mf; if (!mf) return "";
  const rows = MF_KEYS.filter((k) => mf[k]).map((k) => {
    const ad = r._ad[k], same = ad != null && String(ad) === String(mf[k].v);
    return `<li><b>${MF_LABEL[k]}: ${esc(mfVal(k, mf[k].v))}</b> <span class="why">said on ${esc(day(mf[k].at.slice(0, 10)))}${same ? " · same as the ad" : ad == null || ad === "" ? " · not in the ad" : ` · the ad said ${esc(mfVal(k, ad))}`}</span> <button class="linkbtn" type="button" data-clearfact="${k}">Wrong, remove</button></li>`;
  });
  const notes = (mf.notes || []).map((n, i) => `<li>${esc(n.t)} <span class="why">said on ${esc(day(n.at.slice(0, 10)))}</span> <button class="linkbtn" type="button" data-clearfact="notes" data-i="${i}">Wrong, remove</button></li>`);
  if (!rows.length && !notes.length) return "";
  return `<section class="sec" id="lp-mf"><h3>What they told you in messages</h3>
    <p class="why">Newer than the ad, so these are used above and in the deal.</p>
    <ul class="mflist">${rows.join("")}${notes.join("")}</ul></section>`;
}
async function clearFact(id, key, index){
  const r = await post("status", { id: Number(id), action: "clearfact", set: { key, index } });
  if (r.row) statuses[String(id)] = r.row;
  lpRender(); renderAll();
}
// ---- reposts: the same place posted again (same address, price and size, similar text, an hour or more apart) is hidden
// behind the oldest ad; its page lists the reposts, and "Not the same place" shows one again ----
const dups = {}; // listing id -> [{id,url,first_seen_at,posted}]
async function loadDups(id){
  try { dups[id] = await (await rest(`listings?select=id,url,first_seen_at,posted:raw->>publishDate&dup_of=eq.${id}&gone_at=is.null&order=id&limit=20`)).json(); } catch { return; }
  if (lpId === id && $("lpDups")) $("lpDups").innerHTML = dupsHtml(id);
}
function dupsHtml(id){
  const r = cache[id]; if (!r) return "";
  const day = (d) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
  if (r.dup_of) return `<div class="dupbox"><span>This looks like a repost of an older ad for the same place, so it's hidden from the list. <a href="#l=${r.dup_of}">Open the older ad</a></span><button class="btn small ghost" type="button" data-notdup="${id}">Not the same place</button></div>`;
  const list = dups[id] || [];
  const undo = r.dup_ignore ? `<div class="dupbox"><span>You said this isn't a repost, so it shows on its own.</span><button class="btn small ghost" type="button" data-isdup="${id}">It is a repost after all</button></div>` : "";
  if (!list.length) return undo;
  return `${undo}<div class="dupbox"><span><b>Posted ${list.length + 1} times.</b> The ${list.length === 1 ? "repost is" : `${list.length} reposts are`} hidden from the list:</span>
    ${list.map((d) => `<div class="btnrow"><a href="${esc(d.url || "#")}" target="_blank" rel="noopener">Repost of ${esc(day(d.posted || d.first_seen_at))} ↗</a><button class="btn small ghost" type="button" data-notdup="${d.id}">Not the same place</button></div>`).join("")}</div>`;
}
async function setNotDup(lid, ignore){
  await fn("status", { method: "POST", body: JSON.stringify({ action: "notdup", id: Number(lid), set: { ignore } }) });
  await refreshRow(lid);
  if (lpId){ await refreshRow(lpId); lpRender(); }
}
// ---- the ad on its site (Kamernet, Pararius, ...), checked live when its page opens: new listings are read every 15 minutes, but an ad can go or change any time ----
const live = {}; // listing id -> {state: "checking"|"ok"|"gone"|"changed"|"failed", at, old, now}
function liveHtml(id){
  const x = live[id], r = cache[id];
  if (!r || r.source === "manual") return "";
  if (!x) return "";
  const on = esc(siteName(r.source));
  if (x.state === "checking") return `<p class="why">Checking the ad on ${on}…</p>`;
  if (x.state === "gone") return `<div class="closedbar"><span>This ad is no longer on ${on} (checked just now).${stageOf(id) === "none" ? " It's probably let." : " Ask the landlord if it's still available."}</span></div>`;
  if (x.state === "changed") return `<div class="closedbar" style="background:var(--warn-soft);color:var(--warn)"><span>The price on ${on} changed: ${eur(x.old)} → ${eur(x.now)} a month (checked just now).</span></div>`;
  if (x.state === "failed") return `<p class="why">Couldn't check ${on} just now, so this may not be the latest. It's checked again later.</p>`;
  return `<p class="why" style="color:var(--ok)">✓ Still on ${on}, same price (checked just now).</p>`;
}
async function liveCheck(id){
  const r = cache[id];
  if (!r || r.source === "manual" || !r.url) return;
  if (live[id] && live[id].state !== "failed" && Date.now() - live[id].at < 10 * 60000) return; // checked in the last 10 minutes
  live[id] = { state: "checking", at: Date.now() };
  const show = () => { if (lpId === id && $("lpLive")) $("lpLive").innerHTML = liveHtml(id); };
  show();
  try {
    const res = await fn(`reader?check=${encodeURIComponent(r.url)}`);
    const one = (res.results || [])[0] || {};
    const old = r.price;
    await refreshRow(id);
    if (one.status === "gone") live[id] = { state: "gone", at: Date.now() };
    else if (one.status === "saved") live[id] = Number(one.price) && Number(one.price) !== Number(old) ? { state: "changed", at: Date.now(), old, now: Number(one.price) } : { state: "ok", at: Date.now() };
    else live[id] = { state: "failed", at: Date.now() };
  } catch { live[id] = { state: "failed", at: Date.now() }; }
  if (lpId === id && ["gone", "changed"].includes(live[id].state)) { lpRender(); renderAll(); } else show();
}

const fullText = {};
async function loadFull(id){
  if (fullText[id] != null) return;
  try { const [x] = await (await rest(`listings?select=description&id=eq.${id}`)).json(); fullText[id] = x?.description || "No description."; }
  catch { return; }
  if (lpId === id && $("lpFull")) $("lpFull").textContent = fullText[id];
}
$("lpBody").addEventListener("toggle", (e) => { if (e.target.dataset?.k === "full" && e.target.open) loadFull(lpId); }, true);
function list(title, arr){
  arr = (arr || []).filter(Boolean);
  return arr.length ? `<div><h4>${title}</h4><ul>${arr.map((x) => `<li>${esc(cap(x))}</li>`).join("")}</ul></div>` : "";
}
// notes that only repeat what the badges and price already show are left out
const DUP_NOTE = /\b(rent|deposit|available|availability|per month|monthly|bills?|utilities|furnished|registration|registered|size|sqm|students?)\b|m²/i;
function buckets(r){
  const d = r.distilled;
  if (!d) return `<p class="why">No AI summary yet. It sorts everything the ad says into requirements, house rules, costs, features and red flags.</p><button class="btn ghost" type="button" data-a="summarize">Get the AI summary (about ${euro(0.002)})</button>`;
  const lang = d.language || {};
  const langLine = [lang.dutch === "required" ? "Dutch required" : lang.dutch === "preferred" ? "Dutch preferred" : lang.dutch === "not-needed" ? "Dutch not needed" : "", lang.english_ok === true ? "English OK" : "", ...(lang.other || [])].filter(Boolean);
  const stay = d.stay || {}, costs = d.costs || {};
  const stayLine = [stay.min_months ? `Minimum ${stay.min_months} months` : "", stay.max_months ? `Maximum ${stay.max_months} months` : "", stay.fixed_end_date ? `Ends ${stay.fixed_end_date}` : ""].filter(Boolean);
  const costLine = [costs.bills && costs.bills !== "unclear" ? `Bills ${costs.bills}` : "", costs.deposit_note && !(r.deposit != null && /(€|eur)\s?\d|\d\s?(€|eur)/i.test(costs.deposit_note)) ? costs.deposit_note : "", ...(costs.other_fees || [])].filter(Boolean);
  return `<div class="cols">${list("Language", langLine)}${list("Requirements", d.requirements)}${list("Preferences", d.preferences)}${list("House rules", d.house_rules)}
    ${list("Stay and costs", [...stayLine, ...costLine])}${list("Features", d.features)}${list("Notes", (d.notes || []).filter((n) => !DUP_NOTE.test(n)))}</div>
    ${d.registration_evidence ? `<p class="why">Registration: “${esc(d.registration_evidence)}”</p>` : ""}`;
}
// Kamernet gives street + postcode, not the house number, so the pin is the right block, not the exact door
const mapUrl = (r) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([r.street, [r.pc, r.city].filter(Boolean).join(" ")].filter(Boolean).join(", "));

// ---- your message: write, check, send ----
function chanOf(d){ // the channel the landlord last used; a first message goes through the ad's site (a place you added: email if saved, else WhatsApp)
  const last = threads[String(d.listing_id)]?.last_channel, c = contacts[d.listing_id] || {}, src = cache[d.listing_id]?.source;
  if (d.kind === "reply" && ["whatsapp", "email"].includes(last)) return last;
  if (src && !["kamernet", "manual"].includes(src)) return d.kind === "reply" && last !== "site" && (c.email || c.phone) ? (c.email ? "email" : "whatsapp") : "site";
  if (src === "manual" || (d.kind === "reply" && !d.conv_id && last !== "kamernet")) return c.email ? "email" : c.phone ? "whatsapp" : "other";
  return "kamernet";
}
const waUrl = (phone, text) => `https://wa.me/${String(phone).replace(/\D/g, "").replace(/^00/, "").replace(/^0(?=6)/, "31")}?text=${encodeURIComponent(text)}`;
const kamernetUrl = (d) => d.kind === "reply" && d.conv_id ? `https://kamernet.nl/en/my-messages/default/conversation/${d.conv_id}` : `https://kamernet.nl/en/react-to-listing/${d.listing_id}`;
const WHY = {
  kamernet: "Send for me types it into Kamernet and presses Send for you, using Chrome on your PC (where you're logged in). The PC must be on with Chrome open. Kamernet's rules don't allow this, so there's a small risk to your account; it only sends what you tap (one message, or Send all in Inbox), one every 20-40 seconds.",
  whatsapp: "WhatsApp can ban your number if a robot sends from it, so you send it yourself.",
  site: "This site only lets you reach the landlord through its own contact form, so you paste it there and press send yourself.",
};
function draftSection(id){
  const d = draftOf(id), r = cache[id], c = contacts[id] || {};
  if (!d){
    const first = stageOf(id) === "none" && !(r.gone_at && r.source !== "manual");
    if (isClosed(id)) return `<h3>Your message</h3><p class="why">This lead is closed.</p>`;
    if (first || !threads[id]) return `<h3>Your message</h3><p class="why">Claude writes a short first message in your style, using the ad and your facts. You check it and send it yourself.</p><button class="btn" type="button" data-a="write">Write my first message</button>`;
    return `<h3>Your message</h3><p class="why">${needsReply(id) ? "They wrote last. Claude can write a reply for you to check." : threads[id] ? "The last message is yours." : "No messages yet. Claude can write one for you to check."}</p><button class="btn${needsReply(id) ? "" : " ghost"}" type="button" data-a="reply">Write a ${needsReply(id) ? "reply" : "follow-up"}</button>`;
  }
  const ch = chanOf(d), sending = isSending(d);
  const send = d.send_status === "kn_sending" ? `<div class="btnrow"><b>Sending on Kamernet now…</b></div><p class="why">Chrome on your PC is typing it into Kamernet. It shows in the conversation when it's out.</p>`
    : d.send_status === "kn_queued" ? `<div class="btnrow"><b>Waiting for your PC to send it on Kamernet…</b><button class="btn ghost small" type="button" data-d="unqueue">Cancel</button></div><p class="why">${knOnline() ? "Your PC is on: it goes out within a minute or two." : "Your PC seems to be off or Chrome is closed. It goes out as soon as it's back (within 12 hours, or it's cancelled). In a hurry? Cancel, then use Copy and open Kamernet."}</p>`
    : sending ? `<div class="btnrow"><b>Sending by email to ${esc(c.email || "the landlord")}…</b><button class="btn ghost small" type="button" data-d="unqueue">Cancel</button></div><p class="why">It goes out from your Gmail within a minute, then shows in the conversation.</p>`
    : ch === "email" ? `<div class="btnrow"><button class="btn" type="button" data-d="mail">Send for me</button><button class="btn ghost" type="button" data-d="go" data-ch="email">Copy and open email</button></div><p class="why">Send for me emails ${esc(c.email)} from your own Gmail, as a reply in your thread with them.</p>`
    : ch === "whatsapp" ? `<div class="btnrow"><button class="btn" type="button" data-d="go" data-ch="whatsapp">${c.phone ? "Copy and open WhatsApp" : "Copy it"}</button></div><p class="why">${WHY.whatsapp}${c.phone ? "" : " Save their number under Landlord to open their chat directly."}</p>`
    : ch === "other" ? `<div class="btnrow"><button class="btn" type="button" data-d="go" data-ch="other">Copy it</button></div><p class="why">Save the landlord's email or phone under Landlord to get Send for me or WhatsApp.</p>`
    : ch === "site" ? `<div class="btnrow"><button class="btn" type="button" data-d="go" data-ch="site">Copy and open ${esc(siteName(r.source))}</button></div><p class="why">${WHY.site} Save their email or phone under Landlord once they answer.</p>`
    : `<div class="btnrow"><button class="btn" type="button" data-d="kn">Send for me${knOnline() ? "" : " (PC off)"}</button><button class="btn ghost" type="button" data-d="go" data-ch="kamernet">Copy and open Kamernet</button></div><p class="why">${WHY.kamernet}${knOnline() ? "" : " <b>Right now your PC seems off</b>, so Send for me would wait for it; Copy and open works anywhere."}</p>`;
  return `<h3>${d.kind === "reply" ? "Your reply" : "Your first message"} <small class="why">${esc({ kamernet: "on Kamernet", site: "on " + siteName(r.source), whatsapp: "on WhatsApp", email: "by email", other: "" }[ch])}</small></h3>
    ${d.send_status === "failed" ? `<div class="flags">Couldn't send it: ${esc(d.send_error || "unknown error")}. Try again, or copy it.</div>` : ""}
    ${(d.warnings || []).length ? `<ul class="warns">${d.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
    <div class="draft" data-aid="${d.id}">
      ${(d.notes || []).length && !sending ? `<div class="decide"><b>Claude's questions and notes</b>${d.notes.map((n) => `<label><span>${esc(n)}</span><input class="dans" data-q="${esc(n)}" placeholder="Your answer (leave empty if it's just a note)"></label>`).join("")}<button class="btn small" type="button" data-d="redo">Put my answers in</button></div>` : ""}
      <textarea id="dText" aria-label="Message" ${sending ? "disabled" : ""}>${esc(draftEdits[d.id] ?? d.draft)}</textarea><span class="saved" id="dSaved"></span>
      ${send}
      ${sending ? "" : `<div class="btnrow"><button class="btn ghost" type="button" data-d="done" data-ch="${ch}">I sent it</button><button class="btn ghost danger" type="button" data-d="del">Delete</button></div>
      <details data-k="redo"><summary>Change it with AI</summary><div class="fix" style="margin-top:6px"><input id="dNote" placeholder="e.g. shorter, say I can come Saturday, don't mention who comes along">
        <label class="toggle small"><input type="checkbox" id="dRem" checked> Remember my answers for next time</label>
        <label class="toggle small"><input type="checkbox" id="dAlw"> Always write like this</label>
        <button class="btn ghost" type="button" data-d="redo">Rewrite</button></div></details>`}
    </div>`;
}
const saveTimers = {};
$("lpBody").addEventListener("input", (e) => {
  if (e.target.id !== "dText") return;
  const id = Number(e.target.closest(".draft").dataset.aid), st = $("dSaved");
  draftEdits[id] = e.target.value; st.textContent = "Saving…"; clearTimeout(saveTimers[id]);
  saveTimers[id] = setTimeout(async () => {
    try { await post("apply", { action: "save", application_id: id, draft: e.target.value }); const d = drafts.find((x) => x.id === id); if (d) d.draft = e.target.value; delete draftEdits[id]; if ($("dSaved")) $("dSaved").textContent = "Saved ✓"; }
    catch (err) { if ($("dSaved")) $("dSaved").textContent = "Couldn't save: " + err.message; }
  }, 700);
});
async function saveDraftNow(aid){
  const t = $("dText"); if (!t) return;
  clearTimeout(saveTimers[aid]);
  await post("apply", { action: "save", application_id: aid, draft: t.value });
  const d = drafts.find((x) => x.id === aid); if (d) d.draft = t.value; delete draftEdits[aid];
}

// ---- conversation ----
function threadHtml(id){
  const data = threadCache[id];
  if (!data) return '<p class="why">Loading…</p>';
  return data.messages.length
    ? data.messages.map((m) => `<div class="bub ${m.direction}"><div class="bm">${m.direction === "in" ? "Landlord" : "Me"} · ${esc(CHAN[m.channel] || m.channel)} · ${esc(when(m.at))}</div>${esc(m.body)}</div>`).join("")
    : '<p class="why">No messages yet. Landlord messages from Kamernet, email and WhatsApp land here by themselves.</p>';
}
// An exported WhatsApp chat: "19/10/2026, 14:03 - Name: text" (Android) or "[19-10-2026 14:03:22] Name: text" (iPhone).
// Lines without a date continue the message above. Day comes first unless that can't be (Dutch/European phones).
function parseChatExport(text){
  const re = /^‎?\[?(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*([AaPp]\.?[Mm]\.?)?\]?\s*(?:[-–]\s*)?([^:]{1,60}?):\s(.*)$/;
  const out = [];
  for (const line of text.split(/\r?\n/)){
    const m = line.match(re);
    if (!m){ if (out.length && line.trim()) out[out.length - 1].text += "\n" + line.trim(); continue; }
    let [, a, b, y, h, mi, ap, who, body] = m;
    let d = +a, mo = +b; if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    let hr = +h; if (ap){ const pm = /p/i.test(ap); if (pm && hr < 12) hr += 12; if (!pm && hr === 12) hr = 0; }
    const yr = y.length === 2 ? 2000 + +y : +y;
    out.push({ who: who.replace(/‎/g, "").trim(), text: body.trim(), at: new Date(yr, mo - 1, d, hr, +mi).toISOString() });
  }
  return out.map((x) => ({ ...x, text: x.text.trim() })).filter((x) => x.text && !/^<(media|media weggelaten|media omitted)[^>]*>$|omitted$|weggelaten$/i.test(x.text));
}

async function loadThread(id){
  try { threadCache[id] = await fn(`status?thread=${id}`); } catch { threadCache[id] = { messages: [] }; }
  if (lpId === id && $("lpMsgs")){ $("lpMsgs").innerHTML = threadHtml(id); $("lpMsgs").scrollTop = 1e6; }
}

// ---- landlord contact (saves when you leave a field) ----
function contactSection(id){
  const c = contacts[id] || {};
  return `<h3>Landlord <span class="saved" id="cSaved"></span></h3>
    <div class="grid2"><label>Name<input id="cName" value="${esc(c.name || "")}"></label><label>Email<input id="cEmail" inputmode="email" value="${esc(c.email || "")}"></label><label>Phone (WhatsApp)<input id="cPhone" inputmode="tel" value="${esc(c.phone || "")}"></label></div>
    <div class="links">${c.phone ? `<a href="${esc(waUrl(c.phone, ""))}" target="_blank" rel="noopener">WhatsApp chat ↗</a>` : ""}${c.email ? `<a href="mailto:${esc(c.email)}">Email ↗</a>` : ""}</div>
    <p class="why">Messages from this email address or number then land here by themselves${c.email ? ", and Send for me can email them" : ""}.</p>`;
}
$("lpBody").addEventListener("change", async (e) => {
  const id = lpId; if (!id) return;
  const t = e.target;
  try {
    if (["cName", "cEmail", "cPhone"].includes(t.id)){
      const r = await post("deal", { action: "contact", id: Number(id), name: $("cName").value, email: $("cEmail").value, phone: $("cPhone").value });
      contacts[id] = r.contact; $("cSaved").textContent = "Saved ✓";
      if (!$("dText")) $("lp-draft").innerHTML = draftSection(id); // the send buttons depend on the email / phone (an open message editor is left alone)
    } else if (t.id === "lpView"){
      const prev = stOf(id);
      await setStand(id, { viewing_at: t.value ? new Date(t.value).toISOString() : null, ...(t.value && STAGES.indexOf(prev.stage || "none") < 3 ? { stage: "booked" } : {}) });
      toast(t.value ? `Viewing saved: ${when(new Date(t.value).toISOString())}. You'll get a reminder.` : "Viewing time cleared.");
    } else if (t.closest(".dealbox")) await dealChange(e);
  } catch (err) { fail(err); }
});

// ---- where it stands ----
async function setStand(id, set){
  const r = await post("status", { id: Number(id), set });
  if (r.row) statuses[String(id)] = r.row;
  lpRender(); renderAll(); reloadList();
}
function standUndo(id, before){
  return { label: "Undo", fn: () => setStand(id, { stage: before.stage || "none", opinion: before.opinion ?? null, closed: before.closed ?? null, viewing_at: before.viewing_at ?? null }) };
}

// ---- every button on the listing page ----
$("lpBody").addEventListener("click", async (e) => {
  const id = lpId; if (!id) return;
  const b = e.target.closest("button"); if (!b) return;
  const before = { ...stOf(id) };
  try {
    if (b.dataset.stage){
      const k = b.dataset.stage; if (k === stageOf(id)) return;
      await setStand(id, { stage: k });
      toast(`Progress: ${STAGE_LABEL[k]}`, standUndo(id, before));
    } else if (b.dataset.op){
      const op = b.dataset.op, clear = before.opinion === op, set = { opinion: clear ? null : op };
      if (op === "no" && !clear) set.closed = before.closed || "me_no";
      if ((op !== "no" || clear) && before.closed === "me_no") set.closed = null;
      await setStand(id, set);
      if (op === "no" && !clear) toast("Closed: not for you. It's under Closed in My leads.", standUndo(id, before));
    } else if (b.dataset.verdict){
      const op = b.dataset.verdict, set = { opinion: op, note: `${new Date().toISOString().slice(0, 10)}: after the viewing, Asa said: ${OP_LABEL[op]}` };
      if (op === "no") set.closed = "me_no";
      await setStand(id, set);
      toast(op === "no" ? "Closed: not for you." : `Saved: ${OP_LABEL[op]}`, standUndo(id, before));
    } else if (b.dataset.close){
      await setStand(id, { closed: b.dataset.close });
      toast(`Closed: ${CLOSED_LABEL[b.dataset.close]}`, standUndo(id, before));
    } else if (b.dataset.notdup){
      const lid = b.dataset.notdup;
      await setNotDup(lid, true);
      toast("Shown as a separate place now.", { label: "Undo", fn: () => setNotDup(lid, false) });
    } else if (b.dataset.isdup){
      await setNotDup(b.dataset.isdup, false);
      toast("Hidden again as a repost (if it still matches an older ad).");
    } else if (b.dataset.a === "mf"){
      $("lp-mf")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (b.dataset.clearfact){
      await clearFact(id, b.dataset.clearfact, b.dataset.i != null ? Number(b.dataset.i) : undefined);
      toast(b.dataset.clearfact === "notes" ? "Note removed." : "Removed. The ad's value shows again.");
    } else if (b.dataset.a === "reopen"){
      await setStand(id, { closed: null, ...(before.opinion === "no" ? { opinion: null } : {}) });
      toast("Reopened.", standUndo(id, before));
    } else if (b.dataset.a === "noview"){
      await setStand(id, { viewing_at: null }); toast("Viewing time cleared.", standUndo(id, before));
    } else if (b.dataset.a === "write"){
      b.disabled = true; b.textContent = "Writing… (about 10 seconds)";
      const d = await post("apply", { id: Number(id), reuse: true });
      await loadDrafts(); lpRender(); renderAll();
      toast(d.reused ? "Here's the message you already had." : `Written · cost ${euro(d.cost_usd)}. Check it, then send it.`);
    } else if (b.dataset.a === "reply"){
      b.disabled = true; b.textContent = "Writing… (about 10 seconds)";
      const r = await post("replydraft", { id: Number(id), save: true, followup: !needsReply(id) });
      if (r.skipped){ lpRender(); return toast("Nothing to answer: the last message is yours."); }
      await loadDrafts(); lpRender(); renderAll();
      toast(r.notes?.length ? "Written. Claude left you a question or note above the message." : "Written. Check it, then send it.");
    } else if (b.dataset.a === "log" || b.dataset.me){
      const body = $("logBody").value.trim(); if (!body) return toast("Paste or write the message first.", null, true);
      const chat = parseChatExport(body);
      if (chat.length >= 2){ // a whole exported WhatsApp chat: each message keeps its own time and side
        const names = [...new Set(chat.map((m) => m.who))];
        if (!b.dataset.me && names.length > 1){
          $("logWho").innerHTML = `<p class="why" style="margin:6px 0">This is a chat export (${plural(chat.length, "message")}). Which one is you?</p><div class="opts">${names.map((n) => `<button class="btn ghost small" type="button" data-me="${esc(n)}">${esc(n)}</button>`).join("")}</div>`;
          return;
        }
        const me = b.dataset.me || "";
        await loadThread(id);
        const have = new Set((threadCache[id]?.messages || []).map((m) => `${m.direction}|${String(m.body).trim()}`));
        let added = 0, r;
        for (const m of chat){
          const direction = m.who === me ? "out" : "in";
          if (have.has(`${direction}|${m.text}`)) continue;
          r = await post("status", { action: "log", id: Number(id), direction, channel: $("logChan").value, body: m.text, at: m.at });
          if (r.row) statuses[id] = r.row;
          added++;
        }
        $("logBody").value = "";
        await Promise.all([loadThreads(), loadThread(id)]); lpRender(); renderAll();
        return toast(added ? `Added ${plural(added, "message")} from the chat${added < chat.length ? ` (${chat.length - added} were already here)` : ""}.` : "All these messages were already here.");
      }
      const r = await post("status", { action: "log", id: Number(id), direction: $("logDir").value, channel: $("logChan").value, body });
      if (r.row) statuses[id] = r.row;
      await Promise.all([loadThreads(), loadThread(id)]); lpRender(); renderAll(); toast("Added to the conversation.");
    } else if (b.dataset.a === "ask") openAsk(id);
    else if (b.dataset.a === "summarize"){
      b.disabled = true; b.textContent = "Reading the ad… (about 10 seconds)";
      await summarize([Number(id)]); await refreshRow(id); lpRender();
    } else if (b.dataset.a === "startdeal"){
      await setStand(id, { stage: "offer" }); deals[id] ||= { terms: {}, checks: {}, payments: [], after: {} }; lpRender();
      setTimeout(() => $("lp-deal")?.scrollIntoView({ behavior: "smooth" }), 50);
      toast("Deal started. Fill in the offer, check the contract, then sign.", standUndo(id, before));
    } else if (b.dataset.a === "remove"){
      if (!await confirmBox({ title: "Remove this place?", ok: "Remove", danger: true, body: "<p>It disappears from all lists. You can undo this right after.</p>" })) return;
      await post("deal", { action: "remove_place", id: Number(id) }); await loadStatuses();
      $("lp").close(); toast("Place removed.", { label: "Undo", fn: async () => { await post("deal", { action: "restore_place", id: Number(id) }); await loadStatuses(); renderAll(); } });
    } else if (b.dataset.d) await draftAction(b);
    else if (b.closest(".dealbox")) await dealClick(e, b);
  } catch (err) { fail(err); lpRender(); }
});
async function draftAction(b){
  const id = lpId, box = b.closest(".draft"), aid = Number(box?.dataset.aid), d = drafts.find((x) => x.id === aid), c = contacts[id] || {}, text = $("dText")?.value || "";
  const act = b.dataset.d;
  if (["go", "mail", "kn", "done"].includes(act) && /\[YOUR ANSWER/i.test(text)) // never let a placeholder go out
    return toast("Fill in the [YOUR ANSWER …] parts first: answer the questions above and press “Put my answers in”, or edit the text.", null, true);
  if (act === "go"){
    const ch = b.dataset.ch, p = navigator.clipboard?.writeText(text);   // copy and open in the same tap, so the browser allows both
    const u = ch === "whatsapp" ? (c.phone ? waUrl(c.phone, text) : "")
      : ch === "email" ? `mailto:${encodeURIComponent(c.email || "")}?subject=${encodeURIComponent("Re: " + (cache[id]?.street || "the room"))}&body=${encodeURIComponent(text)}`
      : ch === "kamernet" ? kamernetUrl(d || { listing_id: id }) : ch === "site" ? cache[id]?.url || "" : "";
    if (u){ if (ch === "email") location.href = u; else window.open(u, "_blank", "noopener"); }
    const where = { whatsapp: "WhatsApp", email: "your email", kamernet: "Kamernet", site: siteName(cache[id]?.source) + "'s contact form", other: "where you're writing to them" }[ch];
    if (p) p.then(() => toast(`Copied. Paste it in ${where}, send it, then come back and press “I sent it”.`)).catch(() => { $("dText").select(); toast("Couldn't copy by itself. The text is selected: copy it."); });
    else { $("dText").select(); toast("The text is selected: copy it."); }
  } else if (act === "mail"){
    if (!await confirmBox({ title: `Send this email to ${c.email}?`, ok: "Send it now", body: `<p>It goes from your Gmail within a minute, as a reply in your thread with them.</p><p class="why" style="white-space:pre-wrap">${esc(text.slice(0, 400))}${text.length > 400 ? "…" : ""}</p>` })) return;
    const r = await post("deal", { action: "send_email", application_id: aid, draft: text });
    delete draftEdits[aid]; await loadDrafts(); lpRender(); renderAll(); watchSending();
    toast(r.script_ready ? "Sending… You can cancel it in the next minute." : "Queued. The Gmail connection isn't running right now (see More), so it goes out as soon as it is.", { label: "Cancel", fn: async () => { await post("deal", { action: "unqueue", application_id: aid }); await loadDrafts(); lpRender(); renderAll(); } });
  } else if (act === "kn"){
    const online = knOnline(), where = d?.kind === "reply" && d?.conv_id ? "as a reply in your Kamernet conversation" : "through the ad's contact form on Kamernet";
    if (!await confirmBox({ title: "Send this on Kamernet?", ok: "Send it now", body: `<p>Chrome on your PC types it in and presses Send, ${where}. ${online ? "Your PC is on, so it goes out within a minute or two." : "<b>Your PC seems off right now.</b> It goes out once it's back on with Chrome open."}</p><p class="why" style="white-space:pre-wrap">${esc(text.slice(0, 400))}${text.length > 400 ? "…" : ""}</p>` })) return;
    const r = await post("kn-send", { action: "queue", application_id: aid, draft: text });
    window.postMessage({ type: "kn-sender-poke" }, location.origin); // on the PC itself, the helper looks right away
    delete draftEdits[aid]; await loadDrafts(); lpRender(); renderAll(); watchSending();
    toast(r.helper_online ? "Sending through your PC… You can cancel it until it starts." : "Waiting for your PC: it goes out when Chrome is open on it.", { label: "Cancel", fn: async () => { await post("kn-send", { action: "cancel", application_id: aid }); await loadDrafts(); lpRender(); renderAll(); } });
  } else if (act === "unqueue"){
    if (d?.send_status?.startsWith("kn_")) await post("kn-send", { action: "cancel", application_id: aid });
    else await post("deal", { action: "unqueue", application_id: aid });
    await loadDrafts(); lpRender(); renderAll(); toast("Cancelled. Nothing was sent.");
  } else if (act === "done"){
    if (!await confirmBox({ title: "Did you send it?", ok: "Yes, I sent it", body: "<p>It goes into the conversation and the place moves to Applied (if it wasn't further already).</p>" })) return;
    await saveDraftNow(aid);
    await post("apply", { action: "sent", application_id: aid, channel: b.dataset.ch });
    await Promise.all([loadStatuses(), loadDrafts(), loadThreads(), loadThread(id)]); lpRender(); renderAll(); toast("Marked as sent.");
  } else if (act === "del"){
    if (!await confirmBox({ title: "Delete this message?", ok: "Delete", danger: true, body: "<p>Claude can write a new one any time.</p>" })) return;
    await post("apply", { action: "discard", application_id: aid }); delete draftEdits[aid]; await loadDrafts(); lpRender(); renderAll(); toast("Deleted.");
  } else if (act === "redo"){
    const answers = [...box.querySelectorAll(".dans")].map((x) => ({ question: x.dataset.q, answer: x.value.trim() })).filter((x) => x.answer);
    const instruction = $("dNote")?.value.trim() || "";
    if (!answers.length && !instruction) return toast("Write what to change (or answer a question above) first.", null, true);
    b.disabled = true; b.textContent = "Rewriting…";
    await saveDraftNow(aid);
    await post("replydraft", { action: "redo", application_id: aid, instruction, answers, remember: !!$("dRem")?.checked, always: !!$("dAlw")?.checked });
    await loadDrafts(); lpRender(); toast("Rewritten.");
  }
}
// "You decide" answers: pressing Enter rewrites
$("lpBody").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.target.classList.contains("dans") || e.target.id === "dNote")){ e.preventDefault(); $("lpBody").querySelector('[data-d="redo"]')?.click(); } });
function watchSending(){ // while a message is going out, check again so it shows as sent
  clearTimeout(watchSending.t);
  if (!unsent().some(isSending)) return;
  watchSending.t = setTimeout(async () => { await Promise.all([loadDrafts(), loadThreads(), loadStatuses()]); if (lpId){ await loadThread(lpId); lpRender(); } renderAll(); watchSending(); }, 20000);
}

// ---- the deal: from "they offered it" to signed and registered. Nothing here pays or signs for you. ----
const CHECKS = [
  ["seen", "I (or someone I trust) saw the place in person"],
  ["landlord_id", "The landlord's name matches the contract and the bank account"],
  ["reg_ok", "Registration (inschrijving) at this address is allowed, in writing"],
  ["two_people", "Everyone moving in with me is allowed to live there"],
  ["contract_read", "I read the contract (and the AI check) and asked about anything unclear"],
  ["no_fee", "No agency fee is charged to me (not allowed in the Netherlands)"],
];
function payWarnings(id, d, p){
  const t = d.terms || {}, ck = d.checks || {}, w = [];
  if (!(ck.seen || viewingDone(id))) w.push("You haven't seen the place yet. Never pay before a viewing.");
  if (!d.contract) w.push("No contract uploaded yet. Pay only against a written contract.");
  else if (!d.contract.review) w.push("The contract hasn't been checked yet.");
  else if (d.contract.review.verdict === "do not sign") w.push("The contract check said: do not sign.");
  if (!ck.landlord_id) w.push("You haven't confirmed the landlord's name matches the bank account.");
  if (p.iban && !/^NL\d{2}[A-Z]{4}\d{10}$/.test(p.iban)) w.push(/^NL/.test(p.iban) ? "This doesn't look like a valid Dutch IBAN." : "Foreign bank account: a common scam sign for Dutch rentals.");
  if (/deposit|borg/i.test(p.what) && t.rent && p.amount > t.rent * 2) w.push(`A deposit above 2 months' rent (${eur(t.rent * 2)}) isn't allowed for new contracts.`);
  return w;
}
function dealSection(r){
  const id = String(r.id), d = deals[id] || { terms: {}, checks: {}, payments: [], after: {} }, t = d.terms || {}, ck = d.checks || {}, af = d.after || {};
  const signed = !!d.signed_at, rv = d.contract?.review, autoSeen = viewingDone(id);
  const opt = (v, cur, txt) => `<option value="${v}" ${String(cur ?? "") === v ? "selected" : ""}>${txt}</option>`;
  const vcls = { "looks ok": "verdict-ok", "ask first": "verdict-ask", "do not sign": "verdict-no" };
  const L = (title, arr) => (arr || []).length ? `<div><b>${title}</b><ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
  const pays = (d.payments || []).map((p) => {
    const w = payWarnings(id, d, p);
    const head = `${eur(p.amount)} to ${esc(p.to_name || "the landlord")} for ${esc(p.what)}${p.due ? ` · due ${esc(dayTxt(p.due + "T12:00:00"))}` : ""}`;
    if (p.status === "paid") return `<div class="pay paid" data-pid="${p.pid}"><div>✓ Paid ${head}${p.paid_on ? " on " + esc(dayTxt(p.paid_on + "T12:00:00")) : ""}</div><div class="btnrow"><button class="linkbtn" type="button" data-p="undo">Not paid after all</button></div></div>`;
    if (p.status === "approved") return `<div class="pay approved" data-pid="${p.pid}"><div class="q">You approved: pay ${head}</div>
      <div class="btnrow">${p.iban ? `<button class="btn ghost small" type="button" data-copy="${esc(p.iban)}">Copy IBAN ${esc(p.iban)}</button>` : ""}<button class="btn ghost small" type="button" data-copy="${esc(String(p.amount))}">Copy amount</button>${p.reference ? `<button class="btn ghost small" type="button" data-copy="${esc(p.reference)}">Copy reference</button>` : ""}${p.to_name ? `<button class="btn ghost small" type="button" data-copy="${esc(p.to_name)}">Copy name</button>` : ""}</div>
      <p class="why">Pay it in your bank app (Kamernet Live can't move money), then press I paid it.</p>
      <div class="btnrow"><button class="btn small" type="button" data-p="paid">I paid it</button><button class="linkbtn" type="button" data-p="undo">Take back my OK</button></div></div>`;
    return `<div class="pay" data-pid="${p.pid}"><div class="q">Pay ${head}?</div>${w.length ? `<ul class="warns">${w.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : '<p class="why">The checks look fine.</p>'}
      <div class="btnrow"><button class="btn small" type="button" data-p="approve">OK, I'll pay this</button><button class="btn ghost small danger" type="button" data-p="del">Remove</button></div></div>`;
  }).join("");
  return `<div class="dealbox" data-id="${id}"><h3>${signed ? "Signed ✓ Now: move in and register" : "The deal: from offer to signed"} <span class="saved" id="tSaved"></span></h3>
    ${signed ? "" : `<div class="sec" style="background:var(--surface)"><b>The offer</b><p class="why">Saves as you type.</p><div class="grid2">
      <label>Rent per month (€, total)<input class="tm" data-k="rent" inputmode="decimal" value="${esc(t.rent ?? r.price ?? "")}"></label>
      <label>Deposit (€)<input class="tm" data-k="deposit" inputmode="decimal" value="${esc(t.deposit ?? r.deposit ?? "")}"></label>
      <label>Service costs / bills (€ a month)<input class="tm" data-k="service_costs" inputmode="decimal" value="${esc(t.service_costs ?? "")}"></label>
      <label>Start<input class="tm" data-k="start" type="date" value="${esc(t.start ?? "")}"></label>
      <label>End (empty = open-ended)<input class="tm" data-k="end" type="date" value="${esc(t.end ?? "")}"></label>
      <label>Registration allowed<select class="tm" data-k="registration">${opt("", t.registration, "Not sure yet")}${opt("yes", t.registration, "Yes")}${opt("no", t.registration, "No")}</select></label>
      <label>People allowed<input class="tm" data-k="people" inputmode="numeric" value="${esc(t.people ?? r.people ?? "")}"></label>
      <label>Landlord's name<input class="tm" data-k="landlord" value="${esc(t.landlord ?? contacts[id]?.name ?? "")}"></label>
    </div>${t.registration === "no" ? '<div class="flags">No registration: you need a registered address by about 15 Nov.</div>' : ""}</div>
    <div class="sec" style="background:var(--surface)"><b>Before you pay or sign</b>${CHECKS.map(([k, txt]) => {
      const auto = k === "seen" && autoSeen && !ck.seen;
      return `<label class="chk${auto ? " auto" : ""}"><input type="checkbox" class="dck" data-k="${k}" ${ck[k] || auto ? "checked" : ""}> ${esc(txt)}${auto ? " (your viewing is saved)" : ""}</label>`;
    }).join("")}</div>`}
    <div class="sec" style="background:var(--surface)"><b>${signed ? "Signed contract" : "Contract"}</b>
      ${d.contract ? `<div class="btnrow"><span>${esc(d.contract.name)} · ${esc(dayTxt(d.contract.uploaded_at))}</span><button class="btn ghost small" type="button" data-c="open">Open</button><button class="btn ghost small" type="button" data-c="check">${rv ? "Check again" : "Check it with AI"}</button></div>` : '<p class="why">Upload the contract they send you (a PDF, or photos of the pages). The AI reads it and tells you what to watch out for. It isn\'t a lawyer.</p>'}
      <label class="btn ghost small upl">${d.contract ? "Replace the contract" : "Upload the contract"}<input type="file" class="dfile" accept="application/pdf,image/*" hidden></label>
      ${rv ? `<div class="review"><div><span class="${vcls[rv.verdict] || ""}">${esc(cap(rv.verdict || ""))}</span> · ${esc(rv.summary || "")}</div>
        ${L("Watch out", rv.red_flags)}${L("Ask the landlord before signing", rv.check_with_landlord)}${L("Fine", rv.good)}
        ${rv.terms ? `<div><b>What it says</b><ul>${Object.entries(rv.terms).filter(([, v]) => v).map(([k, v]) => `<li>${esc(cap(k.replace(/_/g, " ")))}: ${esc(v)}</li>`).join("")}</ul></div>` : ""}
        ${(rv.check_with_landlord || []).length ? '<div class="btnrow"><button class="btn ghost small" type="button" data-c="ask">Ask Claude to write these questions to the landlord</button></div>' : ""}
        <p class="why">Checked by AI · not legal advice. For a real dispute: Juridisch Loket (free).</p></div>` : ""}
      <p class="why" id="cStatus"></p></div>
    <div class="sec" style="background:var(--surface)"><b>Payments</b>${pays || '<p class="why">Nothing to pay yet. Add each payment they ask for (deposit, first month). Each one needs your OK first.</p>'}
      ${signed && (d.payments || []).every((p) => p.status === "paid") ? "" : `<details data-k="pay"><summary>Add a payment they asked for</summary><div class="grid2" style="margin-top:6px">
        <label>For<select id="pW"><option>Deposit</option><option>First month's rent</option><option>Rent</option><option>Other</option></select></label>
        <label>Amount (€)<input id="pA" inputmode="decimal"></label><label>To (account name)<input id="pT" value="${esc(t.landlord ?? contacts[id]?.name ?? "")}"></label>
        <label>IBAN<input id="pI" autocapitalize="characters"></label><label>Reference<input id="pR"></label><label>Due<input id="pD" type="date"></label>
      </div><div class="btnrow" style="margin-top:6px"><button class="btn ghost" type="button" data-p="add">Add payment</button></div></details>`}</div>
    ${signed ? `<div class="sec" style="background:var(--surface)"><div>Signed on ${esc(dayTxt(d.signed_at))}. <button class="linkbtn" type="button" data-s="unsign">Undo signing</button></div>
      <div class="grid2"><label>Move-in day<input class="daf" data-k="move_in" type="date" value="${esc(af.move_in ?? t.start ?? "")}"></label>
      <label>Registration appointment (gemeente)<input class="daf" data-k="reg_appt" type="datetime-local" value="${esc(af.reg_appt ? toLocalInput(af.reg_appt) : "")}"></label></div>
      <a href="https://www.google.com/search?q=${encodeURIComponent("inschrijven adres afspraak gemeente " + (r.city || ""))}" target="_blank" rel="noopener">Book the registration appointment (gemeente ${esc(r.city || "")}) ↗</a>
      <p class="why">Register within 5 days after moving in; your deadline is about 15 Nov. Bring your passport and the signed contract.</p>
      ${[["keys", "I have the keys"], ["registered", "I'm registered at this address"]].map(([k, txt]) => `<label class="chk"><input type="checkbox" class="dafc" data-k="${k}" ${af[k] ? "checked" : ""}> ${txt}</label>`).join("")}
      <div class="btnrow"><button class="btn ghost" type="button" data-s="bye">Tell the other landlords I found a place</button></div>
      <p class="why">Writes a short "I found a place" message for every other place you're talking to. You still send each one.</p></div>`
    : `<div class="sec" style="background:var(--surface)"><b>Sign</b><div class="btnrow"><label class="field" style="flex:1">Signed on<input id="sDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></label><button class="btn" type="button" data-s="sign">I signed the contract</button></div>
      <p class="why">Sign only after the checks above. You sign with the landlord; this just records it.</p></div>`}
  </div>`;
}
async function dealCall(id, body){
  const r = await post("deal", { id: Number(id), ...body });
  if (r.deal) deals[id] = r.deal;
  return r;
}
async function readFile64(f){ return await new Promise((ok, bad) => { const rd = new FileReader(); rd.onload = () => ok(String(rd.result).split(",")[1] || ""); rd.onerror = () => bad(new Error("couldn't read the file")); rd.readAsDataURL(f); }); }
async function pdfText(src){
  if (!window.pdfjsLib){
    await new Promise((ok, bad) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"; s.onload = ok; s.onerror = () => bad(new Error("couldn't load the PDF reader")); document.head.appendChild(s); });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
  const doc = await window.pdfjsLib.getDocument(src).promise; let out = "";
  for (let i = 1; i <= Math.min(doc.numPages, 30); i++){ const tc = await (await doc.getPage(i)).getTextContent(); out += tc.items.map((x) => x.str).join(" ") + "\n"; }
  return out;
}
async function checkContract(id, text){
  const say = (m) => { if ($("cStatus")) $("cStatus").textContent = m; };
  say("The AI is reading the contract (about 20 seconds)…");
  try {
    if (text == null && deals[id]?.contract?.mime === "application/pdf") text = await pdfText((await dealCall(id, { action: "contract_url" })).url);
    const r = await dealCall(id, { action: "contract_check", text: text || "" });
    lpRender(); toast(`Contract checked · cost ${euro(r.cost_usd)}`);
  } catch (err) { say(/no readable text/.test(err.message) ? "This PDF has no readable text (a scan). Upload photos of the pages instead." : "Couldn't check it: " + err.message); }
}
async function dealClick(e, b){
  const id = lpId, pay = b.closest(".pay"), pid = pay?.dataset.pid, d = deals[id];
  if (b.dataset.copy){ await navigator.clipboard?.writeText(b.dataset.copy); return toast("Copied."); }
  if (b.dataset.c === "open"){ const w = window.open("", "_blank"); const r = await dealCall(id, { action: "contract_url" }); if (w) w.location = r.url; else location.href = r.url; }
  else if (b.dataset.c === "check") await checkContract(id);
  else if (b.dataset.c === "ask"){
    const qs_ = d?.contract?.review?.check_with_landlord || [];
    openAsk(id, `Write a reply draft to the landlord asking these questions about the contract before I sign:\n- ${qs_.join("\n- ")}`);
  } else if (b.dataset.p === "add"){
    if (!$("pA").value) return toast("Fill in the amount.", null, true);
    await dealCall(id, { action: "pay_add", payment: { what: $("pW").value, amount: $("pA").value, to_name: $("pT").value, iban: $("pI").value, reference: $("pR").value, due: $("pD").value } });
    await loadStatuses(); lpRender(); renderAll(); toast("Payment added. It needs your OK before you pay.");
  } else if (b.dataset.p === "approve"){
    const p = (d?.payments || []).find((x) => x.pid === pid), w = payWarnings(id, d, p);
    if (!await confirmBox({ title: `OK to pay ${eur(p.amount)} to ${p.to_name || "the landlord"}?`, ok: "Yes, show me the bank details",
      body: `<p>For ${esc(p.what)}. Kamernet Live never pays: this only shows the bank details so you can pay in your bank app.</p>${w.length ? `<p><b>Still open:</b></p><ul>${w.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}` })) return;
    await dealCall(id, { action: "pay_set", pid, status: "approved" }); lpRender(); renderAll();
  } else if (b.dataset.p === "paid"){
    const p = (d?.payments || []).find((x) => x.pid === pid);
    if (!await confirmBox({ title: `Did you pay ${eur(p.amount)}?`, ok: "Yes, I paid it" })) return;
    await dealCall(id, { action: "pay_set", pid, status: "paid" }); lpRender(); renderAll(); toast("Marked as paid.");
  } else if (b.dataset.p === "undo"){
    await dealCall(id, { action: "pay_set", pid, status: (d?.payments || []).find((x) => x.pid === pid)?.status === "paid" ? "approved" : "proposed" }); lpRender(); renderAll();
  } else if (b.dataset.p === "del"){
    const p = (d?.payments || []).find((x) => x.pid === pid);
    await dealCall(id, { action: "pay_delete", pid }); lpRender(); renderAll();
    toast("Payment removed.", { label: "Undo", fn: async () => { await dealCall(id, { action: "pay_add", payment: p }); lpRender(); renderAll(); } });
  } else if (b.dataset.s === "sign"){
    if (!await confirmBox({ title: "Did you sign the contract?", ok: "Yes, I signed", body: "<p>Progress moves to Signed and the move-in and registration steps appear.</p>" })) return;
    await dealCall(id, { action: "signed", signed_on: $("sDate").value }); await loadStatuses(); lpRender(); renderAll(); toast("Signed. Congratulations!");
  } else if (b.dataset.s === "unsign"){
    if (!await confirmBox({ title: "Undo signing?", ok: "Undo", body: "<p>Progress goes back to Offer, and your opinion goes back to what it was.</p>" })) return;
    await dealCall(id, { action: "unsigned" }); await loadStatuses(); lpRender(); renderAll();
  } else if (b.dataset.s === "bye"){
    const others = Object.keys(statuses).filter((x) => x !== id && !isClosed(x) && ["replied", "booked", "viewed", "offer"].includes(stOf(x).stage));
    if (!others.length) return toast("There are no other places you're talking to.");
    if (!await confirmBox({ title: `Write a goodbye to ${plural(others.length, "landlord")}?`, ok: "Write them", body: "<p>A short “I found a place, thanks” message for each. Nothing is sent: they land in your Inbox, where you send each one yourself.</p>" })) return;
    const r = await dealCall(id, { action: "goodbyes" }); await loadDrafts(); renderAll();
    toast(`${plural(r.drafted, "goodbye")} written.`, { label: "Open Inbox", fn: () => { $("lp").close(); showTab("inbox"); } });
  }
}
async function dealChange(e){
  const id = lpId, t = e.target;
  if (t.closest(".tm")){
    const terms = {}; $("lpBody").querySelectorAll(".tm").forEach((i) => { terms[i.dataset.k] = i.value; });
    await dealCall(id, { action: "terms", terms }); await loadStatuses(); renderAll();
    if (t.tagName === "SELECT") lpRender(); // the "no registration" warning depends on it
    if ($("tSaved")) $("tSaved").textContent = "Saved ✓";
  } else if (t.closest(".dck")){ await dealCall(id, { action: "checks", checks: { [t.dataset.k]: t.checked } }); lpRender(); }
  else if (t.closest(".daf")){ await dealCall(id, { action: "after", after: { [t.dataset.k]: t.type === "datetime-local" && t.value ? new Date(t.value).toISOString() : t.value } }); renderAll(); toast("Saved. It's in Coming up."); }
  else if (t.closest(".dafc")) await dealCall(id, { action: "after", after: { [t.dataset.k]: t.checked } });
  else if (t.closest(".dfile")){
    const f = t.files?.[0]; if (!f) return;
    if (f.size > 15 * 1024 * 1024) return toast("That file is bigger than 15 MB.", null, true);
    if ($("cStatus")) $("cStatus").textContent = "Uploading…";
    const mime = f.type || (/\.pdf$/i.test(f.name) ? "application/pdf" : "image/jpeg");
    let text = null;
    if (mime === "application/pdf") try { text = await pdfText({ data: new Uint8Array(await f.arrayBuffer()) }); } catch { text = ""; }
    await dealCall(id, { action: "contract_upload", name: f.name, mime, data: await readFile64(f) });
    lpRender();
    await checkContract(id, text);
  }
}

// =====================================================================================
// TELL CLAUDE
// =====================================================================================
let askListing = null, askPoll = null, askPolls = 0;
const RQ = { open: "Waiting for Claude", working: "Claude is on it…", done: "Done", needs_chat: "Needs a Claude chat (it's a change to this site)", needs_asa: "Claude has a question for you", declined: "Not done" };
async function loadRequests(){
  try {
    const rs = (await fn("me?requests=1")).requests || [];
    $("askList").innerHTML = rs.length ? `<h3 class="lbl">Your requests</h3>${rs.map((r) => `<div class="rq ${r.status}"><div><b>${esc(RQ[r.status] || r.status)}</b> · ${esc(ago(r.created_at))}${r.listing_id && cache[r.listing_id] ? " · " + esc(cache[r.listing_id].street) : ""}${r.status === "open" && askPolls >= 40 ? ` <button class="btn ghost small asknow" type="button" data-id="${r.id}">Try again</button>` : ""}</div><div>${esc(r.text)}</div>${r.reply ? `<div class="rr">Claude: ${esc(r.reply)}</div>` : ""}</div>`).join("")}` : "";
    return rs;
  } catch (e) { $("askList").textContent = "Couldn't load your requests: " + e.message; return []; }
}
// while a request is waiting or being worked on, check every 2.5 s (max ~100 s); then refresh what it may have changed
function watchRequests(){
  clearTimeout(askPoll); askPolls = 0;
  const tick = async () => {
    askPolls++;
    const rs = await loadRequests();
    const busy = rs.some((r) => (r.status === "open" || r.status === "working") && Date.parse(r.created_at) > Date.now() - 300000);
    if (busy && askPolls < 40 && $("askDlg").open) askPoll = setTimeout(tick, 2500);
    else { if (askPolls >= 40) loadRequests(); await refreshAll(); }
  };
  askPoll = setTimeout(tick, 1500);
}
function openAsk(listingId, text){
  askListing = listingId || null;
  $("askAbout").textContent = listingId && cache[listingId] ? `About ${cache[listingId].street}, ${cache[listingId].city}` : "";
  $("askText").value = text || ""; $("askDlg").showModal(); askPolls = 40; loadRequests(); $("askText").focus();
}
$("askbtn").onclick = () => openAsk(null);
$("askClose").onclick = () => { clearTimeout(askPoll); $("askDlg").close(); };
$("askList").addEventListener("click", async (e) => {
  const b = e.target.closest("button.asknow"); if (!b) return;
  b.disabled = true;
  try { await post("me", { action: "ask_now", request_id: Number(b.dataset.id) }); watchRequests(); }
  catch (err) { b.textContent = "Couldn't: " + err.message; }
});
$("askSend").onclick = async () => {
  const text = $("askText").value.trim(); if (!text) return;
  try { await post("me", { action: "request", text, listing_id: askListing ? Number(askListing) : null }); $("askText").value = ""; askPolls = 0; await loadRequests(); watchRequests(); }
  catch (e) { $("askList").textContent = "Couldn't send: " + e.message; }
};

// =====================================================================================
// MORE: health, alerts, facts, add a place, lock
// =====================================================================================
const gmailOk = () => fresh(inbox?.health.gmail_ping, 15);
// a site needs you when it's broken or blocked, or hasn't been read for 45 minutes (it runs every 15)
const siteBad = (s) => s.enabled && (["broken", "blocked"].includes(s.state) || !fresh(s.last_run_at, 45));
const healthBroken = () => (!!inbox && ((!!inbox.health.gmail_ping && !gmailOk()) || (!!inbox.health.remind_last_run && !fresh(inbox.health.remind_last_run, 30)))) || !!sites?.sites.some(siteBad);

// ---- Sites: what the reader watches, how it's doing, and its recipes ----
let sites = null;
const SITE_STATE = { ok: ["ok", "Reading fine"], quiet: ["warn", "Quiet: no new listings for 6 hours"], learning: ["warn", "Learning how to read it…"], broken: ["bad", "Can't read it"], blocked: ["bad", "Blocks automatic reading"] };
const siteName = (code) => sites?.sites.find((s) => s.site === code)?.name || cap(code || "");
const siteList = () => sites ? sites.sites.filter((s) => s.enabled).map((s) => s.name).join(", ") || "no sites" : "Kamernet and more";
async function loadSites(){
  if (!pass) return;
  const first = !sites;
  try { sites = await fn("reader?sites=1"); } catch { return; }
  if (first) headline(); // it names the sites
  renderBadges();
  if (!$("v-more").hidden){ drawSites(); drawHealth(); }
}
function drawSites(){
  if (!sites){ $("sites").textContent = "Loading…"; return; }
  $("sites").innerHTML = sites.sites.map((s) => {
    const [dot, txt] = !s.enabled ? ["", "Turned off"] : !s.recipe_version ? ["warn", "Not learned yet"] : !fresh(s.last_run_at, 45) && !["broken", "blocked"].includes(s.state) ? ["bad", "Not read for a while"] : SITE_STATE[s.state] || ["warn", s.state];
    const by = String(s.learned_by || "").replace(/^anthropic\//, "AI: ").replace(/^openai\//, "AI: ");
    return `<div class="site${s.enabled ? "" : " off"}" data-site="${esc(s.site)}">
      <div class="hl"><span class="dot ${dot}"></span><span><b>${esc(s.name)}</b> · ${esc(txt)}</span></div>
      ${s.state_note && s.state !== "ok" ? `<p class="why">${esc(cap(s.state_note))}</p>` : ""}
      <div class="facts"><span>${plural(s.listings, "open listing")}</span>${s.last_run_at ? `<span>Read ${ago(s.last_run_at)}</span>` : ""}${s.last_new_at ? `<span>Newest ${ago(s.last_new_at)}</span>` : ""}
        ${s.recipe_version ? `<span>Recipe ${s.recipe_version}${s.learned_at ? `, learned ${ago(s.learned_at)}` : ""}${by ? ` (${esc(by)})` : ""}</span>` : ""}${s.fetch_via === "db" ? "<span>Read through the database server</span>" : ""}</div>
      <div class="btnrow"><button class="btn ghost small" type="button" data-s="run">Check now</button><button class="btn ghost small" type="button" data-s="learn">Re-learn</button>
        <label class="toggle small"><input type="checkbox" data-s="enable" ${s.enabled ? "checked" : ""}> On</label></div>
    </div>`;
  }).join("") || '<p class="why">No sites yet.</p>';
  const KIND = { learned: "Learned", learn_failed: "Couldn't learn", broken: "Broke", blocked: "Blocked", quiet: "Quiet", recovered: "Recovered" };
  $("sitelog").innerHTML = (sites.log || []).slice(0, 15).map((l) => `<div class="ev"><b>${esc(siteName(l.site))}: ${esc(KIND[l.kind] || l.kind)}</b> <small>${ago(l.at)}${l.cost_usd ? " · " + euro(Number(l.cost_usd)) : ""}</small><br>${esc(l.note)}</div>`).join("") || '<p class="why">Nothing yet.</p>';
}
$("sites").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-s]"), box = e.target.closest("[data-site]");
  if (!b || !box || b.dataset.s === "enable") return;
  const code = box.dataset.site, name = siteName(code);
  b.disabled = true; const was = b.textContent; b.textContent = b.dataset.s === "run" ? "Checking…" : "Learning…";
  try {
    if (b.dataset.s === "run"){
      const r = await fn(`reader?run=new&site=${encodeURIComponent(code)}`);
      toast(r.problems?.length && !r.saved ? `${name}: ${r.problems[0]}` : `${name}: ${plural(r.found || 0, "listing")} on the page, ${r.saved || 0} new saved`);
    } else {
      if (!(await confirmBox({ title: `Re-learn ${name}?`, body: `<p>The AI writes a new recipe for ${esc(name)}'s search page and listing pages. The new one is only used if it passes the checks. About ${euro(0.05)}.</p>`, ok: "Re-learn" }))) return;
      const a = await post("reader", { action: "learn", site: code, part: "search" });
      const d = a.ok ? await post("reader", { action: "learn", site: code, part: "detail" }) : a;
      toast(a.ok && d.ok ? `${name}: learned again and checked` : `${name}: couldn't learn it (${(d.note || d.error || "").slice(0, 120)})`, null, !(a.ok && d.ok));
    }
  } catch (err) { toast(`${name}: ${err.message}`, null, true); }
  finally { b.disabled = false; b.textContent = was; loadSites(); }
});
$("sites").addEventListener("change", async (e) => {
  const c = e.target.closest("[data-s=enable]"), box = e.target.closest("[data-site]");
  if (!c || !box) return;
  try { await post("reader", { action: "enable", site: box.dataset.site, on: c.checked }); toast(`${siteName(box.dataset.site)} turned ${c.checked ? "on" : "off"}`); }
  catch (err) { c.checked = !c.checked; toast(err.message, null, true); }
  loadSites();
});
$("siteAdd").onclick = async () => {
  const url = $("siteUrl").value.trim(), name = $("siteName").value.trim(), msg = $("siteMsg");
  if (!/^https?:\/\/\S+\.\S+/.test(url)){ msg.textContent = "Paste the full link, starting with https://"; return; }
  $("siteAdd").disabled = true; msg.textContent = "Learning the site. This takes about a minute; you can keep using the app.";
  try {
    const r = await post("reader", { action: "add", url, name });
    msg.textContent = r.ok ? `Done: ${r.run?.found ?? 0} listings on the page, ${r.run?.saved ?? 0} saved. It's now read every 15 minutes (cost ${euro(r.cost_usd || 0)}).` : `Couldn't add it: ${r.error}${r.note ? ` (${String(r.note).slice(0, 160)})` : ""}`;
    if (r.ok){ $("siteUrl").value = ""; $("siteName").value = ""; headline(); load(true); }
  } catch (e) { msg.textContent = e.message.includes("timed") || e.message.includes("Failed to fetch") ? "Still learning in the background. Check back here in a minute." : "Couldn't add it: " + e.message; }
  $("siteAdd").disabled = false; loadSites();
};
async function loadInbox(){
  if (!pass) return;
  try { inbox = await fn("inbox?setup=1"); inbox.at = Date.now(); } catch { return; }
  renderBadges(); knEnroll();
  if (!$("v-more").hidden) drawHealth();
}
// On the PC with the "Kamernet Live sender" helper installed, the helper marks this page "needs-token". The site (unlocked with
// the passcode) then gets the helper its own key from function kn-send and hands it over inside this browser: nothing to paste.
async function knEnroll(){
  if (document.documentElement.dataset.knSender !== "needs-token" || knEnroll.busy) return;
  knEnroll.busy = true;
  try {
    const { token } = await post("kn-send", { action: "enroll" });
    window.addEventListener("message", function done(e){ if (e.source === window && e.data?.type === "kn-sender-enrolled"){ window.removeEventListener("message", done); toast("Kamernet sending is set up on this PC."); setTimeout(loadInbox, 40000); } });
    window.postMessage({ type: "kn-sender-token", token }, location.origin);
  } catch (e) { toast("Couldn't set up Kamernet sending on this PC: " + e.message, null, true); }
  knEnroll.busy = false;
}
async function thisPhoneSub(){ try { return await (await navigator.serviceWorker?.getRegistration())?.pushManager.getSubscription(); } catch { return null; } }
async function drawHealth(){
  if (!inbox){ $("health").textContent = "Loading…"; return; }
  const h = inbox.health, line = (cls, txt) => `<div class="hl"><span class="dot ${cls}"></span><span>${txt}</span></div>`;
  const notYet = "not connected yet (Claude sets this up in a chat)";
  const mine = await thisPhoneSub();
  $("health").innerHTML = [
    !sites ? line("warn", "New listings: loading…") : sites.sites.some(siteBad) ? line("bad", `New listings: ${sites.sites.filter(siteBad).map((s) => s.name).join(", ")} need${sites.sites.filter(siteBad).length > 1 ? "" : "s"} a look (see Sites below)`)
      : line("ok", `New listings from ${sites.sites.filter((s) => s.enabled).map((s) => s.name).join(", ")}: read ${ago(sites.sites.filter((s) => s.enabled).map((s) => s.last_run_at).sort()[0])} or later`),
    h.sweep?.at ? line(h.sweep.ok !== false ? "ok" : "bad", `Nightly clean-up of removed ads: ran ${ago(h.sweep.at)}`) : line("bad", "Nightly clean-up of removed ads hasn't run in the last day"),
    h.gmail_ping ? (gmailOk() ? line("ok", `Kamernet messages and landlord emails: checked ${ago(h.gmail_ping)}`) : line("bad", `Gmail check stopped: last run ${ago(h.gmail_ping)}`)) : line("warn", `Kamernet messages and landlord emails: ${notYet}`),
    Number(h.gmail_version || 0) >= 2 && gmailOk() ? line(h.failed_emails ? "bad" : "ok", `Send for me (email): ready${h.queued_emails ? ` · ${h.queued_emails} going out` : ""}${h.failed_emails ? ` · ${h.failed_emails} failed (open them in Inbox)` : ""}`) : line("warn", `Send for me (email): ${h.gmail_ping ? "needs the newer Gmail connection (Claude updates it in a chat)" : notYet}`),
    !h.kn_sender_ping ? line("warn", "Send for me (Kamernet): not set up yet (Claude installs the helper in Chrome on your PC, in a chat)")
      : line(h.kn_failed ? "bad" : knOnline() ? "ok" : "warn", `Send for me (Kamernet): ${knOnline() ? "ready, your PC is on" : `your PC is off or Chrome is closed (last seen ${ago(h.kn_sender_ping)}); messages wait until it's back`}${h.kn_queued ? ` · ${h.kn_queued} going out` : ""}${h.kn_failed ? ` · ${h.kn_failed} failed (open them in Inbox)` : ""}${h.kn_sender_last_sent ? ` · last sent ${ago(h.kn_sender_last_sent)}` : ""}`),
    // since 25 Oct 2026 the Chrome helper reads WhatsApp Web on the PC (the phone forwarder never worked)
    h.wa_read && Date.now() - Date.parse(h.wa_read) < 10 * 60000
      ? line(h.wa_read_error ? "bad" : "ok", h.wa_read_error ? `WhatsApp from landlords: your PC can't read WhatsApp Web (${esc(String(h.wa_read_error).slice(0, 120))}). Open web.whatsapp.com in Chrome on your PC and scan the QR code with your phone if it asks.`
        : `WhatsApp from landlords: read from WhatsApp Web on your PC, checked ${ago(h.wa_read)}${h.phone_last ? ` · last one ${ago(h.phone_last)}` : ""}. Chats stay unread on your phone.`)
      : h.wa_read ? line("warn", `WhatsApp from landlords: your PC is off or Chrome is closed (last read ${ago(h.wa_read)}); new ones come in when it's back`)
      : Number(String(h.kn_sender_version || "0").replace(/^(\d+)\.(\d+).*/, "$1.$2")) < 2.1 && h.kn_sender_ping ? line("warn", "WhatsApp from landlords: the PC helper needs a restart to start reading WhatsApp Web (Chrome: restart it, or reload the helper in chrome://extensions)")
      : h.phone_last ? line("ok", `WhatsApp from landlords (your phone): last one ${ago(h.phone_last)}`)
      : h.phone_seen ? line("bad", `WhatsApp from landlords (your phone): MacroDroid reached Kamernet Live ${ago(h.phone_seen)} but the message was unusable (${esc(String(h.phone_result || "unknown").slice(0, 120))})`)
      : line("warn", `WhatsApp from landlords (your phone): MacroDroid has never reached Kamernet Live`),
    inbox.push_devices ? line("ok", `Alerts on ${plural(inbox.push_devices, "device")}${mine ? " (this one too)" : " (not this one)"}${h.last_push ? ` · last alert ${ago(h.last_push)}` : ""}`) : line("warn", "Alerts: no phone has them on yet"),
    h.remind_last_run ? line(fresh(h.remind_last_run, 30) ? "ok" : "bad", `Viewing and payment reminders: checked ${ago(h.remind_last_run)}`) : line("warn", "Viewing and payment reminders: not run yet"),
    h.ask_last_error ? line("bad", `Tell Claude: last error ${esc(String(h.ask_last_error).slice(0, 160))}`) : line("ok", `Tell Claude: working${h.ask_last_run ? " · last request " + ago(String(h.ask_last_run).slice(0, 24)) : ""}`),
  ].join("");
  $("pushOn").hidden = !!mine; $("pushTest").hidden = !mine; $("pushOff").hidden = !mine;
}
const b64ToU8 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
$("pushOn").onclick = async () => {
  const info = $("pushInfo");
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)){ info.textContent = "This browser can't show alerts. Open this page in Chrome on your Android phone."; return; }
  try {
    if (await Notification.requestPermission() !== "granted"){ info.textContent = "Alerts are blocked for this site. In Chrome tap the icon left of the address, then Permissions, Notifications: Allow. Then press the button again."; return; }
    info.textContent = "Turning on…";
    const reg = await navigator.serviceWorker.register("sw.js"); await navigator.serviceWorker.ready;
    if (!inbox) await loadInbox();
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(inbox.vapid_public) });
    await post("inbox", { action: "subscribe", sub: sub.toJSON(), label: /Android/i.test(navigator.userAgent) ? "Android phone" : "Computer" });
    info.textContent = "Alerts are on for this device.";
    await loadInbox(); drawHealth();
  } catch (err) { info.textContent = "Couldn't turn on alerts: " + err.message; }
};
$("pushTest").onclick = async () => {
  try {
    const sub = await thisPhoneSub();
    const r = await post("inbox", { action: "test_push", endpoint: sub?.endpoint || "" });
    $("pushInfo").textContent = r.subs || r.sent ? "Test alert sent to this device. It should arrive in a few seconds." : "This device doesn't have alerts on.";
    loadInbox();
  } catch (err) { $("pushInfo").textContent = "Couldn't send: " + err.message; }
};
$("pushOff").onclick = async () => {
  if (!await confirmBox({ title: "Turn off alerts on this device?", ok: "Turn off", danger: true, body: "<p>You won't get a buzz here when a landlord writes. Other devices keep their alerts.</p>" })) return;
  try {
    const sub = await thisPhoneSub();
    if (sub){ await post("inbox", { action: "unsubscribe", endpoint: sub.endpoint }); await sub.unsubscribe(); }
    $("pushInfo").textContent = "Alerts are off for this device."; await loadInbox(); drawHealth();
  } catch (err) { $("pushInfo").textContent = "Couldn't turn them off: " + err.message; }
};

// ---- facts about you: autosave ----
const TOPICS = ["Timing", "Money", "Who", "Needs", "Decisions", "Writing rules", "From drafts", "Other"];
async function loadFacts(){
  try { facts = (await fn("me?facts=1")).facts || []; } catch (e) { $("meList").textContent = "Couldn't load: " + e.message; return; }
  const by = {}; for (const f of facts) (by[f.topic] ||= []).push(f);
  $("meList").innerHTML = TOPICS.filter((t) => by[t]).map((t) => `<h4>${t}</h4>${by[t].map(factRow).join("")}`).join("") || '<p class="why">No facts yet.</p>';
}
function factRow(f){
  return `<div class="fact" data-id="${f.id || ""}">
    <div class="row"><select class="ftopic" aria-label="Topic">${TOPICS.map((t) => `<option ${t === (f.topic || "Other") ? "selected" : ""}>${t}</option>`).join("")}</select>
      <input class="fq" value="${esc(f.question || "")}" placeholder="Question or subject"></div>
    <textarea class="fa" placeholder="Your answer">${esc(f.answer || "")}</textarea>
    <div class="foot"><span class="fst">${f.source && f.source !== "me" ? "added by " + esc(f.source) : ""}</span><button class="btn ghost small danger fdel" type="button">Delete</button></div>
  </div>`;
}
$("meAdd").onclick = () => { $("meList").insertAdjacentHTML("afterbegin", factRow({ topic: "Other" })); $("meList").querySelector(".fq").focus(); };
async function saveFact(row){
  const st = row.querySelector(".fst");
  if (!row.querySelector(".fq").value.trim() && !row.querySelector(".fa").value.trim()) return;
  st.textContent = "Saving…";
  try {
    const r = await post("me", { action: "fact_save", id: Number(row.dataset.id) || undefined, topic: row.querySelector(".ftopic").value, question: row.querySelector(".fq").value, answer: row.querySelector(".fa").value });
    row.dataset.id = r.id; st.textContent = "Saved ✓";
  } catch (err) { st.textContent = "Couldn't save: " + err.message; }
}
$("meList").addEventListener("change", (e) => { const row = e.target.closest(".fact"); if (row) saveFact(row); });
$("meList").addEventListener("click", async (e) => {
  const row = e.target.closest(".fact"); if (!row || !e.target.closest(".fdel")) return;
  if (!row.dataset.id){ row.remove(); return; }
  const q = row.querySelector(".fq").value;
  if (!await confirmBox({ title: "Delete this fact?", ok: "Delete", danger: true, body: `<p>${esc(q)}</p><p class="why">Claude stops using it in messages.</p>` })) return;
  try { await post("me", { action: "fact_delete", id: Number(row.dataset.id) }); row.remove(); toast("Deleted."); }
  catch (err) { toast("Couldn't delete: " + err.message, null, true); }
});

// ---- add a place that isn't on Kamernet ----
$("addbtn").onclick = () => { $("apInfo").textContent = ""; $("addDlg").showModal(); $("apStreet").focus(); };
$("addClose").onclick = () => $("addDlg").close();
$("apSave").onclick = async () => {
  const v = (i) => $(i).value.trim();
  if (!v("apStreet") || !v("apCity") || !v("apPrice")){ $("apInfo").textContent = "Fill in at least street, city and rent."; return; }
  $("apInfo").textContent = "Adding…";
  try {
    const r = await post("deal", { action: "add_place",
      place: { street: v("apStreet"), city: v("apCity"), price: v("apPrice"), kind: v("apKind"), people: v("apPeople"), size_m2: v("apSize"), available_from: v("apFrom"), url: v("apUrl"), notes: v("apNotes"), stage: v("apStage") },
      contact: { name: v("apCName"), email: v("apCEmail"), phone: v("apCPhone") } });
    $("addDlg").close();
    document.querySelectorAll("#addDlg input, #addDlg textarea").forEach((i) => { i.value = ""; });
    await Promise.all([loadStatuses(), loadDeals()]);
    openListing(r.id);
  } catch (err) { $("apInfo").textContent = "Couldn't add it: " + err.message; }
};
$("lockbtn").onclick = async () => { if (await confirmBox({ title: "Lock this device?", ok: "Lock" })) lockOut("Locked. Enter the passcode to open it again."); };

// =====================================================================================
// LOADING AND START
// =====================================================================================
async function loadStatuses(){ try { const b = await fn("status"); statuses = Object.fromEntries(b.statuses.map((s) => [String(s.id), s])); } catch {} }
async function loadThreads(){ try { const b = await fn("status?threads=1"); threads = Object.fromEntries(b.threads.map((t) => [String(t.id), t])); } catch {} }
async function loadDeals(){ try { const r = await fn("deal?all=1"); deals = r.deals || {}; contacts = r.contacts || {}; } catch {} }
async function loadDrafts(){ try { drafts = (await fn("apply?queue=1")).items || []; } catch {} }
function renderAll(){
  renderList();
  if (!$("v-leads").hidden) renderLeads();
  if (!$("v-inbox").hidden) renderInbox();
  renderBadges();
}
// fetch everything again: statuses, messages, drafts, deals, inbox, the Find list and your leads' cards.
// quiet = the timer did it: don't redraw an open listing while you're typing in it
async function refreshAll(quiet = false){
  // one part failing (a slow function, a bad answer) must not stop the rest
  await Promise.allSettled([loadStatuses(), loadThreads(), loadDrafts(), loadDeals(), loadInbox(), loadSites(), headline(), refreshRows(leadIds())]);
  const typing = document.activeElement?.closest?.("#lp") && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  try { if (lpId){ await loadThread(lpId); if (!(quiet && typing)) lpRender(); } } catch {}
  try { renderAll(); } catch {}
  await reloadList();
}
// new info shows up by itself: every 30 s while the site is open on screen
setInterval(() => { if (document.visibilityState === "visible" && pass && !$("app").hidden) refreshAll(true).catch(() => {}); }, 30000);
const hashId = () => (location.hash.match(/l=(\d+)/) || [])[1] || null;
const openSites = () => { showTab("more"); setTimeout(() => $("sitesPanel").scrollIntoView({ behavior: "smooth" }), 50); history.replaceState(null, "", location.pathname + location.search); };
window.addEventListener("hashchange", () => { if (pass && location.hash === "#sites") openSites(); else if (pass && hashId() && hashId() !== lpId) openListing(hashId()); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && pass && !$("app").hidden) refreshAll(); });
async function boot(){
  $("sort").value = S.sort; drawSortDir();
  renderLoc(); renderActive(); applyView();
  await Promise.all([loadStatuses(), loadThreads(), loadDeals(), loadDrafts()]);
  showTab(["find", "leads", "inbox", "more"].includes(S.tab) ? S.tab : "find");
  load(true); headline(); loadTags(); loadCities(); loadInbox(); loadSites();
  renderLeads(); watchSending();
  if (hashId()) openListing(hashId()); // a phone alert opened one listing
  else if (location.hash === "#sites") openSites(); // an alert about a site
}
function enterApp(){ $("lock").hidden = true; $("app").hidden = false; boot().catch((e) => toast("Couldn't start: " + e.message, null, true)); }
$("passbtn").onclick = async () => {
  const v = $("pass").value.trim(); if (!v) return;
  pass = v; store.set("kn_pass", v); $("pass").value = "";
  try { await rest("listings?select=id&limit=1"); } catch { return; }
  enterApp();
};
$("pass").addEventListener("keydown", (e) => { if (e.key === "Enter") $("passbtn").click(); });
if (pass) enterApp(); else $("lock").hidden = false;
