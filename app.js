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
    totalMovies: document.getElementById("total-movies"),
    totalClassic: document.getElementById("total-classic"),
    doorCount: document.getElementById("door-count"),
    dialog: document.getElementById("poster-dialog"),
    dialogClose: document.getElementById("dialog-close"),
    dialogImage: document.getElementById("dialog-image"),
    dialogSource: document.getElementById("dialog-source"),
    dialogTitle: document.getElementById("dialog-title"),
    dialogMeta: document.getElementById("dialog-meta"),
    dialogTags: document.getElementById("dialog-tags"),
    dialogSynopsis: document.getElementById("dialog-synopsis"),
    dialogWatch: document.getElementById("dialog-watch"),
    dialogWatchLabel: document.getElementById("dialog-watch-label"),
    dialogFavorite: document.getElementById("dialog-favorite")
  };

  let toastTimer;
  let resizeTimer;
  let activeMovieId = null;
  let lastDialogTrigger = null;
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

  function movieYear(movie) {
    const match = String(movie.meta || "").match(/\b(?:19|20)\d{2}\b/);
    return match ? Number(match[0]) : null;
  }

  function movieEra(movie) {
    const year = movieYear(movie);
    return year !== null && year < 2010 ? "classic" : "recent";
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
    if (state.filter === "era:classic" && movieEra(movie) !== "classic") return false;
    if (state.filter === "era:recent" && movieEra(movie) !== "recent") return false;
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
        key: "favorites",
        title: "我的想看",
        note: `${items.length} 部 · 只保存在这台设备的浏览器里`,
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

    return [
      {
        key: "classic",
        title: "经典碟架",
        note: "老片重看，每一部都有来处",
        items: items.filter((movie) => movieEra(movie) === "classic")
      },
      {
        key: "recent",
        title: "近作碟架",
        note: "近年的口碑佳片与开放动画",
        items: items.filter((movie) => movieEra(movie) === "recent")
      }
    ].filter((group) => group.items.length);
  }

  function chunk(items, size) {
    const rows = [];
    for (let index = 0; index < items.length; index += size) {
      rows.push(items.slice(index, index + size));
    }
    return rows;
  }

  function renderMovie(movie, index) {
    const isFavorite = state.favorites.has(movie.id);
    const title = escapeHtml(movie.title);
    const year = movieYear(movie);
    const tilt = (((index + movie.title.length) % 5) - 2) * 0.28;

    return `
      <article class="movie-card" data-id="${escapeHtml(movie.id)}" style="--tilt:${tilt.toFixed(2)}deg">
        <button class="case-cover" type="button" data-open-id="${escapeHtml(movie.id)}"
          aria-label="查看《${title}》的大图与剧情简介">
          <span class="case-spine"><b>${escapeHtml(movie.source)}</b> · ${escapeHtml(movie.category)}${year ? ` · ${year}` : ""}</span>
          <img src="${escapeHtml(movie.poster)}" alt="《${title}》封面" loading="lazy" decoding="async">
          <span class="source-badge">${escapeHtml(movie.source)}</span>
          ${movie.featured ? '<span class="hot-badge">热门</span>' : ""}
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
      { id: "era:classic", label: "经典" },
      { id: "era:recent", label: "近作" },
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

    document.querySelectorAll(".hero-case img").forEach((image, index) => {
      const movie = highlighted[index];
      if (movie) image.src = movie.poster;
    });
  }

  function updateCounts() {
    document.querySelector('[data-count="all"]').textContent = movies.length;
    document.querySelector('[data-count="era:classic"]').textContent = movies.filter((movie) => movieEra(movie) === "classic").length;
    document.querySelector('[data-count="era:recent"]').textContent = movies.filter((movie) => movieEra(movie) === "recent").length;
    for (const category of categoryOrder) {
      const counter = document.querySelector(`[data-count="category:${category}"]`);
      if (counter) counter.textContent = movies.filter((movie) => movie.category === category).length;
    }
    document.querySelector('[data-count="favorites"]').textContent = state.favorites.size;
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
    } else if (state.filter === "era:classic") {
      elements.summary.textContent = `经典碟架 · ${total} 部 · 点击封面看大图`;
    } else if (state.filter === "era:recent") {
      elements.summary.textContent = `近作碟架 · ${total} 部 · 点击封面看大图`;
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
  }

  function openMovie(id, trigger) {
    const movie = movies.find((item) => item.id === id);
    if (!movie) return;

    activeMovieId = id;
    lastDialogTrigger = trigger || document.activeElement;

    elements.dialogImage.src = movie.poster;
    elements.dialogImage.alt = `《${movie.title}》大图海报`;
    elements.dialogSource.textContent = movie.source;
    elements.dialogTitle.textContent = movie.title;
    elements.dialogMeta.textContent = movie.meta;
    elements.dialogSynopsis.textContent = movie.synopsis;
    elements.dialogWatch.href = movie.watchUrl;
    elements.dialogWatch.setAttribute("aria-label", `前往${movie.source}${movie.watchLabel || "在线观看"}《${movie.title}》（新窗口打开）`);
    elements.dialogWatchLabel.textContent = movie.watchLabel || "在线观看";
    elements.dialogTags.innerHTML = (movie.tags || []).map((tag) => `<span class="dialog-tag">${escapeHtml(tag)}</span>`).join("");
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

  function resetAll() {
    state.filter = "all";
    state.query = "";
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
    if (!button) return;

    state.filter = button.dataset.filter;
    for (const chip of elements.filters.querySelectorAll(".filter-chip")) {
      const active = chip === button;
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-pressed", String(active));
    }

    render();
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

  elements.totalMovies.textContent = movies.length;
  elements.totalClassic.textContent = movies.filter((movie) => movieEra(movie) === "classic").length;
  elements.doorCount.textContent = `${movies.length} 部`;
  updateHero();
  renderFilters();
  render();
})();
