// Languages: Grid Central in English or Spanish (Settings → Appearance → Language).
//
// Text is translated a whole sentence at a time: each paragraph, label, button and so on (an element holding just
// text and inline tags like <strong>) is looked up by its HTML, so the grammar comes out right. Numbers are
// placeholders ("Lap 3 of 40" is looked up as "Lap {#} of {#}"), so live text is translated too. Text the app adds
// later (live data, messages) is translated as it appears. Your engineer's spoken calls use the same dictionary.
// Dictionaries: es.js (window.GRID_ES). Untranslated text is listed in gridLang.missing, for adding to them.
(() => {
  const lang = (() => {
    const asked = new URLSearchParams(location.search).get("lang"); // ?lang=es, for trying it
    if (asked) return asked;
    try {
      return (JSON.parse(localStorage.getItem("apex-settings")) || {}).language || "en";
    } catch {
      return "en";
    }
  })();
  const dict = lang === "es" ? window.GRID_ES || {} : {};
  const active = lang !== "en";
  document.documentElement.lang = active ? lang : "en";
  const missing = new Set();
  const INLINE = new Set(["STRONG", "EM", "B", "I", "CODE", "A", "BR", "KBD", "U", "MARK", "SUP", "SUB", "ABBR", "Q", "SMALL"]);
  const SKIP = "script,style,svg,textarea,input,code.no-translate,[translate=no],#talk-log,.radar-log,#radio-log,.gw-stage";
  const NUMBER = /\d+(?:[.:,]\d+)*/g;

  // "Lap 3 of 40" -> ["Lap {#} of {#}", ["3", "40"]].
  function template(text) {
    const numbers = [];
    const key = text.replace(NUMBER, match => {
      numbers.push(match);
      return "{#}";
    });
    return [key, numbers];
  }
  function fill(text, numbers) {
    let i = 0;
    return text.replace(/\{#\}/g, () => (i < numbers.length ? numbers[i++] : ""));
  }
  const norm = text => text.replace(/\s+/g, " ").trim();
  const hasWords = text => /[A-Za-z]{2}/.test(text);

  // Text that's already in the new language (so it isn't looked up again), and patterns for text with names in it
  // ("About 32 s lost, rejoining around P10 (P8 now). Ahead: #26 Ava Lindqvist, 12.8 s.").
  const known = new Set(Object.values(dict).map(value => template(norm(value))[0]));
  const patterns = (lang === "es" ? window.GRID_ES_PATTERNS || [] : []).map(([source, replacement]) => [new RegExp(source), replacement]);

  function exact(clean) {
    if (dict[clean] !== undefined) return dict[clean];
    const [key, numbers] = template(clean);
    if (numbers.length && dict[key] !== undefined) return fill(dict[key], numbers);
    return null;
  }

  // A translation for a piece of text or HTML, or null.
  function lookup(text) {
    const clean = norm(text);
    if (!clean || !hasWords(clean)) return null;
    const found = exact(clean);
    if (found !== null) return found;
    const [key] = template(clean);
    if (known.has(key)) return null; // already translated
    // Several sentences together ("P7. Gap ahead 1.2. Behind 0.8."): one at a time, if each one is known.
    const inner = clean.match(/^<(strong|b|em)>([^<]*)<\/\1>$/);
    const plain = inner ? inner[2] : clean;
    if (!plain.includes("<") && /[.!?] /.test(plain)) {
      const sentences = plain.split(/(?<=[.!?])\s+/);
      const parts = sentences.map(sentence => (hasWords(sentence) ? exact(sentence) ?? patterned(sentence) : sentence));
      if (parts.every(part => part !== null)) {
        const joined = parts.join(" ");
        return inner ? `<${inner[1]}>${joined}</${inner[1]}>` : joined;
      }
    }
    const byPattern = patterned(clean);
    if (byPattern !== null) return byPattern;
    const byPieces = pieces(clean);
    if (byPieces !== null) return byPieces;
    missing.add(key);
    return null;
  }
  // Labels built from parts ("<small>Left front · Camber</small><b>2.1 deg</b>"): each bit of text between the tags
  // and the " · " separators on its own. Names and numbers stay as they are.
  function pieces(clean) {
    if (!clean.includes("<") && !clean.includes(" · ")) return null;
    let changed = false;
    const out = clean.split(/(<[^>]+>)/).map(part => (part.startsWith("<") ? part : part.split(" · ").map(bit => {
      const text = bit.trim();
      if (!hasWords(text)) return bit;
      const found = exact(text) ?? patterned(text);
      if (found === null) return bit;
      changed = true;
      return bit.replace(text, () => found);
    }).join(" · "))).join("");
    return changed ? out : null;
  }
  function patterned(text) {
    for (const [pattern, replacement] of patterns) {
      if (pattern.test(text)) return text.replace(pattern, replacement);
    }
    return null;
  }

  // Page titles ("Race <span>strategy.</span>") are one sentence too.
  const inline = node => INLINE.has(node.tagName) || (node.tagName === "SPAN" && !node.id && !node.className && node.parentElement && node.parentElement.tagName === "H1");
  const isLeaf = el => [...el.childNodes].every(node => node.nodeType === 3 || (node.nodeType === 1 && inline(node) && isLeaf(node)));
  const done = new WeakMap(); // element -> the HTML we put there (so our own changes aren't translated again)

  function translateElement(el) {
    if (el.closest(SKIP)) return;
    if (isLeaf(el)) {
      const html = el.innerHTML;
      if (done.get(el) === html || !hasWords(el.textContent)) return;
      const spaced = /^\s/.test(html) ? " " : "";
      const trailing = /\s$/.test(html) ? " " : "";
      const result = lookup(html);
      if (result !== null) {
        const out = spaced + result + trailing;
        el.innerHTML = out;
        done.set(el, out);
      } else {
        done.set(el, html);
      }
      return;
    }
    // A container: translate its loose bits of text, then its children.
    el.childNodes.forEach(node => {
      if (node.nodeType === 3) translateText(node);
      else if (node.nodeType === 1) translateElement(node);
    });
  }
  const doneText = new WeakMap();
  function translateText(node) {
    const value = node.nodeValue;
    if (doneText.get(node) === value || !hasWords(value) || (node.parentElement && node.parentElement.closest(SKIP))) return;
    const result = lookup(value);
    if (result !== null) {
      const out = (/^\s/.test(value) ? " " : "") + result + (/\s$/.test(value) ? " " : "");
      node.nodeValue = out;
      doneText.set(node, out);
    } else {
      doneText.set(node, value);
    }
  }
  const ATTRS = ["placeholder", "title", "aria-label"];
  function translateAttributes(root) {
    const elements = root.querySelectorAll ? [root, ...root.querySelectorAll("[placeholder],[title],[aria-label]")] : [];
    elements.forEach(el => ATTRS.forEach(name => {
      const value = el.getAttribute && el.getAttribute(name);
      if (!value || el.dataset[`tr${name.replace("-", "")}`] === value) return;
      const result = lookup(value);
      if (result !== null) {
        el.setAttribute(name, result.replace(/<[^>]+>/g, ""));
        el.dataset[`tr${name.replace("-", "")}`] = el.getAttribute(name);
      }
    }));
  }

  function run(root) {
    if (root.nodeType === 3) {
      const parent = root.parentElement;
      if (parent && isLeaf(parent)) translateElement(parent);
      else translateText(root);
      return;
    }
    if (root.nodeType !== 1) return;
    // A change inside a sentence: translate the whole sentence.
    const leafParent = root.parentElement && isLeaf(root.parentElement) && isLeaf(root) ? root.parentElement : null;
    translateElement(leafParent || root);
    translateAttributes(root);
  }

  if (active) {
    run(document.body);
    document.querySelectorAll("dialog").forEach(run);
    let queue = new Set();
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      const items = queue;
      queue = new Set();
      items.forEach(node => node.isConnected && run(node));
    };
    new MutationObserver(records => {
      records.forEach(record => {
        if (record.type === "characterData") queue.add(record.target);
        else if (record.type === "attributes") queue.add(record.target);
        else record.addedNodes.forEach(node => queue.add(node.nodeType === 3 && record.target.nodeType === 1 && isLeaf(record.target) ? record.target : node));
      });
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(flush);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  window.gridLang = {
    lang: active ? lang : "en",
    // For code: a translation of a plain string (or the string itself).
    t: text => (active ? lookup(text) ?? text : text),
    // Your engineer's spoken calls: whole calls first, then sentence by sentence.
    speech(text) {
      if (!active) return text;
      const whole = lookup(text);
      if (whole !== null) return whole.replace(/<[^>]+>/g, "");
      return String(text).split(/(?<=[.!?])\s+/).map(sentence => (lookup(sentence) ?? sentence).replace(/<[^>]+>/g, "")).join(" ");
    },
    missing
  };
})();
