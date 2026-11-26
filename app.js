(() => {
  "use strict";

  const storageKey = "jiudian-guan-favorites-v1";
  const showingCacheKey = "dyk-showing-cache-v2";
  const showingCooldownKey = "dyk-showing-cooldown-v2";
  const showingTtl = 4 * 60 * 60 * 1000;
  const showingCooldown = 3 * 60 * 60 * 1000;
  const detailCacheKey = "dyk-detail-cache-v2";
  const detailCache = new Map();
  const detailRequests = new Map();
  const posterQueue = [];
  let activePosterLoads = 0;
  const maxPosterLoads = 6;
  const posterObserver = "IntersectionObserver" in window
    ? new IntersectionObserver((entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          posterQueue.push(entry.target);
          observer.unobserve(entry.target);
        }
        loadNextPosters();
      }, { rootMargin: "200px 0px" })
    : null;
  try {
    const savedDetails = JSON.parse(localStorage.getItem(detailCacheKey) || "{}");
    for (const [id, detail] of Object.entries(savedDetails)) detailCache.set(id, detail);
  } catch {
    // 缓存不可用时继续实时读取。
  }
  const categoryOrder = [];
  const categoryNotes = {
    "动作": "追车、搏斗与正邪较量",
    "喜剧": "让生活笑出声",
    "剧情": "走进银幕里的真实人生",
    "动画": "开放创作，自由观看与下载",
    "爱情": "银幕里的相遇与错过",
    "科幻": "从现在走向想象的世界",
    "悬疑": "线索、反转与真相",
    "惊悚": "在紧张里屏住呼吸",
    "犯罪": "游走于规则与边缘",
    "冒险": "出发，去未知的地方"
  };
  const collectionOrder = ["showing", "classic", "free"];
  const collectionTitles = {
    showing: "正在热映",
    classic: "经典必看",
    free: "免费正片"
  };
  const collectionNotes = {
    showing: "新片评分与映后口碑，点开可继续看今日排片",
    classic: "豆瓣 Top250 · 按榜单顺序排列",
    free: "1905电影网与 Blender 的合法免费影片"
  };

  const freeMovies = (Array.isArray(window.MOVIES) ? window.MOVIES : []).map((movie) => ({
    ...movie,
    collection: movie.collection || "free"
  }));
  const classicMovies = Array.isArray(window.CLASSICS) ? window.CLASSICS : [];
  const showingFallback = Array.isArray(window.SHOWING) ? window.SHOWING : [];
  const showingPosters = new Map(showingFallback.map((movie) => [movie.id, movie.poster]).filter(([, poster]) => poster));
  let liveShowing = [];
  let showingStatus = "fallback";
  let showingRequest = null;
  let movies = [...freeMovies, ...classicMovies, ...showingFallback];

  const state = {
    filter: "all",
    query: "",
    favorites: loadFavorites()
  };

  const elements = {
    shelves: document.getElementById("shelves"),
    search: document.getElementById("search-input"),
    clearSearch: document.getElementById("clear-search"),
    filters: document.getElementById("filters"),
    summary: document.getElementById("result-summary"),
    reset: document.getElementById("reset-filters"),
    empty: document.getElementById("empty-state"),
    emptyMessage: document.getElementById("empty-message"),
    emptyReset: document.getElementById("empty-reset"),
    toast: document.getElementById("toast"),
    totalClassic: document.getElementById("total-classic"),
    totalFree: document.getElementById("total-free"),
    totalShowing: document.getElementById("total-showing"),
    doorClassic: document.getElementById("door-classic"),
    doorShowing: document.getElementById("door-showing"),
    dialog: document.getElementById("poster-dialog"),
    dialogClose: document.getElementById("dialog-close"),
    dialogImage: document.getElementById("dialog-image"),
    dialogTypographic: document.getElementById("dialog-typographic"),
    dialogSource: document.getElementById("dialog-source"),
    dialogRating: document.getElementById("dialog-rating"),
    dialogRatingValue: document.getElementById("dialog-rating-value"),
    dialogTitle: document.getElementById("dialog-title"),
    dialogMeta: document.getElementById("dialog-meta"),
    dialogTags: document.getElementById("dialog-tags"),
    dialogDirector: document.getElementById("dialog-director"),
    dialogActors: document.getElementById("dialog-actors"),
    dialogSynopsis: document.getElementById("dialog-synopsis"),
    dialogWatch: document.getElementById("dialog-watch"),
    dialogWatchLabel: document.getElementById("dialog-watch-label"),
    dialogSecondary: document.getElementById("dialog-secondary"),
    dialogFavorite: document.getElementById("dialog-favorite")
  };

  let toastTimer;
  let resizeTimer;
  let activeMovieId = null;
  let dialogPosterRequest = 0;
  let lastDialogTrigger = null;
  let lastColumns = columnCount();

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    })[character]);
  }

  function normalize(value) {
    return String(value ?? "").toLocaleLowerCase().replace(/\s+/g, "");
  }

  function movieYear(movie) {
    const match = String(movie.meta || "").match(/\b(?:19|20)\d{2}\b/);
    return match ? Number(match[0]) : null;
  }

  function movieEra(movie) {
    const year = Number(movie.year || movieYear(movie));
    return Number.isFinite(year) && year < 2010 ? "classic" : "recent";
  }

  function columnCount() {
    if (window.innerWidth < 520) return 2;
    if (window.innerWidth < 820) return 3;
    if (window.innerWidth < 1120) return 4;
    if (window.innerWidth < 1360) return 5;
    return 6;
  }

  function loadFavorites() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
      const validIds = new Set(movies.map((movie) => movie.id));
      return new Set(Array.isArray(saved) ? saved.filter((id) => validIds.has(id)) : []);
    } catch {
      return new Set();
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...state.favorites]));
    } catch {
      showToast("浏览器未允许保存，本次想看标记只在当前页面有效");
    }
  }

  function matchesMovie(movie) {
    if (state.filter === "favorites" && !state.favorites.has(movie.id)) return false;
    if (state.filter.startsWith("collection:") && movie.collection !== state.filter.slice(11)) return false;
    if (state.filter === "era:classic" && movieEra(movie) !== "classic") return false;
    if (state.filter === "era:recent" && movieEra(movie) !== "recent") return false;
    if (state.filter.startsWith("category:") && movie.category !== state.filter.slice(9)) return false;
    if (!state.query) return true;

    const haystack = normalize([
      movie.title,
      movie.originalTitle,
      movie.synopsis,
      movie.source,
      movie.meta,
      movie.category,
      movie.director,
      ...(movie.actors || []),
      ...(movie.tags || []),
      ...(movie.keywords || [])
    ].join(" "));
    return haystack.includes(normalize(state.query));
  }

  function buildGroups(items) {
    if (state.filter === "favorites") {
      return [{
        key: "favorites",
        title: "我的想看",
        note: `${items.length} 部 · 只保存在这台设备的浏览器里`,
        items
      }];
    }

    if (state.filter.startsWith("collection:")) {
      const collection = state.filter.slice(11);
      return [{
        key: state.filter,
        title: collectionTitles[collection] || "影片",
        note: collectionNotes[collection] || `${items.length} 部`,
        items
      }];
    }

    if (state.filter.startsWith("category:")) {
      const category = state.filter.slice(9);
      return [{
        key: state.filter,
        title: category,
        note: categoryNotes[category] || `${items.length} 部`,
        items
      }];
    }

    if (state.filter.startsWith("era:")) {
      const classic = state.filter === "era:classic";
      return [{
        key: state.filter,
        title: classic ? "经典碟架" : "近作碟架",
        note: classic ? "2010 年以前的影片" : "2010 年及以后的影片",
        items
      }];
    }

    if (state.query) {
      return [{
        key: "search",
        title: "搜索结果",
        note: `与“${state.query}”相关`,
        items
      }];
    }

    return collectionOrder.map((collection) => ({
      key: collection,
      title: collectionTitles[collection],
      note: collectionNotes[collection],
      items: items.filter((movie) => movie.collection === collection)
    })).filter((group) => group.items.length);
  }

  function chunk(items, size) {
    const rows = [];
    for (let index = 0; index < items.length; index += size) {
      rows.push(items.slice(index, index + size));
    }
    return rows;
  }

  function coverPalette(movie) {
    const palettes = [
      ["#59362c", "#c78458"],
      ["#253e4a", "#7fb0b5"],
      ["#44364f", "#b38bc0"],
      ["#3f472b", "#a9b779"],
      ["#4d342b", "#d5a06a"],
      ["#29374e", "#829dcc"]
    ];
    let hash = 0;
    for (const character of `${movie.id}${movie.title}`) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
    return palettes[hash % palettes.length];
  }

  function typographicCover(movie) {
    const [dark, light] = coverPalette(movie);
    const rankLabel = movie.collection === "classic" && movie.rank ? `NO.${String(movie.rank).padStart(3, "0")}` : "";
    const rating = Number(movie.rating);
    const ratingLabel = Number.isFinite(rating) && rating > 0 ? rating.toFixed(1) : "暂无评分";
    return `
      <span class="typographic-cover" style="--cover-dark:${dark};--cover-light:${light}">
        <span class="type-cover-art" aria-hidden="true"></span>
        ${rankLabel ? `<span class="type-rank">${escapeHtml(rankLabel)}</span>` : ""}
        <span class="type-title">${escapeHtml(movie.title)}</span>
        <span class="type-original">${escapeHtml(movie.originalTitle || "")}</span>
        <span class="type-rating"><b>${escapeHtml(ratingLabel)}</b><small>豆瓣评分</small></span>
      </span>`;
  }

  function thumbnailFor(poster) {
    if (!poster) return "";
    const filename = poster.split("/").pop().replace(/\.[^.]+$/, "");
    return `assets/posters/thumbs/${filename}.webp`;
  }

  function loadNextPosters() {
    while (activePosterLoads < maxPosterLoads && posterQueue.length) {
      const image = posterQueue.shift();
      if (!image.isConnected || !image.dataset.src) continue;
      const source = image.dataset.src;
      image.removeAttribute("data-src");
      activePosterLoads++;
      image.addEventListener("load", () => {
        activePosterLoads--;
        loadNextPosters();
      }, { once: true });
      image.addEventListener("error", () => {
        activePosterLoads--;
        loadNextPosters();
      }, { once: true });
      image.src = source;
    }
  }

  function observePosterImages() {
    document.querySelectorAll(".case-cover img[data-src]").forEach((image) => {
      if (posterObserver) posterObserver.observe(image);
      else {
        image.src = image.dataset.src;
        image.removeAttribute("data-src");
      }
    });
  }

  function renderMovie(movie, index) {
    const isFavorite = state.favorites.has(movie.id);
    const title = escapeHtml(movie.title);
    const year = movieYear(movie);
    const tilt = (((index + movie.title.length) % 5) - 2) * 0.28;
    const hasPoster = Boolean(movie.poster);

    return `
      <article class="movie-card${hasPoster ? "" : " is-typographic"}" data-id="${escapeHtml(movie.id)}" style="--tilt:${tilt.toFixed(2)}deg">
        <button class="case-cover" type="button" data-open-id="${escapeHtml(movie.id)}"
          aria-label="查看《${title}》的大图与剧情简介">
          <span class="case-spine"><b>${escapeHtml(movie.source)}</b> · ${escapeHtml(movie.category)}${year ? ` · ${year}` : ""}</span>
          ${hasPoster
            ? `<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" data-src="${escapeHtml(thumbnailFor(movie.poster))}" alt="《${title}》封面" decoding="async">`
            : typographicCover(movie)}
          <span class="source-badge">${escapeHtml(movie.collection === "classic" ? "豆瓣 Top250" : movie.collection === "showing" ? "豆瓣热映" : movie.source)}</span>
          ${movie.featured && movie.collection === "free" ? '<span class="hot-badge">热门</span>' : ""}
          <span class="case-caption">
            <h3>${title}</h3>
            <p>${escapeHtml(movie.meta)}</p>
          </span>
        </button>
        <button class="favorite-button${isFavorite ? " is-favorite" : ""}" type="button"
          data-favorite-id="${escapeHtml(movie.id)}"
          aria-label="${isFavorite ? "移出" : "加入"}想看：${title}" aria-pressed="${isFavorite}">
          <svg class="icon" aria-hidden="true"><use href="#icon-heart"></use></svg>
        </button>
      </article>`;
  }

  function renderRows(items, columns, groupIndex) {
    return chunk(items, columns).map((row, rowIndex) => `
      <div class="shelf-row">
        <div class="poster-grid" style="--cols:${columns}">
          ${row.map((movie, index) => renderMovie(movie, rowIndex * columns + index)).join("")}
        </div>
        <div class="shelf-plank" aria-hidden="true" data-label="${String(groupIndex + 1).padStart(2, "0")}.${String(rowIndex + 1).padStart(2, "0")}"></div>
      </div>`).join("");
  }

  function renderFilters() {
    const filters = [
      { id: "all", label: "全部" },
      { id: "collection:showing", label: "正在热映" },
      { id: "collection:classic", label: "经典必看" },
      { id: "collection:free", label: "免费正片" },
      ...categoryOrder.map((category) => ({ id: `category:${category}`, label: category })),
      { id: "favorites", label: "想看" }
    ];

    elements.filters.innerHTML = filters.map(({ id, label }) => `
      <button class="filter-chip${id === state.filter ? " is-active" : ""}" type="button"
        data-filter="${escapeHtml(id)}" aria-pressed="${id === state.filter}">
        ${escapeHtml(label)}<span data-count="${escapeHtml(id)}"></span>
      </button>`).join("");
  }

  function updateHero() {
    const highlighted = [
      ...freeMovies.filter((movie) => movie.featured),
      ...freeMovies.filter((movie) => !movie.featured)
    ].slice(0, 3);

    document.querySelectorAll(".hero-case img").forEach((image, index) => {
      const movie = highlighted[index];
      if (movie) image.src = movie.poster;
    });
  }

  function updateCounts() {
    const counts = {
      all: movies.length,
      "collection:showing": movies.filter((movie) => movie.collection === "showing").length,
      "collection:classic": movies.filter((movie) => movie.collection === "classic").length,
      "collection:free": movies.filter((movie) => movie.collection === "free").length,
      favorites: state.favorites.size
    };

    for (const [id, count] of Object.entries(counts)) {
      const counter = document.querySelector(`[data-count="${id}"]`);
      if (counter) counter.textContent = count;
    }
    for (const category of categoryOrder) {
      const counter = document.querySelector(`[data-count="category:${category}"]`);
      if (counter) counter.textContent = movies.filter((movie) => movie.category === category).length;
    }

    elements.totalClassic.textContent = counts["collection:classic"];
    elements.totalFree.textContent = counts["collection:free"];
    elements.totalShowing.textContent = counts["collection:showing"];
    elements.doorClassic.textContent = `${counts["collection:classic"]} 部`;
    elements.doorShowing.textContent = `${counts["collection:showing"]} 部`;
  }

  function updateSummary(total) {
    const hasSearch = Boolean(state.query);
    const hasFilter = state.filter !== "all";

    if (!total) {
      elements.summary.textContent = state.filter === "favorites" && !hasSearch
        ? "还没有想看的影片"
        : "没有找到符合条件的影片";
    } else if (hasSearch) {
      elements.summary.textContent = `找到 ${total} 部与“${state.query}”相关的影片`;
    } else if (state.filter === "favorites") {
      elements.summary.textContent = `我的想看 · ${total} 部 · 点击封面看大图`;
    } else if (state.filter.startsWith("collection:")) {
      const collection = state.filter.slice(11);
      elements.summary.textContent = `${collectionTitles[collection] || "影片"} · ${total} 部 · 点击封面看大图`;
    } else if (state.filter.startsWith("category:")) {
      elements.summary.textContent = `${state.filter.slice(9)} · ${total} 部 · 点击封面看大图`;
    } else {
      elements.summary.textContent = `共 ${total} 部影片 · 点击封面看大图与简介`;
    }

    elements.reset.hidden = !hasSearch && !hasFilter;
  }

  function render() {
    const filtered = movies.filter(matchesMovie);
    const groups = buildGroups(filtered);
    const columns = columnCount();
    lastColumns = columns;

    updateCounts();
    updateSummary(filtered.length);
    elements.clearSearch.hidden = !state.query;
    elements.empty.hidden = filtered.length > 0;
    elements.shelves.hidden = filtered.length === 0;

    if (!filtered.length) {
      elements.emptyMessage.textContent = state.filter === "favorites" && !state.query
        ? "看到喜欢的电影后，点封面右上角的爱心，它就会出现在这里。"
        : "换个片名、简介关键词或分类试试。";
      elements.shelves.innerHTML = "";
      return;
    }

    elements.shelves.innerHTML = groups.map((group, groupIndex) => `
      <section class="collection" aria-labelledby="collection-${escapeHtml(group.key)}">
        <div class="collection-header">
          <div class="collection-title-wrap">
            <h2 id="collection-${escapeHtml(group.key)}">${escapeHtml(group.title)}</h2>
            <p>${escapeHtml(group.note)}</p>
          </div>
          <div class="collection-line"></div>
        </div>
        ${renderRows(group.items, columns, groupIndex)}
      </section>`).join("");
    observePosterImages();
  }

  function doubanIdFor(movie) {
    return String(movie.id).match(/(\d+)$/)?.[1] || "";
  }

  function namesFrom(value) {
    return (Array.isArray(value) ? value : [])
      .map((item) => typeof item === "string" ? item : item?.name)
      .map(clean)
      .filter(Boolean);
  }

  function renderCredits(movie) {
    const actors = Array.isArray(movie.actors) ? movie.actors : [];
    elements.dialogDirector.textContent = movie.director ? `导演：${movie.director}` : "";
    elements.dialogDirector.hidden = !movie.director;
    elements.dialogActors.textContent = actors.length
      ? `主演：${actors.slice(0, 10).join("、")}${actors.length > 10 ? "等" : ""}`
      : "";
    elements.dialogActors.hidden = actors.length === 0;
  }

  function applyMovieDetail(movie, detail) {
    if (detail.synopsis) movie.synopsis = detail.synopsis;
    if (detail.director) movie.director = detail.director;
    if (detail.actors?.length) movie.actors = detail.actors;
    if (Number.isFinite(Number(detail.rating)) && Number(detail.rating) > 0) movie.rating = Number(detail.rating);
  }

  function saveDetailCache() {
    try {
      const entries = [...detailCache.entries()].slice(-300);
      localStorage.setItem(detailCacheKey, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      // 缓存满时保留本次内存结果。
    }
  }

  function loadMovieDetails(movie) {
    const subjectId = doubanIdFor(movie);
    if (!subjectId) return;

    const cached = detailCache.get(subjectId);
    if (cached) {
      applyMovieDetail(movie, cached);
      if (activeMovieId === movie.id) {
        elements.dialogSynopsis.textContent = movie.synopsis || "";
        renderCredits(movie);
        renderDialogRating(movie);
      }
      return;
    }
    if (detailRequests.has(subjectId)) return;

    const callbackName = `__dykDetail_${subjectId}_${Date.now()}`;
    const script = document.createElement("script");
    let settled = false;
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      script.remove();
      delete window[callbackName];
      detailRequests.delete(subjectId);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
    };

    window[callbackName] = (payload) => {
      if (settled) return;
      settled = true;
      cleanup();
      const detail = {
        synopsis: clean(payload?.intro),
        director: namesFrom(payload?.directors).join(" / "),
        actors: namesFrom(payload?.actors).slice(0, 10),
        rating: Number(payload?.rating?.value)
      };
      if (!detail.synopsis && !detail.director && !detail.actors.length) return;
      detailCache.set(subjectId, detail);
      saveDetailCache();
      applyMovieDetail(movie, detail);
      if (activeMovieId === movie.id) {
        elements.dialogSynopsis.textContent = movie.synopsis || "";
        renderCredits(movie);
        renderDialogRating(movie);
      }
    };
    timer = setTimeout(fail, 7000);
    script.onerror = fail;
    script.src = `https://m.douban.com/rexxar/api/v2/subject/${subjectId}?callback=${callbackName}&referer=${encodeURIComponent(`https://m.douban.com/movie/subject/${subjectId}/`)}`;
    detailRequests.set(subjectId, true);
    document.head.appendChild(script);
  }

  function renderDialogRating(movie) {
    const rating = Number(movie.rating);
    const hasRating = Number.isFinite(rating) && rating > 0;
    elements.dialogRating.hidden = !hasRating;
    elements.dialogRatingValue.textContent = hasRating ? rating.toFixed(1) : "";
  }

  function updateDialogPoster(movie) {
    const request = ++dialogPosterRequest;
    const hasPoster = Boolean(movie.poster);
    elements.dialogImage.hidden = !hasPoster;
    elements.dialogTypographic.hidden = hasPoster;
    elements.dialogImage.alt = hasPoster ? `《${movie.title}》大图海报` : "";
    elements.dialogTypographic.innerHTML = hasPoster ? "" : typographicCover(movie);
    if (!hasPoster) {
      elements.dialogImage.removeAttribute("src");
      return;
    }

    elements.dialogImage.removeAttribute("src");
    elements.dialogImage.src = thumbnailFor(movie.poster);
    const full = new Image();
    full.onload = async () => {
      try {
        await full.decode();
      } catch {}
      if (request !== dialogPosterRequest) return;
      elements.dialogImage.src = full.src;
    };
    full.src = movie.poster;
  }

  function openMovie(id, trigger) {
    const movie = movies.find((item) => item.id === id);
    if (!movie) return;

    activeMovieId = id;
    lastDialogTrigger = trigger || document.activeElement;

    updateDialogPoster(movie);
    elements.dialogSource.textContent = movie.source;
    elements.dialogTitle.textContent = movie.title;
    elements.dialogMeta.textContent = movie.meta;
    renderDialogRating(movie);
    elements.dialogSynopsis.textContent = movie.synopsis;
    elements.dialogWatch.href = movie.watchUrl;
    elements.dialogWatch.setAttribute("aria-label", `前往${movie.source}${movie.watchLabel || "在线观看"}《${movie.title}》（新窗口打开）`);
    elements.dialogWatchLabel.textContent = movie.watchLabel || "在线观看";

    if (movie.secondaryUrl) {
      elements.dialogSecondary.hidden = false;
      elements.dialogSecondary.href = movie.secondaryUrl;
      elements.dialogSecondary.textContent = movie.secondaryLabel || "查看详情";
    } else {
      elements.dialogSecondary.hidden = true;
      elements.dialogSecondary.removeAttribute("href");
      elements.dialogSecondary.textContent = "";
    }

    elements.dialogTags.innerHTML = (movie.tags || []).map((tag) => `<span class="dialog-tag">${escapeHtml(tag)}</span>`).join("");
    renderCredits(movie);
    loadMovieDetails(movie);
    updateDialogFavorite();

    if (!elements.dialog.open) elements.dialog.showModal();
    document.body.classList.add("modal-open");
  }

  function closeDialog() {
    if (elements.dialog.open) elements.dialog.close();
  }

  function updateDialogFavorite() {
    const movie = movies.find((item) => item.id === activeMovieId);
    if (!movie) return;

    const favorite = state.favorites.has(movie.id);
    elements.dialogFavorite.classList.toggle("is-favorite", favorite);
    elements.dialogFavorite.setAttribute("aria-pressed", String(favorite));
    elements.dialogFavorite.querySelector("span").textContent = favorite ? "已加入想看" : "加入想看";
  }

  function updateCardFavorite(card, id, movie) {
    const favorite = state.favorites.has(id);
    const button = card.querySelector(".favorite-button");
    if (!button) return;
    button.classList.toggle("is-favorite", favorite);
    button.setAttribute("aria-pressed", String(favorite));
    button.setAttribute("aria-label", `${favorite ? "移出" : "加入"}想看：${movie.title}`);
  }

  function toggleFavorite(card, id) {
    const movie = movies.find((item) => item.id === id);
    if (!movie) return;

    if (state.favorites.has(id)) {
      state.favorites.delete(id);
      showToast(`已移出想看 · ${movie.title}`);
    } else {
      state.favorites.add(id);
      showToast(`已加入想看 · ${movie.title}`);
    }

    saveFavorites();
    updateCounts();
    updateDialogFavorite();

    if (state.filter === "favorites") {
      render();
    } else if (card) {
      updateCardFavorite(card, id, movie);
    }
  }

  function setFilter(filter) {
    state.filter = filter;
    for (const button of elements.filters.querySelectorAll(".filter-chip")) {
      const active = button.dataset.filter === filter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    render();
  }

  function resetAll() {
    state.filter = "all";
    state.query = "";
    elements.search.value = "";
    setFilter("all");
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2200);
  }

  function categoryOf(genres) {
    const preferred = ["动画", "喜剧", "动作", "爱情", "科幻", "悬疑", "惊悚", "犯罪", "冒险", "剧情"];
    for (const item of preferred) {
      if (genres.includes(item)) return item;
    }
    return genres[0] || "剧情";
  }

  function mapShowingItem(item, index) {
    const subjectId = String(item.id || "");
    const subtitle = clean(item.card_subtitle || item.info || "");
    const parts = subtitle.split("/").map(clean).filter(Boolean);
    const year = /^\d{4}$/.test(String(item.year || "")) ? Number(item.year) : null;
    const country = parts[1] || "";
    const genres = (parts[2] || "").split(/\s+/).map(clean).filter(Boolean);
    const director = clean((item.directors || [""])[0]);
    const actors = (item.actors || []).slice(0, 5).map(clean).filter(Boolean);
    const rating = item.rating || {};
    const title = clean(item.title);
    const originalTitle = clean(item.original_title);

    return {
      id: `showing-douban-${subjectId}`,
      title,
      originalTitle,
      category: categoryOf(genres),
      tags: genres,
      meta: [year || clean(item.release_date), country, genres.join(" ")].filter(Boolean).join(" / "),
      synopsis: "正在豆瓣热映榜，点击“今日热映与排片”查看票房、口碑、影院和座位。",
      source: "豆瓣热映",
      poster: showingPosters.get(`showing-douban-${subjectId}`) || "",
      watchUrl: "today/",
      secondaryUrl: item.url || `https://m.douban.com/movie/subject/${subjectId}/`,
      secondaryLabel: "豆瓣详情",
      watchLabel: "今日热映与排片",
      keywords: [title, originalTitle, director, ...actors, ...genres, "豆瓣热映", "正在上映"],
      featured: true,
      collection: "showing",
      rating: Number.isFinite(Number(rating.value)) ? Number(rating.value) : null,
      ratingCount: Number(rating.count) || 0,
      rank: index + 1,
      year,
      director,
      actors,
      country
    };
  }

  function updateCategories() {
    categoryOrder.splice(0, categoryOrder.length, ...new Set(movies.map((movie) => movie.category).filter(Boolean)));
  }

  function applyShowing(items, status) {
    liveShowing = items;
    showingStatus = status;
    movies = [...freeMovies, ...classicMovies, ...liveShowing];
    updateCategories();
    renderFilters();
    updateHero();
    render();
    window.__DYK_SHOWING_STATUS__ = { status, count: liveShowing.length };
  }

  function readShowingCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(showingCacheKey) || "null");
      if (!cached || !Array.isArray(cached.items) || !cached.items.length) return null;
      if (Date.now() - Number(cached.savedAt || 0) > showingTtl) return null;
      return cached;
    } catch {
      return null;
    }
  }

  function isCoolingDown() {
    try {
      return Date.now() - Number(localStorage.getItem(showingCooldownKey) || 0) < showingCooldown;
    } catch {
      return false;
    }
  }

  function startCooldown() {
    try {
      localStorage.setItem(showingCooldownKey, String(Date.now()));
    } catch {
      // 私密模式下保留静态兜底即可。
    }
  }

  function requestLiveShowing() {
    if (showingRequest) return showingRequest;
    showingRequest = new Promise((resolve) => {
      const callbackName = `__dykShowing_${Date.now()}`;
      const script = document.createElement("script");
      let settled = false;

      const finish = (items, status) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.remove();
        delete window[callbackName];
        if (items.length) {
          applyShowing(items, status);
        } else {
          showingStatus = status;
          window.__DYK_SHOWING_STATUS__ = { status, count: movies.filter((movie) => movie.collection === "showing").length };
        }
        resolve();
      };

      const timer = setTimeout(() => finish([], "timeout"), 8000);
      window[callbackName] = (payload) => {
        const items = Array.isArray(payload?.subject_collection_items) ? payload.subject_collection_items : [];
        const mapped = items.slice(0, 30).filter((item) => item.id).map(mapShowingItem);
        if (!mapped.length) {
          startCooldown();
          finish([], "empty");
          return;
        }
        const liveMap = new Map(mapped.map((movie) => [movie.id, movie]));
        const merged = showingFallback.map((movie) => {
          const update = liveMap.get(movie.id);
          return update ? { ...movie, ...update, poster: movie.poster } : movie;
        });
        try {
          localStorage.setItem(showingCacheKey, JSON.stringify({ savedAt: Date.now(), items: merged }));
        } catch {
          // 缓存失败不影响本次展示。
        }
        finish(merged, "live");
      };
      script.src = `https://m.douban.com/rexxar/api/v2/subject_collection/movie_showing/items?count=30&for_mobile=1&callback=${callbackName}&referer=${encodeURIComponent("https://m.douban.com/")}`;
      script.onerror = () => {
        startCooldown();
        finish([], "blocked");
      };
      document.head.appendChild(script);
    }).finally(() => {
      showingRequest = null;
    });
    return showingRequest;
  }

  function initializeShowing() {
    const cached = readShowingCache();
    if (cached) {
      applyShowing(cached.items.map((item, index) => ({ ...item, rank: item.rank || index + 1 })), "cache");
    }
    if (!cached && !isCoolingDown()) {
      setTimeout(() => requestLiveShowing(), 1200);
    }
    window.__DYK_SHOWING_STATUS__ = { status: showingStatus, count: liveShowing.length };
  }

  elements.search.addEventListener("input", () => {
    state.query = elements.search.value.trim();
    render();
  });

  elements.clearSearch.addEventListener("click", () => {
    elements.search.value = "";
    state.query = "";
    render();
    elements.search.focus();
  });

  elements.filters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (button) setFilter(button.dataset.filter);
  });

  document.querySelectorAll("[data-jump-filter]").forEach((link) => {
    link.addEventListener("click", () => {
      state.query = "";
      elements.search.value = "";
      setFilter(link.dataset.jumpFilter);
    });
  });

  elements.shelves.addEventListener("click", (event) => {
    const favoriteButton = event.target.closest("[data-favorite-id]");
    if (favoriteButton) {
      const card = favoriteButton.closest(".movie-card");
      toggleFavorite(card, card.dataset.id);
      return;
    }

    const openButton = event.target.closest("[data-open-id]");
    if (openButton) openMovie(openButton.dataset.openId, openButton);
  });

  elements.dialogClose.addEventListener("click", closeDialog);
  elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog) closeDialog();
  });
  elements.dialog.addEventListener("close", () => {
    document.body.classList.remove("modal-open");
    activeMovieId = null;
    if (lastDialogTrigger && document.contains(lastDialogTrigger)) {
      lastDialogTrigger.focus({ preventScroll: true });
    }
  });
  elements.dialog.addEventListener("cancel", () => {
    document.body.classList.remove("modal-open");
  });
  elements.dialogFavorite.addEventListener("click", () => {
    const card = elements.shelves.querySelector(`[data-id="${CSS.escape(activeMovieId || "")}"]`);
    toggleFavorite(card, activeMovieId);
  });

  elements.reset.addEventListener("click", resetAll);
  elements.emptyReset.addEventListener("click", resetAll);

  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (columnCount() !== lastColumns) render();
    }, 140);
  });

  updateCategories();
  renderFilters();
  updateHero();
  render();
  initializeShowing();
})();
