/* TVBox Desktop 协议兼容：MIT License，Copyright (c) 2026 hgtuj5688 */
(() => {
  "use strict";

  const STORAGE_KEY = "dyk-tvbox-sources-v1";
  const VERSION = "20261127y";
  const ALLOWED_SITE_TYPES = new Set([1, 3, 4]);
  const TYPE_LABELS = { 0: "Spider / Jar", 1: "网页规则", 2: "未知", 3: "苹果 CMS", 4: "JSON 接口" };
  const PRESET = {
    id: "builtin-public-cms",
    name: "公开可用源（苹果CMS 采集站）",
    url: "builtin://public-cms",
    kind: "builtin",
    enabled: true,
    raw: {
      format: "tvbox-desktop/1",
      name: "公开可用源（苹果CMS 采集站）",
      note: "来自 TVBox Desktop 的公开订阅，包含 5 个苹果 CMS 接口与 1 个直播源。",
      sites: [
        { key: "ffzy", name: "非凡资源", type: "cms", api: "https://api.ffzyapi.com/api.php/provide/vod", searchable: 1 },
        { key: "lzi", name: "量子资源", type: "cms", api: "https://cj.lziapi.com/api.php/provide/vod", searchable: 1 },
        { key: "dyttzy", name: "电影天堂资源", type: "cms", api: "https://caiji.dyttzyapi.com/api.php/provide/vod", searchable: 1 },
        { key: "guangsu", name: "光速资源", type: "cms", api: "https://api.guangsuapi.com/api.php/provide/vod", searchable: 1 },
        { key: "subo", name: "素博资源", type: "cms", api: "https://subocaiji.com/api.php/provide/vod", searchable: 1 }
      ],
      lives: [
        { name: "公开直播源·IPv4（txt）", type: 0, url: "https://live.zbds.top/tv/iptv4.txt" }
      ]
    }
  };

  const state = {
    configs: [],
    searchToken: 0,
    searchResults: [],
    searchSites: [],
    searchDone: 0,
    categorySiteKey: "",
    categoryClasses: [],
    liveChannels: [],
    liveGroups: [],
    activeLine: 0,
    detailItem: null,
    detailSite: null,
    hls: null
  };

  const elements = {};
  const resultCache = new Map();

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function uid(prefix = "tvbox") {
    const random = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}-${random}`;
  }

  function hashText(value) {
    let hash = 0x811c9dc5;
    for (const character of String(value)) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 0x01000193);
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

  function hostOf(value) {
    try {
      return new URL(value).hostname.replace(/^www\./, "");
    } catch {
      return clean(value);
    }
  }

  function toast(message, isError = false) {
    const node = document.getElementById("toast");
    if (!node) return;
    node.textContent = message;
    node.style.borderColor = isError ? "rgba(228, 139, 125, 0.45)" : "";
    node.style.color = isError ? "var(--danger)" : "";
    node.classList.add("is-visible");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove("is-visible"), 3600);
  }

  function saveConfigs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, configs: state.configs }));
      return true;
    } catch {
      toast("源配置保存失败，浏览器存储空间可能不足。", true);
      return false;
    }
  }

  function loadConfigs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) {
        state.configs = [{ ...PRESET, lastSync: 0, siteCount: PRESET.raw.sites.length, liveCount: PRESET.raw.lives.length }];
        saveConfigs();
        return;
      }
      const parsed = JSON.parse(raw);
      state.configs = Array.isArray(parsed?.configs) ? parsed.configs : [];
    } catch {
      state.configs = [];
    }
  }

  function normalizeApi(value) {
    const api = clean(value);
    if (!api) return "";
    if (/^https?:\/\//i.test(api)) return api;
    if (/^[\w.-]+\.[a-z]{2,}/i.test(api)) return `https://${api}`;
    return api;
  }

  function normalizeType(raw, api, rules) {
    if (typeof raw === "number" && [0, 1, 2, 3, 4].includes(raw)) return raw;
    if (typeof raw === "string") {
      const key = raw.trim().toLowerCase();
      const map = { cms: 3, maccms: 3, apple: 3, apples: 3, "苹果cms": 3, api: 4, json: 4, html: 1, web: 1, rule: 1, rules: 1, page: 1, spider: 0, jar: 0, aggregate: 0, other: 2 };
      if (map[key] !== undefined) return map[key];
      const number = Number(key);
      if (Number.isInteger(number) && number >= 0 && number <= 4) return number;
      return 2;
    }
    if (rules && (rules.list || rules.search)) return 1;
    if (/provide\/vod|api\.php|\/vod\//i.test(api)) return 3;
    return api ? 4 : 2;
  }

  function flag(value, fallback = false) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === "boolean") return value;
    const number = Number(value);
    if (!Number.isNaN(number)) return number !== 0;
    return ["true", "yes", "1"].includes(String(value).toLowerCase());
  }

  function normalizeRules(raw) {
    if (!raw || typeof raw !== "object") return undefined;
    const pick = (...keys) => {
      for (const key of keys) {
        if (typeof raw[key] === "string" && raw[key].trim()) return raw[key].trim();
      }
      return "";
    };
    const rules = {
      list: pick("list", "vodList", "listRule"),
      name: pick("name", "vodName", "title"),
      link: pick("link", "vodLink", "href"),
      pic: pick("pic", "vodPic", "image"),
      remarks: pick("remarks", "vodRemarks", "note"),
      search: pick("search", "searchUrl"),
      detailName: pick("detailName"),
      detailContent: pick("detailContent", "content"),
      playList: pick("playList", "playFrom"),
      playItem: pick("playItem", "playUrl")
    };
    return Object.values(rules).some(Boolean) ? rules : undefined;
  }

  function normalizeSite(input, config) {
    if (!input || typeof input !== "object") return null;
    const name = clean(input.name ?? input.title);
    const api = normalizeApi(input.api ?? input.url ?? input.ext?.api);
    if (!name && !api) return null;
    const rules = normalizeRules(input.rules ?? input.ext?.rules);
    const type = normalizeType(input.type, api, rules);
    const key = clean(input.key ?? input.id) || `csp_${hashText(`${name}|${api}`)}`;
    const site = {
      key,
      name: name || key,
      type,
      api,
      rules,
      searchable: flag(input.searchable, true),
      enabled: flag(input.enabled, true),
      header: input.header && typeof input.header === "object" ? input.header : {},
      sourceId: config.id,
      sourceName: config.name
    };
    if (!site.api || !/^https?:\/\//i.test(site.api)) site.unsupported = "该源依赖本地文件、Spider 或内置协议，网页无法直接请求";
    else if (type === 0) site.unsupported = "该源需要 Jar / Spider，网页无法运行";
    else if (type === 2) site.unsupported = "未知源类型，暂不支持";
    else if (!ALLOWED_SITE_TYPES.has(type)) site.unsupported = "该源类型暂不支持";
    if (site.unsupported) site.searchable = false;
    return site;
  }

  function normalizeLives(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => {
      if (typeof item === "string") return { name: "直播源", type: 0, url: item };
      if (!item || typeof item !== "object") return null;
      const url = clean(item.url);
      if (!url) return null;
      return { name: clean(item.name) || "直播源", type: item.type ?? 0, url, epg: clean(item.epg) };
    }).filter(Boolean);
  }

  function addConfig(input) {
    const raw = input.raw;
    const sites = Array.isArray(raw?.sites) ? raw.sites : [];
    const lives = normalizeLives(raw?.lives);
    const config = {
      id: input.id || uid("subscription"),
      name: clean(input.name || raw?.name || "未命名订阅"),
      url: clean(input.url || ""),
      kind: input.kind || "url",
      enabled: input.enabled !== false,
      raw,
      lastSync: Date.now(),
      siteCount: sites.length,
      liveCount: lives.length,
      error: ""
    };
    state.configs.push(config);
    saveConfigs();
    renderSources();
    return config;
  }

  function getSites() {
    const seen = new Set();
    const sites = [];
    for (const config of state.configs) {
      if (!config.enabled) continue;
      for (const item of Array.isArray(config.raw?.sites) ? config.raw.sites : []) {
        const site = normalizeSite(item, config);
        if (!site || seen.has(site.key)) continue;
        seen.add(site.key);
        sites.push(site);
      }
    }
    return sites;
  }

  function getLives() {
    const seen = new Set();
    const lives = [];
    for (const config of state.configs) {
      if (!config.enabled) continue;
      for (const live of normalizeLives(config.raw?.lives)) {
        if (seen.has(live.url)) continue;
        seen.add(live.url);
        lives.push({ ...live, sourceName: config.name });
      }
    }
    return lives;
  }

  async function fetchText(url, timeout = 15000) {
    const target = safeHttpUrl(url);
    if (!target) throw new Error("地址不是有效的 HTTP(S) 链接");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(target, {
        signal: controller.signal,
        headers: { Accept: "application/json, text/plain, */*" },
        redirect: "follow"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchTextWithFallback(url, timeout = 15000) {
    try {
      return await fetchText(url, timeout);
    } catch (directError) {
      const target = safeHttpUrl(url);
      if (!target) throw directError;
      try {
        return await fetchText(`https://proxy.jiuchu.top/proxy?url=${encodeURIComponent(target)}`, timeout + 10000);
      } catch {
        try {
          return await fetchText(`https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`, timeout + 5000);
        } catch {
          throw directError;
        }
      }
    }
  }

  function parseLooseJson(text) {
    const value = clean(text).replace(/^\uFEFF/, "");
    try {
      return JSON.parse(value);
    } catch {
      const start = value.indexOf("{");
      const end = value.lastIndexOf("}");
      if (start >= 0 && end > start) return JSON.parse(value.slice(start, end + 1));
      throw new Error("接口返回的不是 JSON");
    }
  }

  function isCmsOk(payload) {
    if (!payload || typeof payload !== "object") return false;
    if (payload.code === undefined || payload.code === null || payload.code === "") return true;
    return ["1", "true", "ok", "success", "200"].includes(String(payload.code).toLowerCase());
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    return value && typeof value === "object" ? [value] : [];
  }

  function buildCmsUrl(site, query) {
    let url = site.api || "";
    const placeholders = [
      ["ac", /\{ac\}/g], ["wd", /\{(wd|kw|key|keyword)\}/g], ["pg", /\{(pg|page)\}/g],
      ["t", /\{(t|type|typeid|class)\}/g], ["ids", /\{(ids|id)\}/g]
    ];
    let templated = false;
    for (const [key, regex] of placeholders) {
      if (regex.test(url)) {
        templated = true;
        url = url.replace(regex, query[key] === undefined ? "" : encodeURIComponent(String(query[key])));
      }
    }
    if (templated) {
      url = url.replace(/\{h\}/g, String(query.h ?? ""));
      if (query.ids !== undefined && !/[?&]ids=/.test(url)) {
        url += `${url.includes("?") ? (url.endsWith("?") || url.endsWith("&") ? "" : "&") : "?"}ids=${encodeURIComponent(String(query.ids))}`;
      }
      return url;
    }
    const params = new URLSearchParams();
    if (query.ac) params.set("ac", query.ac);
    if (query.wd !== undefined) params.set("wd", query.wd);
    if (query.pg !== undefined) params.set("pg", String(query.pg));
    if (query.t !== undefined && query.t !== "") params.set("t", String(query.t));
    if (query.ids !== undefined) params.set("ids", String(query.ids));
    const qs = params.toString();
    if (!qs) return url;
    return `${url}${url.includes("?") ? (url.endsWith("?") || url.endsWith("&") ? "" : "&") : "?"}${qs}`;
  }

  function absolutize(value, base) {
    const text = clean(value);
    if (!text) return "";
    return safeHttpUrl(text, base);
  }

  function cmsItemToVod(raw, site) {
    const str = (value) => clean(value);
    return {
      vod_id: str(raw.vod_id ?? raw.id),
      vod_name: str(raw.vod_name ?? raw.name),
      vod_pic: absolutize(str(raw.vod_pic ?? raw.pic), site.api),
      vod_remarks: str(raw.vod_remarks ?? raw.remarks),
      vod_year: str(raw.vod_year ?? raw.year),
      vod_area: str(raw.vod_area ?? raw.area),
      vod_actor: str(raw.vod_actor ?? raw.actor),
      vod_director: str(raw.vod_director ?? raw.director),
      type_name: str(raw.type_name ?? raw.class),
      vod_score: str(raw.vod_score ?? raw.score),
      siteKey: site.key,
      siteName: site.name
    };
  }

  function parseLines(from, url, note = "") {
    const froms = String(from ?? "").split("$$$");
    const groups = String(url ?? "").split("$$$");
    const notes = String(note ?? "").split("$$$");
    const lines = [];
    groups.forEach((group, index) => {
      const episodes = [];
      for (const segment of group.split("#")) {
        const value = segment.trim();
        if (!value) continue;
        const split = value.indexOf("$");
        const name = split >= 0 ? value.slice(0, split).trim() : "";
        const episodeUrl = split >= 0 ? value.slice(split + 1).trim() : value;
        if (episodeUrl) episodes.push({ name: name || `第${episodes.length + 1}集`, url: episodeUrl, index: episodes.length });
      }
      if (episodes.length) lines.push({ name: clean(froms[index] || notes[index]) || `线路${index + 1}`, episodes });
    });
    return lines;
  }

  function extractText(node, selector, base, attributes = ["Text"]) {
    if (!selector) return "";
    let target;
    try {
      target = node.querySelector(selector);
    } catch {
      return "";
    }
    if (!target) return "";
    for (const attribute of attributes) {
      if (attribute === "Text") {
        const text = clean(target.textContent);
        if (text) return text;
      } else {
        const value = target.getAttribute(attribute);
        if (value) return absolutize(value, base);
      }
    }
    return "";
  }

  async function searchCms(site, keyword) {
    const ac = /\{ac\}/i.test(site.api) ? "videolist" : "detail";
    const payload = parseLooseJson(await fetchTextWithFallback(buildCmsUrl(site, { ac, wd: keyword, pg: 1 })));
    if (!isCmsOk(payload)) throw new Error(clean(payload.msg) || "接口返回异常");
    return asArray(payload.list).slice(0, 30).map((item) => cmsItemToVod(item, site)).filter((item) => item.vod_name && item.vod_id);
  }

  async function searchHtml(site, keyword) {
    const template = clean(site.rules?.search || site.api);
    const target = template.replace(/\{(wd|kw|key|keyword)\}/gi, encodeURIComponent(keyword));
    const html = await fetchTextWithFallback(target);
    const document = new DOMParser().parseFromString(html, "text/html");
    const selector = clean(site.rules?.list);
    if (!selector) throw new Error("网页规则源缺少列表选择器");
    const nodes = [...document.querySelectorAll(selector)].slice(0, 30);
    if (!nodes.length) throw new Error("列表选择器没有匹配到内容");
    return nodes.map((node) => {
      const link = extractText(node, site.rules.link, target, ["href", "Text"]);
      const name = extractText(node, site.rules.name, target, ["Text"]);
      if (!name) return null;
      return {
        vod_id: link || name,
        vod_name: name,
        vod_pic: extractText(node, site.rules.pic, target, ["data-src", "data-original", "src"]),
        vod_remarks: extractText(node, site.rules.remarks, target, ["Text"]),
        vod_year: "", vod_area: "", vod_actor: "", vod_director: "", type_name: "", vod_score: "",
        siteKey: site.key, siteName: site.name
      };
    }).filter(Boolean);
  }

  async function searchSite(site, keyword) {
    const started = Date.now();
    if (site.unsupported) return { site, ok: false, message: site.unsupported, list: [], ms: 0 };
    if (!site.searchable) return { site, ok: false, message: "该源已关闭搜索", list: [], ms: 0 };
    try {
      const list = site.type === 3 || site.type === 4
        ? await searchCms(site, keyword)
        : await searchHtml(site, keyword);
      return { site, ok: true, message: list.length ? `找到 ${list.length} 条` : "没有匹配结果", list, ms: Date.now() - started };
    } catch (error) {
      return { site, ok: false, message: error.message || "请求失败", list: [], ms: Date.now() - started };
    }
  }

  async function runSearch() {
    const keyword = clean(elements.searchInput.value);
    if (!keyword) {
      toast("先输入片名或关键词。", true);
      elements.searchInput.focus();
      return;
    }
    const sites = getSites().filter((site) => site.enabled && site.searchable && !site.unsupported);
    if (!sites.length) {
      toast("没有可搜索的源，请先添加订阅或内置源。", true);
      return;
    }
    const token = ++state.searchToken;
    state.searchResults = [];
    state.searchSites = sites;
    state.searchDone = 0;
    elements.results.hidden = false;
    elements.categoryPanel.hidden = true;
    renderSearchResults();
    let cursor = 0;
    const worker = async () => {
      while (token === state.searchToken) {
        const index = cursor++;
        if (index >= sites.length) return;
        const result = await searchSite(sites[index], keyword);
        if (token !== state.searchToken) return;
        state.searchResults.push(result);
        state.searchDone++;
        renderSearchResults();
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, sites.length) }, worker));
  }

  function renderSearchResults() {
    const total = state.searchSites.length;
    const found = state.searchResults.reduce((sum, result) => sum + result.list.length, 0);
    elements.searchSummary.textContent = state.searchDone < total
      ? `正在搜索 ${state.searchDone} / ${total} 个源，已找到 ${found} 条`
      : `搜索完成：${total} 个源，${found} 条结果`;
    if (!state.searchResults.length) {
      elements.searchGrid.innerHTML = "";
      return;
    }
    elements.searchGrid.innerHTML = state.searchResults.map((result) => {
      const cards = result.list.map((item) => {
        const cacheKey = `${item.siteKey}\n${item.vod_id}`;
        resultCache.set(cacheKey, item);
        const poster = item.vod_pic ? `<img src="${escapeHtml(item.vod_pic)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "";
        return `<button class="tvbox-result-card" type="button" data-result="${escapeHtml(cacheKey)}">
          <div class="tvbox-result-poster">${poster}<span>${escapeHtml(item.vod_remarks || item.type_name || "资源")}</span></div>
          <strong>${escapeHtml(item.vod_name)}</strong>
          <small>${escapeHtml([item.vod_year, item.vod_area, item.siteName].filter(Boolean).join(" · "))}</small>
        </button>`;
      }).join("");
      return `<section class="tvbox-result-group">
        <header><span class="tvbox-status-dot ${result.ok ? "is-ok" : "is-bad"}"></span><strong>${escapeHtml(result.site.name)}</strong><small>${escapeHtml(result.message)}</small></header>
        <div class="tvbox-result-grid">${cards || `<p class="tvbox-inline-empty">${escapeHtml(result.message)}</p>`}</div>
      </section>`;
    }).join("");
  }

  async function openResult(cacheKey) {
    const item = resultCache.get(cacheKey);
    if (!item) return;
    const site = getSites().find((entry) => entry.key === item.siteKey);
    if (!site) return;
    try {
      const detail = await getDetail(site, item.vod_id);
      state.detailItem = detail;
      state.detailSite = site;
      state.activeLine = 0;
      renderDetail();
      elements.detailDialog.showModal();
      document.body.classList.add("modal-open");
    } catch (error) {
      toast(`详情读取失败：${error.message}`, true);
    }
  }

  async function getDetail(site, vodId) {
    if (site.type === 3 || site.type === 4) {
      const payload = parseLooseJson(await fetchTextWithFallback(buildCmsUrl(site, { ac: "detail", ids: vodId })));
      if (!isCmsOk(payload)) throw new Error(clean(payload.msg) || "接口返回异常");
      const raw = asArray(payload.list)[0];
      if (!raw) throw new Error("接口没有返回详情");
      const base = cmsItemToVod(raw, site);
      return {
        ...base,
        vod_content: clean(raw.vod_content ?? raw.vod_blurb).replace(/<[^>]+>/g, " "),
        lines: parseLines(raw.vod_play_from, raw.vod_play_url, raw.vod_play_note)
      };
    }
    if (!/^https?:\/\//i.test(vodId)) throw new Error("该网页规则源没有可用的详情页地址");
    const html = await fetchTextWithFallback(vodId);
    const document = new DOMParser().parseFromString(html, "text/html");
    const name = extractText(document.body, site.rules?.detailName, vodId, ["Text"]) || clean(document.querySelector("h1")?.textContent) || clean(document.title);
    const content = extractText(document.body, site.rules?.detailContent, vodId, ["Text"]);
    const pic = extractText(document.body, site.rules?.pic, vodId, ["data-src", "data-original", "src"]);
    const lines = [];
    const containers = site.rules?.playList ? [...document.querySelectorAll(site.rules.playList)] : [];
    for (const [index, container] of containers.entries()) {
      const episodes = site.rules.playItem ? [...container.querySelectorAll(site.rules.playItem)].map((anchor, episodeIndex) => ({
        name: clean(anchor.textContent) || `第${episodeIndex + 1}集`,
        url: absolutize(anchor.getAttribute("href"), vodId),
        index: episodeIndex
      })).filter((episode) => episode.url) : [];
      if (episodes.length) lines.push({ name: clean(container.getAttribute("data-name")) || clean(container.querySelector("h3,h2,.title,.name")?.textContent) || `线路${index + 1}`, episodes });
    }
    return { vod_id: vodId, vod_name: name || vodId, vod_pic: pic, vod_remarks: "", vod_year: "", vod_area: "", vod_actor: "", vod_director: "", type_name: "", vod_score: "", vod_content: content, lines, siteKey: site.key, siteName: site.name };
  }

  function renderDetail() {
    const item = state.detailItem;
    if (!item) return;
    elements.detailTitle.textContent = item.vod_name || "未命名资源";
    elements.detailSource.textContent = item.siteName || state.detailSite?.name || "TVBox 源";
    elements.detailMeta.textContent = [item.vod_year, item.vod_area, item.type_name, item.vod_score ? `评分 ${item.vod_score}` : "", item.vod_actor ? `主演 ${item.vod_actor}` : ""].filter(Boolean).join(" · ");
    elements.detailDescription.textContent = item.vod_content || "暂无简介。";
    elements.detailPoster.hidden = !item.vod_pic;
    elements.detailTypographic.hidden = Boolean(item.vod_pic);
    if (item.vod_pic) elements.detailPoster.src = item.vod_pic;
    elements.detailTypographic.textContent = item.vod_name || "资源";
    elements.detailLines.innerHTML = "";
    elements.detailEpisodes.innerHTML = "";
    const lines = item.lines || [];
    if (!lines.length) {
      elements.detailEpisodes.innerHTML = `<p class="tvbox-inline-empty">该源没有返回可播放剧集。</p>`;
      return;
    }
    state.activeLine = Math.min(state.activeLine, lines.length - 1);
    lines.forEach((line, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `tvbox-line-button ${index === state.activeLine ? "is-active" : ""}`;
      button.textContent = line.name;
      button.addEventListener("click", () => {
        state.activeLine = index;
        renderDetail();
      });
      elements.detailLines.append(button);
    });
    const episodes = lines[state.activeLine]?.episodes || [];
    elements.detailEpisodes.innerHTML = episodes.map((episode) => `<button type="button" class="tvbox-episode-button" data-episode="${escapeHtml(episode.url)}">${escapeHtml(episode.name)}</button>`).join("");
  }

  async function ensureHls() {
    if (window.Hls) return window.Hls;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `hls.min.js?v=${VERSION}`;
      script.onload = resolve;
      script.onerror = () => reject(new Error("播放器组件加载失败"));
      document.head.append(script);
    });
    return window.Hls;
  }

  async function resolvePlayableUrl(url) {
    const parsed = new URL(url);
    if (!/\/share\//i.test(parsed.pathname)) return url;
    const html = await fetchTextWithFallback(url);
    const match = html.match(/(?:const|let|var)\s+url\s*=\s*["']([^"']+)["']/i);
    if (!match) throw new Error("分享页没有返回视频地址，请切换线路");
    return new URL(match[1], url).href;
  }

  async function playUrl(url, label = "", video = elements.detailVideo, status = elements.playerStatus) {
    let target = safeHttpUrl(url);
    if (!target) {
      toast("该地址不是浏览器可播放的 HTTP(S) 视频。", true);
      return;
    }
    if (state.hls) {
      state.hls.destroy();
      state.hls = null;
    }
    video.hidden = false;
    video.poster = "";
    status.textContent = label ? `正在加载：${label}` : "正在加载视频…";
    try {
      target = await resolvePlayableUrl(target);
      if (/\.m3u8(?:$|[?#])/i.test(target)) {
        const Hls = await ensureHls();
        if (Hls.isSupported()) {
          state.hls = new Hls({ enableWorker: true, lowLatencyMode: true });
          state.hls.loadSource(target);
          state.hls.attachMedia(video);
          state.hls.on(Hls.Events.MANIFEST_PARSED, () => {
            status.textContent = "";
            video.play().catch(() => {});
          });
          state.hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) status.textContent = "视频加载失败，可尝试打开原地址。";
          });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = target;
          video.play().catch(() => {});
        } else {
          throw new Error("当前浏览器不支持 HLS");
        }
      } else {
        video.src = target;
        video.onloadedmetadata = () => {
          status.textContent = "";
          video.play().catch(() => {});
        };
        video.onerror = () => {
          status.textContent = "视频加载失败，可尝试打开原地址。";
        };
      }
    } catch (error) {
      status.textContent = error.message || "视频加载失败";
    }
  }

  function resourceFromDetail() {
    const item = state.detailItem;
    if (!item) return null;
    const links = (item.lines || []).flatMap((line) => line.episodes.map((episode) => ({ label: `${line.name} · ${episode.name}`, url: episode.url })));
    return {
      id: `tvbox-${state.detailSite?.key || "source"}-${hashText(`${item.vod_id}|${item.vod_name}`)}`,
      title: item.vod_name || "未命名资源",
      titleEn: "",
      type: item.type_name || "影视",
      description: item.vod_content || "",
      poster: item.vod_pic || "",
      source: item.siteName || state.detailSite?.name || "TVBox",
      tags: [item.vod_year, item.vod_area, item.type_name].filter(Boolean),
      links,
      downloads: [],
      rating: Number(item.vod_score) || 0,
      ratingSource: item.vod_score ? "源站评分" : "",
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      origin: "TVBox"
    };
  }

  function renderSources() {
    const sites = getSites();
    const lives = getLives();
    elements.sourceStats.textContent = `${sites.length} 个影视源 · ${lives.length} 个直播源`;
    elements.presetButton.disabled = state.configs.some((config) => config.id === PRESET.id);
    if (!state.configs.length) {
      elements.sourceList.innerHTML = `<div class="tvbox-empty">还没有订阅源。添加内置源，或导入 TVBox / JSON 订阅。</div>`;
      return;
    }
    elements.sourceList.innerHTML = state.configs.map((config) => {
      const configSites = (config.raw?.sites || []).map((item) => normalizeSite(item, config)).filter(Boolean);
      const supported = configSites.filter((site) => !site.unsupported).length;
      return `<article class="tvbox-source-card ${config.enabled ? "" : "is-disabled"}">
        <div class="tvbox-source-main">
          <div class="tvbox-source-title"><strong>${escapeHtml(config.name)}</strong><span>${escapeHtml(config.kind === "builtin" ? "内置订阅" : config.kind === "file" ? "本地文件" : "远程订阅")}</span></div>
          <p>${escapeHtml(config.url || "内置数据")}</p>
          <small>${configSites.length} 个影视源（${supported} 个网页可用） · ${normalizeLives(config.raw?.lives).length} 个直播源${config.error ? ` · ${escapeHtml(config.error)}` : ""}</small>
        </div>
        <div class="tvbox-source-actions">
          <button type="button" class="tvbox-mini-button" data-config-test="${escapeHtml(config.id)}">测试</button>
          <button type="button" class="tvbox-mini-button" data-config-export="${escapeHtml(config.id)}">导出</button>
          <button type="button" class="tvbox-switch" data-config-toggle="${escapeHtml(config.id)}" aria-pressed="${config.enabled}">${config.enabled ? "已启用" : "已停用"}</button>
          ${config.id === PRESET.id ? "" : `<button type="button" class="tvbox-mini-button is-danger" data-config-remove="${escapeHtml(config.id)}">移除</button>`}
        </div>
      </article>`;
    }).join("");
  }

  async function testConfig(configId) {
    const config = state.configs.find((item) => item.id === configId);
    if (!config) return;
    const sites = (config.raw?.sites || []).map((item) => normalizeSite(item, config)).filter((site) => site && !site.unsupported && site.api);
    if (!sites.length) {
      toast("这个订阅没有网页可测试的影视源。", true);
      return;
    }
    toast(`正在测试 ${sites.length} 个影视源…`);
    const results = await Promise.all(sites.map(async (site) => {
      const started = Date.now();
      try {
        const payload = parseLooseJson(await fetchTextWithFallback(buildCmsUrl(site, { ac: "detail", pg: 1 })));
        const count = asArray(payload.list).length;
        return { site, ok: isCmsOk(payload) && count > 0, message: isCmsOk(payload) ? `${count} 条` : clean(payload.msg) || "返回异常", ms: Date.now() - started };
      } catch (error) {
        return { site, ok: false, message: error.message, ms: Date.now() - started };
      }
    }));
    const ok = results.filter((result) => result.ok).length;
    toast(`测试完成：${ok} / ${results.length} 个源可用。${ok < results.length ? "失败源已保留，可自行检查地址。" : ""}`, ok < results.length);
  }

  function exportConfig(configId) {
    const config = state.configs.find((item) => item.id === configId);
    if (!config) return;
    const blob = new Blob([JSON.stringify(config.raw, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${config.name.replace(/[\\/:*?"<>|]/g, "_")}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importSubscription(event) {
    event.preventDefault();
    const url = clean(elements.importUrl.value);
    const text = clean(elements.importText.value);
    const file = elements.importFile.files[0];
    let payload;
    let sourceUrl = url;
    let kind = url ? "url" : "file";
    try {
      if (file) {
        payload = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
        sourceUrl = file.name;
      } else if (text) {
        payload = JSON.parse(text);
        sourceUrl = "粘贴的 JSON";
        kind = "paste";
      } else if (url) {
        payload = parseLooseJson(await fetchTextWithFallback(url, 20000));
      } else {
        throw new Error("请填写订阅地址、选择 JSON 文件或粘贴配置。");
      }
      if (!payload || typeof payload !== "object" || !Array.isArray(payload.sites)) {
        throw new Error("配置里没有 sites 数组，不是可识别的 TVBox 订阅。");
      }
      const config = addConfig({ name: clean(payload.name) || hostOf(url) || "导入订阅", url: sourceUrl, kind, raw: payload });
      elements.importForm.reset();
      closeDialog(elements.importDialog);
      toast(`已添加「${config.name}」，包含 ${config.siteCount} 个影视源、${config.liveCount} 个直播源。`);
    } catch (error) {
      elements.importStatus.textContent = error.message || "导入失败";
      elements.importStatus.classList.add("is-error");
    }
  }

  async function openCategories() {
    const sites = getSites().filter((site) => !site.unsupported && (site.type === 3 || site.type === 4));
    if (!sites.length) {
      toast("没有可浏览分类的 CMS 源。", true);
      return;
    }
    if (!sites.some((site) => site.key === state.categorySiteKey)) state.categorySiteKey = sites[0].key;
    elements.categoryPanel.hidden = !elements.categoryPanel.hidden;
    if (elements.categoryPanel.hidden) return;
    elements.categorySite.innerHTML = sites.map((site) => `<option value="${escapeHtml(site.key)}">${escapeHtml(site.name)}</option>`).join("");
    elements.categorySite.value = state.categorySiteKey;
    await loadCategories();
  }

  async function loadCategories() {
    const site = getSites().find((item) => item.key === elements.categorySite.value);
    if (!site) return;
    elements.categoryChips.innerHTML = `<span class="tvbox-inline-empty">正在读取分类…</span>`;
    try {
      const payload = parseLooseJson(await fetchTextWithFallback(buildCmsUrl(site, { ac: "list", pg: 1 })));
      const classes = asArray(payload.class).map((item) => ({
        id: clean(item.type_id ?? item.id ?? item.tid),
        name: clean(item.type_name ?? item.name ?? item.title),
        pid: clean(item.type_pid ?? item.pid) || "0"
      })).filter((item) => item.id && item.name);
      state.categoryClasses = classes;
      if (!classes.length) {
        elements.categoryChips.innerHTML = `<span class="tvbox-inline-empty">该源没有返回分类。</span>`;
        return;
      }
      elements.categoryChips.innerHTML = classes.map((item) => `<button type="button" class="tvbox-category-chip" data-category="${escapeHtml(item.id)}">${escapeHtml(item.name)}</button>`).join("");
    } catch (error) {
      elements.categoryChips.innerHTML = `<span class="tvbox-inline-empty">${escapeHtml(error.message)}</span>`;
    }
  }

  async function browseCategory(typeId) {
    const site = getSites().find((item) => item.key === elements.categorySite.value);
    if (!site) return;
    elements.searchSummary.textContent = `正在读取「${site.name}」分类…`;
    try {
      const payload = parseLooseJson(await fetchTextWithFallback(buildCmsUrl(site, { ac: "list", t: typeId, pg: 1 })));
      const list = asArray(payload.list).slice(0, 60).map((item) => cmsItemToVod(item, site)).filter((item) => item.vod_name && item.vod_id);
      state.searchResults = [{ site, ok: true, message: `分类 ${typeId} · ${list.length} 条`, list, ms: 0 }];
      state.searchSites = [site];
      state.searchDone = 1;
      elements.results.hidden = false;
      renderSearchResults();
      elements.searchSummary.textContent = `分类「${site.name}」：${list.length} 条`;
      elements.results.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      toast(`分类读取失败：${error.message}`, true);
    }
  }

  function normalizeLiveGroup(value) {
    const name = clean(value).replace(/^[\s•·・*\-—]+/, "").replace(/[「」【】《》[\]（）()]/g, "");
    if (!name || /^(未分组|其他|其它|默认|default|undefined|null)$/i.test(name)) return "其它";
    if (/^游戏/.test(name)) return "游戏赛事";
    if (/^影视/.test(name)) return "影视轮播";
    if (/^咪咕/.test(name)) return "咪咕移动";
    return name;
  }

  function parseM3u(text) {
    const out = [];
    let pending = null;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith("#EXTINF")) {
        const body = line.slice(line.indexOf(":") + 1);
        const comma = body.lastIndexOf(",");
        const attrs = comma >= 0 ? body.slice(0, comma) : body;
        const label = comma >= 0 ? body.slice(comma + 1).trim() : "";
        const pick = (key) => attrs.match(new RegExp(`${key}="([^"]*)"`, "i"))?.[1]?.trim() || "";
        pending = { name: pick("tvg-name") || label, group: pick("group-title"), logo: pick("tvg-logo") };
      } else if (!line.startsWith("#") && pending) {
        out.push({ name: pending.name || line, url: line, group: normalizeLiveGroup(pending.group), logo: pending.logo });
        pending = null;
      }
    }
    return out.filter((channel) => channel.name && channel.url);
  }

  function parseTxt(text) {
    const out = [];
    let group = "其它";
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//")) continue;
      if (/#genre#?/i.test(line)) {
        group = normalizeLiveGroup(line.split(",")[0]);
        continue;
      }
      if (line.startsWith("#")) continue;
      const index = line.indexOf(",");
      if (index <= 0) continue;
      const name = line.slice(0, index).trim();
      const url = line.slice(index + 1).trim();
      if (url) out.push({ name, url, group });
    }
    return out;
  }

  function parseLive(text) {
    return /#EXTM3U|#EXTINF/i.test(text) ? parseM3u(text) : parseTxt(text);
  }

  async function openLive() {
    const lives = getLives();
    if (!lives.length) {
      toast("订阅里没有直播源。", true);
      return;
    }
    elements.liveSource.innerHTML = lives.map((live, index) => `<option value="${index}">${escapeHtml(live.name)}</option>`).join("");
    elements.liveDialog.showModal();
    document.body.classList.add("modal-open");
    await loadLive();
  }

  async function loadLive() {
    const lives = getLives();
    const live = lives[Number(elements.liveSource.value) || 0];
    if (!live) return;
    elements.liveStatus.textContent = "正在读取频道…";
    try {
      const text = await fetchTextWithFallback(live.url, 20000);
      const channels = parseLive(text);
      state.liveChannels = channels;
      const groups = new Map();
      for (const channel of channels) {
        if (!groups.has(channel.group)) groups.set(channel.group, []);
        groups.get(channel.group).push(channel);
      }
      state.liveGroups = [...groups.entries()].map(([name, items]) => ({ name, channels: items.sort((a, b) => a.name.localeCompare(b.name, "zh-CN")) }))
        .sort((a, b) => a.name === "其它" ? 1 : b.name === "其它" ? -1 : b.channels.length - a.channels.length);
      elements.liveGroup.innerHTML = `<option value="all">全部分组（${channels.length}）</option>${state.liveGroups.map((group, index) => `<option value="${index}">${escapeHtml(group.name)}（${group.channels.length}）</option>`).join("")}`;
      elements.liveStatus.textContent = `已读取 ${channels.length} 个频道`;
      renderLiveChannels();
    } catch (error) {
      elements.liveStatus.textContent = `读取失败：${error.message}`;
    }
  }

  function renderLiveChannels() {
    const query = clean(elements.liveSearch.value).toLocaleLowerCase("zh-CN");
    const groupValue = elements.liveGroup.value;
    const groups = groupValue === "all" ? state.liveGroups : state.liveGroups.filter((_group, index) => String(index) === groupValue);
    const channels = groups.flatMap((group) => group.channels).filter((channel) => !query || channel.name.toLocaleLowerCase("zh-CN").includes(query));
    elements.liveList.innerHTML = channels.map((channel) => `<button type="button" class="tvbox-live-channel" data-live-url="${escapeHtml(channel.url)}" data-live-name="${escapeHtml(channel.name)}"><span>${escapeHtml(channel.name)}</span><small>${escapeHtml(channel.group)}</small></button>`).join("") || `<p class="tvbox-inline-empty">没有匹配的频道。</p>`;
  }

  function closeDialog(dialog) {
    if (dialog?.open) dialog.close();
    document.body.classList.toggle("modal-open", Boolean(document.querySelector("dialog[open]")));
  }

  function cacheElements() {
    const ids = [
      "tvbox-source-stats", "tvbox-preset-button", "tvbox-source-list", "tvbox-search-input", "tvbox-search-button", "tvbox-category-button", "tvbox-import-button", "tvbox-live-button",
      "tvbox-results", "tvbox-search-summary", "tvbox-search-grid", "tvbox-category-panel", "tvbox-category-site", "tvbox-category-chips",
      "tvbox-import-dialog", "tvbox-import-form", "tvbox-import-url", "tvbox-import-file", "tvbox-import-text", "tvbox-import-status", "tvbox-import-submit", "tvbox-import-close", "tvbox-import-cancel",
      "tvbox-detail-dialog", "tvbox-detail-close", "tvbox-detail-poster", "tvbox-detail-typographic", "tvbox-detail-source", "tvbox-detail-title", "tvbox-detail-meta", "tvbox-detail-description",
      "tvbox-detail-lines", "tvbox-detail-episodes", "tvbox-detail-video", "tvbox-player-status", "tvbox-detail-open", "tvbox-detail-save",
      "tvbox-live-dialog", "tvbox-live-close", "tvbox-live-source", "tvbox-live-group", "tvbox-live-search", "tvbox-live-status", "tvbox-live-list", "tvbox-live-video", "tvbox-live-player-status"
    ];
    for (const id of ids) {
      const key = id.replace(/^tvbox-/, "");
      elements[key.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] = document.getElementById(id);
    }
  }

  function bindEvents() {
    elements.searchButton.addEventListener("click", runSearch);
    elements.searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") runSearch();
    });
    elements.categoryButton.addEventListener("click", openCategories);
    elements.categorySite.addEventListener("change", loadCategories);
    elements.categoryChips.addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (button) browseCategory(button.dataset.category);
    });
    elements.presetButton.addEventListener("click", () => {
      if (state.configs.some((config) => config.id === PRESET.id)) return;
      addConfig({ ...PRESET });
      toast("已添加内置源：5 个影视接口 + 1 个直播源。");
    });
    elements.importButton.addEventListener("click", () => {
      elements.importStatus.textContent = "";
      elements.importStatus.classList.remove("is-error");
      elements.importDialog.showModal();
      document.body.classList.add("modal-open");
    });
    elements.importForm.addEventListener("submit", importSubscription);
    elements.importClose.addEventListener("click", () => closeDialog(elements.importDialog));
    elements.importCancel.addEventListener("click", () => closeDialog(elements.importDialog));
    elements.sourceList.addEventListener("click", (event) => {
      const test = event.target.closest("[data-config-test]");
      const toggle = event.target.closest("[data-config-toggle]");
      const remove = event.target.closest("[data-config-remove]");
      const exportButton = event.target.closest("[data-config-export]");
      if (test) testConfig(test.dataset.configTest);
      if (exportButton) exportConfig(exportButton.dataset.configExport);
      if (toggle) {
        const config = state.configs.find((item) => item.id === toggle.dataset.configToggle);
        if (config) {
          config.enabled = !config.enabled;
          saveConfigs();
          renderSources();
        }
      }
      if (remove && window.confirm("确定移除这个订阅吗？已导入资源库的影片不会受影响。")) {
        state.configs = state.configs.filter((item) => item.id !== remove.dataset.configRemove);
        saveConfigs();
        renderSources();
      }
    });
    elements.searchGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-result]");
      if (button) openResult(button.dataset.result);
    });
    elements.detailClose.addEventListener("click", () => closeDialog(elements.detailDialog));
    elements.detailEpisodes.addEventListener("click", (event) => {
      const button = event.target.closest("[data-episode]");
      if (button) playUrl(button.dataset.episode, button.textContent);
    });
    elements.detailOpen.addEventListener("click", () => {
      const episode = state.detailItem?.lines?.[state.activeLine]?.episodes?.[0];
      const url = episode?.url || state.detailItem?.vod_id;
      if (safeHttpUrl(url)) window.open(url, "_blank", "noopener,noreferrer");
    });
    elements.detailSave.addEventListener("click", () => {
      const resource = resourceFromDetail();
      if (!resource) return;
      window.dispatchEvent(new CustomEvent("dyk:save-resource", { detail: resource }));
      toast("已保存到电影书架资源库。");
    });
    elements.liveButton.addEventListener("click", openLive);
    elements.liveClose.addEventListener("click", () => closeDialog(elements.liveDialog));
    elements.liveSource.addEventListener("change", loadLive);
    elements.liveGroup.addEventListener("change", renderLiveChannels);
    elements.liveSearch.addEventListener("input", renderLiveChannels);
    elements.liveList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-live-url]");
      if (!button) return;
      playUrl(button.dataset.liveUrl, button.dataset.liveName, elements.liveVideo, elements.livePlayerStatus);
    });
    for (const dialog of [elements.importDialog, elements.detailDialog, elements.liveDialog]) {
      dialog.addEventListener("close", () => document.body.classList.toggle("modal-open", Boolean(document.querySelector("dialog[open]"))));
      dialog.addEventListener("click", (event) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(dialog);
      });
    }
  }

  function init() {
    cacheElements();
    loadConfigs();
    bindEvents();
    renderSources();
  }

  window.DYKTVBox = { init, version: VERSION };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
