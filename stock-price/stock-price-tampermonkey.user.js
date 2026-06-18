// ==UserScript==
// @name         USCardForum Stock Price
// @namespace    http://tampermonkey.net/
// @version      4.0.1
// @description  Show stock prices inline on USCardForum investment category
// @match        https://www.uscardforum.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      query1.finance.yahoo.com
// @connect      raw.githubusercontent.com
// @connect      gist.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════
    // 以下配置常量从远程 blacklist.json 加载（见 applyRemoteData）
    // 本地初始化为空，首次联网拉取后由 GM 缓存持久化
    // ═══════════════════════════════════════════════════════════════════════
    const EXCLUDE_CODES = new Set();
    const EXCLUDE_PHRASES = [];
    const SYMBOL_ALIASES = {};
    const CRYPTO_CODES = new Set();
    const FIAT_CODES = new Set();
    const FUTURES_CODES = new Set();
    const SHORT_CODE_WHITELIST = new Set();
    const COMMON_WORDS = new Set();


    // ═══════════════════════════════════════════════════════════════════════
    // Toast notifications — replaces blocking alert()
    // ═══════════════════════════════════════════════════════════════════════
    GM_addStyle(`
        #sp-toast-container {
            position: fixed;
            bottom: 16px;
            right: 16px;
            z-index: 2147483647;
            display: flex;
            flex-direction: column;
            gap: 8px;
            pointer-events: none;
        }
        .sp-toast {
            pointer-events: auto;
            max-width: 360px;
            min-width: 220px;
            padding: 10px 30px 10px 14px;
            border-radius: 8px;
            color: #fff;
            font-size: 13px;
            line-height: 1.45;
            box-shadow: 0 4px 16px rgba(0,0,0,0.35);
            opacity: 0;
            transform: translateX(20px);
            transition: opacity .25s ease, transform .25s ease;
            position: relative;
            word-break: break-word;
            font-family: -apple-system, system-ui, sans-serif;
        }
        .sp-toast.sp-toast-show {
            opacity: 1;
            transform: translateX(0);
        }
        .sp-toast-success { background: #16a34a; }
        .sp-toast-error   { background: #dc2626; }
        .sp-toast-info    { background: #1f2937; }
        .sp-toast-close {
            position: absolute;
            top: 5px;
            right: 8px;
            cursor: pointer;
            font-size: 16px;
            line-height: 1;
            opacity: 0.7;
            user-select: none;
        }
        .sp-toast-close:hover { opacity: 1; }
        .sp-toast-url {
            display: block;
            margin-top: 6px;
            padding: 4px 6px;
            background: rgba(0,0,0,0.28);
            border-radius: 4px;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 12px;
            word-break: break-all;
            cursor: pointer;
            user-select: all;
        }
        .sp-toast-text { white-space: pre-line; }
    `);

    let _toastContainer = null;
    function _getToastContainer() {
        if (_toastContainer && _toastContainer.isConnected) return _toastContainer;
        _toastContainer = document.createElement('div');
        _toastContainer.id = 'sp-toast-container';
        document.body.appendChild(_toastContainer);
        return _toastContainer;
    }

    function showToast(msg, type, duration, opts) {
        console.log('[stock-price] showToast called: type=' + (type || 'info') + ', msg=' + (msg || '').slice(0, 40));
        type = type || 'info';
        duration = duration || 5000;
        opts = opts || null;
        const container = _getToastContainer();
        const toast = document.createElement('div');
        toast.className = 'sp-toast sp-toast-' + type;
        const text = document.createElement('span');
        text.className = 'sp-toast-text';
        text.textContent = msg;
        const closeBtn = document.createElement('span');
        closeBtn.className = 'sp-toast-close';
        closeBtn.textContent = '×';
        toast.appendChild(text);
        if (opts && opts.url) {
            const urlEl = document.createElement('code');
            urlEl.className = 'sp-toast-url';
            urlEl.textContent = opts.url;
            urlEl.title = '点击复制链接';
            urlEl.onclick = function () {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(opts.url).then(
                        function () { showToast('链接已复制', 'success', 1500); },
                        function () { _selectEl(urlEl); }
                    );
                } else {
                    _selectEl(urlEl);
                }
            };
            toast.appendChild(urlEl);
        }
        toast.appendChild(closeBtn);
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('sp-toast-show'));
        const dismiss = () => {
            toast.classList.remove('sp-toast-show');
            setTimeout(() => { if (toast.isConnected) toast.remove(); }, 300);
        };
        const timer = setTimeout(dismiss, duration);
        closeBtn.onclick = () => { clearTimeout(timer); dismiss(); };
    }

    function _selectEl(el) {
        const range = document.createRange();
        range.selectNode(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    // ── Per-URL notification counter (anti-spam for auto background failures) ──
    const GMK_NOTIFY = 'sp_notify_counts';
    const NOTIFY_CAP = 2;

    function _getNotifyCounts() {
        const v = GM_getValue(GMK_NOTIFY, null);
        if (v && typeof v === 'object' && !Array.isArray(v)) return v;
        return {};
    }
    function _setNotifyCount(url, n) {
        const counts = _getNotifyCounts();
        counts[url] = n;
        GM_setValue(GMK_NOTIFY, counts);
    }
    function shouldNotifyForUrl(url) {
        const n = _getNotifyCounts()[url] || 0;
        if (n >= NOTIFY_CAP) return false;
        _setNotifyCount(url, n + 1);
        return true;
    }
    function resetNotifyForUrl(url) {
        _setNotifyCount(url, 0);
    }

    // ── Unified sync-result handler ──
    function _syncSuccessMsg(r) {
        return '✓ 黑名单同步成功: 代码 ' + r.counts.codes + ' / 短语 ' + r.counts.phrases + ' / 别名 ' + r.counts.aliases;
    }
    function _syncFailMsg(r) {
        return '✗ 黑名单同步失败: ' + r.msg + '\n（已保留旧缓存）';
    }
    function onSyncResult(r, isManual) {
        const url = getBlacklistUrl();
        if (r.ok) {
            resetNotifyForUrl(url);   // success → reset this URL's failure count
            showToast(_syncSuccessMsg(r), 'success', isManual ? 5000 : 3000);
            return;
        }
        if (isManual) {
            showToast(_syncFailMsg(r), 'error', 6000);
        } else if (shouldNotifyForUrl(url)) {
            showToast(_syncFailMsg(r), 'error', 6000);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Remote blacklist — default uses repo JSON, user can swap to their gist
    // ═══════════════════════════════════════════════════════════════════════
    const DEFAULT_BLACKLIST_URL =
        'https://raw.githubusercontent.com/lynkas/uscardforum-userscripts/main/stock-price/blacklist.json';
    const GMK_URL = 'sp_blacklist_url';
    const GMK_CACHE = 'sp_blacklist_cache';
    const SCRIPT_VERSION = '4.0.1';   // bump together with @version to force one-time blacklist refetch
    const GMK_VER = 'sp_last_script_ver';

    // Populate all config constants from remote data (single source = blacklist.json).
    // Clears each list first, then fills from whichever fields the JSON provides.
    function applyRemoteData(data) {
        EXCLUDE_CODES.clear();
        EXCLUDE_PHRASES.length = 0;
        for (const k of Object.keys(SYMBOL_ALIASES)) delete SYMBOL_ALIASES[k];
        CRYPTO_CODES.clear();
        FIAT_CODES.clear();
        FUTURES_CODES.clear();
        SHORT_CODE_WHITELIST.clear();
        COMMON_WORDS.clear();

        if (!data || typeof data !== 'object') return;
        if (Array.isArray(data.excludeCodes)) {
            data.excludeCodes.forEach(c => {
                if (typeof c === 'string') EXCLUDE_CODES.add(c.toUpperCase());
            });
        }
        if (Array.isArray(data.excludePhrases)) {
            data.excludePhrases.forEach(p => {
                if (typeof p === 'string') EXCLUDE_PHRASES.push(p);
            });
        }
        if (data.aliases && typeof data.aliases === 'object' && !Array.isArray(data.aliases)) {
            for (const [k, v] of Object.entries(data.aliases)) {
                if (typeof v === 'string') SYMBOL_ALIASES[String(k).toUpperCase()] = v;
            }
        }
        if (Array.isArray(data.cryptoCodes)) {
            data.cryptoCodes.forEach(c => {
                if (typeof c === 'string') CRYPTO_CODES.add(c.toUpperCase());
            });
        }
        if (Array.isArray(data.fiatCodes)) {
            data.fiatCodes.forEach(c => {
                if (typeof c === 'string') FIAT_CODES.add(c.toUpperCase());
            });
        }
        if (Array.isArray(data.futuresCodes)) {
            data.futuresCodes.forEach(c => {
                if (typeof c === 'string') FUTURES_CODES.add(c.toUpperCase());
            });
        }
        if (Array.isArray(data.shortCodeWhitelist)) {
            data.shortCodeWhitelist.forEach(c => {
                if (typeof c === 'string') SHORT_CODE_WHITELIST.add(c.toUpperCase());
            });
        }
        if (Array.isArray(data.commonWords)) {
            data.commonWords.forEach(c => {
                if (typeof c === 'string') COMMON_WORDS.add(c.toUpperCase());
            });
        }
    }

    // Strip JSONC comments (// line and /* block */) and trailing commas
    // before JSON.parse. Strings in this file never contain // or /* so safe.
    function stripJsonc(text) {
        return text
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1')
            .replace(/,\s*([}\]])/g, '$1');
    }

    function getBlacklistUrl() {
        return GM_getValue(GMK_URL, DEFAULT_BLACKLIST_URL);
    }

    async function loadRemoteBlacklist(force) {
        const url = getBlacklistUrl();
        if (!url) return { ok: false, msg: '未配置 URL' };

        try {
            const resp = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    timeout: 8000,
                    onload: resolve,
                    onerror: () => reject(new Error('网络错误')),
                    ontimeout: () => reject(new Error('请求超时')),
                    onabort: () => reject(new Error('请求中止')),
                });
            });
            if (resp.status < 200 || resp.status >= 300) throw new Error('HTTP ' + resp.status);
            const data = JSON.parse(stripJsonc(resp.responseText));
            if (typeof data !== 'object' || data === null || Array.isArray(data))
                throw new Error('JSON 不是对象');

            GM_setValue(GMK_CACHE, data);
            applyRemoteData(data);
            console.log('[stock-price] 远程黑名单已加载:', {
                codes: (data.excludeCodes || []).length,
                phrases: (data.excludePhrases || []).length,
                aliases: Object.keys(data.aliases || {}).length,
            });
            return {
                ok: true,
                counts: {
                    codes: (data.excludeCodes || []).length,
                    phrases: (data.excludePhrases || []).length,
                    aliases: Object.keys(data.aliases || {}).length,
                },
            };
        } catch (e) {
            return { ok: false, msg: e.message };
        }
    }

    const RE_URL = /^https:\/\/(raw\.githubusercontent\.com|gist\.githubusercontent\.com)\/.+/i;

    GM_registerMenuCommand('⚙️ 设置黑名单同步链接…', () => {
        const cur = getBlacklistUrl();
        const input = prompt(
            '黑名单 JSON 的 raw 链接：\n\n' +
            '支持 raw.githubusercontent.com 或 gist.githubusercontent.com\n' +
            '（不要用 gist.github.com 网页链接）\n\n' +
            '留空恢复默认。',
            cur
        );
        if (input === null) return;
        const trimmed = input.trim();
        if (trimmed === '') {
        GM_setValue(GMK_URL, DEFAULT_BLACKLIST_URL);
        resetNotifyForUrl(DEFAULT_BLACKLIST_URL);
        showToast('已恢复默认链接，正在同步…', 'info', 3000);
            loadRemoteBlacklist(true).then(function (r) { onSyncResult(r, true); });
            return;
        }
        if (!RE_URL.test(trimmed)) {
            showToast('✗ 链接格式不对\n需要 raw.githubusercontent.com 或 gist.githubusercontent.com', 'error', 6000);
            return;
        }
        GM_setValue(GMK_URL, trimmed);
        resetNotifyForUrl(trimmed);
        loadRemoteBlacklist(true).then(function (r) { onSyncResult(r, true); });
    });

    GM_registerMenuCommand('🔄 立即重新同步黑名单', () => {
        loadRemoteBlacklist(true).then(function (r) { onSyncResult(r, true); });
    });

    GM_registerMenuCommand('📋 查看当前生效黑名单', () => {
        const url = getBlacklistUrl();
        const cached = GM_getValue(GMK_CACHE, null);
        console.group('[stock-price] 当前黑名单');
        console.log('URL:', url);
        console.log('缓存来源:', cached ? '远程' : '空（未加载远程配置）');
        console.log('excludeCodes:', [...EXCLUDE_CODES]);
        console.log('excludePhrases:', [...EXCLUDE_PHRASES]);
        console.log('aliases:', { ...SYMBOL_ALIASES });
        console.groupEnd();
        showToast('已打印到控制台 (F12)\n来源: ' + (cached ? '远程缓存' : '空（未加载）'), 'info', 8000, { url: url });
    });

    GM_registerMenuCommand('🧹 清除黑名单缓存（测试）', () => {
        GM_setValue(GMK_CACHE, null);
        GM_setValue(GMK_VER, '');
        console.log('[stock-price] cache cleared via menu');
        alert('黑名单缓存已清除，刷新页面后会重新拉取');
    });

    // ─── Task 1: Page Detection ───────────────────────────────────────────

    function isInvestmentCategory() {
        // Check body class for category-investment* (matches category-investment, category-investment-stock-market, etc.)
        for (const cls of document.body.classList) {
            if (cls.startsWith('category-investment')) return true;
        }

        // Check breadcrumb containing "理财"
        const breadcrumbs = document.querySelectorAll(
            '.breadcrumb-item, .category-breadcrumb, .breadcrumbs li'
        );
        for (const bc of breadcrumbs) {
            if (bc.textContent.includes('理财')) {
                return true;
            }
        }

        // Check badge category name containing "理财"
        const badges = document.querySelectorAll(
            '.badge-category .category-name, .badge-wrapper .badge-category, .category-name'
        );
        for (const badge of badges) {
            if (badge.textContent.includes('理财')) {
                return true;
            }
        }

        return false;
    }

    let initialized = false;
    let observer = null;
    let refreshTimer = null;

    function stop() {
        if (observer) { observer.disconnect(); observer = null; }
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
        initialized = false;
    }

    function init() {
        if (!isInvestmentCategory()) {
            if (initialized) stop();
            return;
        }
        if (initialized) return;

    // ── Remote blacklist: apply cache synchronously; refetch on script-version change or cache miss ──
    const _cached = GM_getValue(GMK_CACHE, null);
    const _lastVer = GM_getValue(GMK_VER, '');
    const _versionChanged = _lastVer !== SCRIPT_VERSION;
    console.log('[stock-price] init blacklist: cached=' + (_cached ? 'YES' : 'NO') + ', lastVer="' + _lastVer + '", versionChanged=' + _versionChanged);
    if (_cached) applyRemoteData(_cached);
    const _needFetch = _versionChanged || !_cached;
    if (_versionChanged) GM_setValue(GMK_VER, SCRIPT_VERSION);
    if (_needFetch) {
        console.log('[stock-price] init: calling loadRemoteBlacklist (force=' + _versionChanged + ')');
        loadRemoteBlacklist(_versionChanged).then(function (r) {
            console.log('[stock-price] init: loadRemoteBlacklist resolved, r=', JSON.stringify(r));
            onSyncResult(r, false);
            processNewPosts();   // first scan now that blacklist is populated
        });
    } else {
        console.log('[stock-price] init: no fetch needed, using cache');
    }

    // ─── Task 2: Stock Code Extraction ────────────────────────────────────

    // Grammar words — indicate English prose, not stock codes
    const GRAMMAR_WORDS = new Set([
        'THE','A','AN','IS','AM','ARE','WAS','WERE','BE','BEEN','BEING',
        'HAVE','HAS','HAD','DO','DOES','DID','WILL','WOULD','COULD','SHOULD',
        'MAY','MIGHT','SHALL','CAN','TO','OF','IN','FOR','ON','WITH','AT',
        'BY','FROM','AS','INTO','THROUGH','DURING','BEFORE','AFTER','ABOVE',
        'BELOW','BETWEEN','UNDER','OVER','AND','BUT','OR','NOR','NOT','SO',
        'YET','IF','THAN','THAT','THIS','IT','HE','SHE','WE','THEY','MY',
        'YOUR','HIS','HER','ITS','OUR','ME','HIM','US','THEM','WHAT','WHICH',
        'WHO','WHEN','WHERE','HOW','WHY',
    ]);

    // ── Helpers ─────────────────────────────────────────────────────────────

    function classifyParagraph(para) {
        if (/[^\x00-\x7F]/.test(para)) return 'chinese';
        const words = [...para.matchAll(/[A-Za-z']+/g)].map(m => m[0].toUpperCase());
        if (words.some(w => GRAMMAR_WORDS.has(w))) return 'prose';
        if (words.length > 10) return 'prose';
        return 'codelist';
    }

    function isTickerLike(word) {
        if (word.length >= 2 && word === word.toUpperCase()) return true;
        if (word.includes('.')) return true;
        const upper = word.toUpperCase();
        if (SHORT_CODE_WHITELIST.has(upper)) return true;
        if (SYMBOL_ALIASES[upper]) return true;
        if (FUTURES_CODES.has(upper)) return true;
        return false;
    }

    function isAcceptedCode(code) {
        if (code.length < 2) return false;
        return code.length >= 3 || SHORT_CODE_WHITELIST.has(code)
            || SYMBOL_ALIASES[code] || FUTURES_CODES.has(code);
    }

    function groupParagraphs(text) {
        const paragraphs = text.split(/\n/);
        const groups = [];
        let offset = 0;

        for (let i = 0; i < paragraphs.length;) {
            const para = paragraphs[i];
            const type = classifyParagraph(para);

            if (type === 'chinese') {
                groups.push({ type, text: para, offset });
                offset += para.length + 1;
                i++;
            } else {
                // Group consecutive English paragraphs of the same type
                let segText = para;
                let j = i + 1;
                while (j < paragraphs.length) {
                    const nextPara = paragraphs[j];
                    if (classifyParagraph(nextPara) !== type) break;
                    segText += '\n' + paragraphs[j];
                    j++;
                }
                groups.push({ type, text: segText, offset });
                offset += segText.length + 1;
                i = j;
            }
        }
        return groups;
    }

    // ── Stage 1: $EXACT ─────────────────────────────────────────────────────

    const RE_EXACT = /\$([A-Za-z0-9.\-=^]*[A-Za-z0-9])/g;

    function collectExactCodes(text) {
        const codes = new Set();
        for (const m of text.matchAll(RE_EXACT)) {
            codes.add(m[1].toUpperCase());
        }
        return codes;
    }

    // ── Stage 2: Skip zones & special extractors ────────────────────────────

    function buildExactZones(text, offset) {
        const zones = [];
        for (const m of text.matchAll(RE_EXACT)) {
            zones.push([offset + m.index, offset + m.index + m[0].length]);
        }
        return zones;
    }

    const RE_DOT_CODE = /(?<![A-Za-z\d])([A-Za-z0-9]+\.([A-Za-z]{1,2}))(?![A-Za-z\d])/gi;

    function collectDotCodes(text, offset) {
        const codes = new Set();
        const zones = [];
        for (const m of text.matchAll(RE_DOT_CODE)) {
            if (/^\d/.test(m[1]) || m[2].length === 2) {
                codes.add(m[1].toUpperCase());
                zones.push([offset + m.index, offset + m.index + m[0].length]);
            }
        }
        return { codes, zones };
    }

    const RE_FOREX = /(?<![A-Za-z\d])([A-Za-z]{6})(=?([A-Za-z]))?(?![A-Za-z\d])/g;

    function collectForexPairs(text, offset) {
        const codes = new Set();
        const zones = [];
        for (const m of text.matchAll(RE_FOREX)) {
            const pair = m[1].toUpperCase();
            if (!FIAT_CODES.has(pair.slice(0, 3)) || !FIAT_CODES.has(pair.slice(3))) continue;
            // Include suffix (=X) if present
            const code = m[2] ? (pair + '=' + m[3].toUpperCase()) : pair;
            codes.add(code);
            // Skip the whole match (including suffix) from standalone extraction
            zones.push([offset + m.index, offset + m.index + m[0].length]);
        }
        return { codes, zones };
    }

    function buildGrammarZones(text, offset) {
        const zones = [];
        for (const m of text.matchAll(/[A-Za-z']+(?:[^A-Za-z'\n]+[A-Za-z']+)+/g)) {
            const words = m[0].split(/[^A-Za-z']+/).filter(Boolean).map(w => w.toUpperCase());
            if (words.length >= 3 && words.some(w => GRAMMAR_WORDS.has(w))) {
                zones.push([offset + m.index, offset + m.index + m[0].length]);
            }
        }
        return zones;
    }

    function buildPhraseZones(text, offset) {
        const zones = [];
        const upper = text.toUpperCase();
        for (const phrase of EXCLUDE_PHRASES) {
            const pUpper = phrase.toUpperCase();
            let p = 0;
            while ((p = upper.indexOf(pUpper, p)) !== -1) {
                const before = p > 0 ? upper[p - 1] : ' ';
                const after = upper[p + pUpper.length] || ' ';
                if (!/[A-Z]/.test(before) && !/[A-Z]/.test(after)) {
                    zones.push([offset + p, offset + p + pUpper.length]);
                }
                p++;
            }
        }
        return zones;
    }

    const RE_STANDALONE = /(?<![A-Za-z\d'])([A-Za-z]{1,5}(?:\.[A-Za-z])?)(?![A-Za-z\d])/g;

    function collectStandalone(text, offset, zones) {
        const codes = new Set();
        for (const m of text.matchAll(RE_STANDALONE)) {
            const pos = offset + m.index;
            if (zones.some(([s, e]) => pos >= s && pos < e)) continue;
            const code = m[1].toUpperCase();
            if (isAcceptedCode(code)) codes.add(code);
        }
        return codes;
    }

    // ── Pipeline ────────────────────────────────────────────────────────────

    function extractStockCodes(container) {
        const text = container.textContent || '';

        // Stage 1: $EXACT (always global)
        const exactCodes = collectExactCodes(text);

        // Stage 2: per-group extraction
        const standaloneCodes = new Set();
        for (const group of groupParagraphs(text)) {
            if (group.type === 'prose') continue; // prose: only $EXACT

            if (group.type === 'codelist') {
                const words = [...group.text.matchAll(/[A-Za-z]+/g)].map(m => m[0]);
                if (!words.some(isTickerLike)) continue;
            }

            // Build skip zones
            let zones = buildExactZones(group.text, group.offset);

            const dot = collectDotCodes(group.text, group.offset);
            const forex = collectForexPairs(group.text, group.offset);
            zones = zones.concat(dot.zones, forex.zones);

            // Chinese paragraphs get grammar + phrase skip zones
            // All types get phrase skip zones
            if (group.type === 'chinese') {
                zones = zones.concat(
                    buildGrammarZones(group.text, group.offset),
                    buildPhraseZones(group.text, group.offset)
                );
            } else {
                zones = zones.concat(buildPhraseZones(group.text, group.offset));
            }

            for (const c of dot.codes) standaloneCodes.add(c);
            for (const c of forex.codes) standaloneCodes.add(c);
            for (const c of collectStandalone(group.text, group.offset, zones)) standaloneCodes.add(c);
        }

        // Stage 3: filter & merge
        const filtered = [...standaloneCodes]
            .filter(code => !COMMON_WORDS.has(code) && !EXCLUDE_CODES.has(code));
        return [...new Set([...exactCodes, ...filtered])];
    }

    // ─── Task 3: Yahoo Finance API ────────────────────────────────────────

    const priceCache = new Map(); // symbol -> { data, timestamp }
    const CACHE_TTL = 60000; // 60 seconds
    const pendingFetches = new Set(); // symbols currently being fetched
    let lastRequestTime = 0;
    let requestCount = 0;
    let requestLog = []; // { time, symbol, status, duration, gap }

    function fetchPrice(symbol) {
        return new Promise((resolve) => {
            // Resolve alias → actual Yahoo Finance symbol
            const resolved = SYMBOL_ALIASES[symbol] || symbol;
            // Crypto codes use BTC-USD format, fiat codes use CNY=X format
            let yahooSymbol;
            if (CRYPTO_CODES.has(resolved)) {
                yahooSymbol = `${resolved}-USD`;
            } else if (FIAT_CODES.has(resolved)) {
                yahooSymbol = `${resolved}=X`;
            } else if (/^[A-Z]{6}$/.test(resolved) && FIAT_CODES.has(resolved.slice(0,3)) && FIAT_CODES.has(resolved.slice(3))) {
                yahooSymbol = `${resolved}=X`;
            } else if (FUTURES_CODES.has(resolved)) {
                yahooSymbol = `${resolved}=F`;
            } else {
                yahooSymbol = resolved;
            }
            console.log('[stock-price] request:', symbol);
            const startTime = Date.now();
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1d&includePrePost=true`,
                responseType: 'json',
                timeout: 5000,
                onload(response) {
                    const duration = Date.now() - startTime;
                    const gap = startTime - lastRequestTime;
                    lastRequestTime = startTime;
                    requestCount++;
                    const entry = { time: new Date().toISOString(), symbol, status: response.status, duration, gap, queueLen: pendingFetches.size };
                    requestLog.push(entry);
                    if (requestLog.length > 200) requestLog.shift();

                    if (response.status === 429) {
                        console.warn(`[stock-price] ⚠️ 429 RATE LIMITED ${symbol} (gap=${gap}ms, duration=${duration}ms, queue=${pendingFetches.size})`);
                        resolve(null);
                        return;
                    }
                    console.log(`[stock-price] ✓ ${symbol} ${response.status} ${duration}ms (gap=${gap}ms, queue=${pendingFetches.size}, total=#${requestCount})`);
                    try {
                        const data = typeof response.response === 'string'
                            ? JSON.parse(response.response)
                            : response.response;
                        const meta = data?.chart?.result?.[0]?.meta;
                        log('fetchPrice', symbol, 'meta:', meta ? 'regularMarketPrice=' + meta.regularMarketPrice + ' tradingPeriod=' + JSON.stringify(meta.currentTradingPeriod?.regular) : 'null');
                        if (meta?.regularMarketPrice != null) {
                            const price = meta.regularMarketPrice;
                            const prevClose = meta.chartPreviousClose ?? meta.previousClose;
                            const change = prevClose ? ((price - prevClose) / prevClose) * 100 : (meta.regularMarketChangePercent ?? 0);
                            const result = {
                                symbol,
                                name: meta.longName || meta.shortName || '',
                                price,
                                change,
                                tradingPeriod: meta.currentTradingPeriod
                            };
                            // Post-market data
                            if (meta.postMarketPrice != null) {
                                result.postPrice = meta.postMarketPrice;
                                result.postChange = meta.postMarketChangePercent ?? (prevClose ? ((meta.postMarketPrice - price) / price) * 100 : 0);
                            }
                            // Pre-market data
                            if (meta.preMarketPrice != null) {
                                result.prePrice = meta.preMarketPrice;
                                result.preChange = meta.preMarketChangePercent ?? (prevClose ? ((meta.preMarketPrice - prevClose) / prevClose) * 100 : 0);
                            }
                            resolve(result);
                        } else {
                            resolve(null);
                        }
                    } catch (e) {
                        resolve(null);
                    }
                },
                onerror() {
                    resolve(null);
                },
                ontimeout() {
                    resolve(null);
                }
            });
        });
    }

    const BATCH_SIZE = 20;
    const BATCH_INTERVAL = 5000;

    async function fetchPrices(symbols, onBatch) {
        const priceMap = new Map();
        const toFetch = [];
        const now = Date.now();

        // Check cache for each symbol, skip pending
        for (const symbol of symbols) {
            if (pendingFetches.has(symbol)) continue;
            const cached = priceCache.get(symbol);
            if (cached && (now - cached.timestamp) < CACHE_TTL) {
                priceMap.set(symbol, cached.data);
            } else {
                toFetch.push(symbol);
            }
        }

        if (toFetch.length === 0) {
            if (onBatch && priceMap.size > 0) onBatch(priceMap);
            return priceMap;
        }

        // Mark all as pending immediately to prevent duplicate requests
        toFetch.forEach(s => pendingFetches.add(s));

        // Fetch in batches of 20, with 5s between batches
        for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
            const batch = toFetch.slice(i, i + BATCH_SIZE);
            console.log(`[stock-price] batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(toFetch.length / BATCH_SIZE)}: ${batch.join(', ')}`);
            const results = await Promise.all(batch.map(s => fetchPrice(s)));
            for (const result of results) {
                if (result) {
                    priceMap.set(result.symbol, result);
                    priceCache.set(result.symbol, { data: result, timestamp: Date.now() });
                }
            }
            // Remove from pending
            batch.forEach(s => pendingFetches.delete(s));
            // Notify caller after each batch so DOM can update progressively
            if (onBatch && priceMap.size > 0) onBatch(priceMap);
            if (i + BATCH_SIZE < toFetch.length) {
                console.log(`[stock-price] waiting ${BATCH_INTERVAL}ms before next batch...`);
                await new Promise(r => setTimeout(r, BATCH_INTERVAL));
            }
        }

        return priceMap;
    }

    // ─── Task 4: Styles ───────────────────────────────────────────────────

    GM_addStyle(`
        .sp-stock-link {
            color: inherit;
            text-decoration: none;
            border-bottom: 1px dashed currentColor;
            cursor: pointer;
            white-space: nowrap;
        }

        .sp-stock-link:hover {
            border-bottom-style: solid;
        }

        .sp-stock-price {
            font-size: 0.85em;
            margin-left: 2px;
        }

        .sp-stock-price.sp-up {
            color: #16a34a;
        }

        .sp-stock-price.sp-down {
            color: #dc2626;
        }

        .sp-stock-price.sp-flat {
            color: #ffffff;
        }

        .sp-stock-price.sp-closed.sp-up {
            color: #4a7c5c;
        }

        .sp-stock-price.sp-closed.sp-down {
            color: #8b4e4e;
        }

        .sp-stock-price.sp-closed.sp-flat {
            color: #888888;
        }

        .sp-after-hours {
            opacity: 0.6;
            font-size: 0.9em;
        }

        .sp-stock-title {
            white-space: nowrap;
        }

        .sp-stock-title .sp-stock-price {
            font-size: 0.75em;
        }
    `);

    // ── Market session helper ──────────────────────────────────────────────

    function getMarketSession(tp) {
        if (!tp?.regular) return 'unknown';
        const now = Date.now() / 1000;
        if (now < tp.regular.start) {
            return tp.pre && now >= tp.pre.start ? 'pre' : 'closed';
        }
        if (now >= tp.regular.start && now < tp.regular.end) return 'regular';
        if (tp.post && now >= tp.post.start && now < tp.post.end) return 'post';
        return 'closed';
    }

    function formatChange(val) {
        return val >= 0 ? `+${val.toFixed(2)}` : val.toFixed(2);
    }

    function buildPriceContent(symbol, priceData) {
        if (FIAT_CODES.has(symbol)) {
            return `($1=${symbol}${priceData.price.toFixed(2)} ${formatChange(priceData.change)}%)`;
        }

        const session = getMarketSession(priceData.tradingPeriod);
        const isClosed = session === 'closed';
        const prefix = isClosed ? 'C' : '';

        // Regular price portion (plain text)
        let text = `(${prefix}${priceData.price.toFixed(2)} ${formatChange(priceData.change)}%)`;

        // After-hours (pre/post)
        const afterPrice = session === 'post' ? priceData.postPrice : session === 'pre' ? priceData.prePrice : null;
        const afterChange = session === 'post' ? priceData.postChange : session === 'pre' ? priceData.preChange : null;

        if (afterPrice != null) {
            const afterClass = afterChange > 0 ? 'sp-up' : afterChange < 0 ? 'sp-down' : 'sp-flat';
            text += `<span class="sp-after-hours ${afterClass}"> · P${afterPrice.toFixed(2)} ${formatChange(afterChange)}%</span>`;
        }

        return text;
    }

    // ─── Task 5: Text Node Replacement + Main Process ─────────────────────

    function buildStockRegex(symbols) {
        const sorted = [...symbols].sort((a, b) => b.length - a.length);
        const escaped = sorted.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const pattern = escaped.join('|');
        return new RegExp(
            `\\$(${pattern})(?![A-Za-z0-9])|(?<![A-Za-z$\\d'’‘])(${pattern})(?![A-Za-z\\d.])`,
            'gi'
        );
    }

    function replaceInContainer(container, priceMap, isTitle) {
        const symbols = [...priceMap.keys()];
        if (symbols.length === 0) return;

        const regex = buildStockRegex(symbols);

        // Collect text nodes before modifying the DOM
        const walker = document.createTreeWalker(
            container,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    const tag = parent.tagName;
                    if (tag === 'SCRIPT' || tag === 'STYLE') {
                        return NodeFilter.FILTER_REJECT;
                    }
                    // Skip text inside existing links (not our injected ones)
                    // But allow if processing a title — .fancy-title is itself an <a>
                    if (!isTitle && parent.closest('a:not(.sp-stock-link)')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    // Skip text inside <aside> (quoted content)
                    if (parent.closest('aside')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    // Skip username elements
                    if (parent.closest('.username, .names, [data-user-card], .post-avatar, .user-card, .topic-post .row .topic-meta-data')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    if (
                        parent.classList.contains('sp-stock-link') ||
                        parent.classList.contains('sp-stock-title') ||
                        parent.classList.contains('sp-stock-price')
                    ) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        const textNodes = [];
        while (walker.nextNode()) {
            textNodes.push(walker.currentNode);
        }

        for (const textNode of textNodes) {
            const text = textNode.textContent;
            regex.lastIndex = 0;

            const matches = [...text.matchAll(regex)];
            if (matches.length === 0) continue;

            // Keep only matches with valid price data and not in exclude phrases
            const validMatches = matches.filter(m => {
                const symbol = (m[1] || m[2]).toUpperCase();
                if (!priceMap.has(symbol)) return false;
                // Check if this match falls inside an exclude phrase
                const upper = text.toUpperCase();
                for (const phrase of EXCLUDE_PHRASES) {
                    const pUpper = phrase.toUpperCase();
                    let p = 0;
                    while ((p = upper.indexOf(pUpper, p)) !== -1) {
                        if (m.index >= p && m.index < p + pUpper.length) return false;
                        p++;
                    }
                }
                return true;
            });
            if (validMatches.length === 0) continue;

            const fragment = document.createDocumentFragment();
            let lastIndex = 0;

            for (const match of validMatches) {
                const symbol = (match[1] || match[2]).toUpperCase();
                const priceData = priceMap.get(symbol);

                // Text before this match
                if (match.index > lastIndex) {
                    fragment.appendChild(
                        document.createTextNode(text.slice(lastIndex, match.index))
                    );
                }

                // Format price text
                const session = getMarketSession(priceData.tradingPeriod);
                const isClosed = session === 'closed';
                const changeClass = priceData.change > 0 ? 'sp-up' : priceData.change < 0 ? 'sp-down' : 'sp-flat';
                const closedClass = !FIAT_CODES.has(symbol) && isClosed ? ' sp-closed' : '';
                const priceContent = buildPriceContent(symbol, priceData);

                if (isTitle) {
                    const span = document.createElement('span');
                    span.className = 'sp-stock-title';
                    span.textContent = symbol;
                    if (priceData.name) span.title = priceData.name;
                    const priceSpan = document.createElement('span');
                    priceSpan.className = `sp-stock-price ${changeClass}${closedClass}`;
                    priceSpan.innerHTML = priceContent;
                    priceSpan.dataset.spSymbol = symbol;
                    priceSpan.dataset.spTs = Date.now();
                    span.appendChild(priceSpan);
                    fragment.appendChild(span);
                } else {
                    const link = document.createElement('a');
                    link.className = 'sp-stock-link';
                    const quoteSymbol = SYMBOL_ALIASES[symbol]
                        || (CRYPTO_CODES.has(symbol) ? `${symbol}-USD` : null)
                        || (FIAT_CODES.has(symbol) ? `${symbol}=X` : null)
                        || (FUTURES_CODES.has(symbol) ? `${symbol}=F` : null)
                        || symbol;
                    link.href = `https://finance.yahoo.com/quote/${encodeURIComponent(quoteSymbol)}`;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.textContent = symbol;
                    if (priceData.name) link.title = priceData.name;
                    const priceSpan = document.createElement('span');
                    priceSpan.className = `sp-stock-price ${changeClass}${closedClass}`;
                    priceSpan.innerHTML = priceContent;
                    priceSpan.dataset.spSymbol = symbol;
                    priceSpan.dataset.spTs = Date.now();
                    link.appendChild(priceSpan);
                    fragment.appendChild(link);
                }

                lastIndex = match.index + match[0].length;
            }

            // Remaining text after last match
            if (lastIndex < text.length) {
                fragment.appendChild(
                    document.createTextNode(text.slice(lastIndex))
                );
            }

            textNode.parentNode.replaceChild(fragment, textNode);
        }
    }

    const DEBUG = false; // set to true for verbose console logging
    const log = (...args) => { if (DEBUG) console.log('[stock-price]', ...args); };

    const processedPosts = new WeakSet();
    const pagePriceMap = new Map(); // page-level price cache, persists for all dynamically loaded posts
    const deadSymbols = new Set(); // symbols that returned no data — don't retry this session
    const recentlySeen = new Map(); // symbol → last seen timestamp, for refresh priority

    function processNewPosts() {
        if (!isInvestmentCategory()) return;
        const newContainers = [];

        // Title
        const titleEl = document.querySelector('.fancy-title');
        if (titleEl && !processedPosts.has(titleEl)) {
            newContainers.push({ el: titleEl, isTitle: true });
            log('processNewPosts: found new title');
        }

        // Track .cooked elements (Discourse re-renders .cooked inside .topic-post on scroll)
        const cookedEls = document.querySelectorAll('.topic-post .cooked');
        for (const cookedEl of cookedEls) {
            if (!processedPosts.has(cookedEl)) {
                newContainers.push({ el: cookedEl, isTitle: false });
                log('processNewPosts: found new cooked');
            }
        }

        if (newContainers.length === 0) {
            log('processNewPosts: no new containers');
            return;
        }

        log('processNewPosts:', newContainers.length, 'new containers, pagePriceMap size:', pagePriceMap.size);

        // Gather codes from all new containers, skip ones we already have or know are dead
        // Clone and strip <aside> (quotes) to avoid extracting codes from quoted content
        const allCodes = new Set();
        const now = Date.now();
        for (const { el } of newContainers) {
            const cleanEl = el.cloneNode(true);
            cleanEl.querySelectorAll('aside').forEach(a => a.remove());
            for (const code of extractStockCodes(cleanEl)) {
                recentlySeen.set(code, now);
                if (!pagePriceMap.has(code) && !deadSymbols.has(code) && !pendingFetches.has(code)) {
                    allCodes.add(code);
                }
            }
        }

        // Replace already-known codes in new containers immediately
        if (pagePriceMap.size > 0) {
            for (const { el, isTitle } of newContainers) {
                replaceInContainer(el, pagePriceMap, isTitle);
            }
        }

        // Mark as processed only if content has been replaced (contains .sp-stock-link)
        for (const { el, isTitle } of newContainers) {
            const alreadyReplaced = el.querySelector('.sp-stock-link, .sp-stock-title');
            if (alreadyReplaced) {
                processedPosts.add(el);
            }
        }

        if (allCodes.size === 0) return;

        // Fetch only unknown codes, update DOM progressively after each batch
        const codesToFetch = [...allCodes];
        fetchPrices(codesToFetch, (batchMap) => {
            // Merge batch results into page-level map
            for (const [symbol, data] of batchMap) {
                pagePriceMap.set(symbol, data);
            }
            // Update captured containers (may be detached if Discourse re-rendered)
            for (const { el, isTitle } of newContainers) {
                replaceInContainer(el, pagePriceMap, isTitle);
            }
            // Re-scan live DOM — Discourse may have replaced .cooked elements
            // between extraction and fetch completion (bottom-to-top scrolling)
            processNewPosts();
        }).then(freshMap => {
            // Mark codes that returned no data as dead
            for (const code of codesToFetch) {
                if (!freshMap.has(code)) {
                    deadSymbols.add(code);
                    log('processNewPosts: marking dead', code);
                }
            }
        });
    }

    // ─── Task 6: MutationObserver ─────────────────────────────────────────

    // Scan immediately only if blacklist is already populated; otherwise the
    // remote-fetch .then() above will trigger the first scan once it arrives.
    if (_cached) processNewPosts();

    let pendingUpdate = false;
    observer = new MutationObserver(() => {
      if (!pendingUpdate) {
        pendingUpdate = true;
        requestAnimationFrame(() => {
          pendingUpdate = false;
          processNewPosts();
        });
      }
    });

    // Observe both .post-stream and body as fallback for Discourse's dynamic loading
    const postStream = document.querySelector('.post-stream');
    if (postStream) {
        observer.observe(postStream, { childList: true, subtree: true });
    }
    observer.observe(document.body, { childList: true, subtree: true });

    // ─── Periodic Price Refresh ────────────────────────────────────────────

    const REFRESH_INTERVAL = 60000; // 60 seconds per symbol

    const lastRefresh = new Map(); // symbol → timestamp

    async function refreshPrices() {
        log('refreshPrices called, isInvestment:', isInvestmentCategory(), 'symbols:', [...pagePriceMap.keys()].join(','));
        if (!isInvestmentCategory()) return;

        // Sort by recently seen, prioritize top 20
        const now = Date.now();
        const nowS = now / 1000;
        const allSymbols = [...pagePriceMap.keys()]
            .filter(s => !deadSymbols.has(s) && recentlySeen.has(s))
            .sort((a, b) => (recentlySeen.get(b) || 0) - (recentlySeen.get(a) || 0));

        if (allSymbols.length === 0) { log('refreshPrices: no symbols, skipping'); return; }

        // Filter to needs-refresh, then take top 20 by recency
        const needsRefresh = allSymbols.filter(s => {
            const last = lastRefresh.get(s) || 0;
            if (now - last < REFRESH_INTERVAL) return false;
            const priceData = pagePriceMap.get(s);
            const tp = priceData?.tradingPeriod;
            if (tp?.regular && tp.regular.end > nowS - 14400) {
                const session = getMarketSession(tp);
                if (session === 'closed') {
                    log('refresh check:', s, 'market closed, skipping');
                    return false;
                }
            }
            return true;
        });

        const toRefresh = needsRefresh.slice(0, 20);
        if (toRefresh.length === 0) { log('refreshPrices: all up to date, skipping'); return; }

        log('refreshing', toRefresh.length, 'symbols:', toRefresh.join(','));

        function updateSymbolSpans(symbol, priceData) {
            const spans = document.querySelectorAll(`.sp-stock-price[data-sp-symbol="${symbol}"]`);
            if (spans.length === 0) { log('no spans found for', symbol); return; }

            const session = getMarketSession(priceData.tradingPeriod);
            const isClosed = session === 'closed';
            const changeClass = priceData.change > 0 ? 'sp-up' : priceData.change < 0 ? 'sp-down' : 'sp-flat';
            const priceContent = buildPriceContent(symbol, priceData);

            for (const span of spans) {
                span.innerHTML = priceContent;
                span.classList.remove('sp-up', 'sp-down', 'sp-flat');
                span.classList.add(changeClass);
                if (!FIAT_CODES.has(symbol)) {
                    span.classList.toggle('sp-closed', isClosed);
                }
            }
            log('updated', spans.length, 'span(s) for', symbol);
        }

        // Fetch in batches of 20, update DOM after each batch
        for (let i = 0; i < toRefresh.length; i += BATCH_SIZE) {
            const batch = toRefresh.slice(i, i + BATCH_SIZE);
            log('refresh batch:', batch.join(', '));
            const results = await Promise.all(batch.map(s => fetchPrice(s)));
            for (let j = 0; j < batch.length; j++) {
                const symbol = batch[j];
                const result = results[j];
                lastRefresh.set(symbol, Date.now());
                if (result) {
                    pagePriceMap.set(symbol, result);
                    priceCache.set(symbol, { data: result, timestamp: Date.now() });
                    updateSymbolSpans(symbol, result);
                } else {
                    log('fetch failed, marking dead:', symbol);
                    deadSymbols.add(symbol);
                    pagePriceMap.delete(symbol);
                }
            }
            if (i + BATCH_SIZE < toRefresh.length) {
                await new Promise(r => setTimeout(r, BATCH_INTERVAL));
            }
        }

        log('refresh complete');
    }

    refreshTimer = setInterval(refreshPrices, 60000);
    log('refresh timer set, interval 60s');

    // Expose debug helpers on window
    window.__stockPriceDebug = {
        getLog() {
            return requestLog;
        },
        stats() {
            const total = requestLog.length;
            if (total === 0) return 'No requests yet';
            const byStatus = {};
            let minGap = Infinity, maxGap = 0, sumGap = 0, gaps = [];
            for (const e of requestLog) {
                byStatus[e.status] = (byStatus[e.status] || 0) + 1;
                if (e.gap > 0) { gaps.push(e.gap); sumGap += e.gap; }
            }
            if (gaps.length) { minGap = Math.min(...gaps); maxGap = Math.max(...gaps); }
            const avgGap = gaps.length ? Math.round(sumGap / gaps.length) : 0;
            const rateLimited = requestLog.filter(e => e.status === 429).length;
            return `Total: ${total}, Rate limited: ${rateLimited}, Avg gap: ${avgGap}ms, Min gap: ${minGap}ms, Max gap: ${maxGap}ms, Status: ${JSON.stringify(byStatus)}`;
        },
        recent(n = 20) {
            return requestLog.slice(-n);
        },
        symbols() {
            return { pagePriceMap: [...pagePriceMap.keys()], deadSymbols: [...deadSymbols], pending: [...pendingFetches] };
        }
    };
    // Allow clearing cache from page console (DOM events cross the TM sandbox):
    //   document.dispatchEvent(new Event('sp-clear-cache'))
    // then reload to trigger a fresh auto-fetch.
    document.addEventListener('sp-clear-cache', function () {
        GM_setValue(GMK_CACHE, null);
        GM_setValue(GMK_VER, '');
        console.log('[stock-price] cache cleared (sp_blacklist_cache + sp_last_script_ver). Reload to refetch.');
        alert('黑名单缓存已清除，刷新页面后会重新拉取');
    });

    console.log('[stock-price] Debug: use __stockPriceDebug.stats(), .recent(), .symbols(), .getLog()');

    initialized = true;

    } // end of init()

    // Poll for SPA navigation — Discourse changes body classes without reloading
    // Also handles initial page load where body classes aren't ready yet
    const POLL_INTERVAL = 1000;
    let lastCategoryState = false;
    const poll = setInterval(() => {
        const isInvest = isInvestmentCategory();
        if (isInvest && !initialized) {
            lastCategoryState = true;
            init();
        } else if (!isInvest && initialized) {
            lastCategoryState = false;
            stop();
        }
    }, POLL_INTERVAL);
})();
