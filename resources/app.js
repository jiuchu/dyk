(() => {
  "use strict";

  const storageKey = "dyk-resource-library-v1";
  const pageSize = 24;
  const catalogMigrationKey = "dyk-resource-library-catalog-v6";
  const doubanCacheKey = "dyk-resource-douban-v1";
  const apiDefault = "https://dm.xueximeng.com/api/resources/public";
  let builtinResources = [];
  let builtinById = new Map();
  let deletedBuiltinIds = new Set();
  let resources = [];
  let editingId = null;
  let activeId = null;
  let toastTimer;

  const state = {
    query: "",
    type: "all",
    source: "all",
    sort: "updated",
    favoritesOnly: false,
    limit: pageSize
  };
  let renderKey = "";
  let nextCatalogIndex = 0;
  let catalogTask = null;
  const doubanRequests = new Set();
  let doubanCache = {};
  try {
    doubanCache = JSON.parse(localStorage.getItem(doubanCacheKey) || "{}") || {};
  } catch {
    doubanCache = {};
  }

  const elements = {
    grid: document.getElementById("resource-grid"),
    loadMore: document.getElementById("load-more"),
    search: document.getElementById("search-input"),
    clearSearch: document.getElementById("clear-search"),
    typeFilter: document.getElementById("type-filter"),
    sourceFilter: document.getElementById("source-filter"),
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
    fieldRating: document.getElementById("field-rating"),
    fieldDescription: document.getElementById("field-description"),
    fieldPoster: document.getElementById("field-poster"),
    fieldSource: document.getElementById("field-source"),
    fieldRatingSource: document.getElementById("field-rating-source"),
    fieldTags: document.getElementById("field-tags"),
    fieldFavorite: document.getElementById("field-favorite"),
    linkRows: document.getElementById("link-rows"),
    formError: document.getElementById("form-error"),
    detail: document.getElementById("detail-dialog"),
    detailImage: document.getElementById("detail-image"),
    detailTypographic: document.getElementById("detail-typographic"),
    detailSource: document.getElementById("detail-source"),
    detailTitle: document.getElementById("detail-title"),
    detailRating: document.getElementById("detail-rating"),
    detailRatingValue: document.getElementById("detail-rating-value"),
    detailRatingLabel: document.getElementById("detail-rating-label"),
    detailRatingCount: document.getElementById("detail-rating-count"),
    detailMeta: document.getElementById("detail-meta"),
    detailTags: document.getElementById("detail-tags"),
    detailDescription: document.getElementById("detail-description"),
    detailLinksSection: document.getElementById("detail-links-section"),
    detailLinks: document.getElementById("detail-links"),
    detailDownloadsSection: document.getElementById("detail-downloads-section"),
    detailDownloads: document.getElementById("detail-downloads"),
    detailDownloadsEmpty: document.getElementById("detail-downloads-empty"),
    detailDownloadsNote: document.getElementById("detail-downloads-note"),
    detailEmptyLinks: document.getElementById("detail-empty-links"),
    detailFavorite: document.getElementById("detail-favorite"),
    api: document.getElementById("api-dialog"),
    apiForm: document.getElementById("api-form"),
    apiEndpoint: document.getElementById("api-endpoint"),
    apiStatus: document.getElementById("api-status"),
    apiSubmit: document.getElementById("api-submit"),
    github: document.getElementById("github-dialog"),
    githubForm: document.getElementById("github-form"),
    githubSource: document.getElementById("github-source"),
    githubUrl: document.getElementById("github-url"),
    githubUpdate: document.getElementById("github-update"),
    githubStatus: document.getElementById("github-status"),
    githubSubmit: document.getElementById("github-submit"),
    jsonFile: document.getElementById("json-file"),
    toast: document.getElementById("toast")
  };

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function titleKey(value) {
    return clean(value).toLocaleLowerCase("zh-CN").replace(/[^\p{L}\p{N}]+/gu, "");
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

  function posterThumb(value) {
    const text = normalizePoster(value);
    if (!text) return "";
    if (text.includes("/assets/posters/") && !text.includes("/assets/posters/thumbs/")) {
      const file = text.split("/").pop().replace(/\.(?:jpe?g|png|webp)$/i, ".webp");
      return text.replace(/\/assets\/posters\/[^/]+$/i, `/assets/posters/thumbs/${file}`);
    }
    return text.replace("https://image.tmdb.org/t/p/w500/", "https://image.tmdb.org/t/p/w342/");
  }

  const OPEN_MOVIE_SOURCES = {
    bigbuckbunny: { project: "https://studio.blender.org/projects/big-buck-bunny/", download: "https://download.blender.org/demo/movies/BBB/" },
    sintel: { project: "https://studio.blender.org/projects/sintel/", download: "https://download.blender.org/demo/movies/Sintel/" },
    tearsofsteel: { project: "https://studio.blender.org/projects/tears-of-steel/", download: "https://download.blender.org/demo/movies/ToS/" },
    cosmoslaundromat: { project: "https://studio.blender.org/projects/cosmos-laundromat/", download: "https://download.blender.org/demo/movies/CosmosLaundromat/" },
    spring: { project: "https://studio.blender.org/projects/spring/", download: "https://download.blender.org/demo/movies/Spring/" },
    charge: { project: "https://studio.blender.org/projects/charge/", download: "https://download.blender.org/demo/movies/Charge/" },
    elephantsdream: { project: "https://studio.blender.org/projects/elephants-dream/", download: "https://download.blender.org/demo/movies/ED/" },
    agent327: { project: "https://studio.blender.org/projects/agent-327/", download: "https://download.blender.org/demo/movies/Agent327/" },
    spritefright: { project: "https://studio.blender.org/projects/sprite-fright/", download: "https://download.blender.org/demo/movies/SpriteFright/" },
    coffeerun: { project: "https://studio.blender.org/projects/coffee-run/", download: "https://download.blender.org/demo/movies/CoffeeRun/" }
  };

  function downloadSearchSourceLinks() {
    return [
      { label: "电影天堂 · 站内搜索", url: "https://www.dytt8899.com/" },
      { label: "电影港 · 站内搜索", url: "https://www.dygang.net/" },
      { label: "音范丝 · 站内搜索", url: "https://www.yinfans.me/" },
      { label: "4K电影网 · 站内搜索", url: "http://www.4khd.cn/" }
    ];
  }

  function archiveSourceLinks(title, titleEn) {
    const query = encodeURIComponent(titleEn || title);
    return [
      { label: "Internet Archive · 用户上传检索", url: `https://archive.org/search?query=${query}` }
    ];
  }

  function officialSourceLinks(title, titleEn) {
    const zh = encodeURIComponent(title);
    const query = encodeURIComponent(titleEn || title);
    return [
      { label: "腾讯视频 · 正版平台", url: `https://v.qq.com/x/search/?q=${zh}` },
      { label: "爱奇艺 · 正版平台", url: `https://so.iqiyi.com/so/q_${zh}` },
      { label: "优酷 · 正版平台", url: `https://so.youku.com/search_video/q_${zh}` },
      { label: "哔哩哔哩 · 正版平台", url: `https://search.bilibili.com/all?keyword=${zh}` },
      { label: "1905电影网 · 正版检索", url: `https://www.1905.com/search/?q=${zh}` },
      { label: "JustWatch · 正版聚合", url: `https://www.justwatch.com/us/search?q=${query}` }
    ];
  }

  function publicDomainSourceLinks(title, titleEn) {
    const query = encodeURIComponent(titleEn || title);
    return [
      { label: "PublicDomainMovies · 公共领域电影", url: `https://publicdomainmovie.net/search/node?keys=${query}` },
      { label: "Wikimedia Commons · 公共领域 / CC 视频", url: `https://commons.wikimedia.org/w/index.php?search=${query}&title=Special:MediaSearch&type=video` },
      { label: "Public Domain Torrents · 公共领域种子", url: "https://publicdomaintorrents.info/" }
    ];
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
    const entries = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? [value]
        : value && typeof value === "object"
          ? Object.entries(value).map(([label, link]) => typeof link === "string" ? { label, url: link } : link)
          : [];
    return entries.map((link) => {
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
    const rawRating = Number(input.rating ?? input.score ?? input.vote_average ?? input.douban_rating);
    const rating = Number.isFinite(rawRating) && rawRating > 0 ? Math.min(10, rawRating) : null;
    const ratingCount = Math.max(0, Number(input.ratingCount ?? input.rating_count ?? input.vote_count ?? 0) || 0);
    return {
      id: clean(input.id) || uid(),
      title,
      titleEn: clean(input.titleEn || input.title_en),
      type: clean(input.type || input.resource_type) || "未分类",
      description: clean(input.description),
      descriptionSource: clean(input.descriptionSource || input.description_source),
      poster: normalizePoster(input.poster || input.poster_image),
      source: clean(input.source) || "个人整理",
      tags: normalizeTags(input.tags),
      links,
      downloads: options.downloads || normalizeSimpleLinks(input.downloads || input.download_links || input.downloadLinks || input.download_url || input.downloadUrl),
      downloadNotice: clean(input.downloadNotice || input.download_notice),
      rating,
      ratingCount,
      ratingSource: clean(input.ratingSource || input.rating_source) || (rating ? "评分" : ""),
      doubanId: clean(input.doubanId || input.douban_id),
      favorite: Boolean(input.favorite),
      createdAt,
      updatedAt: clean(input.updatedAt) || now,
      origin: clean(input.origin) || "本地整理"
    };
  }

  function resourcesFromMovies() {
    const extra = Array.isArray(window.EXTRA_RESOURCES)
      ? window.EXTRA_RESOURCES.map((item) => normalizeResource(item, { links: normalizeSimpleLinks(item.links) })).filter(Boolean)
      : [];
    const collections = [
      { items: window.MOVIES, prefix: "movie" },
      { items: window.CLASSICS, prefix: "classic" },
      { items: window.SHOWING, prefix: "showing" }
    ];
    const mergeLinks = (incoming, target) => {
      for (const link of incoming) {
        if (!target.some((item) => item.url === link.url)) target.push({ ...link });
      }
    };
    const movieAliasesByKey = new Map();
    const movieAliasesByKeyAndYear = new Map();
    const movies = collections.flatMap(({ items, prefix }) => {
      if (!Array.isArray(items)) return [];
      return items.map((movie) => {
        const links = [];
        let watchUrl = movie.watchUrl || "";
        if (watchUrl.startsWith("today/")) watchUrl = `../${watchUrl}`;
        if (watchUrl) links.push({ label: movie.watchLabel || "在线观看", url: watchUrl });
        if (movie.secondaryUrl) {
          links.push({ label: movie.secondaryLabel || "更多信息", url: movie.secondaryUrl });
        }
        const year = String(movie.year || (String(movie.meta || "").match(/\b(?:19|20)\d{2}\b/) || [])[0] || "");
        const resource = normalizeResource({
          id: `${prefix}-${movie.id}`,
          title: movie.title,
          titleEn: movie.originalTitle || movie.titleEn,
          type: movie.category || "电影",
          description: movie.synopsis,
          poster: movie.poster ? `../${movie.poster}` : "",
          source: movie.source || "电影书架",
          tags: [...(Array.isArray(movie.tags) ? movie.tags : []), movie.source, year].filter(Boolean),
          links: normalizeSimpleLinks(links),
          downloads: normalizeSimpleLinks(movie.downloads || movie.downloadUrls),
          rating: movie.rating,
          ratingCount: movie.ratingCount,
          ratingSource: movie.rating ? "豆瓣" : "",
          doubanId: String(movie.id).match(/(\d+)$/)?.[1] || "",
          origin: "电影书架"
        });
        if (resource) {
          const open = OPEN_MOVIE_SOURCES[titleKey(movie.title)] || OPEN_MOVIE_SOURCES[titleKey(movie.originalTitle || movie.titleEn)];
          const sourceText = clean(movie.source);
          if (open) {
            mergeLinks([
              { label: "Blender Studio · 官方下载", url: open.project },
              { label: "Blender · 官方下载目录", url: open.download }
            ], resource.downloads);
            resource.downloadNotice = "Blender 开放电影采用 CC BY 许可，可免费下载；请保留署名。另含用户上传来源，版权与可用性以原页为准。";
          } else if (sourceText.includes("1905") && watchUrl) {
            mergeLinks([
              { label: "1905电影网 · 官方免费片源", url: watchUrl },
              ...downloadSearchSourceLinks(),
              ...archiveSourceLinks(movie.title, movie.originalTitle || movie.titleEn)
            ], resource.downloads);
            resource.downloadNotice = "包含 1905 官方免费片源、多个下载站检索入口与 Internet Archive 用户上传检索；版权与可用性以原页为准。";
          } else if (prefix !== "showing") {
            if (year && Number(year) <= 1930) {
              mergeLinks([
                ...publicDomainSourceLinks(movie.title, movie.originalTitle || movie.titleEn),
                ...archiveSourceLinks(movie.title, movie.originalTitle || movie.titleEn)
              ], resource.downloads);
              resource.downloadNotice = "包含公共领域候选来源与 Internet Archive 用户上传检索；下载前请查看原页的版权与许可说明。";
            } else {
              mergeLinks([
                ...officialSourceLinks(movie.title, movie.originalTitle || movie.titleEn),
                ...downloadSearchSourceLinks(),
                ...archiveSourceLinks(movie.title, movie.originalTitle || movie.titleEn)
              ], resource.downloads);
              resource.downloadNotice = "正版平台需购买、租赁或会员；购买或租赁后可下载。其余为下载站检索入口与 Internet Archive 用户上传来源，版权与可用性请自行确认。";
            }
          } else {
            mergeLinks([
              ...downloadSearchSourceLinks(),
              ...archiveSourceLinks(movie.title, movie.originalTitle || movie.titleEn)
            ], resource.downloads);
            resource.downloadNotice = "影片仍在上映或尚未发行数字版；以下为下载站检索入口与 Internet Archive 用户上传来源，版权与可用性请自行确认。";
          }
          for (const alias of [movie.title, movie.originalTitle, movie.titleEn]) {
            const key = titleKey(alias);
            if (!key) continue;
            if (!movieAliasesByKey.has(key)) movieAliasesByKey.set(key, resource);
            const keyAndYear = `${year}\n${key}`;
            if (!movieAliasesByKeyAndYear.has(keyAndYear)) movieAliasesByKeyAndYear.set(keyAndYear, resource);
          }
        }
        return resource;
      }).filter(Boolean);
    });
    for (const resource of extra) {
      const year = resource.tags.find((tag) => /^\d{4}$/.test(tag)) || "";
      const keys = [resource.title, resource.titleEn].map(titleKey).filter(Boolean);
      const match = keys.map((key) => movieAliasesByKeyAndYear.get(`${year}\n${key}`)).find(Boolean)
        || keys.map((key) => movieAliasesByKey.get(key)).find(Boolean);
      if (!match) continue;
      mergeLinks(resource.links, match.links);
      mergeLinks(resource.downloads, match.downloads);
    }
    return [...extra, ...movies];
  }

  function resourceKey(resource) {
    const year = resource.tags.find((tag) => /^\d{4}$/.test(tag)) || "";
    const title = resource.title.toLocaleLowerCase("zh-CN").replace(/[^\p{L}\p{N}]+/gu, "");
    return `${title}\n${year}`;
  }

  function copyResource(resource) {
    return {
      ...resource,
      tags: [...resource.tags],
      links: resource.links.map((link) => ({ ...link })),
      downloads: resource.downloads.map((link) => ({ ...link }))
    };
  }

  function mergeLinkLists(base, extra) {
    const merged = base.map((link) => ({ ...link }));
    for (const link of extra || []) {
      if (!merged.some((item) => item.url === link.url)) merged.push({ ...link });
    }
    return merged;
  }

  function loadResources() {
    try {
      builtinResources = resourcesFromMovies();
      builtinById = new Map(builtinResources.map((resource) => [resource.id, resource]));
      const builtinByKey = new Map(builtinResources.map((resource) => [resourceKey(resource), resource]));
      const raw = localStorage.getItem(storageKey);
      if (raw === null) {
        localStorage.setItem(catalogMigrationKey, "2");
        return builtinResources.map(copyResource);
      }
      const parsed = JSON.parse(raw);
      let stored;
      if (Array.isArray(parsed)) {
        const custom = [];
        const overrides = {};
        for (const item of parsed) {
          const resource = normalizeResource(item, { links: normalizeSimpleLinks(item.links) });
          if (!resource) continue;
          const fresh = builtinById.get(resource.id) || builtinByKey.get(resourceKey(resource));
          if (!fresh) {
            custom.push(resource);
            continue;
          }
          resource.id = fresh.id;
          const hasLocalDescription = resource.descriptionSource === "本地编辑";
          const hasCustomRating = resource.rating && resource.ratingSource !== "豆瓣";
          const sameLink = (link, list) => list.some((item) => item.label === link.label && item.url === link.url);
          const customLinks = resource.links.filter((link) => !sameLink(link, fresh.links));
          const customDownloads = resource.downloads.filter((link) => !sameLink(link, fresh.downloads));
          if (!resource.favorite && !customLinks.length && !customDownloads.length && !hasLocalDescription && !hasCustomRating) continue;
          overrides[resource.id] = {
            ...resource,
            links: customLinks.length ? customLinks : fresh.links,
            downloads: customDownloads.length ? customDownloads : fresh.downloads,
            description: hasLocalDescription ? resource.description : fresh.description || resource.description,
            descriptionSource: hasLocalDescription ? resource.descriptionSource : fresh.descriptionSource,
            poster: resource.poster || fresh.poster,
            rating: hasCustomRating ? resource.rating : fresh.rating ?? resource.rating,
            ratingCount: hasCustomRating ? resource.ratingCount : fresh.ratingCount || resource.ratingCount,
            ratingSource: hasCustomRating ? resource.ratingSource : fresh.ratingSource || resource.ratingSource,
            doubanId: resource.doubanId || fresh.doubanId
          };
        }
        stored = { version: 2, custom, overrides, deleted: [] };
      } else if (parsed && parsed.version === 2) {
        stored = parsed;
      } else {
        return builtinResources;
      }
      const custom = (Array.isArray(stored.custom) ? stored.custom : [])
        .map((item) => normalizeResource(item, { links: normalizeSimpleLinks(item.links) })).filter(Boolean);
      const overrides = stored.overrides && typeof stored.overrides === "object" ? stored.overrides : {};
      deletedBuiltinIds = new Set(Array.isArray(stored.deleted) ? stored.deleted : []);
      const merged = builtinResources
        .filter((resource) => !deletedBuiltinIds.has(resource.id))
        .map((resource) => {
          const override = overrides[resource.id];
          if (!override) return copyResource(resource);
          const links = mergeLinkLists(resource.links, override.links);
          const downloads = mergeLinkLists(resource.downloads, override.downloads);
          const merged = normalizeResource(
            { ...resource, ...override, links, downloads, downloadNotice: override.downloadNotice || resource.downloadNotice },
            { links, downloads }
          );
          return merged;
        });
      localStorage.setItem(catalogMigrationKey, "2");
      localStorage.setItem(storageKey, JSON.stringify(stored));
      return [...custom, ...merged];
    } catch (error) {
      return builtinResources.map(copyResource);
    }
  }

  function saveResources() {
    try {
      const custom = [];
      const overrides = {};
      for (const resource of resources) {
        const fresh = builtinById.get(resource.id);
        if (!fresh) {
          custom.push(resource);
        } else if (JSON.stringify(resource) !== JSON.stringify(fresh)) {
          overrides[resource.id] = resource;
        }
      }
      localStorage.setItem(storageKey, JSON.stringify({
        version: 2,
        custom,
        overrides,
        deleted: [...deletedBuiltinIds]
      }));
      localStorage.setItem(catalogMigrationKey, "2");
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

  function renderSourceFilter() {
    const sources = [...new Set(resources.map((resource) => resource.source).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    if (state.source !== "all" && !sources.includes(state.source)) state.source = "all";
    elements.sourceFilter.innerHTML = `<option value="all">全部来源</option>${sources.map((source) =>
      `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`
    ).join("")}`;
    elements.sourceFilter.value = state.source;
  }

  function filteredResources() {
    const query = clean(state.query).toLocaleLowerCase("zh-CN");
    const result = resources.filter((resource) => {
      if (state.type !== "all" && resource.type !== state.type) return false;
      if (state.source !== "all" && resource.source !== state.source) return false;
      if (state.favoritesOnly && !resource.favorite) return false;
      if (!query) return true;
      const haystack = [
        resource.title,
        resource.titleEn,
        resource.type,
        resource.description,
        resource.source,
        ...resource.tags,
        ...resource.links.flatMap((link) => [link.label, link.url]),
        ...resource.downloads.flatMap((link) => [link.label, link.url])
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
    const nextRenderKey = `${state.query}\n${state.type}\n${state.source}\n${state.sort}\n${state.favoritesOnly}`;
    if (nextRenderKey !== renderKey) {
      state.limit = pageSize;
      renderKey = nextRenderKey;
    }
    renderTypeFilter();
    renderSourceFilter();
    renderStats();
    const list = filteredResources();
    const visible = list.slice(0, state.limit);
    elements.summary.textContent = `显示 ${visible.length} / ${resources.length} 条资源`;
    elements.clearSearch.hidden = !state.query;
    elements.reset.hidden = !state.query && state.type === "all" && state.source === "all" && !state.favoritesOnly;
    elements.favoriteFilter.setAttribute("aria-pressed", String(state.favoritesOnly));
    elements.grid.innerHTML = visible.map((resource, index) => {
      const hasPoster = Boolean(resource.poster);
      const poster = posterThumb(resource.poster);
      const eager = index < 6;
      return `<article class="resource-card">
        <button class="resource-case" type="button" data-open="${escapeHtml(resource.id)}" aria-label="查看《${escapeHtml(resource.title)}》详情">
          <div class="resource-cover">
            ${hasPoster ? `<img src="${escapeHtml(poster)}" alt="《${escapeHtml(resource.title)}》海报" width="400" height="600" loading="${eager ? "eager" : "lazy"}" ${eager && index < 2 ? 'fetchpriority="high"' : ""} decoding="async" referrerpolicy="no-referrer">` : ""}
            <div class="resource-typographic" ${hasPoster ? "hidden" : ""}>${escapeHtml(resource.title)}</div>
            <span class="resource-spine">${escapeHtml(resource.type)}</span>
            ${resource.rating ? `<span class="resource-rating">${escapeHtml(resource.ratingSource || "评分")} ${resource.rating.toFixed(1)}</span>` : ""}
            <span class="resource-type">${escapeHtml(resource.type)}</span>
          </div>
        </button>
        <button class="card-favorite" type="button" data-favorite="${escapeHtml(resource.id)}" aria-pressed="${resource.favorite}" aria-label="${resource.favorite ? "取消收藏" : "收藏"}《${escapeHtml(resource.title)}》">
          <svg class="icon"><use href="#icon-heart"></use></svg>
        </button>
        <div class="resource-card-copy">
          <h3>${escapeHtml(resource.title)}</h3>
          <p>${escapeHtml(resource.description || resource.titleEn || "暂无简介")}</p>
          <div class="resource-card-meta"><span>${escapeHtml(resource.source)}</span><span>${resource.downloads.length ? `${resource.downloads.length} 个下载` : `${resource.links.length} 个链接`}</span></div>
        </div>
      </article>`;
    }).join("");
    hydratePosterImages();
    elements.loadMore.hidden = list.length <= state.limit;
    elements.loadMore.textContent = `加载更多（还有 ${Math.max(0, list.length - state.limit)} 条）`;
    elements.empty.hidden = list.length !== 0;
    if (!resources.length) {
      elements.emptyMessage.textContent = "新增一条资源，或从电影书架导入影片。";
    } else if (!list.length) {
      elements.emptyMessage.textContent = "没有符合当前筛选条件的资源，换个关键词或清除筛选试试。";
    }
  }

  function hydratePosterImages() {
    for (const image of elements.grid.querySelectorAll("img")) {
      const reveal = () => image.classList.add("is-loaded");
      const fallback = () => {
        image.hidden = true;
        const typographic = image.parentElement.querySelector(".resource-typographic");
        if (typographic) typographic.hidden = false;
      };
      image.addEventListener("load", reveal, { once: true });
      image.addEventListener("error", fallback, { once: true });
      if (image.complete) {
        if (image.naturalWidth > 0) reveal();
        else fallback();
      }
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
    elements.fieldRating.value = resource?.rating ?? "";
    elements.fieldRatingSource.value = resource?.ratingSource || "";
    elements.fieldSource.value = resource?.source || "";
    elements.fieldTags.value = resource?.tags.join(", ") || "";
    elements.fieldFavorite.checked = resource?.favorite || false;
    const editorLinks = [...(resource?.links || []), ...(resource?.downloads || []).map((link) => ({ ...link, kind: "download" }))];
    if (editorLinks.length) {
      for (const link of editorLinks) addLinkRow(link.label, link.url, link.kind);
    } else {
      addLinkRow();
    }
    if (elements.detail.open) closeDialog(elements.detail);
    elements.editor.showModal();
    syncBodyLock();
    setTimeout(() => elements.fieldTitle.focus(), 30);
  }

  function addLinkRow(label = "", url = "", kind = "link") {
    const row = document.createElement("div");
    row.className = "link-row";
    row.innerHTML = `
      <select class="link-kind" aria-label="链接类型">
        <option value="link"${kind === "link" ? " selected" : ""}>资料/在线</option>
        <option value="download"${kind === "download" ? " selected" : ""}>下载</option>
      </select>
      <input class="link-label" type="text" maxlength="80" placeholder="链接名称" aria-label="链接名称" value="${escapeHtml(label)}">
      <input class="link-url" type="url" maxlength="1200" placeholder="https://…" aria-label="链接地址" value="${escapeHtml(url)}">
      <button class="secondary-button link-remove" type="button" aria-label="删除这条链接"><svg class="icon"><use href="#icon-trash"></use></svg></button>`;
    elements.linkRows.append(row);
    return row;
  }

  function readEditorLinks() {
    const links = [];
    const downloads = [];
    for (const row of elements.linkRows.querySelectorAll(".link-row")) {
      const label = clean(row.querySelector(".link-label").value);
      const rawUrl = clean(row.querySelector(".link-url").value);
      if (!label && !rawUrl) continue;
      const url = safeHttpUrl(rawUrl);
      if (!url) throw new Error(`链接地址无效：${rawUrl || "（空）"}`);
      const link = { label: label || linkLabel(url), url };
      if (row.querySelector(".link-kind").value === "download") downloads.push(link);
      else links.push(link);
    }
    return { links, downloads };
  }

  function saveEditor(event) {
    event.preventDefault();
    elements.formError.hidden = true;
    try {
      const title = clean(elements.fieldTitle.value);
      if (!title) throw new Error("请填写片名或资源名。");
      const { links, downloads } = readEditorLinks();
      const now = new Date().toISOString();
      const existing = editingId ? resources.find((item) => item.id === editingId) : null;
      const description = clean(elements.fieldDescription.value);
      const rawRating = Number(elements.fieldRating.value);
      const rating = Number.isFinite(rawRating) && rawRating > 0 ? Math.min(10, rawRating) : null;
      const resource = normalizeResource({
        id: existing?.id || uid(),
        title,
        titleEn: elements.fieldTitleEn.value,
        type: elements.fieldType.value,
        description,
        descriptionSource: description === existing?.description ? existing?.descriptionSource || "" : "本地编辑",
        poster: elements.fieldPoster.value,
        source: elements.fieldSource.value,
        tags: elements.fieldTags.value,
        favorite: elements.fieldFavorite.checked,
        rating,
        ratingCount: existing?.ratingCount || 0,
        ratingSource: elements.fieldRatingSource.value || (rating ? "评分" : ""),
        doubanId: existing?.doubanId || "",
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        origin: existing?.origin || "本地整理"
      }, { links, downloads });
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

  function applyDoubanCache(resource, force = false) {
    const cached = resource.doubanId ? doubanCache[resource.doubanId] : null;
    if (!cached) return false;
    let changed = false;
    const intro = clean(cached.intro);
    if (intro && (force ? resource.descriptionSource !== "本地编辑" : !resource.description || resource.descriptionSource === "豆瓣")) {
      resource.description = intro;
      resource.descriptionSource = "豆瓣";
      changed = true;
    }
    const rating = Number(cached.rating);
    if (Number.isFinite(rating) && rating > 0 && (!resource.rating || resource.ratingSource === "豆瓣")) {
      resource.rating = Math.min(10, rating);
      resource.ratingCount = Math.max(0, Number(cached.ratingCount) || 0);
      resource.ratingSource = "豆瓣";
      changed = true;
    }
    return changed;
  }

  function saveDoubanCache() {
    try {
      localStorage.setItem(doubanCacheKey, JSON.stringify(doubanCache));
    } catch {
      return;
    }
  }

  function loadDoubanDetail(resource) {
    const subjectId = clean(resource.doubanId);
    if (!/^\d+$/.test(subjectId)) return;
    const cached = doubanCache[subjectId];
    if (cached) {
      if (applyDoubanCache(resource, resource.descriptionSource !== "本地编辑")) {
        saveResources();
        render();
      }
      return;
    }
    if (doubanRequests.has(subjectId) || (resource.descriptionSource === "本地编辑" && resource.ratingSource !== "豆瓣")) return;
    doubanRequests.add(subjectId);
    const callbackName = `dykDouban_${subjectId}_${Date.now().toString(36)}`;
    const script = document.createElement("script");
    const finishRequest = () => {
      clearTimeout(timer);
      doubanRequests.delete(subjectId);
      script.remove();
    };
    const timer = setTimeout(() => {
      doubanRequests.delete(subjectId);
      script.remove();
    }, 30000);
    window[callbackName] = (payload) => {
      finishRequest();
      delete window[callbackName];
      if (!payload || typeof payload !== "object") return;
      const intro = clean(payload.intro);
      const rating = Number(payload.rating?.value);
      const ratingCount = Math.max(0, Number(payload.rating?.count) || 0);
      if (!intro && !(Number.isFinite(rating) && rating > 0)) return;
      doubanCache[subjectId] = { intro, rating, ratingCount, updatedAt: new Date().toISOString() };
      saveDoubanCache();
      for (const item of resources) {
        if (item.doubanId === subjectId) applyDoubanCache(item, true);
      }
      saveResources();
      if (activeId === resource.id && elements.detail.open) renderDetail(resource.id);
      else render();
    };
    script.onerror = () => {
      finishRequest();
      delete window[callbackName];
    };
    script.src = `https://m.douban.com/rexxar/api/v2/subject/${subjectId}?callback=${callbackName}&referer=${encodeURIComponent(`https://m.douban.com/movie/subject/${subjectId}/`)}`;
    document.head.append(script);
  }

  function renderDetail(id) {
    const resource = resources.find((item) => item.id === id);
    if (!resource) return;
    if (applyDoubanCache(resource)) saveResources();
    activeId = id;
    const hasPoster = Boolean(resource.poster);
    elements.detailImage.hidden = !hasPoster;
    elements.detailTypographic.hidden = hasPoster;
    elements.detailImage.alt = hasPoster ? `《${resource.title}》海报` : "";
    if (hasPoster) {
      const fullSrc = resource.poster;
      const thumbSrc = posterThumb(fullSrc);
      elements.detailImage.dataset.fullSrc = fullSrc;
      elements.detailImage.src = thumbSrc;
      if (thumbSrc !== fullSrc) {
        const preload = new Image();
        preload.decoding = "async";
        preload.onload = () => {
          if (activeId === id && elements.detail.open) elements.detailImage.src = fullSrc;
        };
        preload.src = fullSrc;
      }
    } else {
      elements.detailImage.removeAttribute("data-full-src");
      elements.detailImage.removeAttribute("src");
    }
    elements.detailTypographic.textContent = resource.title;
    elements.detailSource.textContent = resource.source;
    elements.detailTitle.textContent = resource.title;
    elements.detailRating.hidden = !resource.rating;
    elements.detailRatingValue.textContent = resource.rating ? resource.rating.toFixed(1) : "";
    elements.detailRatingLabel.textContent = resource.ratingSource || "评分";
    elements.detailRatingCount.textContent = resource.ratingCount ? `${resource.ratingCount.toLocaleString("zh-CN")} 人评分` : "";
    elements.detailMeta.textContent = [resource.titleEn, resource.type, `更新于 ${formatDate(resource.updatedAt)}`].filter(Boolean).join(" · ");
    elements.detailTags.innerHTML = resource.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
    elements.detailDescription.textContent = resource.description || "暂无简介。";
    elements.detailLinksSection.hidden = resource.links.length === 0;
    elements.detailEmptyLinks.hidden = resource.links.length !== 0;
    elements.detailLinks.innerHTML = resource.links.map((link) =>
      `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer"><span>${escapeHtml(link.label)}</span><svg class="icon"><use href="#icon-arrow"></use></svg></a>`
    ).join("");
    elements.detailDownloadsSection.hidden = false;
    elements.detailDownloadsEmpty.hidden = resource.downloads.length !== 0;
    elements.detailDownloadsNote.hidden = !resource.downloadNotice;
    elements.detailDownloadsNote.textContent = resource.downloadNotice || "";
    elements.detailDownloads.innerHTML = resource.downloads.map((link) =>
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
    loadDoubanDetail(resources.find((item) => item.id === id));
  }

  function deleteResource(id) {
    const resource = resources.find((item) => item.id === id);
    if (!resource) return;
    if (!window.confirm(`确定删除《${resource.title}》吗？此操作只影响当前浏览器的资源库。`)) return;
    resources = resources.filter((item) => item.id !== id);
    if (builtinById.has(id)) deletedBuiltinIds.add(id);
    if (!saveResources()) return;
    if (elements.detail.open) closeDialog(elements.detail);
    activeId = null;
    render();
    showToast("资源已删除。");
  }

  function mergeResources(incoming, options = {}) {
    const byId = new Map(resources.map((resource) => [resource.id, resource]));
    const overwrite = options.overwrite !== false;
    let added = 0;
    let updated = 0;
    for (const resource of incoming) {
      const existing = byId.get(resource.id);
      if (existing) {
        deletedBuiltinIds.delete(resource.id);
        if (!overwrite) continue;
        byId.set(resource.id, { ...resource, createdAt: existing.createdAt || resource.createdAt, updatedAt: new Date().toISOString() });
        updated++;
      } else {
        deletedBuiltinIds.delete(resource.id);
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
      showToast("电影书架影片已经在资源库里了。");
      return;
    }
    resources = [...fresh, ...resources];
    for (const resource of fresh) deletedBuiltinIds.delete(resource.id);
    saveResources();
    render();
    showToast(`已从电影书架导入 ${fresh.length} 部影片。`);
  }

  function extractResourceArray(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    for (const key of ["resources", "items", "data", "list", "results", "movies"]) {
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
      description: item.description || item.overview || item.synopsis || item.intro,
      poster,
      source: "GoComicMosaic",
      tags: item.tags,
      links: normalizeExternalLinks(item.links, base),
      downloads: normalizeExternalLinks(item.downloads || item.download_url || item.downloadUrl || item.download_links, base),
      rating: item.rating ?? item.vote_average ?? item.score,
      ratingCount: item.ratingCount ?? item.rating_count ?? item.vote_count,
      ratingSource: item.ratingSource || item.rating_source || (item.douban_rating ? "豆瓣" : item.vote_average ? "TMDB" : item.rating || item.score ? "评分" : ""),
      doubanId: item.doubanId || item.douban_id,
      origin: "GoComicMosaic"
    });
  }

  function genericResource(item, endpoint, sourceName) {
    if (!item || typeof item !== "object") return null;
    const base = new URL(endpoint);
    const title = clean(item.title || item.name || item.Title || item.movie_name || item.film || item["片名"] || item["名称"]);
    if (!title) return null;
    const year = (clean(item.year || item.release_year || item.releaseDate || item.release_date || item.Year).match(/\d{4}/) || [""])[0];
    const rawGenres = item.genres || item.genre || item.categories || item.category || item.type || item["类型"];
    const genres = (Array.isArray(rawGenres) ? rawGenres : String(rawGenres || "").split(/[,，/|]/))
      .map((genre) => clean(typeof genre === "object" ? genre?.name : genre))
      .filter(Boolean);
    const description = clean(item.overview || item.description || item.plot || item.synopsis || item.intro || item.summary || item.full_description || item["简介"] || item["剧情简介"]);
    let rawPoster = item.poster || item.poster_path || item.cover || item.image || item.img || item["海报"] || "";
    if (Array.isArray(rawPoster)) rawPoster = rawPoster[0] || "";
    if (typeof rawPoster === "string" && rawPoster.startsWith("/")) {
      rawPoster = `https://image.tmdb.org/t/p/w500${rawPoster}`;
    }
    const poster = rawPoster ? safeHttpUrl(rawPoster, base) : "";
    const linkValue = item.watchUrl || item.watch_url || item.url || item.link || item.playUrl || item.play_url || item.links;
    const links = normalizeExternalLinks(linkValue, base);
    const id = `gh-${hashText(`${sourceName}\n${title}\n${year}`)}`;
    return normalizeResource({
      id,
      title,
      titleEn: item.original_title || item.originalTitle || item.title_en || item.titleEn,
      type: genres[0] || "电影",
      description,
      poster,
      source: sourceName,
      tags: [...genres, year].filter(Boolean),
      links,
      downloads: normalizeExternalLinks(item.downloads || item.download_url || item.downloadUrl || item.download_links || item.downloadLinks, base),
      rating: item.rating ?? item.score ?? item.vote_average ?? item.douban_rating,
      ratingCount: item.ratingCount ?? item.rating_count ?? item.vote_count,
      ratingSource: item.ratingSource || item.rating_source || (item.douban_rating ? "豆瓣" : item.vote_average ? "TMDB" : item.rating || item.score ? "评分" : ""),
      doubanId: item.doubanId || item.douban_id,
      origin: sourceName
    });
  }

  function normalizeGithubDataUrl(value) {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.hostname === "github.com" && parts[2] === "blob" && parts.length > 4) {
      url.hostname = "raw.githubusercontent.com";
      url.pathname = `/${parts[0]}/${parts[1]}/${parts.slice(3).join("/")}`;
    }
    return url.href;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (character === '"') {
          quoted = false;
        } else {
          field += character;
        }
      } else if (character === '"') {
        quoted = true;
      } else if (character === ",") {
        row.push(field);
        field = "";
      } else if (character === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (character !== "\r") {
        field += character;
      }
    }
    if (field || row.length) {
      row.push(field);
      rows.push(row);
    }
    const headers = (rows.shift() || []).map(clean);
    return rows.filter((values) => values.some((value) => clean(value))).map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]))
    );
  }

  function decodeBase64Utf8(value) {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async function importFromGithub(event) {
    event.preventDefault();
    const rawEndpoint = safeHttpUrl(elements.githubUrl.value);
    const endpoint = rawEndpoint ? normalizeGithubDataUrl(rawEndpoint) : "";
    const sourceName = clean(elements.githubSource.value) || "GitHub 公开数据";
    elements.githubStatus.classList.remove("is-error");
    if (!endpoint) {
      elements.githubStatus.textContent = "请填写有效的 http 或 https 数据地址。";
      elements.githubStatus.classList.add("is-error");
      return;
    }
    elements.githubSubmit.disabled = true;
    elements.githubStatus.textContent = "正在读取 GitHub 公开数据…";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json, text/csv, text/plain" },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`地址返回 HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") || "";
      let items;
      if (contentType.includes("csv") || /\.csv(?:$|\?)/i.test(endpoint)) {
        items = parseCsv(await response.text());
      } else {
        if (!contentType.includes("json")) throw new Error("地址返回的不是 JSON 或 CSV，请使用 raw 文件地址或数据接口。");
        let payload = await response.json();
        if (payload?.encoding === "base64" && typeof payload.content === "string") {
          const decoded = decodeBase64Utf8(payload.content);
          try {
            payload = JSON.parse(decoded);
          } catch {
            items = parseCsv(decoded);
          }
        }
        if (!items) items = extractResourceArray(payload);
      }
      if (!items.length) throw new Error("没有读到可导入的资源数组。");
      const incoming = items.map((item) => genericResource(item, endpoint, sourceName)).filter(Boolean);
      if (!incoming.length) throw new Error("返回的数据里没有有效片名。");
      const result = mergeResources(incoming, { overwrite: elements.githubUpdate.checked });
      elements.githubStatus.textContent = `导入完成：新增 ${result.added} 条，更新 ${result.updated} 条，跳过 ${incoming.length - result.added - result.updated} 条。`;
      showToast(`已从 ${sourceName} 导入 ${incoming.length} 条资源。`);
      setTimeout(() => closeDialog(elements.github), 900);
    } catch (error) {
      elements.githubStatus.textContent = error.name === "AbortError" ? "读取超时，请稍后重试。" : error.message;
      elements.githubStatus.classList.add("is-error");
    } finally {
      clearTimeout(timer);
      elements.githubSubmit.disabled = false;
    }
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

  async function exportJson() {
    await loadExtraCatalog();
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
    state.source = "all";
    state.favoritesOnly = false;
    elements.search.value = "";
    render();
  }

  elements.search.addEventListener("input", () => {
    loadExtraCatalog();
    state.query = elements.search.value;
    render();
  });
  elements.clearSearch.addEventListener("click", () => {
    state.query = "";
    elements.search.value = "";
    elements.search.focus();
    render();
  });
  elements.typeFilter.addEventListener("focus", loadExtraCatalog);
  elements.sourceFilter.addEventListener("focus", loadExtraCatalog);
  elements.typeFilter.addEventListener("change", () => {
    loadExtraCatalog();
    state.type = elements.typeFilter.value;
    render();
  });
  elements.sourceFilter.addEventListener("change", () => {
    loadExtraCatalog();
    state.source = elements.sourceFilter.value;
    render();
  });
  elements.sort.addEventListener("change", () => {
    loadExtraCatalog();
    state.sort = elements.sort.value;
    render();
  });
  elements.favoriteFilter.addEventListener("click", () => {
    loadExtraCatalog();
    state.favoritesOnly = !state.favoritesOnly;
    render();
  });
  elements.reset.addEventListener("click", resetFilters);
  elements.loadMore.addEventListener("click", async () => {
    const expandCatalog = state.limit + pageSize * 3 >= filteredResources().length && nextCatalogIndex < 8;
    if (expandCatalog) await loadExtraCatalog();
    state.limit += expandCatalog ? pageSize * 4 : pageSize;
    render();
  });
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
      rows[0].querySelector(".link-kind").value = "link";
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
  document.getElementById("open-github-import").addEventListener("click", () => {
    elements.githubStatus.textContent = "";
    elements.githubStatus.classList.remove("is-error");
    elements.github.showModal();
    syncBodyLock();
  });
  document.getElementById("open-tvbox-sources").addEventListener("click", () => {
    document.getElementById("sources").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  window.addEventListener("dyk:save-resource", (event) => {
    const resource = event.detail;
    if (!resource?.title) return;
    const result = mergeResources([normalizeResource(resource, { links: normalizeSimpleLinks(resource.links) })].filter(Boolean));
    showToast(`已保存到资源库：${result.added ? "新增" : "更新"} ${result.added + result.updated} 条。`);
  });
  document.getElementById("github-close").addEventListener("click", () => closeDialog(elements.github));
  document.getElementById("github-cancel").addEventListener("click", () => closeDialog(elements.github));
  elements.githubForm.addEventListener("submit", importFromGithub);

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

  for (const dialog of [elements.editor, elements.detail, elements.api, elements.github]) {
    dialog.addEventListener("close", syncBodyLock);
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) closeDialog(dialog);
    });
  }

  resources = loadResources();
  let cachedResourcesChanged = false;
  for (const resource of resources) {
    if (applyDoubanCache(resource, resource.origin === "电影书架")) cachedResourcesChanged = true;
  }
  if (cachedResourcesChanged) saveResources();
  render();

  function refreshExtraCatalog() {
    resources = loadResources();
    let changed = false;
    for (const resource of resources) {
      if (applyDoubanCache(resource, resource.origin === "电影书架")) changed = true;
    }
    if (changed) saveResources();
    render();
  }

  function loadCatalogChunk(index, attempt = 0) {
    return new Promise((resolve) => {
      const before = window.EXTRA_RESOURCES.length;
      const script = document.createElement("script");
      script.src = `catalog-${index}.js?v=20261127z${attempt ? `&retry=${attempt}` : ""}`;
      let settled = false;
      let handedOff = false;
      let retryTimer = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(retryTimer);
        resolve();
      };
      const retry = () => {
        if (settled || handedOff) return;
        if (attempt < 2) {
          handedOff = true;
          loadCatalogChunk(index, attempt + 1).then(finish);
        } else {
          if (!window.__dykCatalogErrorShown) {
            window.__dykCatalogErrorShown = true;
            showToast("部分资源加载失败，请刷新页面重试。", true);
          }
          finish();
        }
      };
      const fail = () => {
        if (settled) return;
        script.remove();
        if (!handedOff) retry();
      };
      if (attempt < 2) retryTimer = window.setTimeout(retry, 12000);
      script.onload = () => {
        if (settled) return;
        if (window.EXTRA_RESOURCES.length === before) fail();
        else finish();
      };
      script.onerror = fail;
      document.head.appendChild(script);
    });
  }

  function loadNextCatalog() {
    if (nextCatalogIndex >= 8) return Promise.resolve();
    return loadCatalogChunk(nextCatalogIndex++);
  }

  async function loadExtraCatalog() {
    if (!Array.isArray(window.EXTRA_RESOURCES)) window.EXTRA_RESOURCES = [];
    if (nextCatalogIndex >= 8) return;
    if (!catalogTask) {
      catalogTask = (async () => {
        async function worker() {
          while (nextCatalogIndex < 8) await loadNextCatalog();
        }
        await Promise.all(Array.from({ length: 4 }, worker));
        refreshExtraCatalog();
      })().finally(() => {
        catalogTask = null;
      });
    }
    await catalogTask;
  }
})();
