// ==UserScript==
// @name         USCardForum Stock Price
// @namespace    http://tampermonkey.net/
// @version      0.4.2
// @description  Show stock prices inline on USCardForum investment category
// @match        https://www.uscardforum.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      query1.finance.yahoo.com
// @connect      raw.githubusercontent.com
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // #region core
    // ═══════════════════════════════════════════════════════════════════════
    // 纯逻辑：不碰 DOM、不调 GM_*。run-tests.js 直接截取本段执行测试，
    // 所以这里的函数就是测试覆盖的函数，不要在测试里另抄一份。
    // ═══════════════════════════════════════════════════════════════════════

    // ── 配置：全部来自远程 blacklist.json（applyRemoteData 填充），初始为空 ──
    const EXCLUDE_CODES = new Set();
    const EXCLUDE_PHRASES = [];
    const SYMBOL_ALIASES = {};
    const CRYPTO_CODES = new Set();
    const FIAT_CODES = new Set();
    const FUTURES_CODES = new Set();
    const SHORT_CODE_WHITELIST = new Set();
    const COMMON_WORDS = new Set();

    // blacklist.json 字段名 → 对应的大写代码集合
    const CODE_SET_FIELDS = {
        excludeCodes: EXCLUDE_CODES,
        cryptoCodes: CRYPTO_CODES,
        fiatCodes: FIAT_CODES,
        futuresCodes: FUTURES_CODES,
        shortCodeWhitelist: SHORT_CODE_WHITELIST,
        commonWords: COMMON_WORDS,
    };

    // 语法词：出现即说明是英文句子，不是代码列表（随脚本发布，不走远程）
    const GRAMMAR_WORDS = new Set([
        'THE','A','AN','IS','AM','ARE','WAS','WERE','BE','BEEN','BEING',
        'HAVE','HAS','HAD','DO','DOES','DID','WILL','WOULD','COULD','SHOULD',
        'MAY','MIGHT','SHALL','CAN','TO','OF','IN','FOR','ON','WITH','AT',
        'BY','FROM','AS','INTO','THROUGH','DURING','BEFORE','AFTER','ABOVE',
        'BELOW','BETWEEN','UNDER','OVER','AND','BUT','OR','NOR','NOT','SO',
        'YET','IF','THAN','THAT','THIS','IT','HE','SHE','WE','THEY','MY',
        'YOUR','HIS','HER','ITS','OUR','ME','HIM','US','THEM','WHAT','WHICH',
        'WHO','WHEN','WHERE','HOW','I','WHY',
    ]);

    // 清空全部配置，再按 JSON 里出现的字段重新填充（单一来源 = blacklist.json）
    function applyRemoteData(data) {
        for (const set of Object.values(CODE_SET_FIELDS)) set.clear();
        EXCLUDE_PHRASES.length = 0;
        for (const k of Object.keys(SYMBOL_ALIASES)) delete SYMBOL_ALIASES[k];

        if (!data || typeof data !== 'object') return;
        for (const [field, set] of Object.entries(CODE_SET_FIELDS)) {
            if (!Array.isArray(data[field])) continue;
            for (const c of data[field]) {
                if (typeof c === 'string') set.add(c.toUpperCase());
            }
        }
        if (Array.isArray(data.excludePhrases)) {
            for (const p of data.excludePhrases) {
                if (typeof p === 'string') EXCLUDE_PHRASES.push(p);
            }
        }
        if (data.aliases && typeof data.aliases === 'object' && !Array.isArray(data.aliases)) {
            for (const [k, v] of Object.entries(data.aliases)) {
                if (typeof v === 'string') SYMBOL_ALIASES[String(k).toUpperCase()] = v;
            }
        }
    }

    function configCounts() {
        return {
            codes: EXCLUDE_CODES.size,
            phrases: EXCLUDE_PHRASES.length,
            aliases: Object.keys(SYMBOL_ALIASES).length,
        };
    }

    // 去掉 JSONC 注释（// 行注释、/* 块注释 */）和尾逗号，再交给 JSON.parse。
    // blacklist.json 的字符串里不会出现 // 或 /*，所以这样处理是安全的。
    function stripJsonc(text) {
        return text
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1')
            .replace(/,\s*([}\]])/g, '$1');
    }

    // ── 段落分类 ────────────────────────────────────────────────────────────

    function classifyParagraph(para) {
        if (/[^\x00-\x7F]/.test(para)) return 'chinese';
        const words = [...para.matchAll(/[A-Za-z.']+/g)].map(m => m[0].toUpperCase());
        if (words.some(w => GRAMMAR_WORDS.has(w))) return 'prose';
        if (words.length > 10) return 'prose';
        return 'codelist';
    }

    function isTickerLike(word) {
        if (word.length >= 3 && !COMMON_WORDS.has(word.toUpperCase())) return true;
        if (word.length >= 2 && word === word.toUpperCase()) return true;
        if (word.includes('.')) return true;
        const upper = word.toUpperCase();
        if (SHORT_CODE_WHITELIST.has(upper)) return true;
        if (SYMBOL_ALIASES[upper]) return true;
        if (FUTURES_CODES.has(upper)) return true;
        return false;
    }

    function isAcceptedCode(code) {
        if (SHORT_CODE_WHITELIST.has(code) || SYMBOL_ALIASES[code] || FUTURES_CODES.has(code)) return true;
        const dotIdx = code.indexOf('.');
        if (dotIdx >= 0 && code.length - dotIdx - 1 < 2) return false;
        return code.length >= 3;
    }

    // 按行切段；连续的同类英文段合并成一组。offset 是该组在原文中的起点。
    function groupParagraphs(text) {
        const paragraphs = text.split(/\n/);
        const groups = [];
        let offset = 0;

        for (let i = 0; i < paragraphs.length;) {
            const para = paragraphs[i];
            const type = classifyParagraph(para);

            if (type === 'chinese' || para === '') {
                groups.push({ type, text: para, offset });
                offset += para.length + 1;
                i++;
                continue;
            }
            let segText = para;
            let j = i + 1;
            while (j < paragraphs.length && classifyParagraph(paragraphs[j]) === type) {
                segText += '\n' + paragraphs[j];
                j++;
            }
            groups.push({ type, text: segText, offset });
            offset += segText.length + 1;
            i = j;
        }
        return groups;
    }

    // ── 第 1 步：$EXACT ─────────────────────────────────────────────────────

    const RE_EXACT = /\$([A-Za-z0-9.\-=^]*[A-Za-z0-9])/g;

    function collectExactCodes(text) {
        const codes = new Set();
        for (const m of text.matchAll(RE_EXACT)) {
            const code = m[1].toUpperCase();
            if (/[A-Z]/.test(code)) codes.add(code);
        }
        return codes;
    }

    // ── 第 2 步：跳过区间 & 特殊格式 ─────────────────────────────────────────
    // 区间一律是 [start, end)，以全文为坐标（offset + 组内位置）

    function buildExactZones(text, offset) {
        const zones = [];
        for (const m of text.matchAll(RE_EXACT)) {
            zones.push([offset + m.index, offset + m.index + m[0].length]);
        }
        return zones;
    }

    const RE_DOT_CODE = /(?<![A-Za-z\d])([A-Za-z0-9]+\.([A-Za-z]{1,2}))(?![A-Za-z\d])/gi;

    // 9020.T、SHOP.TO 一类：数字开头，或后缀两个字母
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

    const RE_FOREX = /(?<![A-Za-z\d])([A-Za-z]{6})(?![A-Za-z])(=?([A-Za-z]))?(?![A-Za-z\d])/g;

    // CADCNY、USDJPY=X 一类：前后三个字母都是法币
    function collectForexPairs(text, offset) {
        const codes = new Set();
        const zones = [];
        for (const m of text.matchAll(RE_FOREX)) {
            const pair = m[1].toUpperCase();
            if (!FIAT_CODES.has(pair.slice(0, 3)) || !FIAT_CODES.has(pair.slice(3))) continue;
            codes.add(m[2] ? pair + '=' + m[3].toUpperCase() : pair);
            zones.push([offset + m.index, offset + m.index + m[0].length]);   // 含 =X 后缀
        }
        return { codes, zones };
    }

    // 中文段里夹的英文句子（≥3 个词且含语法词）整体跳过
    function buildGrammarZones(text, offset) {
        const zones = [];
        for (const m of text.matchAll(/[A-Za-z']+(?:[^A-Za-z'\n一-鿿぀-ゟ가-힯]+[A-Za-z']+)+/g)) {
            const words = m[0].split(/[^A-Za-z']+/).filter(Boolean).map(w => w.toUpperCase());
            if (words.length >= 3 && words.some(w => GRAMMAR_WORDS.has(w))) {
                zones.push([offset + m.index, offset + m.index + m[0].length]);
            }
        }
        return zones;
    }

    // excludePhrases 在 text 中的出现位置（不区分大小写）。
    // wordBoundary=true 时要求短语前后不是字母。
    function findPhraseZones(text, offset, wordBoundary) {
        const zones = [];
        const upper = text.toUpperCase();
        for (const phrase of EXCLUDE_PHRASES) {
            const pUpper = phrase.toUpperCase();
            let p = 0;
            while ((p = upper.indexOf(pUpper, p)) !== -1) {
                const before = p > 0 ? upper[p - 1] : ' ';
                const after = upper[p + pUpper.length] || ' ';
                if (!wordBoundary || (!/[A-Z]/.test(before) && !/[A-Z]/.test(after))) {
                    zones.push([offset + p, offset + p + pUpper.length]);
                }
                p++;
            }
        }
        return zones;
    }

    function inZones(pos, zones) {
        return zones.some(([s, e]) => pos >= s && pos < e);
    }

    const RE_STANDALONE = /(?<![A-Za-z\d'])([A-Za-z]{1,5}(?:\.[A-Za-z])?)(?![A-Za-z\d:])/g;

    function collectStandalone(text, offset, zones) {
        const codes = new Set();
        for (const m of text.matchAll(RE_STANDALONE)) {
            if (inZones(offset + m.index, zones)) continue;
            const code = m[1].toUpperCase();
            if (isAcceptedCode(code)) codes.add(code);
        }
        return codes;
    }

    // ── 提取主流程 ──────────────────────────────────────────────────────────

    function extractStockCodes(container) {
        const text = container.textContent || '';

        // 第 1 步：$EXACT（全文，不分段）
        const exactCodes = collectExactCodes(text);

        // 第 2 步：逐组提取
        const standaloneCodes = new Set();
        for (const group of groupParagraphs(text)) {
            if (group.type === 'prose') continue;   // 英文句子：只认 $EXACT

            if (group.type === 'codelist') {
                const words = [...group.text.matchAll(/[A-Za-z0-9.]+/g)].map(m => m[0]);
                if (!words.some(isTickerLike)) continue;
            }

            const { text: gText, offset } = group;
            const dot = collectDotCodes(gText, offset);
            const forex = collectForexPairs(gText, offset);
            const zones = [
                ...buildExactZones(gText, offset),
                ...dot.zones,
                ...forex.zones,
                ...(group.type === 'chinese' ? buildGrammarZones(gText, offset) : []),
                ...findPhraseZones(gText, offset, true),
            ];

            for (const c of dot.codes) standaloneCodes.add(c);
            for (const c of forex.codes) standaloneCodes.add(c);
            for (const c of collectStandalone(gText, offset, zones)) standaloneCodes.add(c);
        }

        // 第 3 步：过滤常用词 / 排除代码后合并
        const filtered = [...standaloneCodes]
            .filter(code => !COMMON_WORDS.has(code) && !EXCLUDE_CODES.has(code));
        return [...new Set([...exactCodes, ...filtered])];
    }

    // ── Yahoo 代码 / 行情 ───────────────────────────────────────────────────

    // 论坛里的写法 → Yahoo Finance 代码：别名 → 加密货币 -USD / 法币与外汇对 =X / 期货 =F
    function resolveYahooSymbol(symbol) {
        const resolved = SYMBOL_ALIASES[symbol] || symbol;
        if (CRYPTO_CODES.has(resolved)) return `${resolved}-USD`;
        if (FIAT_CODES.has(resolved)) return `${resolved}=X`;
        if (/^[A-Z]{6}$/.test(resolved) && FIAT_CODES.has(resolved.slice(0, 3)) && FIAT_CODES.has(resolved.slice(3))) {
            return `${resolved}=X`;
        }
        if (FUTURES_CODES.has(resolved)) return `${resolved}=F`;
        return resolved;
    }

    // 'pre' | 'regular' | 'post' | 'closed' | 'unknown'；tp 是 Yahoo 的 currentTradingPeriod
    function getMarketSession(tp, nowS = Date.now() / 1000) {
        if (!tp?.regular) return 'unknown';
        if (nowS < tp.regular.start) {
            return tp.pre && nowS >= tp.pre.start ? 'pre' : 'closed';
        }
        if (nowS < tp.regular.end) return 'regular';
        if (tp.post && nowS >= tp.post.start && nowS < tp.post.end) return 'post';
        return 'closed';
    }

    function isCacheExpired(timestamp, now, ttl) {
        return (now - timestamp) >= ttl;
    }

    function sortByRecentlySeen(symbols, recentlySeen) {
        return [...symbols].sort((a, b) => (recentlySeen.get(b) || 0) - (recentlySeen.get(a) || 0));
    }

    // 按代码散列出 ±30s 的抖动，让各代码的缓存过期/刷新时间错开
    function symbolJitter(symbol) {
        let hash = 0;
        for (let i = 0; i < symbol.length; i++) {
            hash = ((hash << 5) - hash) + symbol.charCodeAt(i);
        }
        return (Math.abs(hash) % 60001) - 30000;
    }

    function getChangeClass(change) {
        if (change > 0) return 'sp-up';
        if (change < 0) return 'sp-down';
        return 'sp-flat';
    }

    function formatChange(val) {
        return val >= 0 ? `+${val.toFixed(2)}` : val.toFixed(2);
    }

    // 价格标签的 HTML：(C123.45 +1.23%)，盘前盘后追加 · P 价格
    function buildPriceContent(symbol, priceData, nowS) {
        if (FIAT_CODES.has(symbol)) {
            return `(1=${symbol}${priceData.price.toFixed(2)} ${formatChange(priceData.change)}%)`;
        }

        const session = getMarketSession(priceData.tradingPeriod, nowS);
        const prefix = session === 'closed' ? 'C' : '';
        let html = `(${prefix}${priceData.price.toFixed(2)} ${formatChange(priceData.change)}%)`;

        const afterPrice = session === 'post' ? priceData.postPrice : session === 'pre' ? priceData.prePrice : null;
        const afterChange = session === 'post' ? priceData.postChange : session === 'pre' ? priceData.preChange : null;
        if (afterPrice != null) {
            html += `<span class="sp-after-hours ${getChangeClass(afterChange)}"> · P${afterPrice.toFixed(2)} ${formatChange(afterChange)}%</span>`;
        }
        return html;
    }

    // 匹配 $SYM 或独立出现的 SYM；长代码优先
    function buildStockRegex(symbols) {
        const escaped = [...symbols]
            .sort((a, b) => b.length - a.length)
            .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const pattern = escaped.join('|');
        return new RegExp(
            `\\$(${pattern})(?![A-Za-z0-9])|(?<![A-Za-z$\\d'’‘])(${pattern})(?![A-Za-z\\d.])`,
            'gi'
        );
    }

    // #endregion core

    const DEBUG = false; // 改成 true 打开详细日志
    const log = (...args) => { if (DEBUG) console.log('[stock-price]', ...args); };

    // ═══════════════════════════════════════════════════════════════════════
    // Toast 提示（代替阻塞的 alert）
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

    let toastContainer = null;
    function getToastContainer() {
        if (toastContainer && toastContainer.isConnected) return toastContainer;
        toastContainer = document.createElement('div');
        toastContainer.id = 'sp-toast-container';
        document.body.appendChild(toastContainer);
        return toastContainer;
    }

    function selectEl(el) {
        const range = document.createRange();
        range.selectNode(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    // opts.url：附带一个点击即复制的链接
    function showToast(msg, type = 'info', duration = 5000, opts = null) {
        const toast = document.createElement('div');
        toast.className = 'sp-toast sp-toast-' + type;
        const text = document.createElement('span');
        text.className = 'sp-toast-text';
        text.textContent = msg;
        toast.appendChild(text);

        if (opts && opts.url) {
            const urlEl = document.createElement('code');
            urlEl.className = 'sp-toast-url';
            urlEl.textContent = opts.url;
            urlEl.title = '点击复制链接';
            urlEl.onclick = () => {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(opts.url).then(
                        () => showToast('链接已复制', 'success', 1500),
                        () => selectEl(urlEl)
                    );
                } else {
                    selectEl(urlEl);
                }
            };
            toast.appendChild(urlEl);
        }

        const closeBtn = document.createElement('span');
        closeBtn.className = 'sp-toast-close';
        closeBtn.textContent = '×';
        toast.appendChild(closeBtn);

        getToastContainer().appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('sp-toast-show'));
        const dismiss = () => {
            toast.classList.remove('sp-toast-show');
            setTimeout(() => { if (toast.isConnected) toast.remove(); }, 300);
        };
        const timer = setTimeout(dismiss, duration);
        closeBtn.onclick = () => { clearTimeout(timer); dismiss(); };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 远程黑名单：默认用仓库里的 JSON，用户可换成自己的 Gist 等
    // ═══════════════════════════════════════════════════════════════════════
    const DEFAULT_BLACKLIST_URL =
        'https://raw.githubusercontent.com/lynkas/uscardforum-userscripts/main/stock-price/blacklist.json';
    const GMK_URL = 'sp_blacklist_url';
    const GMK_CACHE = 'sp_blacklist_cache';
    const GMK_VER = 'sp_last_script_ver';
    const GMK_NOTIFY = 'sp_notify_counts';
    // 脚本版本变化时强制重新拉一次黑名单；直接读 @version，不用手动同步
    const SCRIPT_VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '';

    function getBlacklistUrl() {
        return GM_getValue(GMK_URL, DEFAULT_BLACKLIST_URL);
    }

    // ── 自动同步失败的提示次数：每个 URL 最多提示 NOTIFY_CAP 次，成功后清零 ──
    const NOTIFY_CAP = 2;

    function getNotifyCounts() {
        const v = GM_getValue(GMK_NOTIFY, null);
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    }
    function setNotifyCount(url, n) {
        const counts = getNotifyCounts();
        counts[url] = n;
        GM_setValue(GMK_NOTIFY, counts);
    }
    function shouldNotifyForUrl(url) {
        const n = getNotifyCounts()[url] || 0;
        if (n >= NOTIFY_CAP) return false;
        setNotifyCount(url, n + 1);
        return true;
    }

    // isManual：用户从菜单触发的同步，失败总是提示
    function onSyncResult(r, isManual) {
        const url = getBlacklistUrl();
        if (r.ok) {
            setNotifyCount(url, 0);
            const c = r.counts;
            showToast(`✓ 黑名单同步成功: 代码 ${c.codes} / 短语 ${c.phrases} / 别名 ${c.aliases}`,
                'success', isManual ? 5000 : 3000);
        } else if (isManual || shouldNotifyForUrl(url)) {
            showToast(`✗ 黑名单同步失败: ${r.msg}\n（已保留旧缓存）`, 'error', 6000);
        }
    }

    async function loadRemoteBlacklist() {
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
            if (typeof data !== 'object' || data === null || Array.isArray(data)) {
                throw new Error('JSON 不是对象');
            }

            GM_setValue(GMK_CACHE, data);
            applyRemoteData(data);
            const counts = configCounts();
            console.log('[stock-price] 远程黑名单已加载:', counts);
            return { ok: true, counts };
        } catch (e) {
            return { ok: false, msg: e.message };
        }
    }

    function syncNow() {
        loadRemoteBlacklist().then(r => onSyncResult(r, true));
    }

    function clearBlacklistCache() {
        GM_setValue(GMK_CACHE, null);
        GM_setValue(GMK_VER, '');
        console.log('[stock-price] 已清除 sp_blacklist_cache + sp_last_script_ver，刷新页面后重新拉取');
        alert('黑名单缓存已清除，刷新页面后会重新拉取');
    }

    // ── 菜单 ──

    GM_registerMenuCommand('⚙️ 设置黑名单同步链接…', () => {
        const input = prompt(
            '黑名单 JSON 的链接（需 HTTPS，返回 JSON）：\n\n' +
            '支持任意能 GET 返回 JSON 的地址（GitHub raw、Gist raw、自建服务等）。\n\n' +
            '留空恢复默认。',
            getBlacklistUrl()
        );
        if (input === null) return;
        let url = input.trim();
        if (url === '') {
            url = DEFAULT_BLACKLIST_URL;
            showToast('已恢复默认链接，正在同步…', 'info', 3000);
        } else if (!/^https:\/\/.+/i.test(url)) {
            showToast('✗ 链接格式不对\n需要 https:// 开头的地址', 'error', 6000);
            return;
        }
        GM_setValue(GMK_URL, url);
        setNotifyCount(url, 0);
        syncNow();
    });

    GM_registerMenuCommand('🔄 立即重新同步黑名单', syncNow);

    GM_registerMenuCommand('📋 查看当前生效黑名单', () => {
        const url = getBlacklistUrl();
        const source = GM_getValue(GMK_CACHE, null) ? '远程缓存' : '空（未加载）';
        console.group('[stock-price] 当前黑名单');
        console.log('URL:', url);
        console.log('来源:', source);
        console.log('excludeCodes:', [...EXCLUDE_CODES]);
        console.log('excludePhrases:', [...EXCLUDE_PHRASES]);
        console.log('aliases:', { ...SYMBOL_ALIASES });
        console.groupEnd();
        showToast('已打印到控制台 (F12)\n来源: ' + source, 'info', 8000, { url });
    });

    GM_registerMenuCommand('🧹 清除黑名单缓存（测试）', clearBlacklistCache);

    // 页面控制台也能清缓存（DOM 事件可以穿过 TM 沙箱）：
    //   document.dispatchEvent(new Event('sp-clear-cache'))
    document.addEventListener('sp-clear-cache', clearBlacklistCache);

    // ═══════════════════════════════════════════════════════════════════════
    // 价格标签样式
    // ═══════════════════════════════════════════════════════════════════════
    GM_addStyle(`
        .sp-stock-link {
            color: inherit;
            text-decoration: none;
            border-bottom: 1px dashed currentColor;
            cursor: pointer;
            white-space: nowrap;
        }
        .sp-stock-link:hover { border-bottom-style: solid; }

        .sp-stock-price { font-size: 0.85em; margin-left: 2px; }
        .sp-stock-price.sp-up   { color: #16a34a; }
        .sp-stock-price.sp-down { color: #dc2626; }
        .sp-stock-price.sp-flat { color: #ffffff; }
        .sp-stock-price.sp-closed.sp-up   { color: #4a7c5c; }
        .sp-stock-price.sp-closed.sp-down { color: #8b4e4e; }
        .sp-stock-price.sp-closed.sp-flat { color: #888888; }

        .sp-after-hours { opacity: 0.6; font-size: 0.9em; }

        .sp-stock-title { white-space: nowrap; }
        .sp-stock-title .sp-stock-price { font-size: 0.75em; }
    `);

    // ═══════════════════════════════════════════════════════════════════════
    // 页面判断：只在「理财」分类下工作
    // ═══════════════════════════════════════════════════════════════════════
    function isInvestmentCategory() {
        // body 的 category-investment* 类（含 category-investment-stock-market 等子分类）
        for (const cls of document.body.classList) {
            if (cls.startsWith('category-investment')) return true;
        }
        // 面包屑或分类徽章里含「理财」
        const selectors =
            '.breadcrumb-item, .category-breadcrumb, .breadcrumbs li, ' +
            '.badge-category .category-name, .badge-wrapper .badge-category, .category-name';
        for (const el of document.querySelectorAll(selectors)) {
            if (el.textContent.includes('理财')) return true;
        }
        return false;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 一次「理财页会话」：进入理财分类时 init()，离开时 stop()。
    // 行情缓存、请求队列等状态都在 init() 里，每次进入重新开始。
    // ═══════════════════════════════════════════════════════════════════════
    const CACHE_TTL = 60000;          // 行情缓存 60s（± symbolJitter）
    const REFRESH_INTERVAL = 60000;   // 每个代码 60s 刷新一次（± symbolJitter）
    const REFRESH_MAX = 20;           // 每轮最多刷新最近看到的 20 个
    const BATCH_SIZE = 30;            // 每批并发请求数
    const BATCH_INTERVAL = 5000;      // 批与批之间的间隔
    const POLL_INTERVAL = 1000;       // SPA 跳转检测间隔

    let initialized = false;
    let observer = null;
    let refreshTimer = null;

    function stop() {
        if (observer) { observer.disconnect(); observer = null; }
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
        initialized = false;
    }

    function init() {
        if (initialized || !isInvestmentCategory()) return;
        initialized = true;
        console.log('[stock-price] init()');

        // ── 黑名单：先同步应用缓存；脚本升级或无缓存时再联网拉取 ──
        const cached = GM_getValue(GMK_CACHE, null);
        const versionChanged = GM_getValue(GMK_VER, '') !== SCRIPT_VERSION;
        if (cached) applyRemoteData(cached);
        if (versionChanged) GM_setValue(GMK_VER, SCRIPT_VERSION);
        if (versionChanged || !cached) {
            loadRemoteBlacklist().then(r => {
                onSyncResult(r, false);
                processNewPosts();   // 黑名单到位后再扫一遍
            });
        }

        // ── 会话状态 ──
        const priceCache = new Map();      // symbol → { data, timestamp }，带 TTL
        const pagePriceMap = new Map();    // symbol → data，本页已拿到的行情
        const deadSymbols = new Set();     // 查不到行情的代码，本次会话不再请求
        const recentlySeen = new Map();    // symbol → 最后一次在页面上看到的时间，决定刷新优先级
        const lastRefresh = new Map();     // symbol → 上次刷新时间
        const processedPosts = new WeakSet();

        // ── 请求队列：去重、分批、批间延时；429/网络错误本批丢弃，等下次扫描再排 ──
        const symbolFetchQueue = [];
        const pendingFetches = new Set();  // 正在请求中的代码
        const queueCallbacks = [];
        let queueDraining = false;

        // 调试统计
        let lastRequestTime = 0;
        let requestCount = 0;
        const requestLog = [];             // { time, symbol, status, duration, gap, queueLen }，最多 200 条

        function enqueueSymbols(symbols, onBatch, force) {
            const deduped = symbols.filter(s =>
                !symbolFetchQueue.includes(s) &&
                !pendingFetches.has(s) &&
                !deadSymbols.has(s) &&
                (force || !pagePriceMap.has(s))
            );
            if (deduped.length === 0) return;
            symbolFetchQueue.push(...deduped);
            if (onBatch) queueCallbacks.push(onBatch);
            if (!queueDraining) drainFetchQueue();
        }

        async function drainFetchQueue() {
            queueDraining = true;
            let firstBatch = true;
            while (symbolFetchQueue.length > 0) {
                if (!firstBatch) {
                    log('queue delay', BATCH_INTERVAL, 'ms');
                    await new Promise(r => setTimeout(r, BATCH_INTERVAL));
                }
                firstBatch = false;
                const batch = symbolFetchQueue.splice(0, BATCH_SIZE);
                log('queue batch', batch.join(','));
                batch.forEach(s => pendingFetches.add(s));
                const results = await Promise.all(batch.map(fetchPrice));
                const fetched = [];
                batch.forEach((symbol, i) => {
                    const result = results[i];
                    pendingFetches.delete(symbol);
                    if (result?._retry) return;
                    if (result) {
                        priceCache.set(symbol, { data: result, timestamp: Date.now() });
                        pagePriceMap.set(symbol, result);
                        fetched.push(result);
                    } else {
                        deadSymbols.add(symbol);
                    }
                });
                for (const r of fetched) updateSymbolSpans(r.symbol, r);
                for (const cb of queueCallbacks) {
                    try { cb(pagePriceMap); } catch (e) { /* 回调出错不影响队列 */ }
                }
            }
            queueDraining = false;
            queueCallbacks.length = 0;
        }

        // 返回行情对象；查不到返回 null；需要以后重试返回 { _retry: true }
        function fetchPrice(symbol) {
            return new Promise((resolve) => {
                const yahooSymbol = resolveYahooSymbol(symbol);
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
                        requestLog.push({ time: new Date().toISOString(), symbol, status: response.status, duration, gap, queueLen: pendingFetches.size });
                        if (requestLog.length > 200) requestLog.shift();

                        if (response.status === 429) {
                            console.log('[stock-price] ⚠ rate limited, retry later:', yahooSymbol);
                            resolve({ _retry: true });
                            return;
                        }
                        if (response.status === 404) {
                            console.log('[stock-price] ✗ 404 not found:', yahooSymbol);
                            resolve(null);
                            return;
                        }
                        log(`✓ ${symbol} ${response.status} ${duration}ms (gap=${gap}ms, queue=${pendingFetches.size}, total=#${requestCount})`);
                        try {
                            const data = typeof response.response === 'string'
                                ? JSON.parse(response.response)
                                : response.response;
                            resolve(parseChartMeta(symbol, data?.chart?.result?.[0]?.meta));
                        } catch (e) {
                            resolve(null);
                        }
                    },
                    onerror() { resolve({ _retry: true }); },
                    ontimeout() { resolve({ _retry: true }); },
                });
            });
        }

        function parseChartMeta(symbol, meta) {
            log('fetchPrice', symbol, 'meta:', meta ? 'regularMarketPrice=' + meta.regularMarketPrice + ' tradingPeriod=' + JSON.stringify(meta.currentTradingPeriod?.regular) : 'null');
            if (meta?.regularMarketPrice == null) return null;
            const price = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose ?? meta.previousClose;
            const result = {
                symbol,
                name: meta.longName || meta.shortName || '',
                price,
                change: prevClose ? ((price - prevClose) / prevClose) * 100 : (meta.regularMarketChangePercent ?? 0),
                tradingPeriod: meta.currentTradingPeriod,
            };
            if (meta.postMarketPrice != null) {
                result.postPrice = meta.postMarketPrice;
                result.postChange = meta.postMarketChangePercent ?? (prevClose ? ((meta.postMarketPrice - price) / price) * 100 : 0);
            }
            if (meta.preMarketPrice != null) {
                result.prePrice = meta.preMarketPrice;
                result.preChange = meta.preMarketChangePercent ?? (prevClose ? ((meta.preMarketPrice - prevClose) / prevClose) * 100 : 0);
            }
            return result;
        }

        // 缓存命中的立即回调；其余进队列，每批完成后回调 onBatch(pagePriceMap)
        function fetchPrices(symbols, onBatch) {
            const priceMap = new Map();
            const retrySymbols = new Set();
            const now = Date.now();
            const toFetch = [];

            for (const symbol of symbols) {
                if (pendingFetches.has(symbol)) continue;
                const cached = priceCache.get(symbol);
                if (cached && !isCacheExpired(cached.timestamp, now, CACHE_TTL + symbolJitter(symbol))) {
                    priceMap.set(symbol, cached.data);
                } else {
                    toFetch.push(symbol);
                }
            }

            if (onBatch && priceMap.size > 0) onBatch(priceMap);
            if (toFetch.length === 0) return { priceMap, retrySymbols };

            enqueueSymbols(toFetch, onBatch);

            for (const symbol of toFetch) {
                if (pagePriceMap.has(symbol)) {
                    priceMap.set(symbol, pagePriceMap.get(symbol));
                } else if (!deadSymbols.has(symbol)) {
                    retrySymbols.add(symbol);
                }
            }
            return { priceMap, retrySymbols };
        }

        // ── DOM：价格标签 ──

        function renderPriceSpan(span, symbol, priceData) {
            const closed = !FIAT_CODES.has(symbol) && getMarketSession(priceData.tradingPeriod) === 'closed';
            span.className = `sp-stock-price ${getChangeClass(priceData.change)}${closed ? ' sp-closed' : ''}`;
            span.innerHTML = buildPriceContent(symbol, priceData);
            span.dataset.spSymbol = symbol;
            span.dataset.spTs = Date.now();
        }

        function updateSymbolSpans(symbol, priceData) {
            for (const span of document.querySelectorAll(`.sp-stock-price[data-sp-symbol="${symbol}"]`)) {
                renderPriceSpan(span, symbol, priceData);
            }
        }

        // 标题里用 span（.fancy-title 本身就是 <a>），正文里用指向 Yahoo 的链接
        function createStockElement(symbol, priceData, isTitle) {
            let el;
            if (isTitle) {
                el = document.createElement('span');
                el.className = 'sp-stock-title';
            } else {
                el = document.createElement('a');
                el.className = 'sp-stock-link';
                el.href = `https://finance.yahoo.com/quote/${encodeURIComponent(resolveYahooSymbol(symbol))}`;
                el.target = '_blank';
                el.rel = 'noopener noreferrer';
            }
            el.textContent = symbol;
            if (priceData.name) el.title = priceData.name;
            const priceSpan = document.createElement('span');
            renderPriceSpan(priceSpan, symbol, priceData);
            el.appendChild(priceSpan);
            return el;
        }

        const SKIP_SELECTOR =
            'aside, ' +   // 引用
            '.username, .names, [data-user-card], .post-avatar, .user-card, .topic-post .row .topic-meta-data';

        function acceptTextNode(node, isTitle) {
            const parent = node.parentElement;
            if (!parent) return false;
            if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') return false;
            // 跳过原有链接里的文字；标题例外（.fancy-title 本身就是 <a>）
            if (!isTitle && parent.closest('a:not(.sp-stock-link)')) return false;
            if (parent.closest(SKIP_SELECTOR)) return false;
            const cl = parent.classList;
            return !(cl.contains('sp-stock-link') || cl.contains('sp-stock-title') || cl.contains('sp-stock-price'));
        }

        function replaceInContainer(container, priceMap, isTitle) {
            if (priceMap.size === 0) return;
            const regex = buildStockRegex(priceMap.keys());

            // 先收集文本节点，再改 DOM
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
                acceptNode: node => acceptTextNode(node, isTitle) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
            });
            const textNodes = [];
            while (walker.nextNode()) textNodes.push(walker.currentNode);

            for (const textNode of textNodes) {
                const text = textNode.textContent;
                const phraseZones = findPhraseZones(text, 0, false);
                const matches = [...text.matchAll(regex)].filter(m =>
                    priceMap.has((m[1] || m[2]).toUpperCase()) && !inZones(m.index, phraseZones)
                );
                if (matches.length === 0) continue;

                const fragment = document.createDocumentFragment();
                let lastIndex = 0;
                for (const m of matches) {
                    const symbol = (m[1] || m[2]).toUpperCase();
                    if (m.index > lastIndex) {
                        fragment.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
                    }
                    fragment.appendChild(createStockElement(symbol, priceMap.get(symbol), isTitle));
                    lastIndex = m.index + m[0].length;
                }
                if (lastIndex < text.length) {
                    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
                }
                textNode.parentNode.replaceChild(fragment, textNode);
            }
        }

        // ── 扫描新帖子 ──

        function processNewPosts() {
            if (!isInvestmentCategory()) return;

            // 标题 + 各楼 .cooked（Discourse 滚动时会重建 .topic-post 里的 .cooked）
            const newContainers = [];
            const titleEl = document.querySelector('.fancy-title');
            if (titleEl && !processedPosts.has(titleEl)) newContainers.push({ el: titleEl, isTitle: true });
            for (const el of document.querySelectorAll('.topic-post .cooked')) {
                if (!processedPosts.has(el)) newContainers.push({ el, isTitle: false });
            }
            if (newContainers.length === 0) return;
            log('processNewPosts:', newContainers.length, 'new containers, pagePriceMap size:', pagePriceMap.size);

            // 提取代码：克隆后去掉 <aside>（引用），引用里的代码不算
            const newCodes = new Set();
            const now = Date.now();
            for (const { el } of newContainers) {
                const cleanEl = el.cloneNode(true);
                cleanEl.querySelectorAll('aside').forEach(a => a.remove());
                for (const code of extractStockCodes(cleanEl)) {
                    recentlySeen.set(code, now);
                    if (!pagePriceMap.has(code) && !deadSymbols.has(code) && !pendingFetches.has(code)) {
                        newCodes.add(code);
                    }
                }
            }

            // 已有行情的代码立即替换
            for (const { el, isTitle } of newContainers) {
                replaceInContainer(el, pagePriceMap, isTitle);
                // 真的替换过才标记为已处理，否则等拿到行情后再处理
                if (el.querySelector('.sp-stock-link, .sp-stock-title')) processedPosts.add(el);
            }

            if (newCodes.size === 0) return;

            const codesToFetch = [...newCodes];
            const { priceMap, retrySymbols } = fetchPrices(codesToFetch, (batchMap) => {
                for (const [symbol, data] of batchMap) pagePriceMap.set(symbol, data);
                // 先更新当初抓到的容器（可能已被 Discourse 换掉）
                for (const { el, isTitle } of newContainers) replaceInContainer(el, pagePriceMap, isTitle);
                // 再扫一遍现有 DOM：请求期间 .cooked 可能被重建（从下往上滚时常见）
                requestAnimationFrame(processNewPosts);
            });
            for (const code of codesToFetch) {
                if (!priceMap.has(code) && !retrySymbols.has(code)) {
                    deadSymbols.add(code);
                    log('processNewPosts: marking dead', code);
                }
            }
        }

        // ── 定时刷新：最近看到的优先，闭市的跳过 ──

        function refreshPrices() {
            if (!isInvestmentCategory()) return;
            const now = Date.now();
            const nowS = now / 1000;
            const candidates = sortByRecentlySeen(
                [...pagePriceMap.keys()].filter(s => !deadSymbols.has(s) && recentlySeen.has(s)),
                recentlySeen
            );
            const toRefresh = candidates.filter(s => {
                if (now - (lastRefresh.get(s) || 0) < REFRESH_INTERVAL + symbolJitter(s)) return false;
                // 最近 4 小时内有交易时段的数据，且现在闭市 → 不用刷
                const tp = pagePriceMap.get(s)?.tradingPeriod;
                if (tp?.regular && tp.regular.end > nowS - 14400 && getMarketSession(tp, nowS) === 'closed') {
                    return false;
                }
                return true;
            }).slice(0, REFRESH_MAX);

            if (toRefresh.length === 0) return;
            log('refreshing', toRefresh.length, 'symbols:', toRefresh.join(','));
            toRefresh.forEach(s => lastRefresh.set(s, now));
            enqueueSymbols(toRefresh, null, true);
        }

        // ── 启动 ──

        processNewPosts();

        // DOM 变化时（Discourse 动态加载帖子）按帧合并后重扫
        let pendingUpdate = false;
        observer = new MutationObserver(() => {
            if (pendingUpdate) return;
            pendingUpdate = true;
            requestAnimationFrame(() => {
                pendingUpdate = false;
                processNewPosts();
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });

        refreshTimer = setInterval(refreshPrices, REFRESH_INTERVAL);

        // 控制台调试：__stockPriceDebug.stats() / .recent() / .symbols() / .getLog()
        window.__stockPriceDebug = {
            getLog: () => requestLog,
            recent: (n = 20) => requestLog.slice(-n),
            symbols: () => ({ pagePriceMap: [...pagePriceMap.keys()], deadSymbols: [...deadSymbols], pending: [...pendingFetches] }),
            stats() {
                if (requestLog.length === 0) return 'No requests yet';
                const byStatus = {};
                const gaps = [];
                for (const e of requestLog) {
                    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
                    if (e.gap > 0) gaps.push(e.gap);
                }
                const avgGap = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0;
                const minGap = gaps.length ? Math.min(...gaps) : Infinity;
                const maxGap = gaps.length ? Math.max(...gaps) : 0;
                return `Total: ${requestLog.length}, Rate limited: ${byStatus[429] || 0}, Avg gap: ${avgGap}ms, Min gap: ${minGap}ms, Max gap: ${maxGap}ms, Status: ${JSON.stringify(byStatus)}`;
            },
        };
    }

    // Discourse 是 SPA，换分类不刷新页面；轮询检测进入/离开理财分类（也覆盖首次加载时 body 类尚未就绪）
    setInterval(() => {
        const isInvest = isInvestmentCategory();
        if (isInvest && !initialized) init();
        else if (!isInvest && initialized) stop();
    }, POLL_INTERVAL);
})();
