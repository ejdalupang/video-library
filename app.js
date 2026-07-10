// ---------- Theme ----------
const THEME_KEY = "video-library-theme";
const themeToggle = document.getElementById("themeToggle");
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
}
applyTheme(localStorage.getItem(THEME_KEY) || "light");
themeToggle.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

// ---------- Platform detection ----------
function detectPlatform(url) {
  try {
    const host = new URL(url).hostname.replace("www.", "");
    if (host.includes("instagram.com")) return "instagram";
    if (host.includes("tiktok.com")) return "tiktok";
  } catch (e) {}
  return null;
}

// ---------- Storage layer ----------
// Falls back to a local-only store (this browser only) until firebase-config.js
// is filled in with a real project, so the app is usable immediately.
const isFirebaseConfigured = typeof firebaseConfig !== "undefined" && firebaseConfig.apiKey !== "REPLACE_ME";

let store;

if (isFirebaseConfigured) {
  firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();
  firebase.auth().signInAnonymously().catch(console.error);

  store = {
    subscribe(onChange) {
      firebase.auth().onAuthStateChanged((user) => {
        if (!user) return;
        db.collection("videos").orderBy("createdAt", "desc").onSnapshot((snap) => {
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          onChange(items);
        });
      });
    },
    add(entry) {
      return db.collection("videos").add({ ...entry, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    },
    remove(id) {
      return db.collection("videos").doc(id).delete();
    },
  };
} else {
  const LOCAL_KEY = "video-library-local-demo";
  function readLocal() {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
  }
  function writeLocal(items) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(items));
  }
  store = {
    subscribe(onChange) {
      onChange(readLocal());
    },
    add(entry) {
      const items = readLocal();
      items.unshift({ id: String(Date.now()), ...entry, createdAt: Date.now() });
      writeLocal(items);
      onChange_(items);
    },
    remove(id) {
      const items = readLocal().filter((i) => i.id !== id);
      writeLocal(items);
      onChange_(items);
    },
  };
  var onChange_ = () => {};
  const originalSubscribe = store.subscribe;
  store.subscribe = (onChange) => {
    onChange_ = onChange;
    originalSubscribe(onChange);
  };
}

if (!isFirebaseConfigured) {
  const banner = document.createElement("p");
  banner.textContent = "⚠️ Firebase not configured yet — running in local-only demo mode (this browser only). See README to enable cross-device sync.";
  banner.style.cssText = "font-size:0.8rem;color:#b8860b;background:#fff8e1;border:1px solid #f0d78c;padding:8px 12px;border-radius:10px;margin-bottom:12px;";
  document.body.insertBefore(banner, document.querySelector(".add-form"));
}

// ---------- State ----------
let allEntries = [];
let activeCategory = "All";

// ---------- Render ----------
const cardGrid = document.getElementById("cardGrid");
const categoryFilters = document.getElementById("categoryFilters");
const emptyState = document.getElementById("emptyState");
const categoryList = document.getElementById("categoryList");

function renderCategoryFilters() {
  const categories = ["All", ...new Set(allEntries.map((e) => e.category).filter(Boolean))];
  categoryFilters.innerHTML = "";
  categories.forEach((cat) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (cat === activeCategory ? " active" : "");
    chip.textContent = cat;
    chip.addEventListener("click", () => {
      activeCategory = cat;
      render();
    });
    categoryFilters.appendChild(chip);
  });

  categoryList.innerHTML = "";
  categories.filter((c) => c !== "All").forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat;
    categoryList.appendChild(opt);
  });
}

function buildEmbedHtml(entry) {
  if (entry.platform === "instagram") {
    return `<blockquote class="instagram-media" data-instgrm-permalink="${entry.url}" style="margin:0;width:100%;"></blockquote>`;
  }
  return `<blockquote class="tiktok-embed" cite="${entry.url}" style="margin:0;width:100%;"><section></section></blockquote>`;
}

function reprocessEmbeds() {
  if (window.instgrm) window.instgrm.Embeds.process();
  // TikTok's embed.js scans the DOM for unprocessed blockquotes when re-run.
  const existing = document.querySelector('script[src*="tiktok.com/embed.js"]');
  if (existing) {
    const fresh = document.createElement("script");
    fresh.async = true;
    fresh.src = existing.src;
    existing.replaceWith(fresh);
  }
}

function render() {
  renderCategoryFilters();
  const filtered = activeCategory === "All" ? allEntries : allEntries.filter((e) => e.category === activeCategory);

  cardGrid.innerHTML = "";
  emptyState.hidden = allEntries.length > 0;

  filtered.forEach((entry) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-head">
        <span class="platform-badge ${entry.platform}">${entry.platform === "instagram" ? "Instagram" : "TikTok"}</span>
        <span class="card-category">${entry.category || ""}</span>
      </div>
      ${entry.note ? `<div class="card-note">${entry.note}</div>` : ""}
      <div class="embed-wrap">${buildEmbedHtml(entry)}</div>
      <div class="card-actions">
        <button class="hide-btn">▲ Hide preview</button>
        <button class="delete-btn" title="Delete">🗑</button>
      </div>
    `;

    const embedWrap = card.querySelector(".embed-wrap");
    const hideBtn = card.querySelector(".hide-btn");
    hideBtn.addEventListener("click", () => {
      if (embedWrap.hidden) {
        embedWrap.innerHTML = buildEmbedHtml(entry);
        embedWrap.hidden = false;
        hideBtn.textContent = "▲ Hide preview";
        reprocessEmbeds();
      } else {
        embedWrap.hidden = true;
        embedWrap.innerHTML = "";
        hideBtn.textContent = "▶ Show preview";
      }
    });

    card.querySelector(".delete-btn").addEventListener("click", () => {
      if (confirm("Delete this video from your library?")) store.remove(entry.id);
    });

    cardGrid.appendChild(card);
  });

  reprocessEmbeds();
}

store.subscribe((items) => {
  allEntries = items;
  render();
});

// ---------- Add form ----------
const urlInput = document.getElementById("urlInput");
const categoryInput = document.getElementById("categoryInput");
const noteInput = document.getElementById("noteInput");
const addBtn = document.getElementById("addBtn");
const formError = document.getElementById("formError");

addBtn.addEventListener("click", () => {
  const url = urlInput.value.trim();
  const category = categoryInput.value.trim() || "Uncategorized";
  const note = noteInput.value.trim();
  const platform = detectPlatform(url);

  if (!platform) {
    formError.textContent = "Please paste a valid Instagram or TikTok link.";
    formError.hidden = false;
    return;
  }
  formError.hidden = true;

  store.add({ url, category, note, platform });
  urlInput.value = "";
  noteInput.value = "";
});

urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addBtn.click();
});
