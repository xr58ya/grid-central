// Grid Central team hub: follows a car live from its room in a Firebase Realtime Database (the address and room
// come in the link Grid Central gives the driver: team.html?db=...&room=...), and sends messages to the driver.
(() => {
  const $ = selector => document.querySelector(selector);
  // Text on the page is translated by i18n.js (team.html?...&lang=es) as it changes; T() is for text it can't see.
  const T = text => (window.gridLang ? window.gridLang.t(text) : text);
  $("#radio .empty").textContent = T($("#radio .empty").textContent);
  const params = new URLSearchParams(location.search);
  const db = (params.get("db") || "").replace(/\/+$/, "");
  const room = params.get("room") || "";
  const base = `${db}/rooms/${encodeURIComponent(room)}`;
  const data = { live: null, strategy: null, radio: null, info: null };
  const esc = text => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const num = value => typeof value === "number" && Number.isFinite(value);
  const lapTime = s => (num(s) && s > 0 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0")}` : "—");
  const clock = s => (num(s) && s >= 0 ? `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ""}${String(Math.floor((s % 3600) / 60)).padStart(Math.floor(s / 3600) ? 2 : 1, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "");
  const short = name => {
    const parts = String(name || "").trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0][0]}. ${parts[parts.length - 1]}` : parts[0] || "";
  };
  function setState(text, cls) {
    const chip = $("#state");
    chip.className = `chip ${cls || ""}`;
    chip.innerHTML = `<i></i> ${esc(text)}`;
  }

  if (!db || !room) {
    setState("NO LINK", "bad");
    $("#where").textContent = "Open this page with the team link from Grid Central (Settings → Team hub → Copy team link).";
    return;
  }

  // ---- Live from the database (Firebase's streaming REST API) ----
  function apply(path, value) {
    const parts = path.split("/").filter(Boolean);
    if (!parts.length) {
      Object.assign(data, { live: null, strategy: null, radio: null, info: null }, value || {});
      return;
    }
    let target = data;
    for (let i = 0; i < parts.length - 1; i++) {
      target[parts[i]] = target[parts[i]] && typeof target[parts[i]] === "object" ? target[parts[i]] : {};
      target = target[parts[i]];
    }
    target[parts[parts.length - 1]] = value;
  }
  function connect() {
    const source = new EventSource(`${base}.json`);
    source.addEventListener("put", event => {
      const message = JSON.parse(event.data);
      apply(message.path, message.data);
      render();
    });
    source.addEventListener("patch", event => {
      const message = JSON.parse(event.data);
      Object.entries(message.data || {}).forEach(([key, value]) => apply(`${message.path}/${key}`, value));
      render();
    });
    source.addEventListener("cancel", () => {
      setState("NO ACCESS", "bad");
      $("#where").textContent = "The database didn't let this page in. Check the link with the driver.";
    });
    source.onerror = () => setState("RECONNECTING", "bad");
  }

  const FLAGS = [["red", "RED FLAG", "red"], ["black", "BLACK FLAG", "black"], ["repair", "MEATBALL · PIT FOR REPAIRS", "black"], ["checkered", "CHEQUERED FLAG", "white"],
    ["caution", "CAUTION", "yellow"], ["cautionWaving", "CAUTION", "yellow"], ["yellow", "YELLOW FLAG", "yellow"], ["yellowWaving", "YELLOW FLAG", "yellow"], ["white", "WHITE FLAG · LAST LAP", "white"], ["blue", "BLUE FLAG", "blue"]];

  function render() {
    const live = data.live || {};
    const info = data.info || {};
    $("#team").textContent = info.name || live.team || "Team hub";
    document.title = `${info.name || "Grid Central"} · ${T("Team hub")}`;
    const fresh = live.at && Date.now() / 1000 - live.at < 15;
    if (!live.at) setState("WAITING FOR THE CAR");
    else if (!fresh) setState("NOT SENDING", "bad");
    else if (!live.connected) setState("NOT IN IRACING");
    else setState("LIVE", "live");
    $("#where").textContent = live.connected ? [live.driver, live.car, live.track, live.session && live.session.type].filter(Boolean).join(" · ")
      : !live.at ? "Waiting for Grid Central to start sharing." : !fresh ? "Grid Central hasn't sent anything for a while. It may be closed." : "The driver isn't in an iRacing session right now.";
    const l = live.live || {};
    const field = (live.field || []).map(([p, cp, n, name, cls, cc, gap, last, best, pit, me]) => ({ p, cp, n, name, cls, cc, gap, last, best, pit, me }));
    const me = field.find(car => car.me);
    const race = /race/i.test((live.session || {}).type || "");
    $("#pos").textContent = l.position ? `P${l.position}` : "—";
    $("#pos-note").textContent = l.classPosition && l.classPosition !== l.position ? `P${l.classPosition} in class` : field.length ? `${l.incidents || 0}x incidents` : "";
    const laps = (live.session || {}).laps;
    $("#lap").textContent = l.lap ? `${l.lap}${num(laps) && laps > 0 ? `/${laps}` : ""}` : "—";
    $("#left").textContent = num((live.session || {}).timeRemain) ? `${clock(live.session.timeRemain)} left` : num((live.session || {}).lapsRemain) && live.session.lapsRemain < 10000 ? `${live.session.lapsRemain} to go` : "";
    $("#last").textContent = lapTime(l.lastLap);
    $("#best").textContent = l.bestLap ? `best ${lapTime(l.bestLap)}` : "";
    const ahead = me && field.find(car => car.p === me.p - 1);
    const behind = me && field.find(car => car.p === me.p + 1);
    const gap = (front, back) => (race && front && back && num(front.gap) && num(back.gap) ? `${(back.gap - front.gap).toFixed(1)} s` : "—");
    $("#ahead").textContent = gap(ahead, me);
    $("#ahead-who").textContent = ahead ? `#${ahead.n} ${short(ahead.name)}` : "";
    $("#behind").textContent = gap(me, behind);
    $("#behind-who").textContent = behind ? `#${behind.n} ${short(behind.name)}` : "";
    const imperial = data.strategy && data.strategy.units === "imperial";
    $("#fuel").textContent = num(l.fuelL) ? (imperial ? `${(l.fuelL * 0.264172).toFixed(1)} gal` : `${l.fuelL.toFixed(1)} L`) : "—";
    $("#fuel-laps").textContent = data.strategy && num(data.strategy.lapsOfFuel) ? `${data.strategy.lapsOfFuel.toFixed(1)} laps` : "";
    // Banner: flags first, then the pit call.
    const flags = new Set(l.flags || []);
    const flag = FLAGS.find(([name]) => flags.has(name));
    const boxIn = data.strategy && data.strategy.boxIn;
    const banner = $("#banner");
    const text = flag ? flag[1] : fresh && live.connected && boxIn === 0 && !l.inPits ? "BOX THIS LAP" : fresh && live.connected && boxIn === 1 && !l.inPits ? "BOX NEXT LAP" : "";
    banner.textContent = text;
    banner.className = `banner ${flag ? flag[2] : "box"}${text ? "" : " hidden"}`;
    // Standings.
    $("#standings").innerHTML = field.length
      ? `<thead><tr><th>P</th><th>#</th><th>DRIVER</th><th>${race ? "GAP" : "BEST"}</th><th>LAST</th></tr></thead><tbody>${field.map(car => `<tr class="${car.me ? "me" : ""}${car.pit ? " pit" : ""}"><td>${car.p}</td><td><span class="n" style="--cc:${esc(car.cc || "#666")}">${esc(car.n)}</span></td><td>${esc(short(car.name))}${car.pit ? " · PIT" : ""}</td>`
        + `<td>${race ? (car.p === 1 ? "Leader" : num(car.gap) && num(field[0].gap) ? `+${(car.gap - field[0].gap).toFixed(1)}` : "—") : lapTime(car.best)}</td><td>${lapTime(car.last)}</td></tr>`).join("")}</tbody>`
      : '<tbody><tr><td class="empty">Waiting for the car.</td></tr></tbody>';
    // Strategy.
    const s = data.strategy || {};
    $("#advice").textContent = s.advice || "—";
    $("#advice").classList.toggle("urgent", Boolean(s.urgent));
    const LABELS = { finish: "To the finish", stops: "Stops left", add: "Add at next stop", window: "Pit window" };
    $("#stats").innerHTML = Object.entries(LABELS).map(([key, label]) => {
      const stat = (s.stats || {})[key] || {};
      return `<div><span>${label}</span><b class="${stat.tone ? `is-${esc(stat.tone)}` : ""}">${esc(stat.value || "—")}</b><span>${esc(stat.note || "")}</span></div>`;
    }).join("");
    $("#team-line").textContent = s.team || "";
    // Radio (left alone by i18n.js, so the driver's own words stay as said; the car's calls come in English).
    const radio = Array.isArray(data.radio) ? data.radio : Object.values(data.radio || {});
    const said = item => (item.who === "driver" || !window.gridLang ? item.text : window.gridLang.speech(String(item.text || "")));
    $("#radio").innerHTML = radio.length
      ? radio.slice().reverse().map(item => `<li class="${esc(item.who)}"><b>${esc(T(String(item.who || "radio").toUpperCase()))}${item.at ? ` · ${new Date(item.at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</b>${esc(said(item))}</li>`).join("")
      : `<li class="empty">${esc(T("Race calls and team messages appear here."))}</li>`;
  }
  setInterval(render, 5000); // notices when the car stops sending

  // ---- Messages to the driver ----
  try { $("#chat-name").value = localStorage.getItem("gc-team-name") || ""; } catch { /* private mode */ }
  $("#chat").addEventListener("submit", async event => {
    event.preventDefault();
    const name = $("#chat-name").value.trim() || "Team";
    const text = $("#chat-text").value.trim();
    if (!text) return;
    try { localStorage.setItem("gc-team-name", name); } catch { /* private mode */ }
    const button = event.target.querySelector("button");
    button.disabled = true;
    try {
      const response = await fetch(`${base}/chat.json`, { method: "POST", body: JSON.stringify({ name, text, at: { ".sv": "timestamp" } }) });
      if (!response.ok) throw new Error(String(response.status));
      $("#chat-text").value = "";
    } catch {
      alert(T("Couldn't send that. Check your connection and try again."));
    } finally {
      button.disabled = false;
    }
  });

  connect();
})();
