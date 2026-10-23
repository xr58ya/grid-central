// Grid Central's shop on the website: the home page's Pricing section. Sign in with your Grid Central account (made in
// the app, where the free trial is tied to the PC), see what it has, and buy: Grid Central's server (worker/) makes a
// Lemon Squeezy checkout, which comes back here after paying, or opens Lemon Squeezy's customer portal. This page only
// reads the account and its teams (from Grid Central's server); the payments server writes what's bought, as it does for
// the app (account.js).
// Open once selling starts (PLANS_LIVE), on gridcentral.store only: GitHub Pages doesn't allow selling. ?shop in the
// address opens it anywhere, for testing (buying itself only works from gridcentral.store: the server checks). The
// sign-in is kept in this browser tab only (sessionStorage), until Sign out or the tab closes.
(() => {
  // Set at launch, with account.js's PLANS_LIVE and LAUNCH (and companion/plan_pass.py's PLANS_LIVE).
  const PLANS_LIVE = false;
  const LAUNCH = null; // release day, a UTC date: e.g. Date.UTC(2027, 0, 11)
  const params = new URLSearchParams(location.search);
  const SHOP_OPEN = (PLANS_LIVE && ["gridcentral.store", "www.gridcentral.store"].includes(location.hostname)) || params.has("shop");
  if (!SHOP_OPEN) return;

  const FIREBASE = { apiKey: "AIzaSyBgSt-oANOD7JgblZafCJN71jhifth4vDY", projectId: "grid-central-accounts" };
  const WORKER = window.GC_WORKER || "https://api.gridcentral.store";
  // As account.js PRICES: a month, a year (US dollars; tax is added at checkout). The prices are final on 23 Nov 2026:
  // check them then. A year is ten months' price, as the Pricing page has it.
  const PRICES = { driver: ["$9.99", "$99.99"], "race-team": ["$19.99", "$199.99"], "seat-pack": ["$29.99", "$299.99"], broadcast: ["$9.99", "$99.99"] };
  const SAVING = "Save 17%";
  const TRIAL_DAYS = 7;
  const BETA_MONTHS = 6;
  const BETA_OFFER_DAYS = 30;
  const DAY = 86400000;
  const JUST_BOUGHT_MS = 10 * 60000; // after a checkout, its Buy button stays away this long (or until it shows)
  // { session: {uid, email, refreshToken}, checkout: {plan, seats} (the one opened last), bought: {plan, at} }
  const STORE = "gc-shop";
  const AUTH = "https://identitytoolkit.googleapis.com/v1/accounts";

  // As account.js MESSAGES and WORKER_MESSAGES.
  const MESSAGES = {
    EMAIL_NOT_FOUND: "Wrong email or password.",
    INVALID_PASSWORD: "Wrong email or password.",
    INVALID_LOGIN_CREDENTIALS: "Wrong email or password.",
    INVALID_EMAIL: "That email address doesn't look right.",
    MISSING_PASSWORD: "Enter your password.",
    TOO_MANY_ATTEMPTS_TRY_LATER: "Too many tries. Wait a few minutes and try again.",
    TOO_MANY: "Too many tries. Wait a few minutes and try again.", // (Grid Central's server: worker/src/limits.js)
    USER_DISABLED: "This account has been turned off. Contact support@gridcentral.store.",
    TOKEN_EXPIRED: "Please sign in again.",
    INVALID_REFRESH_TOKEN: "Please sign in again.",
    USER_NOT_FOUND: "Please sign in again.",
    NOT_SIGNED_IN: "Please sign in again.",
    NO_TEAM: "Create your team in Grid Central first (Settings → Team), then buy Race Team for it here.",
    NOT_OWNER: "Only the team's owner can buy for it.",
    NOT_BETA: "The beta tester offer is for accounts with a beta code.",
    OFFER_NOT_OPEN: "The beta tester offer opens on release day.",
    OFFER_CLOSED: "The beta tester offer has closed.",
    OFFER_USED: "You've already started your beta tester offer.",
    NOT_ON_SALE: "That isn't on sale yet.",
    ALREADY_ON: "You already have that. Manage your subscription to change it.",
    NO_SUBSCRIPTION: "There's no subscription to manage yet.",
  };
  const SIGNED_OUT = ["TOKEN_EXPIRED", "INVALID_REFRESH_TOKEN", "USER_NOT_FOUND", "USER_DISABLED", "NOT_SIGNED_IN"];
  // Back from a checkout (Lemon Squeezy comes back to ?bought=<plan>, the server's choice).
  const THANKS = {
    driver: "Thanks! Driver is yours. Switch back to Grid Central, or open it, and it shows up within a couple of minutes.",
    beta: "Thanks for testing! Your free months of Driver have started. Switch back to Grid Central, or open it, and they show up within a couple of minutes.",
    broadcast: "Thanks! The Broadcast add-on is yours. Switch back to Grid Central, or open it, and it shows up within a couple of minutes.",
    "race-team": "Thanks! Your team has Race Team. Its drivers get it in Grid Central within a couple of minutes.",
    "seat-pack": "Thanks! Your team has 5 more seats. Add your drivers in Grid Central (Settings → Team).",
  };
  const ON_ITS_WAY = "Bought. It shows up here as soon as Lemon Squeezy confirms the payment, usually within a minute.";

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const section = $("#pricing");
  let saved = read() || {};
  let idToken = null;
  let idExpires = 0;
  let account = null; // the account (from Grid Central's server), and the teams: the one it drives for, the one it owns
  let team = null;
  let owned = null;
  let interval = "monthly";
  let busy = false;
  let leaving = false; // on the way to Lemon Squeezy

  function read() {
    try {
      return JSON.parse(sessionStorage.getItem(STORE)) || null;
    } catch {
      return null;
    }
  }
  function write() {
    try {
      if (saved.session || saved.bought) sessionStorage.setItem(STORE, JSON.stringify(saved));
      else sessionStorage.removeItem(STORE);
    } catch {
      // No storage: signed in until the page closes.
    }
  }

  // ---- Talking to Firebase and Grid Central's server ----
  class ShopError extends Error {
    constructor(code, message) {
      super(message || MESSAGES[code] || "Something went wrong. Try again in a minute.");
      this.code = code;
    }
  }
  async function request(url, options) {
    let response;
    try {
      response = await fetch(url, options);
    } catch {
      throw new ShopError("OFFLINE", "Couldn't reach the account server. Check your internet connection.");
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Sign-in errors are codes like "INVALID_LOGIN_CREDENTIALS"; database errors have a status.
      const error = body.error || {};
      const word = /^[A-Z_]+\b/.exec(String(error.message || ""));
      throw new ShopError(word ? word[0] : String(error.status || response.status));
    }
    return body;
  }
  const post = (url, body, token) => request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const claimsOf = jwt => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), ch => ch.charCodeAt(0))));
  function signedIn(result) {
    idToken = result.idToken || result.id_token;
    idExpires = Date.now() + (Number(result.expiresIn || result.expires_in) || 3600) * 1000;
    const claims = claimsOf(idToken);
    saved.session = { uid: result.localId || result.user_id || claims.user_id, email: claims.email, refreshToken: result.refreshToken || result.refresh_token };
    write();
  }
  async function token() {
    if (idToken && Date.now() < idExpires - 60000) return idToken;
    if (!saved.session) throw new ShopError("TOKEN_EXPIRED");
    signedIn(await request(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(saved.session.refreshToken)}`,
    }));
    return idToken;
  }
  function signOut() {
    saved.session = null;
    write();
    idToken = null;
    account = team = owned = null;
  }
  async function worker(path, body) {
    let response;
    try {
      response = await fetch(`${WORKER}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ShopError("OFFLINE", "Couldn't reach Grid Central's server. Check your internet connection.");
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new ShopError(result.code || String(response.status));
    return result;
  }

  // The account, the team it drives for (member: it has a seat there; past the seats, after a seat pack ran out, it
  // hasn't) and the team it owns, from Grid Central's server, as account.js loadAccount reads them; nothing written.
  async function load() {
    const found = await worker("/me", {});
    if (!found.account) {
      signOut();
      throw new ShopError("NO_ACCOUNT", "Open Grid Central and sign in there once first: that's where your account is set up.");
    }
    account = found.account;
    team = found.team || null;
    owned = found.ownedTeam || null;
  }

  // ---- What the account has (as account.js status()) ----
  function status() {
    const time = Date.now();
    const onTeam = team && team.member && (team.proUntil || 0) > time ? team : null;
    const trialFrom = account.trialFrom || account.created; // (or a new trial from support)
    const trialUntil = account.trial && trialFrom ? trialFrom + TRIAL_DAYS * DAY : 0;
    const kind = account.dev === true ? "dev" : (account.proUntil || 0) > time ? "pro" : onTeam ? "team" : trialUntil > time ? "trial" : "free";
    return {
      kind, onTeam, trialUntil,
      betaOffer: Boolean(account.beta) && !account.betaUsed && Boolean(LAUNCH) && time >= LAUNCH && time <= LAUNCH + BETA_OFFER_DAYS * DAY,
      // The beta tester offer's free months, while they run.
      freeUntil: kind === "pro" && (account.trialUntil || 0) > time ? account.trialUntil : 0,
    };
  }
  // A plan this tab just bought (back from its checkout), until it shows or JUST_BOUGHT_MS goes by.
  const justBought = plan => Boolean(saved.bought && saved.bought.plan === plan && Date.now() - saved.bought.at < JUST_BOUGHT_MS);
  // The purchase is on the account (written by the payments server when Lemon Squeezy says so).
  function arrived(plan) {
    const time = Date.now();
    if (plan === "driver" || plan === "beta") return (account.proUntil || 0) > time;
    if (plan === "race-team") return Boolean(owned && (owned.proUntil || 0) > time);
    if (plan === "broadcast") return (account.broadcastUntil || 0) > time || Boolean(owned && (owned.broadcastUntil || 0) > time);
    // A seat pack: more seats than when its checkout opened.
    const opened = saved.checkout && saved.checkout.plan === "seat-pack" ? saved.checkout.seats || 0 : Infinity;
    return Boolean(owned && (owned.seats || 0) > opened);
  }

  // ---- The Pricing section ----
  const dateText = ms => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  const show = (element, on) => { if (element) element.hidden = !on; };
  const note = (selector, text) => { $(selector).textContent = text || ""; };
  function say(message, error = false) {
    const line = $("#shop-status");
    line.textContent = message || "";
    line.classList.toggle("is-error", Boolean(error));
  }
  function formSay(message, error = false) {
    const line = $("#shop-form-status");
    line.textContent = message || "";
    line.classList.toggle("is-error", Boolean(error));
  }
  function priceIn(element, plan) {
    const [month, year] = PRICES[plan];
    const unit = document.createElement("small");
    unit.textContent = interval === "yearly" ? " a year" : " a month";
    element.replaceChildren(interval === "yearly" ? year : month, unit);
  }
  const perMonth = plan => `$${(Number(PRICES[plan][1].slice(1)) / 12).toFixed(2)}`;

  function render() {
    const time = Date.now();
    $$("[data-interval]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.interval === interval)));
    $$("[data-price]").forEach(element => priceIn(element, element.dataset.price));
    $$("[data-per]").forEach(element => {
      const plan = element.dataset.per;
      element.hidden = false;
      element.textContent = interval === "yearly" ? `${perMonth(plan)} a month · ${SAVING}` : `Or ${PRICES[plan][1]} a year · ${SAVING}`;
    });
    $$("[data-price-of]").forEach(element => {
      const [month, year] = PRICES[element.dataset.priceOf];
      element.textContent = interval === "yearly" ? `${year} a year` : `${month} a month`;
    });

    // Signed out: every Buy button opens the sign-in. (Signed in, the account shows once it's been read.)
    const session = Boolean(saved.session);
    const signed = session && Boolean(account);
    const s = signed ? status() : null;
    $("#shop-who").textContent = session ? `Signed in as ${saved.session.email}` : "Sign in to buy, with the account you use in Grid Central.";
    show($("#shop-sign-in"), !session);
    show($("#shop-sign-out"), session);
    const boughtBefore = signed && ([account.proUntil, account.broadcastUntil, account.trialUntil, account.betaUsed].some(Boolean)
      || Boolean(owned && (owned.proUntil || owned.broadcastUntil)));
    show($("#shop-manage"), boughtBefore);

    // Driver: on Rookie or the trial (the beta tester offer comes first while it's open).
    const canDriver = !signed || ((s.kind === "free" || s.kind === "trial") && !s.betaOffer);
    show($("[data-buy='driver']"), canDriver && !justBought("driver"));
    show($("[data-buy='beta']"), Boolean(signed && s.betaOffer && !justBought("beta")));
    let driverNote = "";
    if (!signed) driverNote = "";
    else if (justBought("driver") || justBought("beta")) driverNote = ON_ITS_WAY;
    else if (s.kind === "dev") driverNote = "Your developer licence includes everything.";
    // The beta tester offer's price comes from Grid Central's server, only for an account with a beta code.
    else if (s.kind === "pro" && s.freeUntil && account.betaPrice) driverNote = `Driver is free until ${dateText(s.freeUntil)}, then ${account.betaPrice} a month.`;
    else if (s.kind === "pro") driverNote = `You have Driver. Your subscription is active until ${dateText(account.proUntil)}.`;
    else if (s.kind === "team") driverNote = `You have Driver through ${s.onTeam.name}, on Race Team until ${dateText(s.onTeam.proUntil)}.`;
    else if (s.betaOffer && account.betaPrice) driverNote = `Thanks for testing! Start your ${BETA_MONTHS} free months of Driver by ${dateText(LAUNCH + BETA_OFFER_DAYS * DAY)}: a card is needed at checkout, and nothing is charged until they end. Then it's ${account.betaPrice} a month for as long as you stay subscribed.`;
    else if (s.kind === "trial") driverNote = `Your free trial ends on ${dateText(s.trialUntil)}.`;
    note("#shop-driver-note", driverNote);

    // Race Team, for the team you own: Race Team first, then seat packs and the team's Broadcast add-on.
    const paid = item => Boolean(item && (item.proUntil || 0) > time);
    const raceTeam = $("[data-buy='race-team']");
    raceTeam.textContent = signed && owned ? `Buy Race Team for ${owned.name || "your team"}` : "Buy Race Team";
    show(raceTeam, !signed || Boolean(owned && !paid(owned) && !justBought("race-team")));
    show($("[data-buy='seat-pack']"), Boolean(signed && paid(owned) && !justBought("seat-pack")));
    show($("[data-buy='team-broadcast']"), Boolean(signed && paid(owned) && !((owned.broadcastUntil || 0) > time) && !justBought("broadcast")));
    let teamNote = "";
    if (!signed) teamNote = "";
    else if (justBought("race-team") || justBought("seat-pack")) teamNote = ON_ITS_WAY;
    else if (!owned) teamNote = MESSAGES.NO_TEAM;
    else if (paid(owned)) teamNote = `${owned.name || "Your team"} has Race Team until ${dateText(owned.proUntil)}, with ${owned.used || 0} of ${owned.seats || 0} seats in use.`
      + ((owned.broadcastUntil || 0) > time ? " Its Broadcast add-on is on for every driver." : "");
    note("#shop-team-note", teamNote);

    // The Broadcast add-on: on top of Driver or Race Team.
    const teamBroadcast = Boolean(s && s.onTeam && (s.onTeam.broadcastUntil || 0) > time);
    const ownBroadcast = Boolean(signed && (account.broadcastUntil || 0) > time);
    const canBroadcast = !signed || ((s.kind === "pro" || s.kind === "team") && !ownBroadcast && !teamBroadcast);
    show($("[data-buy='broadcast']"), canBroadcast && !justBought("broadcast"));
    let broadcastNote = "";
    if (!signed) broadcastNote = "";
    else if (justBought("broadcast")) broadcastNote = ON_ITS_WAY;
    else if (s.kind === "dev") broadcastNote = "Included in your developer licence.";
    else if (ownBroadcast) broadcastNote = `You have the Broadcast add-on, active until ${dateText(account.broadcastUntil)}.`;
    else if (teamBroadcast) broadcastNote = `You have it through ${s.onTeam.name}.`;
    else if (!canBroadcast) broadcastNote = "It adds to Driver or Race Team: get one of those first.";
    note("#shop-broadcast-note", broadcastNote);

    $$("#pricing [data-buy], #shop-manage, #shop-sign-out, #shop-sign-in").forEach(button => { button.disabled = busy || leaving; });
  }

  // Something that talks to the servers, with what it's doing on the status line.
  async function run(task, working) {
    if (busy || leaving) return;
    busy = true;
    say(working);
    render();
    try {
      say((await task()) || "");
    } catch (error) {
      if (SIGNED_OUT.includes(error.code)) signOut();
      say(error.message, true);
    } finally {
      busy = false;
      render();
    }
  }
  // To Lemon Squeezy (its checkout or customer portal), in this tab.
  function go(url) {
    if (!/^https:\/\//.test(String(url))) throw new ShopError("SERVER");
    leaving = true;
    window.location.assign(url);
  }
  // Back here with the browser's Back button: the page may come back as it was left.
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    leaving = false;
    say("");
    render();
  });

  // ---- Signing in (an account made in Grid Central) ----
  const dialog = $("#shop-dialog");
  function openSignIn() {
    formSay("");
    if (!dialog.open) dialog.showModal();
    $("#shop-email").focus();
  }
  let signingIn = false;
  async function formRun(task, working) {
    if (signingIn) return;
    signingIn = true;
    formSay(working);
    try {
      formSay((await task()) || "");
    } catch (error) {
      formSay(error.message, true);
    } finally {
      signingIn = false;
      render();
    }
  }
  $("#shop-form").addEventListener("submit", event => {
    event.preventDefault();
    formRun(async () => {
      const email = $("#shop-email").value.trim();
      const password = $("#shop-password").value;
      if (!email) throw new ShopError("INVALID_EMAIL");
      if (!password) throw new ShopError("MISSING_PASSWORD");
      signedIn(await post(`${AUTH}:signInWithPassword?key=${FIREBASE.apiKey}`, { email, password, returnSecureToken: true }));
      $("#shop-password").value = "";
      await load();
      dialog.close();
      say("");
    }, "Signing in…");
  });
  // A reset link by email. Whether an account has that email isn't given away.
  $("#shop-forgot").addEventListener("click", () => formRun(async () => {
    const email = $("#shop-email").value.trim();
    if (!email) throw new ShopError("NO_EMAIL", "Enter your email first, then press Forgot password.");
    try {
      await post(`${AUTH}:sendOobCode?key=${FIREBASE.apiKey}`, { requestType: "PASSWORD_RESET", email });
    } catch (error) {
      if (error.code !== "EMAIL_NOT_FOUND") throw error;
    }
    return "If there's an account with that email, a link to reset your password is on its way.";
  }, "Sending…"));
  $("#shop-cancel").addEventListener("click", () => dialog.close());
  $("#shop-sign-in").addEventListener("click", openSignIn);
  $("#shop-sign-out").addEventListener("click", () => {
    signOut();
    say("");
    render();
  });

  // ---- Buying ----
  $$("[data-interval]").forEach(button => button.addEventListener("click", () => {
    interval = button.dataset.interval;
    render();
  }));
  section.addEventListener("click", event => {
    const button = event.target.closest("[data-buy]");
    if (!button) return;
    if (!saved.session) {
      openSignIn();
      return;
    }
    if (!account) {
      // Signed in, but the account couldn't be read (offline, say): read it again first.
      run(async () => {
        await load();
        return "";
      }, "Checking your account…");
      return;
    }
    // team-broadcast: the team's own Broadcast add-on (every driver in the team gets it).
    const kind = button.dataset.buy;
    const plan = kind === "team-broadcast" ? "broadcast" : kind;
    const forTeam = kind === "race-team" || kind === "seat-pack" || kind === "team-broadcast";
    run(async () => {
      if (forTeam && !owned) throw new ShopError("NO_TEAM");
      const { url } = await worker("/checkout", { plan, interval: plan === "beta" ? "monthly" : interval, ...(forTeam ? { team: owned.id } : {}) });
      saved.checkout = { plan, seats: owned ? owned.seats || 0 : 0 };
      write();
      go(url);
      return "Opening the checkout…";
    }, "Opening the checkout…");
  });
  // Lemon Squeezy's customer portal: cancel, monthly or yearly, the card, invoices.
  $("#shop-manage").addEventListener("click", () => run(async () => {
    const { url } = await worker("/portal", {});
    go(url);
    return "Opening your subscription…";
  }, "Opening your subscription…"));

  // ---- Opening ----
  // Back from a checkout: a thank-you, the address tidied (the Buy button stays away in this tab: justBought), and the
  // account read every 5 seconds for a minute until the purchase shows.
  const back = params.get("bought");
  if (Object.hasOwn(THANKS, back || "")) {
    saved.bought = { plan: back, at: Date.now() };
    write();
    const query = location.search.slice(1).split("&").filter(part => part && !part.startsWith("bought=")).join("&");
    history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
    $("#shop-thanks").textContent = THANKS[back];
    $("#shop-thanks").hidden = false;
  }
  // The purchase is on the account: the Buy buttons follow the account again.
  function landed() {
    saved.bought = null;
    saved.checkout = null;
    write();
  }
  function watch(plan) {
    const until = Date.now() + 60000;
    const timer = window.setInterval(async () => {
      try {
        if (!busy && saved.session) await load();
      } catch (error) {
        if (SIGNED_OUT.includes(error.code)) signOut();
      }
      const here = Boolean(saved.session && account && arrived(plan));
      if (here) landed();
      render();
      if (here || !saved.session || Date.now() > until) window.clearInterval(timer);
    }, 5000);
  }
  $$("[data-shop-closed]").forEach(element => { element.hidden = true; });
  $$("[data-shop]").forEach(element => { element.hidden = false; });
  section.classList.add("is-open");
  render();
  if (saved.session) {
    run(async () => {
      await load();
      if (!back || !saved.bought) return "";
      if (arrived(back)) landed();
      else watch(back);
      return "";
    }, "");
  }
})();
