// ==UserScript==
// @name         USCardForum Stock Price
// @namespace    http://tampermonkey.net/
// @version      0.5.0
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
    //
    // 识别思路：先确认"是不是真实存在的代码"，再看"在这里是不是在说它"。
    //   1. 写法本身就明确的直接认：$NVDA、9020.T / 0700.HK / VOD.L、SHA:600060、USDCNY
    //   2. 其余的词必须在代码清单里（tickers.json：美股 + ETF，另有加密货币/期货/别名）
    //   3. 热门代码且不是常用英文词（NVDA、QQQ）→ 直接认；小写也认（nvda）
    //   4. 常用英文词（ALL、NOW、COST）、冷门代码、公司名（英伟达、Nike）、纯数字代码
    //      → 要有证据：本帖用过 $X / 标题里出现 / 旁边有交易相关的词 / 同一行有别的确定代码
    // ═══════════════════════════════════════════════════════════════════════

    // ── 配置：blacklist.json（applyRemoteData）──
    const EXCLUDE_CODES = new Set();   // 论坛常见缩写，即使是代码也不认（除非写成 $X）
    const EXCLUDE_PHRASES = [];        // 短语内的词不认（cost basis）
    const SYMBOL_ALIASES = {};         // 代码的其他写法 → Yahoo 代码，等同代码（BRK.B → BRK-B）
    const NAME_ALIASES = {};           // 公司名 → Yahoo 代码，要有证据（英伟达 → NVDA）
    const CRYPTO_CODES = new Set();
    const FIAT_CODES = new Set();
    const FUTURES_CODES = new Set();

    // ── 代码清单：tickers.json（applyTickerData，由 tools/build-tickers.js 生成）──
    const POPULAR_TICKERS = new Set(); // 市值 ≥ 20 亿的股票、规模 ≥ 10 亿的 ETF
    const MINOR_TICKERS = new Set();   // 其余上市代码
    const COMMON_WORDS = new Set();    // 英文词频前 5000 里同时是代码的词
    const ENGLISH_WORDS = new Set();   // 词频 5000–20000 里同时是代码的词（小写时不认）

    // 识别过程中推断出的 Yahoo 代码（纯数字代码 → 候选市场），供 resolveYahooSymbol 使用
    const INFERRED_SYMBOLS = new Map();

    const CODE_SET_FIELDS = {
        excludeCodes: EXCLUDE_CODES,
        cryptoCodes: CRYPTO_CODES,
        fiatCodes: FIAT_CODES,
        futuresCodes: FUTURES_CODES,
    };

    function fillMap(target, src) {
        for (const k of Object.keys(target)) delete target[k];
        if (!src || typeof src !== 'object' || Array.isArray(src)) return;
        for (const [k, v] of Object.entries(src)) {
            if (typeof v === 'string') target[String(k).toUpperCase()] = v;
        }
    }

    // 清空 blacklist 配置，再按 JSON 里出现的字段重新填充
    function applyRemoteData(data) {
        for (const set of Object.values(CODE_SET_FIELDS)) set.clear();
        EXCLUDE_PHRASES.length = 0;
        data = data && typeof data === 'object' ? data : {};
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
        fillMap(SYMBOL_ALIASES, data.aliases);
        fillMap(NAME_ALIASES, data.nameAliases);
    }

    function applyTickerData(data) {
        const lists = [[POPULAR_TICKERS, 'popular'], [MINOR_TICKERS, 'minor'],
            [COMMON_WORDS, 'commonWords'], [ENGLISH_WORDS, 'englishWords']];
        for (const [set, field] of lists) {
            set.clear();
            const v = data && data[field];
            const items = typeof v === 'string' ? v.split(/\s+/) : Array.isArray(v) ? v : [];
            for (const s of items) if (s) set.add(String(s).toUpperCase());
        }
    }

    function configCounts() {
        return {
            codes: EXCLUDE_CODES.size,
            phrases: EXCLUDE_PHRASES.length,
            aliases: Object.keys(SYMBOL_ALIASES).length + Object.keys(NAME_ALIASES).length,
            tickers: POPULAR_TICKERS.size + MINOR_TICKERS.size,
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

    // 网址里的片段（www、com、路径）不是代码
    function stripUrls(text) {
        return text.replace(/https?:\/\/\S+|www\.\S+|\S+\.(?:com|org|net|io)\b\S*/gi, m => ' '.repeat(m.length));
    }

    // ── 代码分级 ────────────────────────────────────────────────────────────

    function isListed(U) {
        return POPULAR_TICKERS.has(U) || MINOR_TICKERS.has(U);
    }
    function isKnownCode(U) {
        return isListed(U) || CRYPTO_CODES.has(U) || FUTURES_CODES.has(U) || !!SYMBOL_ALIASES[U];
    }
    function isPopularCode(U) {
        return POPULAR_TICKERS.has(U) || CRYPTO_CODES.has(U) || FUTURES_CODES.has(U) || !!SYMBOL_ALIASES[U];
    }
    // 1–2 个字母的词太容易撞（AB、CD、PS），和英文常用词一样要证据
    function isCommonWord(U) {
        return U.length <= 2 || COMMON_WORDS.has(U);
    }
    // 不需要上下文证据就能认的代码
    function isStrongCode(U) {
        return isPopularCode(U) && !isCommonWord(U);
    }

    // 这种写法能不能当代码：大写；小写只限不像英文词的热门代码（nvda、meta）；公司名不限大小写
    function acceptsForm(U, raw) {
        if (raw === U || NAME_ALIASES[U]) return true;
        return isStrongCode(U) && U.length >= 3 && !ENGLISH_WORDS.has(U);
    }

    // ── 上下文证据 ──────────────────────────────────────────────────────────

    const RE_CUE = /股|仓|倉|涨|漲|跌|买|買|卖|賣|财报|財報|期权|期權|抄底|梭哈|持有|割肉|止损|翻倍|看好|看空|做空|做多|市值|盘前|盘后|call|put|shares?|stock|earnings|\bER\b|\bATH\b/i;
    const RE_FX_CUE = /汇率|匯率|换汇|換匯|兑|兌|贬|貶|升值|外汇|外匯|强|強|弱|涨|漲|跌|新高|新低/;
    // 紧跟在数字后面时是单位而不是代码：93.8 KB、16 GB、5 M
    const UNIT_WORDS = new Set(['KB', 'MB', 'GB', 'TB', 'K', 'M', 'B', 'MM', 'BN', 'KG', 'LB', 'LBS', 'OZ',
        'CM', 'KM', 'FT', 'MPH', 'HZ', 'GHZ', 'MHZ', 'KW', 'KWH', 'MW', 'GW', 'PX', 'DPI', 'FPS']);
    const CUE_WINDOW = 12;

    // 代码前后 w 个字符，但不跨出所在分句（"MU 财报后涨了，AB 方案"里的"涨"不算 AB 的证据）
    const RE_CLAUSE_BREAK = /[，。！？；、,!?;\n]|\.\s/g;
    function nearText(text, start, end, w = CUE_WINDOW) {
        const s0 = Math.max(0, start - w);
        let s = s0, e = Math.min(text.length, end + w);
        for (const m of text.slice(s0, start).matchAll(RE_CLAUSE_BREAK)) s = s0 + m.index + m[0].length;
        const after = text.slice(end, e).search(RE_CLAUSE_BREAK);
        if (after !== -1) e = end + after;
        return text.slice(s, e);
    }

    // ctx：同一个帖子里的线索 { dollar: Set(用 $X 写过的代码), title: Set(标题里的代码/公司名) }
    function hasEvidence(U, text, start, end, ctx) {
        return ctx.dollar.has(U) || ctx.title.has(U) || RE_CUE.test(nearText(text, start, end));
    }

    // ── 明确写法 ────────────────────────────────────────────────────────────

    // $NVDA、$NQ=F、$^GSPC、$.INX、$9020.T、$0700.HK；$250K / $1M 这种金额不算
    const RE_EXACT = /\$([A-Za-z^.](?:[A-Za-z0-9.\-=^]*[A-Za-z0-9])?|\d+\.[A-Za-z]{1,3})(?![A-Za-z0-9])/g;

    function collectExactCodes(text) {
        const codes = new Set();
        for (const m of text.matchAll(RE_EXACT)) {
            if (/[A-Za-z]/.test(m[1])) codes.add(m[1].toUpperCase());
        }
        return codes;
    }

    function buildExactZones(text, offset) {
        const zones = [];
        for (const m of text.matchAll(RE_EXACT)) {
            zones.push([offset + m.index, offset + m.index + m[0].length]);
        }
        return zones;
    }

    // Yahoo Finance 的交易所后缀；左边是常见写法，右边是 Yahoo 用的后缀
    const FOREIGN_SUFFIX = {
        T: 'T', HK: 'HK', SS: 'SS', SH: 'SS', SZ: 'SZ', TO: 'TO', V: 'V', CN: 'CN', NE: 'NE',
        L: 'L', PA: 'PA', DE: 'DE', F: 'F', AS: 'AS', BR: 'BR', MI: 'MI', MC: 'MC', LS: 'LS',
        SW: 'SW', ST: 'ST', OL: 'OL', CO: 'CO', HE: 'HE', IR: 'IR', VI: 'VI',
        AX: 'AX', NZ: 'NZ', KS: 'KS', KQ: 'KQ', TW: 'TW', TWO: 'TWO', SI: 'SI',
        NS: 'NS', BO: 'BO', JK: 'JK', BK: 'BK', KL: 'KL', SA: 'SA', MX: 'MX', TA: 'TA',
    };

    // 9020.T、0700.HK、600519.SS、SHOP.TO、VOD.L
    const RE_SUFFIX_CODE = /(?<![A-Za-z0-9.])([A-Za-z0-9]{1,6})\.([A-Za-z]{1,3})(?![A-Za-z0-9.])/g;

    function collectSuffixCodes(text, offset) {
        const codes = new Set();
        const zones = [];
        for (const m of text.matchAll(RE_SUFFIX_CODE)) {
            const base = m[1], sfx = m[2].toUpperCase();
            if (!FOREIGN_SUFFIX[sfx]) continue;
            const digits = /^\d+$/.test(base);
            // 字母代码要大写且至少 2 位，避免 e.g / U.S / a.m 一类
            if (!digits && (base !== base.toUpperCase() || base.length < 2 || /\d/.test(base))) continue;
            if (m[2] !== sfx && !digits) continue;
            codes.add(`${base.toUpperCase()}.${sfx}`);
            zones.push([offset + m.index, offset + m.index + m[0].length]);
        }
        return { codes, zones };
    }

    // SHA: 600060、SH600519、SZ300750、HK:0700、KRX 005930、TSE 7203
    const MARKET_PREFIX = { SHA: 'SS', SH: 'SS', SSE: 'SS', SHE: 'SZ', SZ: 'SZ', SZSE: 'SZ', HK: 'HK', HKG: 'HK', HKEX: 'HK', KRX: 'KS', KS: 'KS', TSE: 'T', TYO: 'T', TWSE: 'TW' };
    const RE_PREFIX_CODE = /(?<![A-Za-z0-9])(SHA|SHE|SSE|SZSE|SH|SZ|HKEX|HKG|HK|KRX|KS|TSE|TYO|TWSE)\s?[:：]?\s?(\d{4,6})(?![\d.])/g;

    // 纯数字代码前后的市场词
    const MARKET_WORDS = [
        [/港股|港股通|恒生|HK/, 'HK'],
        [/日股|日本|東證|东证|日经|日經/, 'T'],
        [/台股|台湾|台灣/, 'TW'],
        [/韩股|韓股|韩国|韓國|KRX|三星|海力士/, 'KS'],
        [/A股|沪市|滬市|沪|滬|上证|上證/, 'SS'],
        [/深市|深证|深證|创业板|創業板|科创板|科創板/, 'SZ'],
    ];
    // 数字前后是金额/数量的说法 → 不是代码（买房花了600000、工资300000刀、买了1000股）
    const RE_MONEY_AFTER = /^\s?(?:刀|元|块|塊|美元|美金|万|萬|k|K|w|W|USD|CNY|RMB|HKD|JPY|%|年|月|日|号|號|次|个|個|人|股(?![息价價票市份]))/;
    const RE_MONEY_BEFORE = /(?:花了?|贷款?|貸款?|付了?|工资|工資|薪水?|年薪|月薪|收入|存了|首付|总价|總價|价格|價格|预算|預算|[$¥￥])\s?$/;

    function marketNear(text, start, end) {
        const near = nearText(text, start, end, 8);
        for (const [re, mkt] of MARKET_WORDS) if (re.test(near)) return mkt;
        return null;
    }

    // 纯数字代码 → 依次尝试的 Yahoo 代码。6 位：沪(6/9 开头)/深(0/2/3 开头)，查不到再试韩股
    function inferNumericSymbols(digits, market) {
        if (market === 'HK') return [`${String(Number(digits)).padStart(4, '0')}.HK`];
        if (market === 'T' || market === 'TW') return digits.length === 4 ? [`${digits}.${market}`] : [];
        if (digits.length !== 6) return [];
        const cn = market === 'SS' ? ['SS', 'SZ']
            : market === 'SZ' ? ['SZ', 'SS']
            : /^[69]/.test(digits) ? ['SS', 'SZ'] : ['SZ', 'SS'];
        const order = market === 'KS' ? ['KS', 'KQ', ...cn] : [...cn, 'KS', 'KQ'];
        return order.map(s => `${digits}.${s}`);
    }

    function collectNumericCodes(text, offset) {
        const codes = new Set();
        const zones = [];
        const add = (digits, start, end, market) => {
            const cands = inferNumericSymbols(digits, market);
            if (cands.length === 0) return;
            codes.add(digits);
            INFERRED_SYMBOLS.set(digits, cands);
            zones.push([offset + start, offset + end]);
        };
        for (const m of text.matchAll(RE_PREFIX_CODE)) {
            add(m[2], m.index, m.index + m[0].length, MARKET_PREFIX[m[1]]);
        }
        // 6 位：A 股 / 韩股；4–5 位：港股、日股、台股（必须紧跟市场词）
        for (const m of text.matchAll(/(?<![\d.,$¥￥:：A-Za-z])(\d{4,6})(?![\d.,A-Za-z])/g)) {
            const digits = m[1], start = m.index, end = start + digits.length;
            if (zones.some(([s, e]) => offset + start >= s && offset + start < e)) continue;
            if (RE_MONEY_AFTER.test(text.slice(end, end + 4))) continue;
            if (RE_MONEY_BEFORE.test(text.slice(Math.max(0, start - 6), start))) continue;
            const market = marketNear(text, start, end);
            if (digits.length === 6) {
                if (market || RE_CUE.test(nearText(text, start, end))) add(digits, start, end, market);
            } else if (market === 'HK' || ((market === 'T' || market === 'TW') && digits.length === 4)) {
                const before = text.slice(Math.max(0, start - 6), start);
                if (MARKET_WORDS.some(([re]) => re.test(before))) add(digits, start, end, market);
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

    // ── 提取主流程 ──────────────────────────────────────────────────────────

    // 英文词：最长 12 个字母（>5 个字母的只可能是公司名，如 NVIDIA）；BRK.B 这类类别股带一位后缀
    const RE_WORD = /(?<![A-Za-z0-9'$.])([A-Za-z]{1,12}(?:\.[A-Za-z])?)(?![A-Za-z0-9'])/g;

    function cjkNames() {
        return Object.keys(NAME_ALIASES).filter(k => /[^\x00-\x7F]/.test(k)).sort((a, b) => b.length - a.length);
    }

    function emptyContext() {
        return { dollar: new Set(), title: new Set() };
    }

    // 帖子标题 → 线索：标题里的大写代码和公司名
    function titleCodes(title) {
        const out = new Set();
        for (const m of title.matchAll(/(?<![A-Za-z])[A-Z]{1,5}(?![A-Za-z])/g)) out.add(m[0]);
        for (const name of Object.keys(NAME_ALIASES)) {
            if (title.toUpperCase().includes(name)) out.add(name);
        }
        return out;
    }

    function extractStockCodes(text, ctx = emptyContext()) {
        const out = new Set(collectExactCodes(text));
        const suffix = collectSuffixCodes(text, 0);
        const numeric = collectNumericCodes(text, 0);
        const forex = collectForexPairs(text, 0);
        for (const c of [...suffix.codes, ...numeric.codes, ...forex.codes]) out.add(c);
        // explicitZones：写法本身就明确的代码；zones 另含排除短语、已匹配的公司名
        const explicitZones = [...buildExactZones(text, 0), ...suffix.zones, ...numeric.zones, ...forex.zones];
        const zones = [...explicitZones, ...findPhraseZones(text, 0, true)];

        // 中文公司名（长名优先，已匹配的范围不再重复）
        for (const name of cjkNames()) {
            let p = 0;
            while ((p = text.indexOf(name, p)) !== -1) {
                const end = p + name.length;
                if (!inZones(p, zones) && hasEvidence(name, text, p, end, ctx)) out.add(name);
                zones.push([p, end]);
                p = end;
            }
        }

        // 按行统计：{ words: 英文词数, codes: 其中像代码的数, strong: 有没有确定代码 }
        const lineStarts = [0];
        for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
        const lines = new Map();
        const lineAt = (pos) => {
            let lo = 0, hi = lineStarts.length - 1;
            while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1;
            }
            if (!lines.has(lo)) {
                const lineText = text.slice(lineStarts[lo], (lineStarts[lo + 1] || text.length + 1) - 1);
                // 除英文词、数字、标点外还有别的文字（中文等）→ 不是纯代码列表
                const prose = /[^\s\p{P}\p{S}\dA-Za-z]/u.test(lineText);
                lines.set(lo, { words: 0, codes: 0, strong: false, prose });
            }
            return lines.get(lo);
        };
        for (const [s] of explicitZones) lineAt(s).strong = true;
        let anyStrong = out.size > 0;

        const pending = [];     // 需要证据、附近没找到的：最后看所在行
        for (const m of text.matchAll(RE_WORD)) {
            const start = m.index, raw = m[1], end = start + raw.length;
            const line = lineAt(start);
            line.words++;
            if (inZones(start, zones)) {
                if (inZones(start, explicitZones)) line.codes++;
                continue;
            }
            const U = raw.toUpperCase();
            if (EXCLUDE_CODES.has(U) && !ctx.dollar.has(U)) continue;

            if (NAME_ALIASES[U]) {                         // 英文公司名：NIKE、Nvidia
                if (hasEvidence(U, text, start, end, ctx)) out.add(U);
                continue;
            }
            if (U.length > 5 && !U.includes('.')) continue;
            if (U.length === 1) continue;                  // 单字母只认 $X
            const afterNumber = /\d[\d.,]*\s?$/.test(text.slice(Math.max(0, start - 12), start));
            const fiat = FIAT_CODES.has(U);
            if (afterNumber && (UNIT_WORDS.has(U) || fiat)) continue;   // 93.8 KB / 100 USD

            if (fiat) {                                    // 单独的货币代码：说汇率时才认
                if (raw !== U) continue;
                line.codes++;
                if (RE_FX_CUE.test(nearText(text, start, end))) out.add(U);
                else pending.push({ U, line });
                continue;
            }
            if (!isKnownCode(U) || !acceptsForm(U, raw)) continue;
            line.codes++;
            if (isStrongCode(U)) {
                out.add(U);
                line.strong = anyStrong = true;
            } else if (raw === U) {
                if (hasEvidence(U, text, start, end, ctx)) out.add(U);
                else pending.push({ U, line });
            }
        }
        // 同一行有确定代码；或这一行只有代码（≥2 个，或单独一个且本楼有别的确定代码）
        for (const { U, line } of pending) {
            const codeOnly = !line.prose && line.codes === line.words;
            if (line.strong || (codeOnly && (line.words >= 2 || anyStrong))) out.add(U);
        }
        return [...out];
    }

    // ── Yahoo 代码 / 行情 ───────────────────────────────────────────────────

    // 论坛里的写法 → 按顺序尝试的 Yahoo 代码（多数只有一个；纯数字代码可能要试几个市场）
    function yahooCandidates(symbol) {
        const alias = SYMBOL_ALIASES[symbol] || NAME_ALIASES[symbol];
        return alias ? codeCandidates(alias.toUpperCase()) : codeCandidates(symbol);
    }

    function codeCandidates(symbol) {
        if (INFERRED_SYMBOLS.has(symbol)) return INFERRED_SYMBOLS.get(symbol);
        const m = symbol.match(/^([A-Z0-9]+)\.([A-Z]{1,3})$/);
        if (m && FOREIGN_SUFFIX[m[2]]) {
            const sfx = FOREIGN_SUFFIX[m[2]];
            const base = sfx === 'HK' && /^\d+$/.test(m[1]) ? String(Number(m[1])).padStart(4, '0') : m[1];
            return [`${base}.${sfx}`];
        }
        if (m && isListed(symbol)) return [symbol.replace('.', '-')];      // BF.B → BF-B
        if (CRYPTO_CODES.has(symbol)) return [`${symbol}-USD`];
        if (FIAT_CODES.has(symbol)) return [`${symbol}=X`];
        if (/^[A-Z]{6}$/.test(symbol) && FIAT_CODES.has(symbol.slice(0, 3)) && FIAT_CODES.has(symbol.slice(3))) {
            return [`${symbol}=X`];
        }
        if (FUTURES_CODES.has(symbol)) return [`${symbol}=F`];
        return [symbol];
    }

    function resolveYahooSymbol(symbol) {
        return yahooCandidates(symbol)[0];
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

    // 匹配 $SYM 或独立出现的 SYM；长代码优先（中文公司名前后不要求边界）
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

    async function fetchJson(url, timeout) {
        const resp = await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                timeout,
                onload: resolve,
                onerror: () => reject(new Error('网络错误')),
                ontimeout: () => reject(new Error('请求超时')),
                onabort: () => reject(new Error('请求中止')),
            });
        });
        if (resp.status < 200 || resp.status >= 300) throw new Error('HTTP ' + resp.status);
        const data = JSON.parse(stripJsonc(resp.responseText));
        if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('JSON 不是对象');
        return data;
    }

    async function loadRemoteBlacklist() {
        const url = getBlacklistUrl();
        if (!url) return { ok: false, msg: '未配置 URL' };
        try {
            const data = await fetchJson(url, 8000);
            GM_setValue(GMK_CACHE, data);
            applyRemoteData(data);
            const counts = configCounts();
            console.log('[stock-price] 远程黑名单已加载:', counts);
            return { ok: true, counts };
        } catch (e) {
            return { ok: false, msg: e.message };
        }
    }

    // ── 代码清单 tickers.json：每周由 GitHub Action 重新生成；本地缓存 7 天 ──
    const TICKERS_URL =
        'https://raw.githubusercontent.com/lynkas/uscardforum-userscripts/main/stock-price/tickers.json';
    const GMK_TICKERS = 'sp_tickers_cache';   // { fetchedAt, data }
    const TICKERS_TTL = 7 * 24 * 3600 * 1000;

    async function loadTickers() {
        try {
            const data = await fetchJson(TICKERS_URL, 15000);
            GM_setValue(GMK_TICKERS, { fetchedAt: Date.now(), data });
            applyTickerData(data);
            console.log('[stock-price] 代码清单已加载:', data.version, POPULAR_TICKERS.size + MINOR_TICKERS.size);
            return { ok: true };
        } catch (e) {
            console.log('[stock-price] 代码清单加载失败:', e.message);
            return { ok: false, msg: e.message };
        }
    }

    function syncNow() {
        loadTickers();
        loadRemoteBlacklist().then(r => onSyncResult(r, true));
    }

    function clearBlacklistCache() {
        GM_setValue(GMK_CACHE, null);
        GM_setValue(GMK_TICKERS, null);
        GM_setValue(GMK_VER, '');
        console.log('[stock-price] 已清除黑名单与代码清单缓存，刷新页面后重新拉取');
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
        console.log('nameAliases:', { ...NAME_ALIASES });
        console.log('tickers:', POPULAR_TICKERS.size, '热门 /', MINOR_TICKERS.size, '冷门');
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

        // ── 黑名单 / 代码清单：先同步应用缓存；脚本升级、无缓存或清单过期时再联网拉取 ──
        const cached = GM_getValue(GMK_CACHE, null);
        const tickersCache = GM_getValue(GMK_TICKERS, null);
        const versionChanged = GM_getValue(GMK_VER, '') !== SCRIPT_VERSION;
        if (cached) applyRemoteData(cached);
        if (tickersCache?.data) applyTickerData(tickersCache.data);
        if (versionChanged) GM_setValue(GMK_VER, SCRIPT_VERSION);
        const loads = [];
        if (versionChanged || !cached) {
            loads.push(loadRemoteBlacklist().then(r => onSyncResult(r, false)));
        }
        if (versionChanged || !tickersCache?.data || isCacheExpired(tickersCache.fetchedAt || 0, Date.now(), TICKERS_TTL)) {
            loads.push(loadTickers());
        }
        // 配置到位后所有容器重扫一遍（已替换过的文字会被跳过，重扫是安全的）
        if (loads.length) Promise.all(loads).then(() => { processedPosts = new WeakSet(); processNewPosts(); });

        // ── 会话状态 ──
        const priceCache = new Map();      // symbol → { data, timestamp }，带 TTL
        const pagePriceMap = new Map();    // symbol → data，本页已拿到的行情
        const deadSymbols = new Set();     // 查不到行情的代码，本次会话不再请求
        const recentlySeen = new Map();    // symbol → 最后一次在页面上看到的时间，决定刷新优先级
        const lastRefresh = new Map();     // symbol → 上次刷新时间
        let processedPosts = new WeakSet();

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

        // 返回行情对象；查不到返回 null；需要以后重试返回 { _retry: true }。
        // 纯数字代码可能有多个候选市场（600377 → .SS / .SZ / .KS …），依次尝试。
        async function fetchPrice(symbol) {
            for (const yahooSymbol of yahooCandidates(symbol)) {
                const r = await fetchQuote(symbol, yahooSymbol);
                if (r !== null) return r;
            }
            return null;
        }

        function fetchQuote(symbol, yahooSymbol) {
            return new Promise((resolve) => {
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
                            const result = parseChartMeta(symbol, data?.chart?.result?.[0]?.meta);
                            if (result) result.yahooSymbol = yahooSymbol;
                            resolve(result);
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
        function createStockElement(symbol, priceData, isTitle, label) {
            let el;
            if (isTitle) {
                el = document.createElement('span');
                el.className = 'sp-stock-title';
            } else {
                el = document.createElement('a');
                el.className = 'sp-stock-link';
                el.href = `https://finance.yahoo.com/quote/${encodeURIComponent(priceData.yahooSymbol || resolveYahooSymbol(symbol))}`;
                el.target = '_blank';
                el.rel = 'noopener noreferrer';
            }
            el.textContent = label || symbol;   // 保留原文写法（nvda、英伟达）
            if (priceData.name) el.title = priceData.name;
            const priceSpan = document.createElement('span');
            renderPriceSpan(priceSpan, symbol, priceData);
            el.appendChild(priceSpan);
            return el;
        }

        // 引用、图片说明（"IMG_123 1920×1080 93.8 KB"）、代码块、用户名区域
        const SKIP_SELECTOR =
            'aside, .meta, pre, code, ' +
            '.username, .names, [data-user-card], .post-avatar, .user-card, .topic-post .row .topic-meta-data';

        // 提取用的正文文本：去掉上面这些区域和网址
        function postText(el) {
            const clean = el.cloneNode(true);
            clean.querySelectorAll('aside, .meta, pre, code, img').forEach(e => e.remove());
            return stripUrls(clean.textContent || '');
        }

        // 每个帖子（topic）一份线索：本帖用 $X 写过的代码、标题里的代码
        const threadContexts = new Map();
        function threadContext() {
            const id = (location.pathname.match(/\/t\/[^/]+\/(\d+)/) || [])[1] || location.pathname;
            if (!threadContexts.has(id)) threadContexts.set(id, emptyContext());
            return threadContexts.get(id);
        }

        const containerCodes = new WeakMap();   // 容器 → 这个容器里认出的代码；只替换这些

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
            const allowed = containerCodes.get(container);
            const symbols = allowed ? [...allowed].filter(s => priceMap.has(s)) : [];
            if (symbols.length === 0) return;
            const regex = buildStockRegex(symbols);

            // 先收集文本节点，再改 DOM
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
                acceptNode: node => acceptTextNode(node, isTitle) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
            });
            const textNodes = [];
            while (walker.nextNode()) textNodes.push(walker.currentNode);

            for (const textNode of textNodes) {
                const text = textNode.textContent;
                const phraseZones = findPhraseZones(text, 0, false);
                // 写法也要对得上：撞车词（ALL、COST）只换大写或 $ 写法，不碰正文里的 all / cost
                const matches = [...text.matchAll(regex)].filter(m => {
                    const raw = m[1] || m[2];
                    const symbol = raw.toUpperCase();
                    return allowed.has(symbol) && !inZones(m.index, phraseZones) && (m[1] || acceptsForm(symbol, raw));
                });
                if (matches.length === 0) continue;

                const fragment = document.createDocumentFragment();
                let lastIndex = 0;
                for (const m of matches) {
                    const symbol = (m[1] || m[2]).toUpperCase();
                    if (m.index > lastIndex) {
                        fragment.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
                    }
                    fragment.appendChild(createStockElement(symbol, priceMap.get(symbol), isTitle, m[1] || m[2]));
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

            // 先收集本帖线索（标题、各楼的 $X），再逐个容器提取代码
            const ctx = threadContext();
            const texts = new Map(newContainers.map(({ el }) => [el, postText(el)]));
            for (const { el, isTitle } of newContainers) {
                if (isTitle) titleCodes(texts.get(el)).forEach(c => ctx.title.add(c));
                collectExactCodes(texts.get(el)).forEach(c => ctx.dollar.add(c));
            }
            const newCodes = new Set();
            const now = Date.now();
            for (const { el } of newContainers) {
                const codes = extractStockCodes(texts.get(el), ctx);
                containerCodes.set(el, new Set(codes));
                for (const code of codes) {
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
