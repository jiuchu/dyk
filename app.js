(() => {
  "use strict";

  const movies = Array.isArray(window.MOVIES) ? window.MOVIES : [];
  const storageKey = "jiudian-guan-favorites-v1";
  const categoryOrder = [...new Set(movies.map((movie) => movie.category))];
  const categoryNotes = {
    "动作": "追车、搏斗与正邪较量",
    "喜剧": "让生活笑出声",
    "剧情": "走进银幕里的真实人生",
    "动画": "开放创作，自由观看与下载"
  };

  const state = {
    filter: "all",
    query: "",
    favorites: loadFavorites(),
    flipped: new Set()
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
    toast: document.getElementById("toast")
  };

  let toastTimer;
  let resizeTimer;
  let lastColumns = columnCount();

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

  function columnCount() {
    if (window.innerWidth < 520) return 2;
    if (window.innerWidth < 820) return 3;
    if (window.innerWidth < 1120) return 4;
    if (window.innerWidth < 1360) return 5;
    return 6;
  }

  function matchesMovie(movie) {
    if (state.filter === "favorites" && !state.favorites.has(movie.id)) return false;
    if (state.filter.startsWith("category:") && movie.category !== state.filter.slice(9)) return false;
    if (!state.query) return true;

    const haystack = normalize([
      movie.title,
      movie.synopsis,
      movie.source,
      movie.meta,
      movie.category,
      ...(movie.tags || []),
      ...(movie.keywords || [])
    ].join(" "));
    return haystack.includes(normalize(state.query));
  }

  function buildGroups(items) {
    if (state.filter === "favorites") {
      return [{
        title: "我的想看",
        note: `${items.length} 部 · 只保存在这台设备的浏览器里`,
        items
      }];
    }

    if (state.filter.startsWith("category:")) {
      const category = state.filter.slice(9);
      return [{
        title: category,
        note: categoryNotes[category] || `${items.length} 部`,
        items
      }];
    }

    if (state.query) {
      return [{
        title: "搜索结果",
        note: `与“${state.query}”相关`,
        items
      }];
    }

    return categoryOrder
      .map((category) => ({
        title: category,
        note: categoryNotes[category],
        items: items.filter((movie) => movie.category === category)
      }))
      .filter((group) => group.items.length);
  }

  function chunk(items, size) {
    const rows = [];
    for (let index = 0; index < items.length; index += size) {
      rows.push(items.slice(index, index + size));
    }
    return rows;
  }

  function renderMovie(movie) {
    const isFavorite = state.favorites.has(movie.id);
    const isFlipped = state.flipped.has(movie.id);
    const title = escapeHtml(movie.title);
    const tags = (movie.tags || []).map((tag) => `<span class="card-tag">${escapeHtml(tag)}</span>`).join("");
    const watchUrl = escapeHtml(movie.watchUrl);
    const watchLabel = escapeHtml(movie.watchLabel || "在线观看");

    return `
      <article class="movie-card${isFlipped ? " is-flipped" : ""}" data-id="${escapeHtml(movie.id)}">
        <div class="card-inner">
          <div class="card-face card-front"${isFlipped ? " inert aria-hidden=\"true\"" : ""}>
            <img src="${escapeHtml(movie.poster)}" alt="《${title}》封面" loading="lazy" decoding="async">
            <span class="source-badge">${escapeHtml(movie.source)}</span>
            ${movie.featured ? '<span class="hot-badge">热门</span>' : ""}
            <button class="favorite-button${isFavorite ? " is-favorite" : ""}" type="button"
              aria-label="${isFavorite ? "移出" : "加入"}想看：${title}" aria-pressed="${isFavorite}">
              <svg class="icon" aria-hidden="true"><use href="#icon-heart"></use></svg>
            </button>
            <button class="flip-trigger" type="button" aria-label="查看《${title}》的剧情简介" aria-expanded="${isFlipped}"></button>
            <div class="card-caption">
              <h3>${title}</h3>
              <p>${escapeHtml(movie.meta)}</p>
            </div>
            <span class="flip-hint"><svg class="icon" aria-hidden="true"><use href="#icon-flip"></use></svg>翻面</span>
          </div>
          <div class="card-face card-back"${isFlipped ? "" : " inert aria-hidden=\"true\""}>
            <span class="back-source">${escapeHtml(movie.source)}</span>
            <h3>${title}</h3>
            <p class="synopsis">${escapeHtml(movie.synopsis)}</p>
            <div class="card-tags">${tags}</div>
            <div class="card-actions">
              <a class="watch-button" href="${watchUrl}" target="_blank" rel="noopener noreferrer"
                aria-label="前往${escapeHtml(movie.source)}${watchLabel}《${title}》（新窗口打开）">
                <svg class="icon" aria-hidden="true"><use href="#icon-play"></use></svg>${watchLabel}
              </a>
              <button class="back-return" type="button" aria-label="返回《${title}》封面">
                <svg class="icon" aria-hidden="true"><use href="#icon-flip"></use></svg>返回封面
              </button>
            </div>
          </div>
        </div>
      </article>`;
  }

  function renderRows(items, columns) {
    return chunk(items, columns).map((row) => `
      <div class="shelf-row">
        <div class="poster-grid" style="--cols:${columns}">
          ${row.map(renderMovie).join("")}
        </div>
        <div class="shelf-plank" aria-hidden="true"></div>
      </div>`).join("");
  }

  function renderFilters() {
    const filters = [
      { id: "all", label: "全部" },
      ...categoryOrder.map((category) => ({ id: `category:${category}`, label: category })),
      { id: "favorites", label: "想看" }
    ];

    elements.filters.innerHTML = filters.map(({ id, label }, index) => `
      <button class="filter-chip${index === 0 ? " is-active" : ""}" type="button"
        data-filter="${escapeHtml(id)}" aria-pressed="${index === 0}">
        ${escapeHtml(label)}<span data-count="${escapeHtml(id)}"></span>
      </button>`).join("");
  }

  function updateHero() {
    const highlighted = [
      ...movies.filter((movie) => movie.featured),
      ...movies.filter((movie) => !movie.featured)
    ].slice(0, 3);

    document.querySelectorAll(".hero-poster img").forEach((image, index) => {
      const movie = highlighted[index];
      if (movie) image.src = movie.poster;
    });
  }

  function updateCounts() {
    document.querySelector("[data-count=\"all\"]").textContent = movies.length;
    for (const category of categoryOrder) {
      const counter = document.querySelector(`[data-count="category:${category}"]`);
      if (counter) counter.textContent = movies.filter((movie) => movie.category === category).length;
    }
    document.querySelector("[data-count=\"favorites\"]").textContent = state.favorites.size;
  }

  function updateSummary(total) {
    const hasSearch = Boolean(state.query);
    const hasFilter = state.filter !== "all";

    if (!total) {
      elements.summary.textContent = state.filter === "favorites" && !hasSearch
        ? "还没有想看的影片"
        : "没有找到符合条件的影片";
      return;
    }

    if (hasSearch) {
      elements.summary.textContent = `找到 ${total} 部与“${state.query}”相关的影片`;
    } else if (state.filter === "favorites") {
      elements.summary.textContent = `我的想看 · ${total} 部 · 点击海报翻面`;
    } else if (state.filter.startsWith("category:")) {
      elements.summary.textContent = `${state.filter.slice(9)} · ${total} 部 · 点击海报翻面`;
    } else {
      elements.summary.textContent = `共 ${total} 部影片 · 点击海报翻面看简介`;
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

    elements.shelves.innerHTML = groups.map((group) => `
      <section class="collection" aria-labelledby="collection-${escapeHtml(group.title)}">
        <div class="collection-header">
          <div class="collection-title-wrap">
            <h2 id="collection-${escapeHtml(group.title)}">${escapeHtml(group.title)}</h2>
            <p>${escapeHtml(group.note)}</p>
          </div>
          <div class="collection-line"></div>
        </div>
        ${renderRows(group.items, columns)}
      </section>`).join("");
  }

  function setFlipped(card, flipped) {
    const id = card.dataset.id;
    const front = card.querySelector(".card-front");
    const back = card.querySelector(".card-back");
    const trigger = card.querySelector(".flip-trigger");

    card.classList.toggle("is-flipped", flipped);
    trigger.setAttribute("aria-expanded", String(flipped));
    front.toggleAttribute("inert", flipped);
    back.toggleAttribute("inert", !flipped);
    front.setAttribute("aria-hidden", String(flipped));
    back.setAttribute("aria-hidden", String(!flipped));

    if (flipped) state.flipped.add(id);
    else state.flipped.delete(id);

    if (flipped) back.querySelector(".back-return").focus({ preventScroll: true });
    else trigger.focus({ preventScroll: true });
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

    if (state.filter === "favorites") {
      render();
    } else {
      const button = card.querySelector(".favorite-button");
      const favorite = state.favorites.has(id);
      button.classList.toggle("is-favorite", favorite);
      button.setAttribute("aria-pressed", String(favorite));
      button.setAttribute("aria-label", `${favorite ? "移出" : "加入"}想看：${movie.title}`);
    }
  }

  function resetAll() {
    state.filter = "all";
    state.query = "";
    state.flipped.clear();
    elements.search.value = "";

    for (const button of elements.filters.querySelectorAll(".filter-chip")) {
      const active = button.dataset.filter === "all";
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }

    render();
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2200);
  }

  elements.search.addEventListener("input", () => {
    state.query = elements.search.value.trim();
    state.flipped.clear();
    render();
  });

  elements.clearSearch.addEventListener("click", () => {
    elements.search.value = "";
    state.query = "";
    state.flipped.clear();
    render();
    elements.search.focus();
  });

  elements.filters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;

    state.filter = button.dataset.filter;
    state.flipped.clear();

    for (const chip of elements.filters.querySelectorAll(".filter-chip")) {
      const active = chip === button;
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-pressed", String(active));
    }

    render();
  });

  elements.shelves.addEventListener("click", (event) => {
    const favoriteButton = event.target.closest(".favorite-button");
    if (favoriteButton) {
      const card = favoriteButton.closest(".movie-card");
      toggleFavorite(card, card.dataset.id);
      return;
    }

    const flipButton = event.target.closest(".flip-trigger");
    if (flipButton) {
      const card = flipButton.closest(".movie-card");
      setFlipped(card, !state.flipped.has(card.dataset.id));
      return;
    }

    const returnButton = event.target.closest(".back-return");
    if (returnButton) {
      const card = returnButton.closest(".movie-card");
      setFlipped(card, false);
    }
  });

  elements.reset.addEventListener("click", resetAll);
  elements.emptyReset.addEventListener("click", resetAll);

  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (columnCount() !== lastColumns) render();
    }, 140);
  });

  document.getElementById("total-movies").textContent = movies.length;
  document.getElementById("total-categories").textContent = categoryOrder.length;
  updateHero();
  renderFilters();
  render();
})();
