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
    update(id, fields) {
      return db.collection("videos").doc(id).update(fields);
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
    update(id, fields) {
      const items = readLocal().map((i) => (i.id === id ? { ...i, ...fields } : i));
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
let activeTag = "All";

function parseTags(text) {
  return text.split(",").map((t) => t.trim()).filter(Boolean);
}

// ---------- Render ----------
const cardGrid = document.getElementById("cardGrid");
const categoryFilters = document.getElementById("categoryFilters");
const tagFilters = document.getElementById("tagFilters");
const emptyState = document.getElementById("emptyState");
const categoryList = document.getElementById("categoryList");
const tagList = document.getElementById("tagList");

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

function renderTagFilters() {
  const allTags = new Set();
  allEntries.forEach((e) => (e.tags || []).forEach((t) => allTags.add(t)));

  tagFilters.innerHTML = "";
  if (allTags.size > 0) {
    ["All", ...allTags].forEach((tag) => {
      const chip = document.createElement("button");
      chip.className = "chip tag-chip" + (tag === activeTag ? " active" : "");
      chip.textContent = tag === "All" ? "All tags" : `#${tag}`;
      chip.addEventListener("click", () => {
        activeTag = tag;
        render();
      });
      tagFilters.appendChild(chip);
    });
  }

  tagList.innerHTML = "";
  [...allTags].forEach((tag) => {
    const opt = document.createElement("option");
    opt.value = tag;
    tagList.appendChild(opt);
  });
}

function buildEmbedHtml(entry) {
  if (entry.platform === "instagram") {
    return `<blockquote class="instagram-media" data-instgrm-permalink="${entry.url}" style="margin:0;width:100%;"></blockquote>`;
  }
  return `<blockquote class="tiktok-embed" cite="${entry.url}" style="margin:0;width:100%;"><section></section></blockquote>`;
}

// ---------- Thumbnail previews ----------
// TikTok has a free, no-auth oEmbed endpoint that returns a real thumbnail image.
// Instagram's oEmbed now requires a Meta developer access token, so instead we
// read the post's own cover image out of r.jina.ai's text rendering of the public
// page (falls back to a gradient placeholder if that ever fails).
const thumbCache = new Map();

async function fetchTikTokThumbnail(url) {
  const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
  const data = await res.json();
  return data.thumbnail_url || null;
}

async function fetchInstagramThumbnail(url) {
  const res = await fetch(`https://r.jina.ai/${url}`);
  const text = await res.text();
  const match = text.match(/!\[Image \d+: (?:Video|Photo) by[^\]]*\]\((https:\/\/[^)]+)\)/);
  return match ? match[1] : null;
}

async function fetchThumbnail(entry) {
  if (thumbCache.has(entry.url)) return thumbCache.get(entry.url);
  let thumb = null;
  try {
    thumb = entry.platform === "tiktok" ? await fetchTikTokThumbnail(entry.url) : await fetchInstagramThumbnail(entry.url);
  } catch (e) {}
  thumbCache.set(entry.url, thumb);
  return thumb;
}

function buildThumbHtml(entry) {
  return `<div class="thumb-preview ${entry.platform}"><div class="play-overlay">▶</div></div>`;
}

function loadThumbnail(container, entry) {
  fetchThumbnail(entry).then((url) => {
    if (!url) return;
    const thumb = container.querySelector(".thumb-preview");
    if (thumb) thumb.style.backgroundImage = `url("${url}")`;
  });
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
  renderTagFilters();

  let filtered = activeCategory === "All" ? allEntries : allEntries.filter((e) => e.category === activeCategory);
  if (activeTag !== "All") filtered = filtered.filter((e) => (e.tags || []).includes(activeTag));

  cardGrid.innerHTML = "";
  emptyState.hidden = allEntries.length > 0;

  filtered.forEach((entry) => {
    const card = document.createElement("div");
    card.className = "card";
    const tags = entry.tags || [];
    card.innerHTML = `
      <div class="card-head">
        <span class="platform-badge ${entry.platform}">${entry.platform === "instagram" ? "Instagram" : "TikTok"}</span>
        <span class="card-category">${entry.category || ""}</span>
      </div>
      ${tags.length ? `<div class="card-tags">${tags.map((t) => `<span class="tag">#${t}</span>`).join("")}</div>` : ""}
      ${entry.note ? `<div class="card-note">${entry.note}</div>` : ""}
      <div class="edit-form" hidden>
        <input class="edit-category" type="text" placeholder="Category" list="categoryList">
        <input class="edit-tags" type="text" placeholder="Tags, comma separated" list="tagList">
        <div class="edit-actions">
          <button class="save-btn">Save</button>
          <button class="cancel-btn">Cancel</button>
        </div>
      </div>
      <div class="embed-wrap">${buildThumbHtml(entry)}</div>
      <div class="card-actions">
        <button class="hide-btn">▶ Play here</button>
        <button class="edit-btn" title="Edit category/tags">✏️</button>
        <button class="delete-btn" title="Delete">🗑</button>
      </div>
    `;

    const embedWrap = card.querySelector(".embed-wrap");
    const hideBtn = card.querySelector(".hide-btn");
    let expanded = false;
    const showEmbed = () => {
      embedWrap.innerHTML = buildEmbedHtml(entry);
      expanded = true;
      hideBtn.textContent = "◀ Back to preview";
      reprocessEmbeds();
    };
    const showThumb = () => {
      embedWrap.innerHTML = buildThumbHtml(entry);
      expanded = false;
      hideBtn.textContent = "▶ Play here";
      loadThumbnail(embedWrap, entry);
    };
    hideBtn.addEventListener("click", () => (expanded ? showThumb() : showEmbed()));
    embedWrap.addEventListener("click", () => {
      if (!expanded) showEmbed();
    });
    loadThumbnail(embedWrap, entry);

    const editForm = card.querySelector(".edit-form");
    const editCategoryInput = card.querySelector(".edit-category");
    const editTagsInput = card.querySelector(".edit-tags");
    card.querySelector(".edit-btn").addEventListener("click", () => {
      editCategoryInput.value = entry.category || "";
      editTagsInput.value = tags.join(", ");
      editForm.hidden = false;
    });
    card.querySelector(".cancel-btn").addEventListener("click", () => {
      editForm.hidden = true;
    });
    card.querySelector(".save-btn").addEventListener("click", () => {
      store.update(entry.id, {
        category: editCategoryInput.value.trim() || "Uncategorized",
        tags: parseTags(editTagsInput.value),
      });
      editForm.hidden = true;
    });

    card.querySelector(".delete-btn").addEventListener("click", () => {
      if (confirm("Delete this video from your library?")) store.remove(entry.id);
    });

    cardGrid.appendChild(card);
  });
}

store.subscribe((items) => {
  allEntries = items;
  render();
});

// ---------- Add form ----------
const urlInput = document.getElementById("urlInput");
const categoryInput = document.getElementById("categoryInput");
const tagsInput = document.getElementById("tagsInput");
const noteInput = document.getElementById("noteInput");
const addBtn = document.getElementById("addBtn");
const formError = document.getElementById("formError");

addBtn.addEventListener("click", () => {
  const url = urlInput.value.trim();
  const category = categoryInput.value.trim() || "Uncategorized";
  const tags = parseTags(tagsInput.value);
  const note = noteInput.value.trim();
  const platform = detectPlatform(url);

  if (!platform) {
    formError.textContent = "Please paste a valid Instagram or TikTok link.";
    formError.hidden = false;
    return;
  }
  formError.hidden = true;

  store.add({ url, category, tags, note, platform });
  urlInput.value = "";
  tagsInput.value = "";
  noteInput.value = "";
});

urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addBtn.click();
});
