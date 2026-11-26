(() => {
  "use strict";

  const storageKey = "dyk-resource-library-v1";
  const apiDefault = "https://dm.xueximeng.com/api/resources/public";
  let resources = loadResources();
  let editingId = null;
  let activeId = null;
  let toastTimer;

  const state = {
    query: "",
    type: "all",
    sort: "updated",
    favoritesOnly: false
  };

  const elements = {
    grid: document.getElementById("resource-grid"),
    search: document.getElementById("search-input"),
    clearSearch: document.getElementById("clear-search"),
    typeFilter: document.getElementById("type-filter"),
    sort: document.getElementById("sort-select"),
    favoriteFilter: document.getElementById("favorite-filter"),
    summary: document.getElementById("result-summary"),
    reset: document.getElementById("reset-filters"),
    empty: document.getElementById("empty-state"),
    emptyMessage: document.getElementById("empty-message"),
    statTotal: document.getElementById("stat-total"),
    statFavorites: document.getElementById("stat-favorites"),
    statTypes: document.getElementById("stat-types"),
    editor: document.getElementById("resource-dialog"),
    form: document.getElementById("resource-form"),
    editorTitle: document.getElementById("editor-title"),
    fieldTitle: document.getElementById("field-title"),
    fieldTitleEn: document.getElementById("field-title-en"),
    fieldType: document.getElementById("field-type"),
    fieldDescription: document.getElementById("field-description"),
    fieldPoster: document.getElementById("field-poster"),
    fieldSource: document.getElementById("field-source"),
    fieldTags: document.getElementById("field-tags"),
    fieldFavorite: document.getElementById("field-favorite"),
    linkRows: document.getElementById("link-rows"),
    formError: document.getElementById("form-error"),
    detail: document.getElementById("detail-dialog"),
    detailImage: document.getElementById("detail-image"),
    detailTypographic: document.getElementById("detail-typographic"),
    detailSource: document.getElementById("detail-source"),
    detailTitle: document.getElementById("detail-title"),
    detailMeta: document.getElementById("detail-meta"),
    detailTags: document.getElementById("detail-tags"),
    detailDescription: document.getElementById("detail-description"),
    detailLinksSection: document.getElementById("detail-links-section"),
    detailLinks: document.getElementById("detail-links"),
    detailEmptyLinks: document.getElementById("detail-empty-links"),
    detailFavorite: document.getElementById("detail-favorite"),
    api: document.getElementById("api-dialog"),
    apiForm: document.getElementById("api-form"),
    apiEndpoint: document.getElementById("api-endpoint"),
    apiStatus: document.getElementById("api-status"),
    apiSubmit: document.getElementById("api-submit"),
    jsonFile: document.getElementById("json-file"),
    toast: document.getElementById("toast")
  };

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

  function uid(prefix = "resource") {
    const random = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}-${random}`;
  }

  function hashText(value) {
    let hash = 2166136261;
    for (const character of String(value)) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function safeHttpUrl(value, base = location.href) {
    const text = clean(value);
    if (!text) return "";
    try {
      const url = new URL(text, base);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function normalizePoster(value) {
    const text = clean(value);
    if (!text) return "";
    if (/^https?:\/\//i.test(text)) return safeHttpUrl(text);
    if (/^[\w./-]+$/i.test(text)) return text;
    return safeHttpUrl(text);
  }

  function normalizeTags(value) {
    if (Array.isArray(value)) return [...new Set(value.map(clean).filter(Boolean))].slice(0, 30);
    return [...new Set(String(value ?? "").split(/[,，]/).map(clean).filter(Boolean))].slice(0, 30);
  }

  function linkLabel(url, fallback = "资源链接") {
    try {
      return new URL(url).hostname.replace(/^www\./, "") || fallback;
    } catch {
      return fallback;
    }
  }

  function normalizeSimpleLinks(value) {
    if (!Array.isArray(value)) return [];
    return value.map((link) => {
      const url = safeHttpUrl(typeof link === "string" ? link : link?.url);
      if (!url) return null;
      const label = clean(typeof link === "string" ? "" : link?.label) || linkLabel(url);
      return { label, url };
    }).filter(Boolean);
  }

  function collectExternalLinks(value, base, output = [], fallbackLabel = "资源链接") {
    if (!value) return output;
    if (typeof value === "string") {
      const url = safeHttpUrl(value, base);
      if (url) output.push({ label: fallbackLabel, url });
      return output;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectExternalLinks(item, base, output, fallbackLabel);
      return output;
    }
    if (typeof value !== "object") return output;
    const directUrl = value.url || value.link || value.href;
    if (typeof directUrl === "string") {
      const url = safeHttpUrl(directUrl, base);
      if (url) output.push({ label: clean(value.label || value.name || value.title) || fallbackLabel, url });
      return output;
    }
    for (const [key, item] of Object.entries(value)) {
      collectExternalLinks(item, base, output, clean(key) || fallbackLabel);
    }
    return output;
  }

  function normalizeExternalLinks(value, base) {
    const links = collectExternalLinks(value, base);
    const seen = new Set();
    return links.filter((link) => {
      const key = `${link.label}\n${link.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 50);
  }

  function normalizeResource(input, options = {}) {
    const now = new Date().toISOString();
    const title = clean(input?.title || input?.name);
    if (!title) return null;
    const links = options.links || normalizeSimpleLinks(input.links);
    const createdAt = clean(input.createdAt) || now;
    return {
      id: clean(input.id) || uid(),
      title,
      titleEn: clean(input.titleEn || input.title_en),
      type: clean(input.type || input.resource_type) || "未分类",
      description: clean(input.description),
      poster: normalizePoster(input.poster || input.poster_image),
      source: clean(input.source) || "个人整理",
      tags: normalizeTags(input.tags),
      links,
      favorite: Boolean(input.favorite),
      createdAt,
      updatedAt: clean(input.updatedAt) || now,
      origin: clean(input.origin) || "本地整理"
    };
  }

  function resourcesFromMovies() {
    const movies = Array.isArray(window.MOVIES) ? window.MOVIES : [];
    return movies.map((movie) => normalizeResource({
      id: `movie-${movie.id}`,
      title: movie.title,
      type: movie.category || "电影",
      description: movie.synopsis,
      poster: movie.poster ? `../${movie.poster}` : "",
      source: movie.source,
      tags: movie.tags,
      links: movie.watchUrl ? [{ label: movie.watchLabel || "在线观看", url: movie.watchUrl }] : [],
      origin: "电影书架"
    })).filter(Boolean);
  }

  function loadResources() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === null) {
        const seeded = resourcesFromMovies();
        localStorage.setItem(storageKey, JSON.stringify(seeded));
        return seeded;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((item) => normalizeResource(item, { links: normalizeSimpleLinks(item.links) })).filter(Boolean);
    } catch {
      return [];
    }
  }

  function saveResources() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(resources));
      return true;
    } catch {
      showToast("浏览器存储空间不足，请先导出备份。", true);
      return false;
    }
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date).replace(/\//g, "-");
  }

  function showToast(message, isError = false) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.style.borderColor = isError ? "rgba(228, 139, 125, 0.45)" : "";
    elements.toast.style.color = isError ? "var(--danger)" : "";
    elements.toast.classList.add("is-visible");
    toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 3200);
  }

  function renderTypeFilter() {
    const types = [...new Set(resources.map((resource) => resource.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    if (state.type !== "all" && !types.includes(state.type)) state.type = "all";
    elements.typeFilter.innerHTML = `<option value="all">全部类型</option>${types.map((type) =>
      `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`
    ).join("")}`;
    elements.typeFilter.value = state.type;
  }

  function filteredResources() {
    const query = clean(state.query).toLocaleLowerCase("zh-CN");
    const result = resources.filter((resource) => {
      if (state.type !== "all" && resource.type !== state.type) return false;
      if (state.favoritesOnly && !resource.favorite) return false;
      if (!query) return true;
      const haystack = [
        resource.title,
        resource.titleEn,
        resource.type,
        resource.description,
        resource.source,
        ...resource.tags,
        ...resource.links.flatMap((link) => [link.label, link.url])
      ].join(" ").toLocaleLowerCase("zh-CN");
      return haystack.includes(query);
    });
    result.sort((a, b) => {
      if (state.sort === "title") return a.title.localeCompare(b.title, "zh-CN");
      if (state.sort === "created") return new Date(b.createdAt) - new Date(a.createdAt);
      if (state.sort === "links") return b.links.length - a.links.length || new Date(b.updatedAt) - new Date(a.updatedAt);
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
    return result;
  }

  function renderStats() {
    elements.statTotal.textContent = String(resources.length);
    elements.statFavorites.textContent = String(resources.filter((resource) => resource.favorite).length);
    elements.statTypes.textContent = String(new Set(resources.map((resource) => resource.type).filter(Boolean)).size);
  }

  function render() {
    renderTypeFilter();
    renderStats();
    const list = filteredResources();
    elements.summary.textContent = `显示 ${list.length} / ${resources.length} 条资源`;
    elements.clearSearch.hidden = !state.query;
    elements.reset.hidden = !state.query && state.type === "all" && !state.favoritesOnly;
    elements.favoriteFilter.setAttribute("aria-pressed", String(state.favoritesOnly));
    elements.grid.innerHTML = list.map((resource) => {
      const hasPoster = Boolean(resource.poster);
      return `<article class="resource-card">
        <button class="resource-case" type="button" data-open="${escapeHtml(resource.id)}" aria-label="查看《${escapeHtml(resource.title)}》详情">
          <div class="resource-cover">
            <img src="${escapeHtml(resource.poster)}" alt="《${escapeHtml(resource.title)}》海报" loading="lazy" decoding="async" ${hasPoster ? "" : "hidden"}>
            <div class="resource-typographic" ${hasPoster ? "hidden" : ""}>${escapeHtml(resource.title)}</div>
            <span class="resource-spine">${escapeHtml(resource.type)}</span>
            <span class="resource-type">${escapeHtml(resource.type)}</span>
          </div>
        </button>
        <button class="card-favorite" type="button" data-favorite="${escapeHtml(resource.id)}" aria-pressed="${resource.favorite}" aria-label="${resource.favorite ? "取消收藏" : "收藏"}《${escapeHtml(resource.title)}》">
          <svg class="icon"><use href="#icon-heart"></use></svg>
        </button>
        <div class="resource-card-copy">
          <h3>${escapeHtml(resource.title)}</h3>
          <p>${escapeHtml(resource.description || resource.titleEn || "暂无简介")}</p>
          <div class="resource-card-meta"><span>${escapeHtml(resource.source)}</span><span>${resource.links.length} 个链接</span></div>
        </div>
      </article>`;
    }).join("");
    elements.empty.hidden = list.length !== 0;
    if (!resources.length) {
      elements.emptyMessage.textContent = "新增一条资源，或从电影书架导入免费正片。";
    } else if (!list.length) {
      elements.emptyMessage.textContent = "没有符合当前筛选条件的资源，换个关键词或清除筛选试试。";
    }
  }

  function syncBodyLock() {
    document.body.classList.toggle("modal-open", Boolean(document.querySelector("dialog[open]")));
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
    syncBodyLock();
  }

  function openEditor(id = null) {
    editingId = id;
    elements.form.reset();
    elements.formError.hidden = true;
    elements.linkRows.innerHTML = "";
    const resource = id ? resources.find((item) => item.id === id) : null;
    elements.editorTitle.textContent = resource ? "编辑资源" : "新增资源";
    elements.fieldTitle.value = resource?.title || "";
    elements.fieldTitleEn.value = resource?.titleEn || "";
    elements.fieldType.value = resource?.type || "";
    elements.fieldDescription.value = resource?.description || "";
    elements.fieldPoster.value = resource?.poster || "";
    elements.fieldSource.value = resource?.source || "";
    elements.fieldTags.value = resource?.tags.join(", ") || "";
    elements.fieldFavorite.checked = resource?.favorite || false;
    if (resource?.links.length) {
      for (const link of resource.links) addLinkRow(link.label, link.url);
    } else {
      addLinkRow();
    }
    if (elements.detail.open) closeDialog(elements.detail);
    elements.editor.showModal();
    syncBodyLock();
    setTimeout(() => elements.fieldTitle.focus(), 30);
  }

  function addLinkRow(label = "", url = "") {
    const row = document.createElement("div");
    row.className = "link-row";
    row.innerHTML = `
      <input class="link-label" type="text" maxlength="80" placeholder="链接名称" aria-label="链接名称" value="${escapeHtml(label)}">
      <input class="link-url" type="url" maxlength="1200" placeholder="https://…" aria-label="链接地址" value="${escapeHtml(url)}">
      <button class="secondary-button link-remove" type="button" aria-label="删除这条链接"><svg class="icon"><use href="#icon-trash"></use></svg></button>`;
    elements.linkRows.append(row);
    return row;
  }

  function readEditorLinks() {
    const links = [];
    for (const row of elements.linkRows.querySelectorAll(".link-row")) {
      const label = clean(row.querySelector(".link-label").value);
      const rawUrl = clean(row.querySelector(".link-url").value);
      if (!label && !rawUrl) continue;
      const url = safeHttpUrl(rawUrl);
      if (!url) throw new Error(`链接地址无效：${rawUrl || "（空）"}`);
      links.push({ label: label || linkLabel(url), url });
    }
    return links;
  }

  function saveEditor(event) {
    event.preventDefault();
    elements.formError.hidden = true;
    try {
      const title = clean(elements.fieldTitle.value);
      if (!title) throw new Error("请填写片名或资源名。");
      const links = readEditorLinks();
      const now = new Date().toISOString();
      const existing = editingId ? resources.find((item) => item.id === editingId) : null;
      const resource = normalizeResource({
        id: existing?.id || uid(),
        title,
        titleEn: elements.fieldTitleEn.value,
        type: elements.fieldType.value,
        description: elements.fieldDescription.value,
        poster: elements.fieldPoster.value,
        source: elements.fieldSource.value,
        tags: elements.fieldTags.value,
        favorite: elements.fieldFavorite.checked,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        origin: existing?.origin || "本地整理"
      }, { links });
      if (existing) {
        resources = resources.map((item) => item.id === existing.id ? resource : item);
      } else {
        resources.unshift(resource);
      }
      if (!saveResources()) return;
      render();
      closeDialog(elements.editor);
      showToast(existing ? "资源已更新。" : "资源已加入书架。");
    } catch (error) {
      elements.formError.textContent = error.message;
      elements.formError.hidden = false;
    }
  }

  function toggleFavorite(id) {
    const resource = resources.find((item) => item.id === id);
    if (!resource) return;
    resource.favorite = !resource.favorite;
    resource.updatedAt = new Date().toISOString();
    if (!saveResources()) return;
    render();
    if (activeId === id && elements.detail.open) renderDetail(id);
  }

  function renderDetail(id) {
    const resource = resources.find((item) => item.id === id);
    if (!resource) return;
    activeId = id;
    const hasPoster = Boolean(resource.poster);
    elements.detailImage.hidden = !hasPoster;
    elements.detailTypographic.hidden = hasPoster;
    elements.detailImage.alt = hasPoster ? `《${resource.title}》海报` : "";
    if (hasPoster) {
      elements.detailImage.src = resource.poster;
    } else {
      elements.detailImage.removeAttribute("src");
    }
    elements.detailTypographic.textContent = resource.title;
    elements.detailSource.textContent = resource.source;
    elements.detailTitle.textContent = resource.title;
    elements.detailMeta.textContent = [resource.titleEn, resource.type, `更新于 ${formatDate(resource.updatedAt)}`].filter(Boolean).join(" · ");
    elements.detailTags.innerHTML = resource.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
    elements.detailDescription.textContent = resource.description || "暂无简介。";
    elements.detailLinksSection.hidden = resource.links.length === 0;
    elements.detailEmptyLinks.hidden = resource.links.length !== 0;
    elements.detailLinks.innerHTML = resource.links.map((link) =>
      `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer"><span>${escapeHtml(link.label)}</span><svg class="icon"><use href="#icon-arrow"></use></svg></a>`
    ).join("");
    elements.detailFavorite.setAttribute("aria-pressed", String(resource.favorite));
    elements.detailFavorite.querySelector("span").textContent = resource.favorite ? "已收藏" : "加入收藏";
  }

  function openDetail(id) {
    if (!resources.some((item) => item.id === id)) return;
    renderDetail(id);
    elements.detail.showModal();
    syncBodyLock();
  }

  function deleteResource(id) {
    const resource = resources.find((item) => item.id === id);
    if (!resource) return;
    if (!window.confirm(`确定删除《${resource.title}》吗？此操作只影响当前浏览器的资源库。`)) return;
    resources = resources.filter((item) => item.id !== id);
    if (!saveResources()) return;
    if (elements.detail.open) closeDialog(elements.detail);
    activeId = null;
    render();
    showToast("资源已删除。");
  }

  function mergeResources(incoming) {
    const byId = new Map(resources.map((resource) => [resource.id, resource]));
    let added = 0;
    let updated = 0;
    for (const resource of incoming) {
      const existing = byId.get(resource.id);
      if (existing) {
        byId.set(resource.id, { ...resource, createdAt: existing.createdAt || resource.createdAt, updatedAt: new Date().toISOString() });
        updated++;
      } else {
        byId.set(resource.id, resource);
        added++;
      }
    }
    resources = [...byId.values()];
    saveResources();
    render();
    return { added, updated };
  }

  function importMovies() {
    const incoming = resourcesFromMovies();
    const existingIds = new Set(resources.map((resource) => resource.id));
    const fresh = incoming.filter((resource) => !existingIds.has(resource.id));
    if (!fresh.length) {
      showToast("免费正片已经在资源库里了。");
      return;
    }
    resources = [...fresh, ...resources];
    saveResources();
    render();
    showToast(`已从电影书架导入 ${fresh.length} 部免费正片。`);
  }

  function extractResourceArray(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    for (const key of ["resources", "items", "data", "list", "results"]) {
      if (Array.isArray(payload[key])) return payload[key];
      if (payload[key] && typeof payload[key] === "object") {
        const nested = extractResourceArray(payload[key]);
        if (nested.length) return nested;
      }
    }
    return [];
  }

  function externalResource(item, endpoint) {
    if (!item || typeof item !== "object") return null;
    const base = new URL(endpoint);
    const title = clean(item.title || item.name);
    if (!title) return null;
    const images = Array.isArray(item.images) ? item.images : [];
    const rawPoster = item.poster_image || item.poster || images[0] || "";
    const poster = rawPoster ? safeHttpUrl(rawPoster, base) : "";
    const id = item.id != null ? `gcm-${item.id}` : `gcm-${hashText(title.toLocaleLowerCase("zh-CN"))}`;
    return normalizeResource({
      id,
      title,
      titleEn: item.title_en,
      type: item.resource_type || item.type || "未分类",
      description: item.description,
      poster,
      source: "GoComicMosaic",
      tags: item.tags,
      links: normalizeExternalLinks(item.links, base),
      origin: "GoComicMosaic"
    });
  }

  async function importFromApi(event) {
    event.preventDefault();
    const endpoint = safeHttpUrl(elements.apiEndpoint.value);
    elements.apiStatus.classList.remove("is-error");
    if (!endpoint) {
      elements.apiStatus.textContent = "请填写有效的 http 或 https 接口地址。";
      elements.apiStatus.classList.add("is-error");
      return;
    }
    elements.apiSubmit.disabled = true;
    elements.apiStatus.textContent = "正在读取公开资源…";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`接口返回 HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("json")) throw new Error("接口返回的不是 JSON，可能返回了网站首页。");
      const payload = await response.json();
      const items = extractResourceArray(payload);
      if (!items.length) throw new Error("没有读到可导入的资源。");
      const incoming = items.map((item) => externalResource(item, endpoint)).filter(Boolean);
      if (!incoming.length) throw new Error("返回的数据里没有有效标题。");
      const result = mergeResources(incoming);
      elements.apiStatus.textContent = `导入完成：新增 ${result.added} 条，更新 ${result.updated} 条。`;
      showToast(`已从 GoComicMosaic 导入 ${incoming.length} 条资源。`);
      setTimeout(() => closeDialog(elements.api), 700);
    } catch (error) {
      elements.apiStatus.textContent = error.name === "AbortError" ? "读取超时，请稍后重试。" : error.message;
      elements.apiStatus.classList.add("is-error");
    } finally {
      clearTimeout(timer);
      elements.apiSubmit.disabled = false;
    }
  }

  async function importJsonFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const items = extractResourceArray(payload);
      if (!items.length) throw new Error("文件里没有资源数组。");
      const incoming = items.map((item) => normalizeResource(item, { links: normalizeSimpleLinks(item.links) })).filter(Boolean);
      if (!incoming.length) throw new Error("文件里没有有效资源。");
      const result = mergeResources(incoming);
      showToast(`JSON 导入完成：新增 ${result.added} 条，更新 ${result.updated} 条。`);
    } catch (error) {
      showToast(`JSON 导入失败：${error.message}`, true);
    } finally {
      elements.jsonFile.value = "";
    }
  }

  function exportJson() {
    const payload = {
      format: "dyk-resource-library",
      version: 1,
      exportedAt: new Date().toISOString(),
      resources
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `dyk-resources-${date}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`已导出 ${resources.length} 条资源。`);
  }

  function resetFilters() {
    state.query = "";
    state.type = "all";
    state.favoritesOnly = false;
    elements.search.value = "";
    render();
  }

  elements.search.addEventListener("input", () => {
    state.query = elements.search.value;
    render();
  });
  elements.clearSearch.addEventListener("click", () => {
    state.query = "";
    elements.search.value = "";
    elements.search.focus();
    render();
  });
  elements.typeFilter.addEventListener("change", () => {
    state.type = elements.typeFilter.value;
    render();
  });
  elements.sort.addEventListener("change", () => {
    state.sort = elements.sort.value;
    render();
  });
  elements.favoriteFilter.addEventListener("click", () => {
    state.favoritesOnly = !state.favoritesOnly;
    render();
  });
  elements.reset.addEventListener("click", resetFilters);
  document.getElementById("add-resource").addEventListener("click", () => openEditor());
  document.getElementById("empty-add").addEventListener("click", () => openEditor());
  document.getElementById("import-movies").addEventListener("click", importMovies);
  document.getElementById("import-json").addEventListener("click", () => elements.jsonFile.click());
  document.getElementById("export-json").addEventListener("click", exportJson);
  elements.jsonFile.addEventListener("change", () => importJsonFile(elements.jsonFile.files[0]));
  document.getElementById("editor-close").addEventListener("click", () => closeDialog(elements.editor));
  document.getElementById("editor-cancel").addEventListener("click", () => closeDialog(elements.editor));
  document.getElementById("add-link").addEventListener("click", () => addLinkRow());
  elements.linkRows.addEventListener("click", (event) => {
    const button = event.target.closest(".link-remove");
    if (!button) return;
    const rows = elements.linkRows.querySelectorAll(".link-row");
    if (rows.length === 1) {
      rows[0].querySelectorAll("input").forEach((input) => { input.value = ""; });
    } else {
      button.closest(".link-row").remove();
    }
  });
  elements.form.addEventListener("submit", saveEditor);
  document.getElementById("detail-close").addEventListener("click", () => closeDialog(elements.detail));
  document.getElementById("detail-edit").addEventListener("click", () => openEditor(activeId));
  document.getElementById("detail-delete").addEventListener("click", () => deleteResource(activeId));
  elements.detailFavorite.addEventListener("click", () => toggleFavorite(activeId));
  document.getElementById("open-api-import").addEventListener("click", () => {
    elements.apiStatus.textContent = "";
    elements.apiStatus.classList.remove("is-error");
    elements.apiEndpoint.value = apiDefault;
    elements.api.showModal();
    syncBodyLock();
  });
  document.getElementById("api-close").addEventListener("click", () => closeDialog(elements.api));
  document.getElementById("api-cancel").addEventListener("click", () => closeDialog(elements.api));
  elements.apiForm.addEventListener("submit", importFromApi);

  elements.grid.addEventListener("click", (event) => {
    const favorite = event.target.closest("[data-favorite]");
    if (favorite) {
      toggleFavorite(favorite.dataset.favorite);
      return;
    }
    const open = event.target.closest("[data-open]");
    if (open) openDetail(open.dataset.open);
  });
  elements.grid.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.closest(".resource-cover")) return;
    image.hidden = true;
    const cover = image.closest(".resource-cover");
    const typographic = cover.querySelector(".resource-typographic");
    if (typographic) typographic.hidden = false;
  }, true);
  elements.detailImage.addEventListener("error", () => {
    if (!elements.detailImage.getAttribute("src")) return;
    elements.detailImage.hidden = true;
    elements.detailTypographic.hidden = false;
  });

  for (const dialog of [elements.editor, elements.detail, elements.api]) {
    dialog.addEventListener("close", syncBodyLock);
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) closeDialog(dialog);
    });
  }

  render();
})();
