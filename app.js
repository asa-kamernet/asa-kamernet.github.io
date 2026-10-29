"use strict";
// Kamernet Live. The whole search happens here, on four tabs:
//   Find      every listing (filters, location + distance, list or map); "Select" to act on several at once
//   To do     everything waiting on you: questions (each asked once), viewing verdicts, messages to send, payments,
//             messages that need a place (internal tab key "inbox")
//   Places    where each place stands: coming up, deals, talking, saved, closed (internal tab key "leads")
//   More      alerts and health, facts about you, add a place, lock
// Tapping any listing opens its page: status, your message, the conversation, the landlord, the deal, the AI summary.
// NOTHING here sends to a landlord except "Send for me" (one message) and "Send all" in To do (every ready email and Kamernet
// draft; Asa, 25 Oct 2026), each after an "Are you sure?": email goes out through
// the Gmail script, Kamernet through the "Kamernet Live sender" helper in Chrome on Asa's PC (kamernet-sender-extension).

// ---- Settings (public values only; the passcode is typed on the site and never stored in this file) ----
const SUPA = "https://sldfjyrpopypzbmhvbkq.supabase.co";
const PAGE = 30;
// one status per place (Asa, 28 Oct 2026): 8 steps; "Viewed" means you gave your verdict. Registered is not a step.
const STAGES = ["none","applied","replied","booked","viewed","offer","signed","moved"];
const STAGE_LABEL = { none: "Saved", applied: "Messaged", replied: "Talking", booked: "Viewing", viewed: "Viewed", offer: "Offer", signed: "Signed", moved: "Moved in" };
const STAGE_HINT = { none: "You saved it", applied: "You sent the first message", replied: "The landlord wrote back", booked: "A viewing is planned", viewed: "You've seen it and said what you think", offer: "They offered it to you", signed: "You signed the contract", moved: "You live there" };
// the heart is your opinion; "Not for me" closes the place (closed me_no)
const CLOSED_LABEL = { them_no: "They said no", me_no: "I said no", gone: "Ad gone", scam: "Looks like a scam", no_reply: "Gone quiet", found: "I found a place" };
const STOP_REASONS = [["them_no", "They said no"], ["me_no", "I said no"], ["scam", "Looks like a scam"]];
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
const orderBy = () => S.sort === "status" ? "first_seen_at.desc" : `${S.sort === "per_person" ? "pp_allin" : S.sort}.${S.dir}.nullslast`;
// Status sort: places you're in touch with come first (furthest along or just started), then everything else, newest first
const statusRank = (id) => STAGES.indexOf(stageOf(String(id))) * 10 + (stOf(String(id)).opinion === "want" ? 3 : 0);
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
const cache = {};                // listing id -> row (from any list, kept for Places, To do and the listing page)
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
// the server owns the stage; a viewing that has passed stays at Viewing until you give your verdict
const stageOf = (id) => STAGES.includes(stOf(id).stage) ? stOf(id).stage : "none";
const isClosed = (id) => !!stOf(id).closed;
const unsent = () => drafts.filter((d) => d.send_status !== "sent");
const draftOf = (id) => unsent().find((d) => String(d.listing_id) === String(id));
// "Nothing to answer" (e.g. an automatic reply) hides their last message until a newer one comes in
const needsReply = (id) => threads[id]?.last_dir === "in" && !isClosed(id) && !(Date.parse(stOf(id).seen_in_at || 0) >= Date.parse(threads[id].last_at));
const needsVerdict = (id) => !isClosed(id) && stageOf(id) === "booked" && !!stOf(id).viewing_at && Date.parse(stOf(id).viewing_at) < Date.now();
const payToApprove = (id) => (deals[id]?.payments || []).some((p) => p.status === "proposed");
const SENDING = ["queued", "sending", "kn_queued", "kn_sending"]; // kn_ = on its way through Kamernet (the PC helper)
const isSending = (d) => SENDING.includes(d?.send_status);
const draftReady = (id) => { const d = draftOf(id); return !!d && !isSending(d) && !isClosed(id); };
// the Kamernet sender in Chrome on the PC asked for work in the 3 minutes before the health was loaded
const knOnline = () => { const p = inbox?.health?.kn_sender_ping; return !!p && (inbox.at || Date.now()) - Date.parse(p) < 180000; };
const yourMove = (id) => needsReply(id) || needsVerdict(id) || draftReady(id) || (!isClosed(id) && payToApprove(id));
const divisor = (r) => r.people == null ? null : r.people > 1 ? Math.max(1, Math.min(S.ppl, r.people)) : 1;
const ppOf = (r) => { const d = divisor(r); return d ? Math.round(r.price / d) : null; };
// sort and filter on what you'd really pay (Asa, 27 Oct 2026): a price without bills gets typical bills added (same numbers as DB column price_allin)
const billsEst = (r) => r.utilities_incl === false ? (r.kind === "apartment" ? 200 : r.kind === "studio" ? 150 : 100) : 0;
const ppAllOf = (r) => { const d = divisor(r); return d && r.price != null ? Math.round((r.price + billsEst(r)) / d) : null; };
const dealStarted = (id) => !!deals[id] || ["offer", "signed", "moved"].includes(stageOf(String(id)));
// ad offline: with no conversation it is archived as "Ad gone"; with one it stays and shows "The ad is offline"
const adGone = (id) => !!cache[id]?.gone_at;
const hasTalk = (id) => !!threads[id] || STAGES.indexOf(stageOf(String(id))) >= 1;
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
  if (!res.ok) throw new Error(aiErr(body.error) || `HTTP ${res.status}`);
  return body;
}
// the AI account's spending cap, said plainly instead of OpenRouter's raw error
const aiErr = (m) => m && /key limit exceeded|monthly limit/i.test(m) ? "the AI account reached its monthly spending limit (raise it on openrouter.ai, Keys)" : m;
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
  if (tab !== "leads" && lselecting) lSetSelect(false);
  if (tab === "leads") renderLeads();
  if (tab === "inbox") renderInbox();
  if (tab === "more"){ drawHealth(); drawSites(); loadSites(); loadFacts(); loadPeople().then(drawPeople); }
  if (tab === "find" && S.view === "map" && map) setTimeout(() => map.invalidateSize(), 0);
  window.scrollTo(0, 0);
}
document.querySelector(".tabs").onclick = (e) => { const b = e.target.closest("button[data-tab]"); if (b) showTab(b.dataset.tab); };
function renderBadges(){
  const tb = (id, n) => { $(id).hidden = !n; $(id).textContent = n > 99 ? "99+" : n; };
  tb("tb-inbox", todoCount());
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
    const alts = [`and(people.is.null,price_allin.lte.${S.max})`, `and(people.lte.1,price_allin.lte.${S.max})`];
    for (let k = 2; k < S.ppl; k++) alts.push(`and(people.eq.${k},price_allin.lte.${S.max * k})`);
    alts.push(`and(people.gte.${Math.max(2, S.ppl)},price_allin.lte.${S.max * S.ppl})`);
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
  const hide = known.filter((id) => isClosed(id) || (S.hideContacted && stageOf(id) !== "none")); // closed ones live in Places
  if (hide.length) p.push(`id=not.in.(${hide.join(",")})`);
  if (ands.length) p.push(`and=(${ands.join(",")})`);
  return p;
}
const SELECT = "id,url,kind,city,street,title,price,people,per_person,size_m2,utilities_incl,deposit,available_from,available_until,tags,distill_tags,reg,distilled_at,distill_model,distilled,photos,first_seen_at,gone_at,source,posted:raw->>publishDate,pc:facts->>postcode,lat:facts->>lat,lng:facts->>lng,form_bills:facts->form_bills,check_reasons,dup_of,dup_ignore";
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
  return `<span class="price">${eur(pp ?? r.price)}<small>${pp != null && divisor(r) > 1 ? " pp" : pp != null ? " /mo" : " total"}${r.utilities_incl === false ? " + bills" : ""}</small></span>`;
}
function statePill(id){
  id = String(id);
  if (isClosed(id)) return `<span class="badge bad">${esc(CLOSED_LABEL[stOf(id).closed] || "Closed")}</span>`;
  const sg = stageOf(id), op = stOf(id).opinion;
  return (sg !== "none" || statuses[id] ? `<span class="badge stage">${STAGE_LABEL[sg]}</span>` : "") + (op === "want" ? `<span class="badge ai">♥ Want it</span>` : "");
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
  if (S.sort === "per_person"){ const dir = S.dir === "desc" ? -1 : 1, k = (r) => ppAllOf(eff(r)) ?? dir * 1e9; loaded.sort((a, b) => dir * (k(a) - k(b))); }
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
// integrity = cdnjs's own SHA-512 of each file (checked 29 Oct 2026): a changed file on the CDN is refused, never run
const SRI = {
  "leaflet/1.9.4/leaflet.css": "sha512-Zcn6bjR/8RZbLEpLIeOwNtzREBAJnUKESxces60Mpoj+2okopSAcSUIUOseddDm0cxnGQzxIR7vJgsLZbdLE3w==",
  "leaflet.markercluster/1.5.3/MarkerCluster.css": "sha512-mQ77VzAakzdpWdgfL/lM1ksNy89uFgibRQANsNneSTMD/bj0Y/8+94XMwYhnbzx8eki2hrbPpDm0vD0CiT2lcg==",
  "leaflet/1.9.4/leaflet.js": "sha512-BwHfrr4c9kmRkLw6iXFdzcdWV/PGkVgiIyIWLLlTSXzWQzxuSg4DiQUCpauz/EWjgk5TYQqX/kvn9pG1NpYfqg==",
  "leaflet.markercluster/1.5.3/leaflet.markercluster.js": "sha512-OFs3W4DIZ5ZkrDhBFtsCP6JXtMEDGmhl0QPlmWYBJay40TT1n3gt2Xuw8Pf/iezgW9CdabjkNChRqozl/YADmg==",
  "pdf.js/3.11.174/pdf.min.js": "sha512-q+4liFwdPC/bNdhUpZx6aXDx/h77yEQtn4I1slHydcbZK34nLaR3cAeYSJshoxIOq3mjEf7xJE8YWIUHMn+oCQ==",
  "pdf.js/3.11.174/pdf.worker.min.js": "sha512-BbrZ76UNZq5BhH7LL7pn9A4TKQpQeNCHOo65/akfelcIBbcVvYWOFQKPXIrykE3qZxYjmDX573oa4Ywsc7rpTw==",
};
const CDNJS = "https://cdnjs.cloudflare.com/ajax/libs/";
const cdnAttrs = (path, attrs) => ({ ...attrs, integrity: SRI[path], crossOrigin: "anonymous" });
function ensureLeaflet(){
  const C = CDNJS, css = (p) => cdnAttrs(p, { rel: "stylesheet", href: C + p }), js = (p) => cdnAttrs(p, { src: C + p });
  return mapLib ||= (async () => {
    cdn("link", css("leaflet/1.9.4/leaflet.css")).catch(() => {});
    cdn("link", css("leaflet.markercluster/1.5.3/MarkerCluster.css")).catch(() => {});
    await cdn("script", js("leaflet/1.9.4/leaflet.js"));
    await cdn("script", js("leaflet.markercluster/1.5.3/leaflet.markercluster.js"));
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
  $("selbar").hidden = !on; $("selbtn").textContent = on ? "Done" : "Select several";
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
// "Many at once" row above the list (Asa, 27 Oct 2026): the bulk actions without first finding Select mode
$("bkpick").onclick = async () => {
  setSelect(true); await refreshEligible();
  if (!eligible.length) return toast("No good matches right now: everything that fits has been contacted or has no AI summary yet. Try “AI summaries for new ones” first.");
  $("selpick").onclick();
};
$("bkai").onclick = () => { setSelect(true); $("selai").onclick(); };
$("bksel").onclick = () => setSelect(true);
$("selpick").onclick = () => {
  const ids = eligible.filter((id) => !picked.has(id)).slice(0, 10);
  ids.forEach((id) => picked.add(id)); renderList();
  toast(`Selected ${plural(ids.length, "good match", "good matches")}: they have an AI summary, you haven't contacted them, they're for 1–2 people and not students-only, women-only, Dutch-only or risky. Untick any you don't want.`);
};
$("selwrite").onclick = async () => {
  const todo = [...picked].filter((id) => !isClosed(String(id)) && stageOf(String(id)) === "none").slice(0, MAX_WRITE);
  const ok = await confirmBox({ title: `Write ${plural(todo.length, "message")}?`, ok: "Write them",
    body: `<p>Claude writes a first message for each, in your style (about ${euro(todo.length * 0.0012)} in total). <b>Nothing is sent.</b> They land in To do, where you check each one. Nothing goes out until you tap Send for me (or send it yourself).</p>${todo.some((id) => draftOf(id)) ? "<p class='why'>Places that already have a message keep it.</p>" : ""}` });
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
  await Promise.all([loadDrafts(), loadQuestions()]); setSelect(false); renderAll();
  toast(`${plural(done, "message")} ready in To do${bad ? `, ${bad} failed (${lastErr})` : ""} · cost ${euro(cost)}`, done ? { label: "Open To do", fn: () => showTab("inbox") } : null, !!bad && !done);
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
// PLACES and TO DO: shared helpers
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
  if (needsReply(id)) return [`They wrote ${ago(threads[id].last_at)}${threads[id].last_body ? `: “${threads[id].last_body.slice(0, 110)}${threads[id].last_body.length > 110 ? "…" : ""}”` : ""}`, draftOf(id) ? "Check my reply" : "Reply", "draft"];
  if (payToApprove(id)) return ["A payment is waiting for your OK.", "Check the payment", "deal"];
  if (draftReady(id)) return [draftOf(id).kind === "reply" ? "Your reply is written and ready to send." : "Your first message is written and ready to send.", "Check and send", "draft"];
  return ["", "Open", ""];
}
function leadCard(id, why, btn, sec, cls = ""){
  const r = cache[id] || { id, street: "A listing", city: "" };
  return `<article class="lead ${cls}" data-id="${id}" data-sec="${sec}" tabindex="0" role="button">
    ${thumb(r)}
    <div class="cardtop"><span class="street">${esc(r.street)}</span>${r.price ? priceHtml(r) : ""}</div>
    <div class="badges">${statePill(id)}<span class="badge">${esc(r.city || "")}</span>${pplIds(peopleAns[id])?.length ? `<span class="badge">${esc(pplNames(peopleAns[id]).replace(/^you and /, "with "))}</span>` : ""}</div>
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
// ---- Questions for Asa (Asa, 26 Oct 2026): each one asked ONCE, answered once, every waiting message rewritten with it ----
let questions = [];
async function loadQuestions(){ try { const r = await post("replydraft", { action: "questions" }); questions = r.questions || []; peopleAns = r.people_answers || {}; } catch {} }
const questionsFor = (aid) => questions.filter((q) => (q.places || []).some((p) => p.application_id === aid));
const waitsOnQ = (d) => questionsFor(d.id).length > 0;
function questionCard(q){
  const places = q.places || [], per = q.scope === "place" && places.length > 1;
  const opts = q.kind === "yesno" ? ["Yes", "No"] : q.kind === "pick" ? (q.options || []) : [];
  const btn = (v, label) => `<button class="btn ghost small qopt" type="button" data-v="${esc(v)}">${esc(label || v)}</button>`;
  if (q.kind === "people") return `<div class="qcard" data-qid="${q.id}">
    <b>${esc(q.text)}</b>
    <div class="why">${places.length ? `Needed for ${plural(places.length, "message")}: ${places.map((p) => esc(p.street || "a place")).join(", ")}` : ""}</div>
    ${q.last_answer && pplIds(q.last_answer) ? `<div class="opts">${btn(q.last_answer, `Same as before: ${pplNames(q.last_answer)}`)}</div>` : ""}
    <div class="pwrap">${peopleChips(null)}</div>
    <div class="btnrow"><button class="btn small qppl" type="button">Save${per ? " for all" : ""}</button></div>
    ${per ? `<details><summary>Different for some places</summary>${places.map((p) => `<div class="qpl"><span>${esc(p.street || "a place")}</span><div class="pwrap" data-lid="${p.listing_id}">${peopleChips(null)}</div></div>`).join("")}<button class="btn small qsavepp" type="button">Save these</button></details>` : ""}
    <div class="btnrow"><button class="btn ghost small qno" type="button">Not needed</button><small class="qst why"></small></div>
  </div>`;
  return `<div class="qcard" data-qid="${q.id}">
    <b>${esc(q.text)}</b>
    <div class="why">${places.length ? `Needed for ${plural(places.length, "message")}: ${places.map((p) => esc(p.street || "a place")).join(", ")}` : q.request_id ? "Claude asked this about something you told it." : String(q.key).startsWith("decide_") ? "A decision only you can make." : ""}</div>
    ${opts.length || q.last_answer ? `<div class="opts">${opts.map((o) => btn(o)).join("")}${q.last_answer ? btn(q.last_answer, `Same as before: ${q.last_answer}`) : ""}</div>` : ""}
    ${q.kind === "yesno" ? "" : `<div class="row"><input class="qin"${q.kind === "date" ? ' type="date"' : ""} placeholder="${per ? "Same answer for all" : "Your answer"}" aria-label="Your answer"><button class="btn small qsave" type="button">Save</button></div>`}
    ${per ? `<details><summary>Different for some places</summary>${places.map((p) => `<label class="qpl"><span>${esc(p.street || "a place")}</span><input class="qpp" data-lid="${p.listing_id}" placeholder="Answer for this place"></label>`).join("")}<button class="btn small qsavepp" type="button">Save these</button></details>` : ""}
    <div class="btnrow"><button class="btn ghost small qno" type="button">Not needed</button><small class="qst why"></small></div>
  </div>`;
}
// one handler for question cards, in To do and on the listing page; true when the click was on a card
async function questionClick(e){
  const card = e.target.closest(".qcard"); if (!card) return false;
  const b = e.target.closest("button"); if (!b) return true;
  const q = questions.find((x) => x.id === Number(card.dataset.qid)); if (!q) return true;
  const closeQ = /^decide_close_\d+$/.test(String(q.key));
  let body;
  if (b.classList.contains("qopt")) body = { answer: b.dataset.v };
  else if (b.classList.contains("qppl")){
    const v = chipsVal(card.querySelector(".pwrap:not([data-lid])")); if (v == null){ toast("Pick who comes along, or Just me.", null, true); return true; }
    body = { answer: v };
  } else if (b.classList.contains("qsavepp") && q.kind === "people"){
    const per = {}; card.querySelectorAll(".pwrap[data-lid]").forEach((w) => { const v = chipsVal(w); if (v != null) per[w.dataset.lid] = v; });
    const all = chipsVal(card.querySelector(".pwrap:not([data-lid])"));
    if (!Object.keys(per).length && all == null){ toast("Pick people for at least one place.", null, true); return true; }
    body = { per_place: per, ...(all != null ? { answer: all } : {}) };
  } else if (b.classList.contains("qsave")){
    const v = card.querySelector(".qin").value.trim(); if (!v){ toast("Write an answer first.", null, true); return true; }
    body = { answer: v };
  } else if (b.classList.contains("qsavepp")){
    const per = {}; card.querySelectorAll(".qpp").forEach((i) => { if (i.value.trim()) per[i.dataset.lid] = i.value.trim(); });
    const all = card.querySelector(".qin")?.value.trim();
    if (!Object.keys(per).length && !all){ toast("Write an answer for at least one place.", null, true); return true; }
    body = { per_place: per, ...(all ? { answer: all } : {}) };
  } else if (b.classList.contains("qno")){
    if (closeQ) body = { answer: "No" };
    else if (!await confirmBox({ title: "Leave this out?", ok: "Leave it out", body: "<p>Claude rewrites the waiting messages without it and won't ask again.</p>" })) return true;
    else body = null;
  } else if (b.classList.contains("pchip") || b.classList.contains("pnew")) return true;
  else return true;
  const st = card.querySelector(".qst"), n = (q.places || []).length;
  card.querySelectorAll("button,input").forEach((x) => { x.disabled = true; });
  st.textContent = n ? `Saving and rewriting ${plural(n, "message")}… (about ${Math.max(10, Math.ceil(n / 3) * 10)} seconds)` : "Saving…";
  try {
    if (closeQ){ // "Looks like a no from X. Close it?" (made when a landlord message reads as a no; nothing closes by itself)
      const r = await post("status", { action: "decide_close", question_id: q.id, answer: body?.answer || "No" });
      await Promise.all([loadQuestions(), refreshAll()]); renderAll(); if (lpId) lpRender();
      toast(r.closed ? "Closed as “They said no”. It's in the Archive (Bring back undoes it)." : "Kept open.");
      return true;
    }
    const r = await post("replydraft", body ? { action: "answer_question", id: q.id, ...body } : { action: "dismiss_question", id: q.id });
    if (q.request_id && body) await post("me", { action: "request", text: `Answer to your question “${q.text}”: ${pplNames(body.answer) || Object.values(body.per_place).map(pplNames).join("; ")}` });
    await Promise.all([loadQuestions(), loadDrafts()]); renderAll(); if (lpId) lpRender();
    toast(body ? `Saved.${r.rewritten ? ` ${plural(r.rewritten, "message")} rewritten with it.` : ""}${r.still_open_for ? ` Still open for ${plural(r.still_open_for, "place")}.` : ""}${r.failed?.length ? ` Couldn't rewrite: ${r.failed.join(", ")}.` : ""}` : "Left out. Claude won't ask again.", null, !!r.failed?.length);
  } catch (err){ st.textContent = "Couldn't save: " + err.message; card.querySelectorAll("button,input").forEach((x) => { x.disabled = false; }); }
  return true;
}
// ---- Answer fields (Asa, 29 Oct 2026): every question in a landlord's message gets its own answer. Claude answers what your fact
// sheet, People, profile or the conversation already say (Change to fix it); the rest is yours to fill in or skip; then "Rewrite
// reply". Answers about you are saved for all places, so you never answer them twice; things they ask you to DO go to Other. ----
const askEd = {}, tellOpen = {}; let todos = [];
async function loadTodos(){ try { todos = (await post("replydraft", { action: "todos" })).todos || []; } catch {} }
const asksOf = (d) => Array.isArray(d?.asks) ? d.asks : [];
const askE = (d, i) => ((askEd[d.id] ||= {})[i] ||= {});
const askVal = (d, i) => { const e = askEd[d.id]?.[i]; return String(e && "v" in e ? e.v : asksOf(d)[i]?.answer ?? ""); };
const askSkip = (d, i) => askEd[d.id]?.[i]?.skip ?? !!asksOf(d)[i]?.skipped;
const askScope = (d, i) => askEd[d.id]?.[i]?.scope ?? asksOf(d)[i]?.scope;
const asksLeft = (d) => asksOf(d).filter((a, i) => !askSkip(d, i) && !askVal(d, i).trim()).length;
// the reply still waits on you: a question nobody answered, a gap left in the text, or you tapped "Change my answers"
const asksPending = (d) => asksOf(d).length > 0 && !isSending(d) && d.send_status !== "sent" && (!!askEd[d.id]?.reopen || asksOf(d).some((a) => !a.answer && !a.skipped) || /\[YOUR ANSWER/i.test(d.draft));
const ASK_SRC = { facts: "your fact sheet", place: "your answer for this place", profile: "your profile", thread: "what you wrote to them", you: "your answer" };
function askShow(a, v){
  if (!v) return "";
  if (a.kind === "people") return pplIds(v) ? pplNames(v).replace(/^./, (c) => c.toUpperCase()) : v;
  if (a.kind === "slot" && v === "none") return "None of these work: ask for another time";
  if (/^\d{4}-\d\d-\d\d(T\d\d:\d\d)?$/.test(v)){
    const t = new Date(v.length === 10 ? v + "T12:00:00" : v);
    return t.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + (v.length > 10 ? " at " + v.slice(11, 16) : "");
  }
  if (a.kind === "money" && /^\d+([.,]\d+)?$/.test(v)) return "€" + v;
  return v;
}
// the right way to answer each kind: buttons, People chips, the calendar pop-up (only their times for a viewing offer), € or text
function askInput(d, a, i){
  const v = askVal(d, i), r = cache[d.listing_id] || {};
  if (a.kind === "yesno" || a.kind === "pick") return `<div class="opts">${(a.kind === "yesno" ? ["Yes", "No"] : a.options || []).map((o) => `<button class="chip" type="button" data-ak="pick" data-v="${esc(o)}" aria-pressed="${v === o}">${esc(o)}</button>`).join("")}</div>`;
  if (a.kind === "people") return `<div class="pwrap" data-ak="ppl">${peopleChips(pplIds(v) ? v : null)}</div>`;
  if (a.kind === "date") return `<input type="date" data-ak="in" value="${esc(/^\d{4}-\d\d-\d\d$/.test(v) ? v : "")}" data-from="${esc(String(r.available_from || "").slice(0, 10))}">`;
  if (a.kind === "slot" || a.kind === "datetime") return `<input type="datetime-local" data-ak="in" value="${esc(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(v) ? v : "")}"${a.kind === "slot" ? ` data-slots="${esc((a.slots || []).join(","))}"${v === "none" ? ' data-none="1"' : ""}` : ""}>${a.kind === "slot" ? `<span class="why">They offered: ${(a.slots || []).map((s) => esc(askShow(a, s))).join(", ")}</span>` : ""}`;
  if (a.kind === "money") return `<label class="money"><span>€</span><input type="number" inputmode="decimal" min="0" data-ak="in" value="${esc(v)}" placeholder="0"></label>`;
  if (a.kind === "long") return `<textarea data-ak="in" rows="3" placeholder="Your answer">${esc(v)}</textarea>`;
  return `<input data-ak="in" value="${esc(v)}" placeholder="Your answer">`;
}
function askRow(d, a, i, claude){
  const v = askVal(d, i), sc = askScope(d, i), e = askEd[d.id]?.[i] || {}, scTxt = sc === "global" ? "for all places" : "only this place";
  if (claude && !e.open) return `<div class="askrow" data-i="${i}"><b>${esc(a.text)}</b><span>${esc(askShow(a, v))}</span>
    <div class="askfoot"><span class="why">${"v" in e && e.v !== a.answer ? "Your new answer" : "From " + (ASK_SRC[a.from] || "your facts")} · ${scTxt}</span><button class="linkbtn" type="button" data-ak="chg">Change</button></div></div>`;
  if (!claude && askSkip(d, i)) return `<div class="askrow" data-i="${i}"><b>${esc(a.text)}</b><span class="why"><i>Skipped: the reply leaves this out.</i></span>
    <div class="askfoot"><span></span><button class="linkbtn" type="button" data-ak="unskip">Answer it after all</button></div></div>`;
  return `<div class="askrow" data-i="${i}"><b>${esc(a.text)}</b>${askInput(d, a, i)}
    <div class="askfoot"><button class="linkbtn" type="button" data-ak="scope">${scTxt.replace(/^./, (c) => c.toUpperCase())} · switch</button>${claude ? `<button class="linkbtn" type="button" data-ak="done">Done</button>` : `<button class="linkbtn" type="button" data-ak="skip">Skip</button>`}</div></div>`;
}
function askBody(d){
  const as = asksOf(d), id = String(d.listing_id), left = asksLeft(d);
  const idx = as.map((a, i) => [a, i]), mine = idx.filter(([a]) => a.answer && !a.skipped), open = idx.filter(([a]) => !(a.answer && !a.skipped));
  const td = todos.filter((t) => String(t.listing_id) === id);
  return `<div class="asks" data-aid="${d.id}">
    ${threads[id]?.last_dir === "in" ? `<div class="msg">${quote(threads[id].last_body, 600)}</div>` : ""}
    <p class="why"><b>They ask ${plural(as.length, "thing")}</b>: Claude answered ${mine.length}, ${open.length} ${open.length === 1 ? "needs" : "need"} you.</p>
    ${mine.length ? `<div class="agroup done"><div class="ghead"><b>Claude answered these</b><span class="why">Check, change if needed</span></div>${mine.map(([a, i]) => askRow(d, a, i, true)).join("")}</div>` : ""}
    ${open.length ? `<div class="agroup open"><div class="ghead"><b>Only you can answer</b><span class="why aleft">${left ? `${left} left` : "All done"}</span></div>${open.map(([a, i]) => askRow(d, a, i, false)).join("")}</div>` : ""}
    ${td.length ? `<p class="why">They also ask you to ${td.map((t) => esc(t.text.charAt(0).toLowerCase() + t.text.slice(1))).join(" and ")}: that's in Other, not in this reply.</p>` : ""}
    <div class="btnrow"><button class="btn small" type="button" data-ak="go"${left ? " disabled" : ""}>Rewrite reply</button>${askEd[d.id]?.reopen ? `<button class="btn ghost small" type="button" data-ak="keep">Keep the reply as it is</button>` : ""}</div>
    <p class="why aleft2"${left ? "" : " hidden"}>Fill in or skip the open ones first.</p>
  </div>`;
}
const askRedraw = () => { renderAll(); if (lpId) lpRender(); };
function askRefresh(box, d){
  const left = asksLeft(d), go = box.querySelector('[data-ak="go"]');
  if (go) go.disabled = !!left;
  const l = box.querySelector(".aleft"); if (l) l.textContent = left ? `${left} left` : "All done";
  const l2 = box.querySelector(".aleft2"); if (l2) l2.hidden = !left;
}
// one handler for the answer fields, in To do and on the place page; true when the click was inside them
async function askClick(e){
  const box = e.target.closest(".asks"); if (!box) return false;
  const d = drafts.find((x) => x.id === Number(box.dataset.aid)), b = e.target.closest("[data-ak]");
  if (!d || !b) return true;
  const row = b.closest(".askrow"), i = row ? Number(row.dataset.i) : -1, k = b.dataset.ak;
  if (k === "ppl"){ setTimeout(() => { const v = chipsVal(row.querySelector(".pwrap")); askE(d, i).v = v ?? ""; askRefresh(box, d); }, 0); return true; } // the chip toggles first (document handler)
  if (k === "pick"){ const x = askE(d, i); x.v = askVal(d, i) === b.dataset.v ? "" : b.dataset.v; askRedraw(); return true; }
  if (k === "chg" || k === "done"){ askE(d, i).open = k === "chg"; askRedraw(); return true; }
  if (k === "skip" || k === "unskip"){ askE(d, i).skip = k === "skip"; askRedraw(); return true; }
  if (k === "scope"){ askE(d, i).scope = askScope(d, i) === "global" ? "place" : "global"; askRedraw(); return true; }
  if (k === "keep"){ delete askEd[d.id]; askRedraw(); return true; }
  if (k !== "go") return true;
  const answers = asksOf(d).map((a, j) => {
    let v = askVal(d, j); const w = box.querySelector(`.askrow[data-i="${j}"] .pwrap`);
    if (w){ const c = chipsVal(w); if (c != null) v = c; }
    return { i: j, answer: v, skipped: askSkip(d, j), scope: askScope(d, j) };
  });
  b.disabled = true; b.textContent = "Rewriting… (about 10 seconds)";
  try {
    const r = await post("replydraft", { action: "answer_asks", application_id: d.id, answers });
    delete askEd[d.id];
    await Promise.all([loadDrafts(), loadQuestions(), loadPeople()]);
    if (!$("v-inbox").hidden) todoTab = "send";
    askRedraw();
    const all = (r.saved || []).filter((s) => s.scope === "global").map((s) => s.text.replace(/\?$/, "").toLowerCase()), here = (r.saved || []).filter((s) => s.scope === "place").length;
    toast(`Reply rewritten: check it, then send it.${all.length ? ` Saved for all places: ${all.join("; ")}.` : ""}${here ? ` ${plural(here, "answer")} kept for this place.` : ""}${r.also_filled ? ` Also filled in ${plural(r.also_filled, "other reply", "other replies")}.` : ""}`,
      r.undo?.length ? { label: "Undo saving", fn: async () => { await post("replydraft", { action: "undo_facts", facts: r.undo }); toast("Your fact sheet is back as it was. The reply stays as written."); } } : null);
  } catch (err){ b.disabled = false; b.textContent = "Rewrite reply"; fail(err); }
  return true;
}
function askTyped(e){
  const inp = e.target.closest?.('[data-ak="in"]'), box = inp?.closest(".asks"); if (!box) return;
  const d = drafts.find((x) => x.id === Number(box.dataset.aid)); if (!d) return;
  const i = Number(inp.closest(".askrow").dataset.i);
  askE(d, i).v = inp.dataset.none ? "none" : inp.value;
  if (e.type === "change" && /date/.test(inp.type)) askRedraw(); else askRefresh(box, d);
}
document.addEventListener("input", askTyped);
document.addEventListener("change", askTyped);
// things a landlord asked you to DO (register on their website, call them): their own card in To do > Other, never in the reply
function todoCard(t){
  const r = cache[t.listing_id] || {};
  let host = ""; try { host = t.link ? new URL(t.link).hostname.replace(/^www\./, "") : ""; } catch {}
  return `<article class="tcard" data-tdid="${t.id}">
    <button class="ttl" type="button" data-tdopen="${t.listing_id}">${esc(r.street || "A place")}${r.city ? `, ${esc(r.city)}` : ""} <span aria-hidden="true">›</span></button>
    <div class="waitline">They asked ${esc(when(t.created_at))}</div>
    <div class="twhy">${esc(t.text)}</div>
    ${t.phone ? `<p class="why">Their number: <b>${esc(t.phone)}</b></p>` : ""}
    <p class="why">Not part of your reply: do it yourself, then tap I did it.</p>
    <div class="btnrow">${host ? `<a class="btn small" href="${esc(t.link)}" target="_blank" rel="noopener noreferrer">Open ${esc(host)}</a>` : ""}${t.phone ? `<a class="btn ghost small" href="tel:${esc(t.phone.replace(/[^\d+]/g, ""))}">Call</a>` : ""}<button class="btn ghost small" type="button" data-td="done">I did it</button><button class="btn ghost small" type="button" data-td="no">Not doing it</button></div>
  </article>`;
}
const openTodos = () => todos.filter((t) => !isClosed(String(t.listing_id)));
async function todoClick(e){
  const o = e.target.closest("[data-tdopen]"); if (o){ openListing(Number(o.dataset.tdopen)); return true; }
  const b = e.target.closest("[data-td]"); if (!b) return false;
  const id = Number(b.closest("[data-tdid]").dataset.tdid), status = b.dataset.td;
  try {
    await post("replydraft", { action: "todo_set", id, status });
    todos = todos.filter((t) => t.id !== id); renderAll();
    toast(status === "done" ? "Noted: done." : "Noted: you're not doing it.", { label: "Undo", fn: async () => { await post("replydraft", { action: "todo_set", id, status: "open" }); await loadTodos(); renderAll(); } });
  } catch (err){ fail(err); }
  return true;
}
// ---- People who may move in with you (Asa, 26 Oct 2026): mini profiles, picked per place for "Who comes along?" ----
// An answer "people:3,5" means those two come along, "people:" means just you. Messages use name + intro, the rest only if asked.
let people = [], peopleAns = {};
async function loadPeople(){ try { people = (await fn("me?people=1")).people || []; } catch {} }
const pplIds = (a) => { const m = /^people:\s*([\d,\s]*)$/.exec(String(a ?? "").trim()); return m ? m[1].split(",").map(Number).filter((x) => x > 0) : null; };
function pplNames(a){
  const ids = pplIds(a); if (!ids) return String(a ?? "");
  const ns = ids.map((i) => people.find((p) => p.id === i)?.name).filter(Boolean);
  return ns.length ? "you and " + ns.join(" and ") : "just you";
}
function peopleChips(a){
  const sel = pplIds(a);
  return `<div class="pchips">${people.map((p) => `<button type="button" class="chip pchip" data-pid="${p.id}" aria-pressed="${!!sel?.includes(p.id)}">${esc(p.name)}</button>`).join("")}
    <button type="button" class="chip pchip" data-pid="0" aria-pressed="${!!sel && !sel.length}">Just me</button>
    <button type="button" class="chip pnew">+ New person</button></div>`;
}
// what the chips in one box say: "people:3,5", "people:" (just me) or null (nothing picked)
function chipsVal(box){
  if (!box) return null;
  const on = [...box.querySelectorAll('.pchip[aria-pressed="true"]')].map((b) => Number(b.dataset.pid));
  if (!on.length) return null;
  return "people:" + on.filter((x) => x > 0).join(",");
}
const yn = (v) => v === true ? "yes" : v === false ? "no" : "";
const ynSel = (id, v) => `<select id="${id}"><option value="">Not said</option><option value="yes" ${v === true ? "selected" : ""}>Yes</option><option value="no" ${v === false ? "selected" : ""}>No</option></select>`;
function personForm(p = {}){
  return `<div class="pform">
    <label class="field">Name<input id="pfName" value="${esc(p.name || "")}" autocomplete="off"></label>
    <label class="field">How you know them<input id="pfRel" value="${esc(p.relation || "")}" placeholder="friend, partner, brother…"></label>
    <div class="row2"><label class="field">Age<input id="pfAge" type="number" min="1" max="119" inputmode="numeric" value="${p.age ?? ""}"></label>
      <label class="field">Has an income${ynSel("pfInc", p.has_income)}</label></div>
    <label class="field">Work or study<input id="pfWork" value="${esc(p.work || "")}"></label>
    <div class="row2"><label class="field">Smokes${ynSel("pfSmk", p.smoker)}</label>
      <label class="field">Registers at the address${ynSel("pfReg", p.registers)}</label></div>
    <label class="field">Pets<input id="pfPets" value="${esc(p.pets || "")}" placeholder="none, a cat…"></label>
    <label class="field">Intro for the landlord (1-2 lines)<textarea id="pfIntro" rows="2">${esc(p.intro || "")}</textarea></label>
    <p class="why">Messages use the name and intro. The rest only goes in when a landlord or the ad asks.</p></div>`;
}
// opens the form; saves and returns the person, or null when cancelled
async function editPerson(p = {}){
  if (!await confirmBox({ title: p.id ? "Edit " + p.name : "New person", ok: "Save", body: personForm(p) })) return null;
  const v = (id) => $(id).value.trim(), b = (id) => v(id) === "yes" ? true : v(id) === "no" ? false : null;
  if (!v("pfName")){ toast("Give them a name first.", null, true); return null; }
  try {
    const r = await post("me", { action: "person_save", id: p.id, name: v("pfName"), relation: v("pfRel"), age: v("pfAge") ? Number(v("pfAge")) : null, work: v("pfWork"),
      has_income: b("pfInc"), smoker: b("pfSmk"), pets: v("pfPets"), registers: b("pfReg"), intro: v("pfIntro") });
    await loadPeople(); if (!$("v-more").hidden) drawPeople();
    toast(p.id ? "Saved." : `${r.person.name} added.`);
    return r.person;
  } catch (err){ fail(err); return null; }
}
function drawPeople(){
  $("pplList").innerHTML = people.map((p) => {
    const bits = [p.relation, p.age ? p.age + "" : "", p.work, p.has_income != null ? "income: " + yn(p.has_income) : "", p.smoker != null ? "smokes: " + yn(p.smoker) : "",
      p.pets ? "pets: " + p.pets : "", p.registers != null ? "registers: " + yn(p.registers) : ""].filter(Boolean);
    return `<div class="person" data-pid="${p.id}"><b>${esc(p.name)}</b>${bits.length ? `<div class="why">${esc(bits.join(" · "))}</div>` : ""}${p.intro ? `<p>${esc(p.intro)}</p>` : ""}
      <div class="btnrow"><button class="btn ghost small pedit" type="button">Edit</button><button class="btn ghost small danger pdel" type="button">Delete</button></div></div>`;
  }).join("") || '<p class="why">Nobody yet. Add the people who might move in with you; then you pick them per place.</p>';
}
$("pplAdd").onclick = () => editPerson();
$("pplList").addEventListener("click", async (e) => {
  const row = e.target.closest(".person"); if (!row) return;
  const p = people.find((x) => x.id === Number(row.dataset.pid)); if (!p) return;
  if (e.target.closest(".pedit")) return editPerson(p);
  if (!e.target.closest(".pdel")) return;
  if (!await confirmBox({ title: `Delete ${p.name}?`, ok: "Delete", danger: true, body: "<p>Messages you write from now on leave them out. Messages already sent don't change.</p>" })) return;
  try {
    await post("me", { action: "person_delete", id: p.id }); await loadPeople(); drawPeople();
    toast(`${p.name} deleted.`, { label: "Undo", fn: async () => { await post("me", { action: "person_delete", id: p.id, undo: true }); await loadPeople(); drawPeople(); toast("Back."); } });
  } catch (err){ fail(err); }
});
// chips anywhere: tap toggles; "Just me" clears the others; "+ New person" adds one and picks them
document.addEventListener("click", async (e) => {
  const c = e.target.closest(".pchip, .pnew"); if (!c) return;
  const box = c.closest(".pchips");
  if (c.classList.contains("pnew")){
    const p = await editPerson(); if (!p) return;
    box.querySelector('.pchip[data-pid="0"]').setAttribute("aria-pressed", "false");
    box.querySelector('.pchip[data-pid="0"]').insertAdjacentHTML("beforebegin", `<button type="button" class="chip pchip" data-pid="${p.id}" aria-pressed="true">${esc(p.name)}</button>`);
    return;
  }
  const on = c.getAttribute("aria-pressed") !== "true";
  c.setAttribute("aria-pressed", String(on));
  if (on && c.dataset.pid === "0") box.querySelectorAll('.pchip:not([data-pid="0"])').forEach((x) => x.setAttribute("aria-pressed", "false"));
  if (on && c.dataset.pid !== "0") box.querySelector('.pchip[data-pid="0"]').setAttribute("aria-pressed", "false");
});
// listing page: "Who comes along" line with Change
function whoLine(id){
  const a = peopleAns[id];
  if (!people.length && !a) return "";
  return `<div class="wholine" id="lpWho"><span class="lbl">Who comes along</span><span>${a ? esc(cap(pplNames(a))) : '<span class="why">Not chosen yet</span>'}</span>
    <button class="btn ghost small" type="button" data-pp="change">Change</button></div>`;
}
$("lpBody").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-pp]"); if (!b || !lpId) return;
  const id = lpId, w = $("lpWho");
  if (b.dataset.pp === "change"){
    w.innerHTML = `<span class="lbl">Who comes along</span>${peopleChips(peopleAns[id])}<div class="btnrow"><button class="btn small" type="button" data-pp="save">Save</button><button class="btn ghost small" type="button" data-pp="cancel">Cancel</button></div>
      <p class="why">${draftOf(id) ? "Claude rewrites your unsent message for this place to match." : "Used in the messages Claude writes for this place."}</p>`;
    return;
  }
  if (b.dataset.pp === "cancel"){ w.outerHTML = whoLine(id); return; }
  const v = chipsVal(w); if (v == null){ toast("Pick who comes along, or Just me.", null, true); return; }
  w.querySelectorAll("button").forEach((x) => { x.disabled = true; });
  b.textContent = draftOf(id) ? "Saving and rewriting…" : "Saving…";
  try {
    const r = await post("replydraft", { action: "set_people", listing_id: Number(id), people: pplIds(v) });
    await Promise.all([loadQuestions(), loadDrafts()]); lpRender(); renderAll();
    toast(`Saved.${r.rewritten ? " Your message was rewritten." : ""}${r.error ? " Couldn't rewrite the message: " + aiErr(r.error) : ""}`, null, !!r.error);
  } catch (err){ fail(err); lpRender(); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.classList?.contains("qin")){ e.preventDefault(); e.target.closest(".qcard").querySelector(".qsave").click(); } });

// =====================================================================================
// PLACES (tab "leads"): where each place stands. Actions live in To do; a card only says "1 to do".
// =====================================================================================
// Grouped by where each place stands, furthest along first (Asa, 28 Oct 2026). A place moves up by itself with its messages,
// viewing and deal. Archive: stopped places, and ads that went offline before anyone wrote (they come back when the ad does).
const isArchived = (id) => isClosed(id) || (adGone(id) && stageOf(id) === "none" && !threads[id] && !(Date.parse(stOf(id).updated_at || 0) > Date.parse(cache[id].gone_at)));
const archLabel = (id) => isClosed(id) ? CLOSED_LABEL[stOf(id).closed] || "Stopped" : "Ad gone";
function archWhy(id){
  const c = stOf(id).closed, on = siteName(cache[id]?.source);
  return { them_no: "The landlord said no.", me_no: "You stopped it.", scam: "You marked it as a likely scam.", found: "You found a home.",
    no_reply: "No answer for 10 days after your last message.", gone: `The ad went offline on ${on}.` }[c] || `The ad went offline on ${on} before you wrote to them.`;
}
const HEART = '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"></path>';
function segsHtml(id, big){
  const i = STAGES.indexOf(stageOf(id)), last = STAGES.length - 1;
  return `<div class="segs${big ? " big" : ""}" aria-hidden="true">${STAGES.map((_, k) => `<span class="seg${k < i || i === last ? " done" : k === i ? " cur" : ""}"></span>`).join("")}</div>`;
}
// what happens next for a place with nothing waiting on Asa (the place page shows it as "Next step")
function stepItem(id){
  id = String(id);
  const sg = stageOf(id), x = stOf(id), t = threads[id], dl = deals[id] || {};
  const b = (a, txt, ghost) => `<button class="btn small${ghost ? " ghost" : ""}" type="button" data-a="${a}">${txt}</button>`;
  if (isArchived(id)) return { title: `${archLabel(id)}: ${archWhy(id)}`, body: '<p class="why">Nothing is deleted. It comes back by itself if they write again or the ad is back online.</p>', btns: b("bring", "Bring back") };
  if (sg === "none") return draftOf(id) ? { title: "Your first message is written", body: '<p class="why">It\'s in To do, under Send.</p>' }
    : { title: "Saved", body: '<p class="why">Write them a first message when you\'re ready. Claude writes it; nothing goes out until you tap Send.</p>', btns: b("write", "Write the first message") };
  if (sg === "booked" && x.viewing_at) return { title: `Viewing ${when(x.viewing_at)}`, body: '<p class="why">You get a reminder on your phone before it.</p>',
    btns: `<button class="btn small ghost" type="button" data-t="late">I'm running late</button>` };
  if (sg === "booked") return { title: "Agree a viewing time", body: '<p class="why">Put the time under Viewing below once you agree one. You get a reminder before it.</p>' };
  if (sg === "applied" || sg === "replied") return needsReply(id) ? { title: "They wrote to you", body: "" }
    : { title: "Waiting for their reply", body: `<p class="why">${t ? t.last_dir === "out" ? `You wrote ${ago(t.last_at)}. ` : "Their last message needed no answer. " : ""}If it stays quiet for 3 days, a short follow-up is written for you.</p>` };
  if (sg === "viewed") return { title: "Waiting for their decision", body: `<p class="why">${x.opinion === "want" ? "You said you want it. " : ""}Tell the app when they offer it to you.</p>`, btns: b("startdeal", "They offered it") };
  if (sg === "offer") return { title: "The deal", body: '<p class="why">Check the contract and the payments below before you sign or pay anything.</p>', btns: b("godeal", "Open the deal", true) };
  if (sg === "signed") return { title: dl.after?.move_in ? `Move-in day ${dayTxt(dl.after.move_in + "T12:00:00")}` : "Signed", body: '<p class="why">Next: move in, then register at the municipality (see the deal below).</p>', btns: b("moved", "I moved in") };
  return { title: "Your home", body: '<p class="why">You live here.</p>' };
}
let leadsToken = 0, archOpen = false;
const PLACE_GROUPS = [["Home", ["moved"]], ["Deal", ["offer", "signed"]], ["Viewing", ["booked", "viewed"]], ["Talking", ["replied"]], ["Messaged, waiting", ["applied"]], ["Saved", ["none"]]];
async function renderLeads(){
  const my = ++leadsToken, ids = leadIds();
  await ensureRows(ids);
  if (my !== leadsToken) return;
  const open = ids.filter((id) => !isArchived(id)).sort((a, b) => lastAt(b) - lastAt(a));
  const arch = ids.filter(isArchived).sort((a, b) => lastAt(b) - lastAt(a));
  const ag = agendaItems(), views = ag.filter((i) => i.what === "Viewing");
  const days = [...Array(7)].map((_, k) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + k); return d; });
  const coming = ag.length ? `<section class="pcoming"><h2>Coming up</h2>
    <div class="week">${days.map((d, k) => `<div class="day${k ? "" : " today"}${ag.some((i) => new Date(i.t).toDateString() === d.toDateString()) ? " ev" : ""}">${d.toLocaleDateString("en-GB", { weekday: "short" })}<b>${d.getDate()}</b></div>`).join("")}</div>
    ${ag.map((i) => {
      const r = cache[i.id] || {}, clash = i.what === "Viewing" && views.some((v) => v !== i && Math.abs(v.t - i.t) < 90 * 60000);
      return `<button class="crow${clash ? " clash" : ""}" type="button" data-id="${i.id}" data-sec="${i.sec}"><span class="when">${esc(i.day ? dayTxt(i.t) : when(i.t))}</span><span>${esc(i.what)} · ${esc(r.street || "a listing")}${clash ? " · <b>clashes with another viewing</b>" : ""}</span></button>`;
    }).join("")}</section>` : "";
  const pcard = (id) => {
    const r = cache[id] || { street: "A listing" }, sg = stageOf(id), td = todoItem(id), st = stepItem(id);
    return `<button class="pcard${sg === "moved" ? " home" : ""}${lpicked.has(id) ? " picked" : ""}" type="button" data-id="${id}" data-sec="${td?.sec || ""}">
      <span class="pc-top"><span class="addr">${esc(r.street)}</span>${r.price ? priceHtml(r) : ""}</span>
      <span class="meta">${esc([r.city, cap(r.kind || ""), r.size_m2 ? r.size_m2 + " m²" : ""].filter(Boolean).join(" · "))}</span>
      ${segsHtml(id)}
      <span class="pc-bot"><span class="pchip">${sg === "moved" ? "Home" : STAGE_LABEL[sg]}</span>${stOf(id).opinion === "want" ? `<svg class="miniheart" width="16" height="16" viewBox="0 0 24 24" role="img" aria-label="You want it">${HEART}</svg>` : ""}${adGone(id) && r.source !== "manual" ? `<span class="pchip gone">Ad offline on ${esc(siteName(r.source))}</span>` : ""}<span class="next">${td ? td.why : esc(st.title)}</span>${td?.count ? '<span class="pchip todo">In To do</span>' : ""}</span>
    </button>`;
  };
  $("leadsub").textContent = open.length ? plural(open.length, "place") : "";
  $("lselbtn").hidden = !open.length && !lselecting;
  $("leads").innerHTML = (open.length || arch.length
    ? `<p class="lead-txt">Grouped by where each place stands, furthest along first. A place moves up by itself as its messages, viewing and deal go on.</p>`
      + coming
      + PLACE_GROUPS.map(([title, sgs]) => { const g = open.filter((id) => sgs.includes(stageOf(id))); return g.length ? `<section class="pgroup"><h2>${title} · ${g.length}</h2>${g.map(pcard).join("")}</section>` : ""; }).join("")
      + (arch.length ? `<section class="pgroup"><div class="sechead"><h2>Archive · ${arch.length}</h2><button class="linkbtn" type="button" data-a="arch">${archOpen ? "Hide" : "Show"}</button></div>
        ${archOpen ? `<p class="why">Nothing here is deleted. A place comes back by itself when the landlord writes again or the ad is back online.</p>${arch.map((id) => `<article class="arch" data-id="${id}">
          <button class="titlebtn" type="button" data-t="open">${esc(cache[id]?.street || "A listing")} <span aria-hidden="true">›</span></button>
          <span class="pc-bot"><span class="pchip closed">${esc(archLabel(id))}</span><span class="next">${esc(archWhy(id))}</span></span>
          <div><button class="btn ghost small" type="button" data-a="bring">Bring back</button></div></article>`).join("")}` : ""}</section>` : "")
    : "") || `<div class="empty"><b>No places yet.</b><span>Find a place, open it and write them a message. It shows up here.</span><button class="btn" type="button" data-goto="find">Find a place</button></div>`;
  renderBadges();
}
async function leadTap(e){
  const g = e.target.closest("[data-goto]"); if (g) return showTab(g.dataset.goto);
  if (e.target.closest('[data-a="arch"]')){ archOpen = !archOpen; return renderLeads(); }
  const c = e.target.closest("[data-id]"); if (!c) return;
  if (e.target.closest('[data-a="bring"]')){
    const id = c.dataset.id;
    try { await setStand(id, { closed: null }); toast("Brought back. It's in its group again."); } catch (err){ fail(err); }
    return;
  }
  if (lselecting && c.classList.contains("pcard")){
    const id = c.dataset.id;
    lpicked.has(id) ? lpicked.delete(id) : lpicked.add(id);
    c.classList.toggle("picked", lpicked.has(id));
    return lSync();
  }
  openListing(Number(c.dataset.id), c.dataset.sec);
}
$("leads").addEventListener("click", leadTap);

// ---- Selecting several places (Asa, 27 Oct 2026): replies and follow-ups for many at once. Only drafts; nothing is sent ----
const lpicked = new Set();
let lselecting = false;
const canReply = (id) => needsReply(id) && !draftOf(id);
const canFollow = (id) => !isClosed(id) && threads[id]?.last_dir === "out" && !draftOf(id);
const quietFor = (id) => (Date.now() - (Date.parse(threads[id]?.last_at || 0) || 0)) / 86400000;
function lSetSelect(on){
  lselecting = on; document.body.classList.toggle("selecting", on);
  $("lselbar").hidden = !on; $("lselbtn").textContent = on ? "Done" : "Select several";
  if (!on) lpicked.clear();
  renderLeads(); lSync();
}
$("lselbtn").onclick = () => lSetSelect(!lselecting);
$("lselcancel").onclick = () => lSetSelect(false);
function lSync(){
  if (!lselecting) return;
  const ids = [...lpicked], rep = ids.filter(canReply), fol = ids.filter(canFollow), n = ids.length, skip = n - rep.length - fol.length;
  const open = leadIds().filter((id) => !isClosed(id));
  const allRep = open.filter((id) => canReply(id) && !lpicked.has(id)), quiet = open.filter((id) => canFollow(id) && quietFor(id) >= 3 && !lpicked.has(id));
  const quick = [allRep.length ? `<button class="linkbtn" type="button" data-lq="rep">select ${plural(allRep.length, "place")} that wrote to you</button>` : "",
    quiet.length ? `<button class="linkbtn" type="button" data-lq="quiet">select ${plural(quiet.length, "place")} quiet for 3+ days</button>` : ""].filter(Boolean).join(" · ");
  $("lselcount").textContent = n ? `${plural(n, "place")} selected` : "Tap places to select them";
  $("lselhint").innerHTML = (n ? `${skip ? `${skip} skipped (a message is already waiting in To do, or no messages yet). ` : ""}Nothing is sent. ` : "")
    + (quick ? (n ? "Add: " : "Or ") + quick : n ? "" : "Nothing needs a reply or a follow-up right now.");
  $("lselreply").textContent = rep.length ? `Write ${plural(rep.length, "reply", "replies")}` : "Write replies";
  $("lselreply").disabled = !rep.length;
  $("lselfollow").textContent = fol.length ? `Write ${plural(fol.length, "follow-up")}` : "Write follow-ups";
  $("lselfollow").disabled = !fol.length;
}
$("lselhint").addEventListener("click", (e) => {
  const q = e.target.dataset?.lq; if (!q) return;
  for (const id of leadIds().filter((id) => !isClosed(id))) if (q === "rep" ? canReply(id) : canFollow(id) && quietFor(id) >= 3) lpicked.add(id);
  renderLeads(); lSync();
});
$("lselreply").onclick = () => writeReplies([...lpicked].filter(canReply), false);
$("lselfollow").onclick = () => writeReplies([...lpicked].filter(canFollow), true);
async function writeReplies(ids, follow){
  const what = (n) => plural(n, follow ? "follow-up" : "reply", follow ? "follow-ups" : "replies");
  const ok = await confirmBox({ title: `Write ${what(ids.length)}?`, ok: "Write them",
    body: `<p>${follow ? "Claude writes a short, friendly nudge for each place that hasn't answered you yet." : "Claude reads each conversation and writes a reply in your style."} About ${euro(ids.length * 0.001)} in total, roughly ${Math.max(10, Math.ceil(ids.length / 3) * 10)} seconds. <b>Nothing is sent.</b> They land in To do, where you check them and send them (one by one or with Send all).</p>` });
  if (!ok) return;
  let i = 0, done = 0, bad = 0, asks = 0, cost = 0, lastErr = "";
  toast(`Writing ${what(ids.length)}…`);
  const worker = async () => {
    while (i < ids.length){
      const id = ids[i++];
      try {
        const r = await post("replydraft", { id: Number(id), save: true, followup: follow });
        if (!r.skipped){ done++; cost += r.cost_usd || 0; if (r.questions?.length) asks++; }
      } catch (e) { bad++; lastErr = e.message; }
      toast(`Writing ${what(ids.length)}: ${done + bad} done…`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  await Promise.all([loadDrafts(), loadQuestions()]); lSetSelect(false); renderAll();
  toast(`${what(done)} ready in To do${asks ? ` (${asks} need an answer from you first)` : ""}${bad ? `, ${bad} failed (${aiErr(lastErr)})` : ""} · cost ${euro(cost)}`, done ? { label: "Open To do", fn: () => showTab("inbox") } : null, !!bad && !done);
}

// =====================================================================================
// TO DO (tab "inbox"): everything waiting on Asa, in the order to do it
// =====================================================================================
// One card per place (Asa, 28 Oct 2026), in sub-tabs Send / Answer / Viewings / Deal / Other. A sub-tab shows only when it has
// cards; cards are sorted by how long they have waited, longest first. The place page shows the same card as its "Next step".
const TODO_TABS = [["send", "Send"], ["answer", "Answer"], ["view", "Viewings"], ["deal", "Deal"], ["other", "Other"]];
let todoTab = store.get("kn_todo_tab") || "send";
const waitTxt = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : plural(Math.round(m / 1440), "day"); };
const seenKey = (id) => `seen_v_${id}_${stOf(id).viewing_at}`;
const vAt = (id) => Date.parse(stOf(id).viewing_at || 0) || 0;
const quote = (s, n = 220) => s ? `“${esc(String(s).slice(0, n))}${String(s).length > n ? "…" : ""}”` : "(no text, for example a photo)";
const chanName = (ch, id) => ({ kamernet: "Kamernet", whatsapp: "WhatsApp", email: "email", site: `${siteName(cache[id]?.source)}'s contact form`, other: "" })[ch] || "";
// can Send for me reach the landlord on this channel? (email needs their address, WhatsApp their number, an ad site its link)
const canSendFor = (d, ch) => { const c = contacts[d.listing_id] || {}; return ch === "email" ? !!c.email : ch === "whatsapp" ? !!c.phone : ch === "site" ? !!cache[d.listing_id]?.url : ch === "kamernet"; };
const globalQs = () => questions.filter((q) => !(q.places || []).length);
// the one thing waiting on Asa for this place, or null
function todoItem(id){
  id = String(id);
  if (isClosed(id)) return null;
  const r = cache[id] || { street: "A listing", city: "" }, now = Date.now(), d = draftOf(id), dl = deals[id], va = vAt(id);
  const card = (tab, wait, why, body, btns, count = true, sec = "") => ({ id, tab, wait, count, sec, why, html: `<article class="tcard" data-id="${id}" data-sec="${sec}">
      <button class="ttl" type="button" data-t="open">${esc(r.street)}${r.city ? `, ${esc(r.city)}` : ""} <span aria-hidden="true">›</span></button>
      <div class="waitline">Waiting ${waitTxt(wait)}</div>
      <div class="twhy">${why}</div>${body}
      ${btns ? `<div class="btnrow">${btns}</div>` : ""}</article>` });
  const viewNow = stageOf(id) === "booked" && va && va > now - 3600000 && va < now + 3 * 3600000;
  const viewSoon = stageOf(id) === "booked" && va > now && va < now + 86400000 && !store.get(seenKey(id));
  const viewCard = () => card("view", Math.min(now, va), `Viewing ${new Date(va).toDateString() === new Date().toDateString() ? "today" : "tomorrow"} at ${new Date(va).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
    `<div class="addr">${esc([r.street, [r.pc, r.city].filter(Boolean).join(" ")].filter(Boolean).join(", "))}</div><a class="linkbtn" href="${esc(mapUrl(r))}" target="_blank" rel="noopener">Open in Maps ›</a>`,
    `<button class="btn ghost small" type="button" data-t="late">I'm running late</button><button class="btn ghost small" type="button" data-t="seen">Got it</button>`, va > now, "status");
  if (viewNow) return viewCard();
  if (d){
    const wait = Date.parse(d.created_at) || now, ch = chanOf(d), text = draftEdits[d.id] ?? d.draft, wq = questionsFor(d.id);
    if (isSending(d)) return card("send", wait, d.send_status === "kn_sending" ? `Sending on ${esc(chanName(ch, id))} now…` : d.send_status === "kn_queued" ? (knOnline() ? `Sending on ${esc(chanName(ch, id))} in a minute or two…` : `Waiting for your PC to send it on ${esc(chanName(ch, id))}`) : "Sending by email…",
      `<div class="msg">${esc(text)}</div>`, d.send_status === "kn_sending" ? "" : `<button class="btn ghost small" type="button" data-t="cancel">Cancel</button>`, false, "draft");
    if (asksPending(d)) return card("answer", Date.parse(threads[id]?.last_at) || wait, "They asked you something", askBody(d),
      `<button class="btn ghost small" type="button" data-t="noanswer">Nothing to answer</button><button class="btn ghost small" type="button" data-t="open" data-sec="conv">Read it all</button>`, true, "draft");
    if (wq.length) return card("answer", wait, `Claude needs ${wq.length > 1 ? "answers" : "an answer"} before your ${d.kind === "reply" ? "reply" : "first message"} can go`, wq.map(questionCard).join(""), `<button class="btn ghost small" type="button" data-t="edit">See the message</button>`, true, "draft");
    const send = canSendFor(d, ch);
    return card("send", wait, d.send_status === "failed" ? `Couldn't send it: ${esc(d.send_error || "unknown error")}` : d.kind === "reply" ? "Your reply is ready" : "Your first message is ready",
      `${d.kind === "reply" && threads[id]?.last_dir === "in" ? `<p class="why">They wrote: ${quote(threads[id].last_body, 160)}</p>` : ""}
      <div class="msg">${esc(text)}</div>
      ${d.draft_en ? `<details class="en"><summary>English translation (only for you, not sent)</summary><div class="entext">${esc(d.draft_en)}</div></details>` : ""}
      ${asksOf(d).length ? `<details class="yans" open><summary>Your answers (${asksOf(d).length})</summary><ul>${asksOf(d).map((a) => `<li><b>${esc(a.text)}</b> ${a.skipped ? "<i>skipped</i>" : esc(askShow(a, a.answer))}</li>`).join("")}</ul><button class="linkbtn" type="button" data-t="asksback">‹ Change my answers</button></details>` : ""}
      ${(d.warnings || []).filter((w) => !asksOf(d).length || !/^They/.test(w)).length ? `<ul class="warns">${d.warnings.filter((w) => !asksOf(d).length || !/^They/.test(w)).map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      ${tellOpen[d.id] ? `<div class="tellbox"><textarea class="telltxt" rows="2" placeholder="e.g. shorter, and ask if bills are included" aria-label="What should Claude change?"></textarea><div class="btnrow"><button class="btn small" type="button" data-t="tellgo">Rewrite</button><button class="btn ghost small" type="button" data-t="tellx">Cancel</button></div></div>` : ""}
      <p class="why">${ch === "other" ? "No way to reach the landlord saved yet: tap Edit and add their email or phone." : `Goes through ${esc(chanName(ch, id))}${send && ch !== "email" ? `, from Chrome on your PC${knOnline() ? "" : " (it seems off now; it waits for it)"}` : ""}.`}</p>`,
      `${send ? `<button class="btn small" type="button" data-t="send" data-ch="${ch}">Send for me</button>` : ""}<button class="btn ghost small" type="button" data-t="copy" data-ch="${ch}">Copy and open</button><button class="btn ghost small" type="button" data-t="tell">Tell Claude what to change</button><button class="btn ghost small" type="button" data-t="edit">Edit</button>${d.kind === "reply" ? "" : `<button class="btn ghost small danger" type="button" data-t="notint">Not interested</button>`}`, true, "draft");
  }
  if (needsVerdict(id)) return card("view", va, "How was the viewing?", `<p class="why">You viewed it ${esc(dayTxt(va))}.</p>`,
    `<button class="btn small" type="button" data-t="v" data-v="want">Want it</button><button class="btn ghost small" type="button" data-t="v" data-v="maybe">Maybe</button><button class="btn ghost small danger" type="button" data-t="v" data-v="no">Not for me</button>`, true, "status");
  if (needsReply(id)) return card("answer", Date.parse(threads[id].last_at) || now, "They wrote to you", `<div class="msg">${quote(threads[id].last_body, 400)}</div>`,
    `<button class="btn small" type="button" data-t="reply">See what they ask</button><button class="btn ghost small" type="button" data-t="noanswer">Nothing to answer</button><button class="btn ghost small" type="button" data-t="open" data-sec="conv">Read it all</button>`, true, "conv");
  const p = (dl?.payments || []).find((x) => x.status === "proposed");
  if (p){
    const w = payWarnings(id, dl, p);
    return card("deal", Date.parse(dl.updated_at) || now, `Approve ${eur(p.amount)} ${esc(p.what)}${p.to_name ? ` to ${esc(p.to_name)}` : ""}?`,
      `<ul class="checks">${w.length ? w.map((x) => `<li class="ck bad">${esc(x)}</li>`).join("") : '<li class="ck ok">All the checks are done.</li>'}</ul>
      <p class="why">Approve only shows the bank details. You pay in your bank app.</p>`,
      `<button class="btn small" type="button" data-t="approve" data-pid="${esc(p.pid)}">Approve</button><button class="btn ghost small" type="button" data-t="open" data-sec="deal">Open the deal</button>`, true, "deal");
  }
  if (stageOf(id) === "offer"){
    const wait = Date.parse(stOf(id).updated_at) || now;
    if (!dl?.contract) return card("deal", wait, "They offered it to you", `<p class="why">Upload the contract so it can be checked before you sign or pay anything.</p>`, `<button class="btn small" type="button" data-t="open" data-sec="deal">Upload the contract</button>`, true, "deal");
    if (!dl.signed_at) return card("deal", wait, "Signed the contract?", `<p class="why">${dl.contract.review ? `The contract check said: ${esc(dl.contract.review.verdict || "see the deal")}.` : "The contract is being checked."} Tap I signed once you have.</p>`,
      `<button class="btn small" type="button" data-t="signed">I signed</button><button class="btn ghost small" type="button" data-t="open" data-sec="deal">Open the deal</button>`, true, "deal");
  }
  if (viewSoon) return viewCard();
  return null;
}
function todoItems(){ return leadIds().map(todoItem).filter(Boolean).sort((a, b) => a.wait - b.wait); }
const todoCount = () => todoItems().filter((i) => i.count).length + globalQs().length + (inbox?.open || []).length + openTodos().length;
async function renderInbox(){
  await ensureRows(leadIds());
  const items = todoItems(), other = globalQs().length + (inbox?.open || []).length + openTodos().length;
  const n = items.filter((i) => i.count).length + other;
  $("inboxsub").textContent = n ? `${plural(n, "thing")} waiting on you` : "You're up to date.";
  const by = Object.fromEntries(TODO_TABS.map(([k]) => [k, items.filter((i) => i.tab === k)]));
  const has = (k) => k === "other" ? other > 0 : by[k].length > 0;
  const tabs = TODO_TABS.filter(([k]) => has(k));
  if (!has(todoTab)) todoTab = tabs[0]?.[0] || "send";
  const src = (i) => i.source === "whatsapp" ? `WhatsApp from ${esc(i.sender)}` : i.source === "email" ? `Email from ${esc(i.sender)}` : `Kamernet email${i.subject ? ": " + esc(i.subject) : ""}`;
  const plan = sendAllPlan(unsent().filter((d) => !isClosed(String(d.listing_id))));
  // PC-only sends (Kamernet, WhatsApp, ad sites) wait in kn-send while the PC is off; turning the PC on sends them (up to 3 days)
  const pcWait = !knOnline() && Number(inbox?.health?.kn_queued || 0);
  const body = todoTab === "other"
    ? openTodos().map(todoCard).join("") + globalQs().map(questionCard).join("") + ((inbox?.open || []).length ? `<p class="why">These messages came in but couldn't be matched to a place. Find it, tap it, and Claude files it and writes a reply.</p>${inbox.open.map((i) => `<div class="ib" data-iid="${i.id}">
      <div><b>${src(i)}</b> · ${esc(when(i.created_at))}${i.summary ? " · " + esc(i.summary) : ""}</div>
      ${i.state === "error" ? `<div>Couldn't read it automatically. Picking the place tries again.</div>` : ""}
      <div class="body">${esc(i.body || "")}</div>
      <div class="row"><input class="ifind" placeholder="Street name"><button class="btn small ifindb" type="button">Find</button></div>
      <div class="btnrow icands"></div><div class="btnrow"><button class="btn ghost small danger iign" type="button">Not about housing</button><small class="ist why"></small></div></div>`).join("")}` : "")
    : (todoTab === "send" ? `<div class="tabhead"><span class="why">Longest waiting first.</span>${plan.go.length > 1 ? `<button class="btn small sendall" type="button">Send all (${plan.go.length})</button>` : ""}</div>` : "")
      + by[todoTab].map((i) => i.html).join("");
  $("inboxv").innerHTML = tabs.length
    ? `<p class="lead-txt">Everything waiting on you, one card per place. A tab only shows when it has something in it.</p>
      <div class="subtabs" role="tablist">${tabs.map(([k, l]) => { const c = k === "other" ? other : by[k].filter((i) => i.count).length; return `<button class="stab${k === todoTab ? " on" : ""}" type="button" role="tab" aria-selected="${k === todoTab}" data-stab="${k}">${l}${c ? ` <span class="n">${c}</span>` : ""}</button>`; }).join("")}</div>
      ${pcWait ? `<p class="why pcwait"><b>${plural(pcWait, "message")} waiting for your PC</b>: they go out when it's on (with Chrome open).</p>` : ""}
      <div class="tlist">${body}</div>`
    : `<div class="empty"><b>Nothing waiting on you.</b><span>Messages to send, questions, viewings and deal steps land here.</span></div>`;
  renderBadges();
}
// ---- sending, copying and the other To do buttons (also used on the place page) ----
async function sendDraft(d, ch, text){
  if (/\[YOUR ANSWER/i.test(text)){ toast("Fill in the [YOUR ANSWER …] parts first: answer the question, or edit the text.", null, true); return false; }
  const aid = d.id, c = contacts[d.listing_id] || {};
  const pc = knOnline() ? "Your PC is on, so it goes out within a minute or two." : "<b>Your PC seems off right now.</b> It goes out once it's back on with Chrome open (it waits up to 3 days).";
  const how = {
    email: [`Send this email to ${c.email}?`, "It goes from your Gmail within a minute, as a reply in your thread with them."],
    kamernet: ["Send this on Kamernet?", `Chrome on your PC types it in and presses Send, ${d.kind === "reply" && d.conv_id ? "as a reply in your Kamernet conversation" : "through the ad's contact form on Kamernet"}. ${pc}`],
    whatsapp: [`Send this on WhatsApp to ${c.phone}?`, `Chrome on your PC sends it from WhatsApp Web, from your own number. ${pc}`],
    site: [`Send this through ${siteName(cache[d.listing_id]?.source)}?`, `Chrome on your PC fills in the ad's contact form and presses send. If the form has a consent box or a captcha, it comes back to you to send yourself. ${pc}`],
  }[ch];
  if (!how || !canSendFor(d, ch)) { toast("There's no way to send this for you yet: add the landlord's email or phone on the place page.", null, true); return false; }
  if (!await confirmBox({ title: how[0], ok: "Send it now", body: `<p>${how[1]}</p><p class="why" style="white-space:pre-wrap">${esc(text.slice(0, 400))}${text.length > 400 ? "…" : ""}</p>` })) return false;
  const mail = ch === "email";
  const r = await post(mail ? "deal" : "kn-send", mail ? { action: "send_email", application_id: aid, draft: text } : { action: "queue", application_id: aid, draft: text, channel: ch });
  if (!mail) window.postMessage({ type: "kn-sender-poke" }, location.origin); // on the PC itself, the helper looks right away
  delete draftEdits[aid]; await loadDrafts(); lpRender(); renderAll(); watchSending();
  toast(mail ? (r.script_ready ? "Sending… You can cancel it in the next minute." : "Queued. The Gmail connection isn't running right now (see More), so it goes out as soon as it is.")
    : r.helper_online ? "Sending through your PC… You can cancel it until it starts." : "Waiting for your PC: it goes out when Chrome is open on it.",
    { label: "Cancel", fn: async () => { await post(mail ? "deal" : "kn-send", { action: mail ? "unqueue" : "cancel", application_id: aid }); await loadDrafts(); lpRender(); renderAll(); } });
  return true;
}
async function markSent(d, ch){
  await post("apply", { action: "sent", application_id: d.id, channel: ch });
  await Promise.all([loadStatuses(), loadDrafts(), loadThreads()]); if (lpId) await loadThread(lpId); lpRender(); renderAll(); toast("Marked as sent.");
}
// copy and open in the same tap, so the browser allows both; then offer "I sent it"
function copyOpen(d, ch, text, el){
  if (/\[YOUR ANSWER/i.test(text)) return toast("Fill in the [YOUR ANSWER …] parts first: answer the question, or edit the text.", null, true);
  const id = String(d.listing_id), c = contacts[id] || {}, p = navigator.clipboard?.writeText(text);
  const u = ch === "whatsapp" ? (c.phone ? waUrl(c.phone, text) : "")
    : ch === "email" ? `mailto:${encodeURIComponent(c.email || "")}?subject=${encodeURIComponent("Re: " + (cache[id]?.street || "the room"))}&body=${encodeURIComponent(text)}`
    : ch === "kamernet" ? kamernetUrl(d) : ch === "site" ? cache[id]?.url || "" : "";
  if (u){ if (ch === "email") location.href = u; else window.open(u, "_blank", "noopener"); }
  const where = { whatsapp: "WhatsApp", email: "your email", kamernet: "Kamernet", site: siteName(cache[id]?.source) + "'s contact form", other: "where you're writing to them" }[ch];
  const sent = { label: "I sent it", fn: () => markSent(d, ch) };
  if (p) p.then(() => toast(`Copied. Paste it in ${where} and send it, then tap I sent it.`, sent)).catch(() => { el?.select(); toast("Couldn't copy by itself. Select the text and copy it.", sent); });
  else { el?.select(); toast("Select the text and copy it.", sent); }
}
const verdictSet = (v) => ({ ...(v === "no" ? { closed: "me_no" } : { stage: "viewed", ...(v === "want" ? { opinion: "want" } : {}) }), note: `${new Date().toISOString().slice(0, 10)}: after the viewing, Asa said: ${{ want: "Want it", maybe: "Maybe", no: "Not for me" }[v]}` });
async function approvePay(id, pid){
  const d = deals[id], p = (d?.payments || []).find((x) => x.pid === pid); if (!p) return false;
  const w = payWarnings(id, d, p);
  if (!await confirmBox({ title: `OK to pay ${eur(p.amount)} to ${p.to_name || "the landlord"}?`, ok: "Yes, show me the bank details",
    body: `<p>For ${esc(p.what)}. Kamernet Live never pays: this only shows the bank details so you can pay in your bank app.</p>${w.length ? `<p><b>Still open:</b></p><ul>${w.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}` })) return false;
  await dealCall(id, { action: "pay_set", pid, status: "approved" });
  return true;
}
async function todoAct(b){
  const card = b.closest("[data-id]"), id = card.dataset.id, t = b.dataset.t, before = { ...stOf(id) }, d = draftOf(id);
  try {
    if (t === "open") return openListing(Number(id), b.dataset.sec || card.dataset.sec);
    if (t === "edit") return openListing(Number(id), "draft");
    if (t === "send") return void await sendDraft(d, b.dataset.ch, draftEdits[d.id] ?? d.draft);
    if (t === "copy") return copyOpen(d, b.dataset.ch, draftEdits[d.id] ?? d.draft, lpId === id ? $("dText") : null);
    if (t === "cancel"){
      await (d.send_status.startsWith("kn_") ? post("kn-send", { action: "cancel", application_id: d.id }) : post("deal", { action: "unqueue", application_id: d.id }));
      await loadDrafts(); lpRender(); renderAll(); return toast("Cancelled. Nothing was sent.");
    }
    if (t === "notint"){
      if (!await confirmBox({ title: "Not interested?", ok: "Yes, archive it", body: "<p>The message is deleted and the place goes to the Archive in Places as “I said no”. You can bring it back there.</p>" })) return;
      await post("apply", { action: "discard", application_id: d.id }); await loadDrafts();
      await setStand(id, { closed: "me_no" }); return toast("Archived: not for you.", standUndo(id, before));
    }
    if (t === "v"){
      await setStand(id, verdictSet(b.dataset.v));
      return toast(b.dataset.v === "no" ? "Archived: not for you." : b.dataset.v === "want" ? "Saved: you want it ♥" : "Saved: maybe.", standUndo(id, before));
    }
    if (t === "reply" || t === "late"){
      b.disabled = true; b.textContent = "Writing… (about 10 seconds)";
      const r = await post("replydraft", { id: Number(id), save: true, followup: t === "late" || !needsReply(id) });
      if (t === "late" && r.application_id) await post("replydraft", { action: "redo", application_id: r.application_id, instruction: `Say I'm running about 10 minutes late for the viewing at ${new Date(vAt(id)).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}; apologise briefly. Nothing else.` });
      await Promise.all([loadDrafts(), loadQuestions()]); renderAll();
      if (t === "late") return openListing(Number(id), "draft");
      return toast(r.skipped ? "Nothing to answer: the last message is yours." : r.asks?.length ? `They ask ${plural(r.asks.length, "thing")}: answer ${r.asks.filter((a) => !a.answer).length ? "the open ones" : "or check them"} on the card.` : r.questions?.length ? "Written. Claude needs one answer from you first (Answer tab)." : "Written. It's in Send: check it, then send it.");
    }
    if (t === "asksback"){ askEd[d.id] = { reopen: true }; todoTab = "answer"; return renderAll(); }
    if (t === "tell" || t === "tellx"){ tellOpen[d.id] = t === "tell"; renderAll(); if (t === "tell") setTimeout(() => $("inboxv").querySelector(`[data-id="${id}"] .telltxt`)?.focus(), 0); return; }
    if (t === "tellgo"){
      const instruction = card.querySelector(".telltxt")?.value.trim(); if (!instruction) return toast("Write what Claude should change first.", null, true);
      b.disabled = true; b.textContent = "Rewriting… (about 10 seconds)";
      await post("replydraft", { action: "redo", application_id: d.id, instruction });
      delete draftEdits[d.id]; tellOpen[d.id] = false; await loadDrafts(); renderAll(); if (lpId === id) lpRender();
      return toast("Rewritten with your note. Check it again.");
    }
    if (t === "noanswer"){
      if (d && asksPending(d)){ await post("apply", { action: "discard", application_id: d.id }); await loadDrafts(); }
      await setStand(id, { seen_in_at: true });
      return toast("OK, back to waiting for them. If they stay quiet for 3 days, a short follow-up is written for you.", standUndo(id, before));
    }
    if (t === "seen"){ store.set(seenKey(id), "1"); return renderAll(); }
    if (t === "approve"){ if (await approvePay(id, b.dataset.pid)){ lpRender(); renderAll(); toast("Approved. The bank details are on the place page, under the deal.", { label: "Show them", fn: () => openListing(Number(id), "deal") }); } return; }
    if (t === "signed"){
      if (!await confirmBox({ title: "Did you sign the contract?", ok: "Yes, I signed", body: "<p>The place moves to Signed and the move-in and registration steps appear.</p>" })) return;
      await dealCall(id, { action: "signed", signed_on: new Date().toISOString().slice(0, 10) }); await loadStatuses(); lpRender(); renderAll(); return toast("Signed. Congratulations!");
    }
  } catch (err){ fail(err); renderAll(); lpRender(); }
}
// Send all (Asa, 25 Oct 2026): one tap sends EVERY ready draft. Email through the Gmail script; Kamernet, WhatsApp (WhatsApp
// Web; Asa accepts the ban risk) and the ad's own contact form through the helper in Chrome on his PC, one at a time. Drafts with
// [YOUR ANSWER …] are filled in by Claude first (replydraft fill). Only a draft with no way to reach the landlord stays.
function sendAllPlan(ds){
  const go = [], skip = [];
  for (const d of ds){
    if (isSending(d)) continue;
    if (waitsOnQ(d)){ skip.push([d, "waiting on a question in To do"]); continue; }
    if (asksPending(d)){ skip.push([d, "waiting on your answers in To do"]); continue; }
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
  if (!await confirmBox({ title: `Send all ${go.length}?`, ok: "Send them all", body: `<p>${parts.join(", ")}. Email goes from your Gmail within a minute; the rest from Chrome on your PC, one every 20-40 seconds${pc && !knOnline() ? " (<b>your PC seems off</b>, so they go out once it's on)" : ""}.</p>${fills ? `<p>${plural(fills, "message")} still had [YOUR ANSWER …] parts: Claude fills them in from your facts first, or writes around what it doesn't know.</p>` : ""}${skip.length ? `<p class="why">Not sent: ${skip.map(([d, why]) => `${esc(cache[d.listing_id]?.street || "a listing")} (${esc(why)})`).join(", ")}.</p>` : ""}` })) return;
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
  toast(`${plural(ok, "message")} on the way.${bad.length ? " Couldn't send: " + bad.join("; ") : ""}${skip.length ? ` ${skip.length} not sent (a question waits, or no landlord contact).` : ""}`, null, !!bad.length);
}
$("inboxv").addEventListener("click", async (e) => {
  if (e.target.closest(".sendall")) return sendAll();
  const sb = e.target.closest(".stab");
  if (sb){ todoTab = sb.dataset.stab; store.set("kn_todo_tab", todoTab); return renderInbox(); }
  if (await askClick(e) || await todoClick(e)) return;
  if (await questionClick(e)) return;
  const tb = e.target.closest("[data-t]");
  if (tb && tb.closest("[data-id]")) return todoAct(tb);
  if (e.target.closest("a")) return;
  const it = e.target.closest(".ib");
  if (!it) return;
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
      await Promise.all([loadStatuses(), loadThreads(), loadDrafts(), loadInbox()]); renderAll(); toast("Filed. The reply is in the Send tab.");
    } catch (err) { st.textContent = "Couldn't file it: " + err.message; }
  } else if (e.target.closest(".iign")){
    if (!await confirmBox({ title: "Not about housing?", ok: "Hide it", danger: true, body: "<p>It disappears from here for good.</p>" })) return;
    try { await post("inbox", { action: "ignore", inbox_id: iid }); await loadInbox(); renderInbox(); }
    catch (err) { st.textContent = "Couldn't hide it: " + err.message; }
  }
});
$("inboxv").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.closest(".ifind")) e.target.closest(".ib").querySelector(".ifindb").click();
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
// the place page's "Next step": the same card as in To do, or what happens next when nothing waits on Asa
let lpSteps = false;
function nextHtml(id){
  const td = todoItem(id); if (td) return td.html;
  const st = stepItem(id);
  return `<div class="twhy">${esc(st.title)}</div>${st.body || ""}${st.btns ? `<div class="btnrow">${st.btns}</div>` : ""}`;
}
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
      <div class="pc-top"><div class="lpprice">${priceHtml(r)}${r._mf?.price ? mfTag() : ""}${dv > 1 ? `<span class="why">${eur(r.price)} a month for ${dv}${dv < r.people ? ` (up to ${r.people} allowed)` : ""}</span>` : r.people == null ? '<span class="why">People allowed not stated</span>' : '<span class="why">a month</span>'}${r.deposit > 0 ? `<span class="why">· deposit ${eur(r.deposit)}</span>` : ""}</div>
        <button class="heart${x.opinion === "want" ? " on" : ""}" type="button" data-a="heart" aria-pressed="${x.opinion === "want"}" aria-label="I want this one"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">${HEART}</svg></button></div>
      <div class="lpmeta"><span>${esc(r.city)}</span><span>${esc(cap(r.kind))}${r.size_m2 ? " · " + r.size_m2 + " m²" : ""}</span>${avail(r) ? `<span>${esc(avail(r))}${r._mf?.available_from || r._mf?.available_until ? " ✉" : ""}</span>` : ""}${r.posted ? `<span>${esc(postedTxt(r.posted))}</span>` : ""}${dt ? `<span class="dist">${esc(dt)}</span>` : ""}</div>
      <div class="badges">${r.gone_at && r.source !== "manual" ? `<span class="pchip gone">${isArchived(id) ? "Ad gone" : "Ad offline"} on ${esc(siteName(r.source))}</span>` : ""}${checkBadge(r)}${badgeList(r).map((t) => `<span class="badge ${toneOf(t)}">${esc(label(t))}</span>`).join("")}${r.reg === "unknown" ? '<span class="badge">Registration not stated</span>' : ""}</div>
      <div id="lpLive">${liveHtml(id)}</div>
      <div class="links"><a href="${esc(mapUrl(r))}" target="_blank" rel="noopener">Map ↗</a>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${r.source === "manual" ? "The ad ↗" : `On ${esc(siteName(r.source))} ↗`}</a>` : ""}</div>
      <div id="lpDups">${dupsHtml(id)}</div>
    </div>
    ${msgFactsHtml(r)}
    ${clashHtml(r)}
    <section class="sec" id="lp-status"><div class="sechead"><h3>Where it stands</h3><button class="linkbtn" type="button" data-a="steps">${lpSteps ? "Hide steps" : "All steps"}</button></div>
      ${segsHtml(id, true)}
      <p class="stageline">${isArchived(id) ? `${esc(archLabel(id))}: ${esc(archWhy(id))}` : sg === "moved" ? "Moved in · your home" : `${STAGE_LABEL[sg]} · step ${STAGES.indexOf(sg) + 1} of ${STAGES.length}`}</p>
      ${lpSteps ? `<ol class="steps">${STAGES.map((k, i) => { const cur = STAGES.indexOf(sg); return `<li><button type="button" class="step${i < cur || sg === "moved" ? " done" : i === cur ? " cur" : ""}" data-stage="${k}"><span class="dot"></span><span>${STAGE_LABEL[k]}</span><span class="hint">${STAGE_HINT[k]}</span></button></li>`; }).join("")}</ol>
        <p class="why">It moves by itself with your messages, the viewing and the deal. Tap a step only to correct it.</p>` : ""}
      ${whoLine(id)}
      ${x.viewing_at || STAGES.indexOf(stageOf(id)) < STAGES.indexOf("offer") ? `<label class="field">Viewing (date and time)<div class="btnrow"><input type="datetime-local" id="lpView" value="${toLocalInput(x.viewing_at)}" style="flex:1">${x.viewing_at ? '<button class="btn ghost small" type="button" data-a="noview">Clear</button>' : ""}</div></label>` : ""}
    </section>
    <section class="sec nextbox" id="lp-next"><h3>Next step</h3><div data-id="${id}">${nextHtml(id)}</div></section>
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
    ${!isArchived(id) && STAGES.indexOf(sg) < STAGES.indexOf("signed") ? `<details class="stop" data-k="stop"${open.includes("stop") ? " open" : ""}><summary>Stop this place…</summary>
      <p><b>Why are you stopping?</b></p><p class="why">It goes to the Archive in Places. Nothing is deleted, and you can bring it back.</p>
      <div class="btnrow">${STOP_REASONS.map(([k, t]) => `<button class="btn ghost small danger" type="button" data-close="${k}">${t}</button>`).join("")}<button class="btn ghost small" type="button" data-a="stopcancel">Cancel</button></div></details>` : ""}
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
// ---- where the ad says two different things (Asa, 27 Oct 2026): conditions (bills, furnished, registration) follow the
// text, numbers follow the form, unless the form is clearly a typo; what the landlord said in a message beats both ----
const CLASH_MF = { rent: "price", bills: "utilities_incl", deposit: "deposit", available_from: "available_from", available_until: "available_until", people: "people" };
const CLASH_TEXT_WINS = ["bills", "furnished", "registration"];
function clashes(r){
  const d = r.distilled || {}, list = Array.isArray(d.conflicts) ? d.conflicts.filter((c) => c && c.what) : [];
  const b = d.costs?.bills, fb = r.form_bills; // only summaries made since 27 Oct (they carry conflicts) judge bills
  if (Array.isArray(d.conflicts) && (b === "included" || b === "extra") && typeof fb === "boolean" && fb !== (b === "included") && !list.some((c) => c.what === "bills"))
    list.push({ what: "bills", form: fb ? "included" : "extra", text: b === "included" ? "bills included" : "bills extra" });
  return list;
}
function clashHtml(r){
  const list = clashes(r); if (!list.length) return "";
  const mf = r._mf || {};
  const rows = list.map((c) => {
    const k = CLASH_MF[c.what], settled = k && mf[k];
    const used = settled ? `settled by their message: ${esc(mfVal(k, mf[k].v))}` : CLASH_TEXT_WINS.includes(c.what) ? "using the text" : "using the form, check with them";
    return `<li><b>${esc(cap(String(c.what).replace(/_/g, " ")))}</b>: the form says ${esc(c.form)}, the text says ${esc(c.text)} <span class="why">· ${used}</span></li>`;
  });
  return `<section class="sec" id="lp-clash"><h3>The ad says two different things</h3>
    <p class="why">The written text wins for conditions like bills, the form for numbers. Their messages beat both. Your draft asks them to confirm.</p>
    <ul class="mflist">${rows.join("")}</ul></section>`;
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
// what Send for me does on each channel (shown under the message on the place page)
function sendWhy(ch, id){
  const c = contacts[id] || {}, pcOff = ch !== "email" && ch !== "other" && !knOnline() ? " <b>Right now your PC seems off</b>, so Send for me waits for it (up to 3 days); Copy and open works anywhere." : "";
  return ({
    email: `Send for me emails ${esc(c.email || "them")} from your own Gmail, as a reply in your thread with them.`,
    kamernet: "Send for me types it into Kamernet for you from Chrome on your PC, where you're logged in, one message every 20-40 seconds. Kamernet's rules don't allow this, so there's a small risk to your account.",
    whatsapp: c.phone ? "Send for me sends it from WhatsApp Web in Chrome on your PC, from your own number. WhatsApp can ban numbers that send automatically; you accepted that risk." : "Save their number under Landlord to have it sent for you, or to open their chat directly.",
    site: `Send for me fills in ${esc(siteName(cache[id]?.source))}'s contact form from Chrome on your PC. If the form has a consent box or a captcha, it comes back to you to send yourself.`,
    other: "Save the landlord's email or phone under Landlord to get Send for me.",
  }[ch] || "") + pcOff;
}
function draftSection(id){
  const d = draftOf(id), r = cache[id], c = contacts[id] || {};
  if (!d){
    const first = stageOf(id) === "none" && !(r.gone_at && r.source !== "manual");
    if (isClosed(id)) return `<h3>Your message</h3><p class="why">This lead is closed.</p>`;
    if (first || !threads[id]) return `<h3>Your message</h3><p class="why">Claude writes a short first message in your style, using the ad and your facts. You check it first; nothing goes out until you tap Send for me (or send it yourself).</p><button class="btn" type="button" data-a="write">Write my first message</button>`;
    return `<h3>Your message</h3><p class="why">${needsReply(id) ? "They wrote last. Claude can write a reply for you to check." : threads[id] ? "The last message is yours." : "No messages yet. Claude can write one for you to check."}</p><button class="btn${needsReply(id) ? "" : " ghost"}" type="button" data-a="reply">Write a ${needsReply(id) ? "reply" : "follow-up"}</button>`;
  }
  const ch = chanOf(d), sending = isSending(d);
  const send = d.send_status === "kn_sending" ? `<div class="btnrow"><b>Sending on ${esc(chanName(ch, id))} now…</b></div><p class="why">Chrome on your PC is sending it. It shows in the conversation when it's out.</p>`
    : d.send_status === "kn_queued" ? `<div class="btnrow"><b>Waiting for your PC to send it on ${esc(chanName(ch, id))}…</b><button class="btn ghost small" type="button" data-d="unqueue">Cancel</button></div><p class="why">${knOnline() ? "Your PC is on: it goes out within a minute or two." : "Your PC seems to be off or Chrome is closed. It goes out as soon as it's back (it waits up to 3 days). In a hurry? Cancel, then use Copy and open."}</p>`
    : sending ? `<div class="btnrow"><b>Sending by email to ${esc(c.email || "the landlord")}…</b><button class="btn ghost small" type="button" data-d="unqueue">Cancel</button></div><p class="why">It goes out from your Gmail within a minute, then shows in the conversation.</p>`
    : `<div class="btnrow">${canSendFor(d, ch) ? `<button class="btn" type="button" data-d="sendfor" data-ch="${ch}">Send for me${ch !== "email" && !knOnline() ? " (PC off)" : ""}</button>` : ""}<button class="btn${canSendFor(d, ch) ? " ghost" : ""}" type="button" data-d="go" data-ch="${ch}">${ch === "other" || ch === "whatsapp" && !c.phone ? "Copy it" : `Copy and open ${esc(ch === "site" ? siteName(r.source) : chanName(ch, id))}`}</button></div><p class="why">${sendWhy(ch, id)}</p>`;
  return `<h3>${d.kind === "reply" ? "Your reply" : "Your first message"} <small class="why">${esc({ kamernet: "on Kamernet", site: "on " + siteName(r.source), whatsapp: "on WhatsApp", email: "by email", other: "" }[ch])}</small></h3>
    ${d.send_status === "failed" ? `<div class="flags">Couldn't send it: ${esc(d.send_error || "unknown error")}. Try again, or copy it.</div>` : ""}
    ${(d.warnings || []).length || (d.notes || []).length ? `<div class="headsup"><b>Heads up</b><ul class="warns">${[...(d.warnings || []), ...(d.notes || [])].map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
    <div class="draft" data-aid="${d.id}">
      ${asksPending(d) ? `<div class="decide">${askBody(d)}</div>` : ""}
      ${questionsFor(d.id).length && !sending ? `<div class="decide"><b>Open ${questionsFor(d.id).length > 1 ? "questions" : "question"}</b><p class="why">Answer once: it's saved and used in every message that needs it.</p>${questionsFor(d.id).map(questionCard).join("")}</div>` : ""}
      <textarea id="dText" aria-label="Message" ${sending ? "disabled" : ""}>${esc(draftEdits[d.id] ?? d.draft)}</textarea><span class="saved" id="dSaved"></span>
      ${d.draft_en ? `<details class="english" open><summary>In English (only for you, not sent)</summary><p class="why" style="white-space:pre-wrap">${esc(d.draft_en)}</p></details>` : ""}
      ${send}
      ${sending ? "" : `<div class="btnrow"><button class="btn ghost" type="button" data-d="done" data-ch="${ch}">I sent it</button><button class="btn ghost danger" type="button" data-d="del">Delete</button></div>
      <details data-k="redo"><summary>Change it with AI</summary><div class="fix" style="margin-top:6px"><input id="dNote" placeholder="e.g. shorter, say I can come Saturday, don't mention who comes along">
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
  const t = $("dText"), box = t?.closest(".draft"); // only the open place page's own draft, never another place's text
  const text = t && Number(box?.dataset.aid) === aid ? t.value : draftEdits[aid];
  if (text == null) return;
  clearTimeout(saveTimers[aid]);
  await post("apply", { action: "save", application_id: aid, draft: text });
  const d = drafts.find((x) => x.id === aid); if (d) d.draft = text; delete draftEdits[aid];
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
  return { label: "Undo", fn: () => setStand(id, { stage: before.stage || "none", opinion: before.opinion ?? null, closed: before.closed ?? null, viewing_at: before.viewing_at ?? null, seen_in_at: before.seen_in_at ? true : null }) };
}

// ---- every button on the listing page ----
$("lpBody").addEventListener("click", async (e) => {
  const id = lpId; if (!id) return;
  if (await askClick(e)) return;
  if (await questionClick(e)) return;
  const b = e.target.closest("button"); if (!b) return;
  const before = { ...stOf(id) };
  try {
    if (b.dataset.stage){
      const k = b.dataset.stage; if (k === stageOf(id)) return;
      await setStand(id, { stage: k });
      toast(`Progress: ${STAGE_LABEL[k]}`, standUndo(id, before));
    } else if (b.dataset.t){
      await todoAct(b);
    } else if (b.dataset.a === "heart"){
      await setStand(id, { opinion: before.opinion === "want" ? null : "want" });
      toast(before.opinion === "want" ? "Heart removed." : "Saved: you want this one ♥", standUndo(id, before));
    } else if (b.dataset.close){
      await setStand(id, { closed: b.dataset.close });
      toast(`Archived: ${CLOSED_LABEL[b.dataset.close]}. It's in the Archive in Places.`, standUndo(id, before));
    } else if (b.dataset.a === "steps"){
      lpSteps = !lpSteps; lpRender();
    } else if (b.dataset.a === "stopcancel"){
      b.closest("details").open = false;
    } else if (b.dataset.a === "godeal"){
      $("lp-deal")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (b.dataset.a === "moved"){
      if (!await confirmBox({ title: "Did you move in?", ok: "Yes, I live here", body: "<p>The place becomes your home. Registration at the municipality stays in the deal below.</p>" })) return;
      await setStand(id, { stage: "moved" });
      toast("Welcome home!", standUndo(id, before));
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
    } else if (b.dataset.a === "reopen" || b.dataset.a === "bring"){
      await setStand(id, { closed: null });
      toast("Brought back.", standUndo(id, before));
    } else if (b.dataset.a === "noview"){
      await setStand(id, { viewing_at: null }); toast("Viewing time cleared.", standUndo(id, before));
    } else if (b.dataset.a === "write"){
      b.disabled = true; b.textContent = "Writing… (about 10 seconds)";
      const d = await post("apply", { id: Number(id), reuse: true });
      await Promise.all([loadDrafts(), loadQuestions()]); lpRender(); renderAll();
      toast(d.reused ? "Here's the message you already had." : `Written · cost ${euro(d.cost_usd)}. Check it, then send it.`);
    } else if (b.dataset.a === "reply"){
      b.disabled = true; b.textContent = "Writing… (about 10 seconds)";
      const r = await post("replydraft", { id: Number(id), save: true, followup: !needsReply(id) });
      if (r.skipped){ lpRender(); return toast("Nothing to answer: the last message is yours."); }
      await loadDrafts(); lpRender(); renderAll();
      await loadQuestions(); lpRender(); renderAll();
      toast(r.questions?.length ? "Written. Claude needs one answer from you first (above the message)." : "Written. Check it, then send it.");
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
  if (["go", "sendfor", "done"].includes(act) && /\[YOUR ANSWER/i.test(text)) // never let a placeholder go out
    return toast("Fill in the [YOUR ANSWER …] parts first: answer the question above, or edit the text.", null, true);
  if (act === "go"){
    const ch = b.dataset.ch, p = navigator.clipboard?.writeText(text);   // copy and open in the same tap, so the browser allows both
    const u = ch === "whatsapp" ? (c.phone ? waUrl(c.phone, text) : "")
      : ch === "email" ? `mailto:${encodeURIComponent(c.email || "")}?subject=${encodeURIComponent("Re: " + (cache[id]?.street || "the room"))}&body=${encodeURIComponent(text)}`
      : ch === "kamernet" ? kamernetUrl(d || { listing_id: id }) : ch === "site" ? cache[id]?.url || "" : "";
    if (u){ if (ch === "email") location.href = u; else window.open(u, "_blank", "noopener"); }
    const where = { whatsapp: "WhatsApp", email: "your email", kamernet: "Kamernet", site: siteName(cache[id]?.source) + "'s contact form", other: "where you're writing to them" }[ch];
    if (p) p.then(() => toast(`Copied. Paste it in ${where}, send it, then come back and press “I sent it”.`)).catch(() => { $("dText").select(); toast("Couldn't copy by itself. The text is selected: copy it."); });
    else { $("dText").select(); toast("The text is selected: copy it."); }
  } else if (act === "sendfor"){
    if (d) await sendDraft(d, b.dataset.ch, text);
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
    const instruction = $("dNote")?.value.trim() || "";
    if (!instruction) return toast("Write what to change first.", null, true);
    b.disabled = true; b.textContent = "Rewriting…";
    await saveDraftNow(aid);
    await post("replydraft", { action: "redo", application_id: aid, instruction, always: !!$("dAlw")?.checked });
    await loadDrafts(); lpRender(); toast("Rewritten.");
  }
}
// "You decide" answers: pressing Enter rewrites
$("lpBody").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "dNote"){ e.preventDefault(); $("lpBody").querySelector('[data-d="redo"]')?.click(); } });
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
      <label>Start<input class="tm" data-k="start" type="date" data-from="${esc(r.available_from || "")}" value="${esc(t.start ?? "")}"></label>
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
      <div class="grid2"><label>Move-in day<input class="daf" data-k="move_in" type="date" data-from="${esc(r.available_from || "")}" value="${esc(af.move_in ?? t.start ?? "")}"></label>
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
// the PDF reader (text only). Its worker is fetched, checked against its hash and run from a blob, so it can't be swapped either;
// isEvalSupported:false shuts the code path of the pdf.js 3.x font bug (CVE-2024-4367), which text reading doesn't need anyway
async function sri512(buf){ const b = new Uint8Array(await crypto.subtle.digest("SHA-512", buf)); let s = ""; for (const x of b) s += String.fromCharCode(x); return "sha512-" + btoa(s); }
async function pdfText(src){
  if (!window.pdfjsLib){
    const lib = "pdf.js/3.11.174/pdf.min.js", wk = "pdf.js/3.11.174/pdf.worker.min.js";
    await cdn("script", cdnAttrs(lib, { src: CDNJS + lib })).catch(() => { throw new Error("couldn't load the PDF reader"); });
    const buf = await (await fetch(CDNJS + wk)).arrayBuffer();
    if (await sri512(buf) !== SRI[wk]) throw new Error("the PDF reader didn't pass its safety check");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([buf], { type: "text/javascript" }));
  }
  const opts = typeof src === "string" ? { url: src } : { ...src };
  const doc = await window.pdfjsLib.getDocument({ ...opts, isEvalSupported: false }).promise; let out = "";
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
    if (await approvePay(id, pid)){ lpRender(); renderAll(); }
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
    if (!await confirmBox({ title: `Write a goodbye to ${plural(others.length, "landlord")}?`, ok: "Write them", body: "<p>A short “I found a place, thanks” message for each. Nothing is sent: they land in To do, where you send each one yourself.</p>" })) return;
    const r = await dealCall(id, { action: "goodbyes" }); await loadDrafts(); renderAll();
    toast(`${plural(r.drafted, "goodbye")} written.`, { label: "Open To do", fn: () => { $("lp").close(); showTab("inbox"); } });
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
const RQ = { open: "Waiting for Claude", working: "Claude is on it…", done: "Done", needs_chat: "Needs a Claude chat (it's a change to this site)", needs_asa: "Claude has a question for you", declined: "Not done", failed: "Stopped: tap Try again if you still want it" };
async function loadRequests(){
  try {
    const rs = (await fn("me?requests=1")).requests || [];
    $("askList").innerHTML = rs.length ? `<h3 class="lbl">Your requests</h3>${rs.map((r) => `<div class="rq ${r.status}"><div><b>${esc(RQ[r.status] || r.status)}</b> · ${esc(ago(r.created_at))}${r.listing_id && cache[r.listing_id] ? " · " + esc(cache[r.listing_id].street) : ""}${r.status === "failed" || (r.status === "open" && askPolls >= 40) ? ` <button class="btn ghost small asknow" type="button" data-id="${r.id}">Try again</button>` : ""}</div><div>${esc(r.text)}</div>${r.reply ? `<div class="rr">Claude: ${esc(r.reply)}</div>` : ""}</div>`).join("")}` : "";
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
      <div class="btnrow"><label class="toggle small"><input type="checkbox" data-s="enable" ${s.enabled ? "checked" : ""}> On</label></div>
    </div>`;
  }).join("") || '<p class="why">No sites yet.</p>';
  const KIND = { learned: "Learned", learn_failed: "Couldn't learn", broken: "Broke", blocked: "Blocked", quiet: "Quiet", recovered: "Recovered" };
  $("sitelog").innerHTML = (sites.log || []).slice(0, 15).map((l) => `<div class="ev"><b>${esc(siteName(l.site))}: ${esc(KIND[l.kind] || l.kind)}</b> <small>${ago(l.at)}${l.cost_usd ? " · " + euro(Number(l.cost_usd)) : ""}</small><br>${esc(l.note)}</div>`).join("") || '<p class="why">Nothing yet.</p>';
}
$("sites").addEventListener("change", async (e) => {
  const c = e.target.closest("[data-s=enable]"), box = e.target.closest("[data-site]");
  if (!c || !box) return;
  try { await post("reader", { action: "enable", site: box.dataset.site, on: c.checked }); toast(`${siteName(box.dataset.site)} turned ${c.checked ? "on" : "off"}`); }
  catch (err) { c.checked = !c.checked; toast(err.message, null, true); }
  loadSites();
});
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
    h.sweep_result?.ok === false ? line("bad", `Clean-up of removed ads gave up ${ago(h.sweep_result.at)} (${h.sweep_result.reason})`)
      : h.sweep?.at ? line(h.sweep.ok !== false ? "ok" : "bad", `Clean-up of removed ads (every 2 hours): ran ${ago(h.sweep.at)}${h.sweep_result?.remaining ? `, ${h.sweep_result.remaining} still to check` : ""}`)
      : line("bad", "Clean-up of removed ads hasn't run in the last 4 hours"),
    h.gmail_ping ? (gmailOk() ? line("ok", `Kamernet messages and landlord emails: checked ${ago(h.gmail_ping)}`) : line("bad", `Gmail check stopped: last run ${ago(h.gmail_ping)}`)) : line("warn", `Kamernet messages and landlord emails: ${notYet}`),
    Number(h.gmail_version || 0) >= 2 && gmailOk() ? line(h.failed_emails ? "bad" : "ok", `Send for me (email): ready${h.queued_emails ? ` · ${h.queued_emails} going out` : ""}${h.failed_emails ? ` · ${h.failed_emails} failed (open them in To do)` : ""}`) : line("warn", `Send for me (email): ${h.gmail_ping ? "needs the newer Gmail connection (Claude updates it in a chat)" : notYet}`),
    !h.kn_sender_ping ? line("warn", "Send for me (Kamernet): not set up yet (Claude installs the helper in Chrome on your PC, in a chat)")
      : line(h.kn_failed ? "bad" : knOnline() ? "ok" : "warn", `Send for me (Kamernet): ${knOnline() ? "ready, your PC is on" : `your PC is off or Chrome is closed (last seen ${ago(h.kn_sender_ping)}); messages wait until it's back`}${h.kn_queued ? ` · ${h.kn_queued} going out` : ""}${h.kn_failed ? ` · ${h.kn_failed} failed (open them in To do)` : ""}${h.kn_sender_last_sent ? ` · last sent ${ago(h.kn_sender_last_sent)}` : ""}`),
    // since 25 Oct 2026 the Chrome helper reads WhatsApp Web on the PC (the phone forwarder never worked)
    h.wa_read && Date.now() - Date.parse(h.wa_read) < 10 * 60000
      ? line(h.wa_read_error ? "bad" : "ok", h.wa_read_error ? `WhatsApp from landlords: your PC can't read WhatsApp Web (${esc(String(h.wa_read_error).slice(0, 120))}). Open web.whatsapp.com in Chrome on your PC and scan the QR code with your phone if it asks.`
        : `WhatsApp from landlords: read from WhatsApp Web on your PC, checked ${ago(h.wa_read)}${h.phone_last ? ` · last one ${ago(h.phone_last)}` : ""}. Chats stay unread on your phone.`)
      : h.wa_read ? line("warn", `WhatsApp from landlords: your PC is off or Chrome is closed (last read ${ago(h.wa_read)}); new ones come in when it's back`)
      : Number(String(h.kn_sender_version || "0").replace(/^(\d+)\.(\d+).*/, "$1.$2")) < 2.1 && h.kn_sender_ping ? line("warn", "WhatsApp from landlords: the PC helper needs a restart to start reading WhatsApp Web (Chrome: restart it, or reload the helper in chrome://extensions)")
      : h.phone_last ? line("ok", `WhatsApp from landlords (your phone): last one ${ago(h.phone_last)}`)
      : h.phone_seen ? line("bad", `WhatsApp from landlords (your phone): MacroDroid reached Kamernet Live ${ago(h.phone_seen)} but the message was unusable (${esc(String(h.phone_result || "unknown").slice(0, 120))})`)
      : line("warn", `WhatsApp from landlords (your phone): MacroDroid has never reached Kamernet Live`),
    // since 27 Oct 2026 (helper 2.4) the PC also reads Kamernet's own chat log, both sides, about every 2 min
    !h.kn_read ? null
      : Date.now() - Date.parse(h.kn_read) < 10 * 60000
      ? line(h.kn_read_error ? "bad" : "ok", h.kn_read_error ? `Kamernet chat log: your PC can't read it (${esc(String(h.kn_read_error).slice(0, 120))}). Open kamernet.nl in Chrome on your PC and log in if it asks.`
        : `Kamernet chat log: read from Kamernet on your PC, checked ${ago(h.kn_read)}. Alerts still come from Gmail.`)
      : line("warn", `Kamernet chat log: your PC is off or Chrome is closed (last read ${ago(h.kn_read)}); it catches up when it's back`),
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
  await Promise.allSettled([loadStatuses(), loadThreads(), loadDrafts(), loadQuestions(), loadPeople(), loadDeals(), loadInbox(), loadSites(), loadTodos(), headline(), refreshRows(leadIds())]);
  const typing = document.activeElement?.closest?.("#lp") && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  const typingTodo = document.activeElement?.closest?.("#inboxv") && /INPUT|TEXTAREA/.test(document.activeElement.tagName); // keep what you're typing (answers are kept anyway)
  try { if (lpId){ await loadThread(lpId); if (!(quiet && typing)) lpRender(); } } catch {}
  try { if (!(quiet && typingTodo)) renderAll(); } catch {}
  await reloadList();
}
// new info shows up by itself: every 30 s while the site is open on screen
setInterval(() => { if (document.visibilityState === "visible" && pass && !$("app").hidden) refreshAll(true).catch(() => {}); }, 30000);
const hashId = () => (location.hash.match(/l=(\d+)/) || [])[1] || null;
const openSites = () => { showTab("more"); setTimeout(() => $("sitesPanel").scrollIntoView({ behavior: "smooth" }), 50); history.replaceState(null, "", location.pathname + location.search); };
window.addEventListener("hashchange", () => { if (pass && location.hash === "#todo"){ showTab("inbox"); history.replaceState(null, "", location.pathname + location.search); } else if (pass && location.hash === "#sites") openSites(); else if (pass && hashId() && hashId() !== lpId) openListing(hashId()); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && pass && !$("app").hidden) refreshAll(); });
// One date pop-up for every date field (Asa, 28 Oct 2026): always 6 weeks, opens at the chosen date, or at the ad's
// available-from date for a start or move-in day. For a viewing time it shows in green when you're free (More > Free times).
const FDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], FPARTS = ["Morning", "Afternoon", "Evening"], WD = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
let freeGrid = null, cal = null, calQueued = false;
const ymdL = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const isFree = (d, hh) => !!freeGrid?.[FDAYS[(d.getDay() + 6) % 7]]?.[hh < 12 ? 0 : hh < 17 ? 1 : 2];
function calText(inp){
  const v = inp.value, dt = inp.type === "datetime-local";
  if (inp.dataset.none) return "None of these work";
  if (!v) return inp.dataset.slots ? "Pick one of their times" : dt ? "Pick a date and time" : "Pick a date";
  const d = new Date(dt ? v : v + "T12:00:00");
  return isNaN(d) ? v : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }) + (dt ? " " + v.slice(11, 16) : "");
}
function calify(){
  calQueued = false;
  document.querySelectorAll('input[type="date"],input[type="datetime-local"]').forEach((inp) => {
    let b = inp.nextElementSibling;
    if (!inp.dataset.cal){
      inp.dataset.cal = "1"; inp.style.display = "none";
      b = document.createElement("button"); b.type = "button"; b.className = "btn ghost calbtn";
      b.onclick = (e) => { e.preventDefault(); openCal(inp); };
      inp.after(b);
    }
    if (b?.classList.contains("calbtn")){ const t = calText(inp); if (b.textContent !== t) b.textContent = t; }
  });
}
new MutationObserver(() => { if (!calQueued){ calQueued = true; setTimeout(calify, 0); } }).observe(document.body, { childList: true, subtree: true });
function openCal(inp){
  const v = inp.value, sel = v ? v.slice(0, 10) : "", from = inp.dataset.from || "";
  const slots = inp.dataset.slots ? inp.dataset.slots.split(",").filter(Boolean) : null; // they offered these times: only those can be picked
  const lid = inp.closest("[data-id]")?.dataset.id || lpId || "";
  const start = new Date((sel || slots?.[0]?.slice(0, 10) || (from > ymdL(new Date()) ? from : "") || ymdL(new Date())) + "T12:00:00");
  cal = { inp, dt: inp.type === "datetime-local", sel, from, slots, lid, time: inp.type === "datetime-local" && v ? v.slice(11, 16) : "", y: start.getFullYear(), m: start.getMonth() };
  drawCal(); $("calDlg").showModal();
}
function drawCal(){
  const c = cal, first = new Date(c.y, c.m, 1), off = (first.getDay() + 6) % 7, today = ymdL(new Date());
  const cells = [...Array(42)].map((_, k) => new Date(c.y, c.m, 1 - off + k)), selD = c.sel ? new Date(c.sel + "T12:00:00") : null;
  const sdays = c.slots ? [...new Set(c.slots.map((s) => s.slice(0, 10)))] : null;
  const times = c.slots ? c.slots.filter((s) => s.startsWith(c.sel)).map((s) => s.slice(11, 16)) : [...Array(13)].map((_, k) => String(8 + k).padStart(2, "0") + ":00");
  // another viewing less than 2 hours away
  const clash = (t) => { const at = Date.parse(`${c.sel}T${t}`); return Object.entries(statuses).some(([k, s]) => k !== String(c.lid) && s.viewing_at && !s.closed && Math.abs(Date.parse(s.viewing_at) - at) < 7200000); };
  $("calDlg").innerHTML = `<div class="calhead"><button class="btn ghost small" type="button" data-c="prev" aria-label="Previous month">‹</button><b>${first.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</b><button class="btn ghost small" type="button" data-c="next" aria-label="Next month">›</button></div>
    <div class="calgrid">${WD.map((w) => `<span class="wd">${w}</span>`).join("")}${cells.map((d) => { const s = ymdL(d);
      return `<button type="button" data-day="${s}" class="${d.getMonth() !== c.m ? "out" : ""}${s === today ? " today" : ""}${s === c.sel ? " sel" : ""}${s === c.from ? " from" : ""}${sdays?.includes(s) ? " offer" : ""}"${sdays && !sdays.includes(s) ? " disabled" : ""} aria-label="${d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}"${s === c.sel ? ' aria-pressed="true"' : ""}>${d.getDate()}</button>`; }).join("")}</div>
    ${c.from ? `<p class="why" style="margin-top:6px">Green ring: the ad says it's free from ${esc(dayTxt(c.from + "T12:00:00"))}.</p>` : ""}
    ${sdays ? `<p class="why" style="margin-top:6px">Only the days they offered can be picked (blue ring).</p>` : ""}
    ${c.dt ? `<p class="why" style="margin-top:8px">${selD ? "Pick a time" + (freeGrid ? " (green: you're free then)" : "") : "Pick a day first"}</p>
      <div class="caltimes">${times.map((t) => { const cl = selD && clash(t); return `<button class="chip${cl ? " clash" : selD && isFree(selD, +t.slice(0, 2)) ? " free" : ""}${t === c.time ? " on" : ""}" type="button" data-tm="${t}"${selD ? "" : " disabled"}>${t}${cl ? " ✗" : ""}</button>`; }).join("")}</div>
      ${selD && times.some(clash) ? `<p class="why" style="margin-top:4px">✗ = less than 2 hours from another viewing.</p>` : ""}
      ${c.slots ? "" : `<label class="why" style="display:flex;gap:8px;align-items:center;margin-top:8px">Other time <input type="time" data-c="time" value="${esc(c.time)}"></label>`}` : ""}
    <div class="calfoot">${c.slots ? `<button class="linkbtn" type="button" data-c="none">None of these work</button>` : `<button class="linkbtn" type="button" data-c="clear">Clear</button>`}<span class="btnrow"><button class="btn ghost small" type="button" data-c="cancel">Cancel</button>${c.dt ? `<button class="btn small" type="button" data-c="ok"${c.sel && c.time ? "" : " disabled"}>Done</button>` : ""}</span></div>`;
}
function calSet(val, none = false){
  const i = cal.inp; i.value = val; $("calDlg").close();
  if (none) i.dataset.none = "1"; else delete i.dataset.none;
  i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true }));
  calify();
}
$("calDlg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b || !cal) return;
  const c = cal, k = b.dataset.c;
  if (b.dataset.day){ c.sel = b.dataset.day; if (!c.dt) return calSet(c.sel); const d = new Date(c.sel + "T12:00:00"); c.y = d.getFullYear(); c.m = d.getMonth(); return drawCal(); }
  if (b.dataset.tm){ c.time = b.dataset.tm; return calSet(`${c.sel}T${c.time}`); }
  if (k === "prev" || k === "next"){ const d = new Date(c.y, c.m + (k === "prev" ? -1 : 1), 1); c.y = d.getFullYear(); c.m = d.getMonth(); return drawCal(); }
  if (k === "clear") return calSet("");
  if (k === "none") return calSet("", true);
  if (k === "cancel") return $("calDlg").close();
  if (k === "ok") return calSet(`${c.sel}T${c.time}`);
});
$("calDlg").addEventListener("change", (e) => { if (e.target.dataset.c === "time"){ cal.time = e.target.value; drawCal(); } });

// Free times (More): Asa writes when he's free in his own words, the AI fills the week, he can tap blocks to fix it.
function drawFree(){
  const g = freeGrid;
  $("freeGrid").innerHTML = `<div class="fgrid"><span></span>${WD.map((w) => `<span class="h">${w}</span>`).join("")}${FPARTS.map((p, pi) => `<span class="rl">${p}</span>${FDAYS.map((d, di) =>
    `<button type="button" data-fd="${d}" data-fp="${pi}" class="${g?.[d]?.[pi] ? "on" : ""}" aria-pressed="${!!g?.[d]?.[pi]}" aria-label="${WD[di]} ${p.toLowerCase()}"></button>`).join("")}`).join("")}</div>
    <p class="why" style="margin-top:6px">${g ? "Green = free. Tap a block to change it." : "Not filled in yet. Write it above, or tap the blocks."}</p>`;
}
async function loadFree(){ try { const r = await fn("me?free=1"); freeGrid = r.grid; $("freeTxt").value = r.text || ""; } catch {} drawFree(); }
$("freeRead").onclick = async () => {
  const text = $("freeTxt").value.trim(), b = $("freeRead");
  if (!text) return toast("Write when you're free first.");
  b.disabled = true; b.textContent = "Reading…";
  try { freeGrid = (await fn("me", { method: "POST", body: JSON.stringify({ action: "free_read", text }) })).grid; drawFree(); toast("Your week is filled in. Check it below."); }
  catch (e){ fail(e); } finally { b.disabled = false; b.textContent = "Fill in my week"; }
};
$("freeGrid").onclick = async (e) => {
  const b = e.target.closest("[data-fd]"); if (!b) return;
  const g = freeGrid || Object.fromEntries(FDAYS.map((d) => [d, [false, false, false]])), d = b.dataset.fd, p = +b.dataset.fp;
  g[d] = [...(g[d] || [false, false, false])]; g[d][p] = !g[d][p]; freeGrid = g; drawFree();
  try { await fn("me", { method: "POST", body: JSON.stringify({ action: "free_save", grid: g }) }); } catch (err){ fail(err); }
};

async function boot(){
  $("sort").value = S.sort; drawSortDir();
  renderLoc(); renderActive(); applyView();
  await Promise.all([loadStatuses(), loadThreads(), loadDeals(), loadDrafts(), loadQuestions(), loadTodos(), loadPeople()]);
  showTab(location.hash === "#todo" ? "inbox" : ["find", "leads", "inbox", "more"].includes(S.tab) ? S.tab : "find");
  if (location.hash === "#todo") history.replaceState(null, "", location.pathname + location.search);
  load(true); headline(); loadTags(); loadCities(); loadInbox(); loadSites(); loadFree();
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
