#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// ── Read main script source ────────────────────────────────────────────────
const scriptSrc = fs.readFileSync(
    path.join(__dirname, 'stock-price-tampermonkey.user.js'),
    'utf8'
);

// ── Load config from blacklist.json (JSONC — strip comments) ──────────────
function stripJsonc(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        .replace(/,\s*([}\]])/g, '$1');
}
const configRaw = fs.readFileSync(path.join(__dirname, 'blacklist.json'), 'utf8');
const CONFIG = JSON.parse(stripJsonc(configRaw));

const EXCLUDE_CODES = new Set(CONFIG.excludeCodes);
const EXCLUDE_PHRASES = CONFIG.excludePhrases;
const SYMBOL_ALIASES = CONFIG.aliases;
const CRYPTO_CODES = new Set(CONFIG.cryptoCodes);
const FIAT_CODES = new Set(CONFIG.fiatCodes);
const FUTURES_CODES = new Set(CONFIG.futuresCodes);
const SHORT_CODE_WHITELIST = new Set(CONFIG.shortCodeWhitelist);
const COMMON_WORDS = new Set(CONFIG.commonWords);

// GRAMMAR_WORDS stays hardcoded in .user.js — extract via regex
const grammarRe = /GRAMMAR_WORDS\s*=\s*new Set\(([\s\S]*?)\);/;
const grammarM = scriptSrc.match(grammarRe);
if (!grammarM) throw new Error('Cannot find GRAMMAR_WORDS in script');
const GRAMMAR_WORDS = new Set(
    grammarM[1]
        .split(',')
        .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
        .filter(s => !s.startsWith('//'))
);

// ── Helpers ─────────────────────────────────────────────────────────────────

function classifyParagraph(para) {
    if (/[^\x00-\x7F]/.test(para)) return 'chinese';
    const words = [...para.matchAll(/[A-Za-z']+/g)].map(m => m[0].toUpperCase());
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

// ── Stage 1: $EXACT ─────────────────────────────────────────────────────────

const RE_EXACT = /\$([A-Za-z0-9.\-=^]*[A-Za-z0-9])/g;

function collectExactCodes(text) {
    const codes = new Set();
    for (const m of text.matchAll(RE_EXACT)) {
        codes.add(m[1].toUpperCase());
    }
    return codes;
}

// ── Stage 2: Skip zones & special extractors ────────────────────────────────

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
        const code = m[2] ? (pair + '=' + m[3].toUpperCase()) : pair;
        codes.add(code);
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

// ── Pipeline ────────────────────────────────────────────────────────────────

function extractStockCodes(container) {
    const text = container.textContent || '';

    // Stage 1: $EXACT (always global)
    const exactCodes = collectExactCodes(text);

    // Stage 2: per-group extraction
    const standaloneCodes = new Set();
    for (const group of groupParagraphs(text)) {
        if (group.type === 'prose') continue;

        if (group.type === 'codelist') {
            const words = [...group.text.matchAll(/[A-Za-z]+/g)].map(m => m[0]);
            if (!words.some(isTickerLike)) continue;
        }

        let zones = buildExactZones(group.text, group.offset);

        const dot = collectDotCodes(group.text, group.offset);
        const forex = collectForexPairs(group.text, group.offset);
        zones = zones.concat(dot.zones, forex.zones);

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

// ── resolveYahooSymbol ─────────────────────────────────────────────────────

function resolveYahooSymbol(symbol) {
    const resolved = SYMBOL_ALIASES[symbol] || symbol;
    if (CRYPTO_CODES.has(resolved)) return `${resolved}-USD`;
    if (FIAT_CODES.has(resolved)) return `${resolved}=X`;
    if (/^[A-Z]{6}$/.test(resolved) && FIAT_CODES.has(resolved.slice(0,3)) && FIAT_CODES.has(resolved.slice(3))) return `${resolved}=X`;
    if (FUTURES_CODES.has(resolved)) return `${resolved}=F`;
    return resolved;
}

// ── getMarketSession ─────────────────────────────────────────────────────────

function getMarketSession(tp, nowS) {
    if (!tp?.regular) return 'unknown';
    if (nowS < tp.regular.start) {
        return tp.pre && nowS >= tp.pre.start ? 'pre' : 'closed';
    }
    if (nowS >= tp.regular.start && nowS < tp.regular.end) return 'regular';
    if (tp.post && nowS >= tp.post.start && nowS < tp.post.end) return 'post';
    return 'closed';
}

function isMarketClosed(tradingPeriod, nowS) {
    return getMarketSession(tradingPeriod, nowS) === 'closed';
}

// ── isCacheExpired ─────────────────────────────────────────────────────────

function isCacheExpired(timestamp, now, ttl) {
    return (now - timestamp) >= ttl;
}

// ── sortByRecentlySeen ─────────────────────────────────────────────────────

function sortByRecentlySeen(symbols, recentlySeen) {
    return [...symbols].sort((a, b) => (recentlySeen.get(b) || 0) - (recentlySeen.get(a) || 0));
}

// ── formatPriceText ────────────────────────────────────────────────────────

function formatChange(val) {
    return val >= 0 ? `+${val.toFixed(2)}` : val.toFixed(2);
}

function formatPriceText(symbol, priceData) {
    const isFiat = FIAT_CODES.has(symbol);
    if (isFiat) {
        return `($1=${symbol}${priceData.price.toFixed(2)} ${formatChange(priceData.change)}%)`;
    }
    const tp = priceData.tradingPeriod;
    const session = getMarketSession(tp, priceData._nowS ?? Date.now() / 1000);
    const prefix = session === 'closed' ? 'C' : '';
    let text = `(${prefix}${priceData.price.toFixed(2)} ${formatChange(priceData.change)}%)`;
    const afterPrice = session === 'post' ? priceData.postPrice : session === 'pre' ? priceData.prePrice : null;
    const afterChange = session === 'post' ? priceData.postChange : session === 'pre' ? priceData.preChange : null;
    if (afterPrice != null) {
        text += ` · P${afterPrice.toFixed(2)} ${formatChange(afterChange)}%`;
    }
    return text;
}

// ── getChangeClass ─────────────────────────────────────────────────────────

function getChangeClass(change) {
    if (change > 0) return 'sp-up';
    if (change < 0) return 'sp-down';
    return 'sp-flat';
}

// ── Load test arrays from test-cases.js ────────────────────────────────────

function loadTestArrays(src) {
    // Convert const declarations + push calls to property assignments on ctx
    let body = src.replace(/const\s+(\w+Tests)\s*=\s*\[\];?/g, 'ctx.$1 = [];');
    body = body.replace(/(\w+Tests)\.push\(/g, 'ctx.$1.push(');
    const ctx = {};
    new Function('ctx', body)(ctx);
    return ctx;
}

const testSrc = fs.readFileSync(path.join(__dirname, 'test-cases.js'), 'utf8');
const allTests = loadTestArrays(testSrc);

const extractionTests = allTests.extractionTests || [];
const symbolResolutionTests = allTests.symbolResolutionTests || [];
const marketClosedTests = allTests.marketClosedTests || [];
const priceFormatTests = allTests.priceFormatTests || [];
const cacheExpiryTests = allTests.cacheExpiryTests || [];
const recentlySeenSortTests = allTests.recentlySeenSortTests || [];
const changeClassTests = allTests.changeClassTests || [];
const classifyParagraphTests = allTests.classifyParagraphTests || [];
const isTickerLikeTests = allTests.isTickerLikeTests || [];
const isAcceptedCodeTests = allTests.isAcceptedCodeTests || [];
const groupParagraphsTests = allTests.groupParagraphsTests || [];
const marketSessionTests = allTests.marketSessionTests || [];

// ── Test runner ────────────────────────────────────────────────────────────

function runSuite(name, tests, fn) {
    console.log(`\n── ${name} ──`);
    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        let result;
        try {
            result = fn(test);
        } catch (e) {
            result = `ERROR: ${e.message}`;
        }

        if (result === null) {
            passed++;
            console.log(`  PASS  ${test.name}`);
        } else {
            failed++;
            console.log(`  FAIL  ${test.name}`);
            console.log(`        ${result}`);
        }
    }

    console.log(`  ${passed} passed, ${failed} failed, ${tests.length} total`);
    return { passed, failed };
}

let totalPassed = 0;
let totalFailed = 0;

// Suite 1: extractStockCodes
(function () {
    const { passed, failed } = runSuite('extractStockCodes', extractionTests, (test) => {
        const mockContainer = { textContent: test.input };
        const result = extractStockCodes(mockContainer);
        const resultSorted = [...result].sort();
        const expectedSorted = [...test.expected].sort();
        const ok = resultSorted.length === expectedSorted.length &&
            resultSorted.every((v, i) => v === expectedSorted[i]);
        if (!ok) {
            return `expected: ${JSON.stringify(expectedSorted)}\n        got:      ${JSON.stringify(resultSorted)}`;
        }
        return null;
    });
    totalPassed += passed;
    totalFailed += failed;
})();

// Suite 2: resolveYahooSymbol
(function () {
    const { passed, failed } = runSuite('resolveYahooSymbol', symbolResolutionTests, (test) => {
        const result = resolveYahooSymbol(test.input);
        const ok = result === test.expected;
        if (!ok) {
            return `input: ${test.input}\n        expected: ${test.expected}\n        got:      ${result}`;
        }
        return null;
    });
    totalPassed += passed;
    totalFailed += failed;
})();

// Suite 3: isMarketClosed
(function () {
    const { passed, failed } = runSuite('isMarketClosed', marketClosedTests, (test) => {
        const result = isMarketClosed(test.tradingPeriod, test.nowS);
        const ok = result === test.expected;
        if (!ok) {
            return `tradingPeriod: ${JSON.stringify(test.tradingPeriod)}\n        nowS: ${test.nowS}\n        expected: ${test.expected}\n        got:      ${result}`;
        }
        return null;
    });
    totalPassed += passed;
    totalFailed += failed;
})();

// Suite 4: formatPriceText
(function () {
    const { passed, failed } = runSuite('formatPriceText', priceFormatTests, (test) => {
        const result = formatPriceText(test.symbol, test.priceData);
        const ok = result === test.expected;
        if (!ok) {
            return `symbol: ${test.symbol}\n        priceData: ${JSON.stringify(test.priceData)}\n        expected: ${test.expected}\n        got:      ${result}`;
        }
        return null;
    });
    totalPassed += passed;
    totalFailed += failed;
})();

// Suite 5: isCacheExpired
(function () {
    const { passed, failed } = runSuite('isCacheExpired', cacheExpiryTests, (test) => {
        const result = isCacheExpired(test.timestamp, test.now, test.ttl);
        const ok = result === test.expected;
        if (!ok) {
            return `timestamp: ${test.timestamp} now: ${test.now} ttl: ${test.ttl}\n        expected: ${test.expected}\n        got:      ${result}`;
        }
        return null;
    });
    totalPassed += passed;
    totalFailed += failed;
})();

// Suite 6: sortByRecentlySeen
(function () {
    const { passed, failed } = runSuite('sortByRecentlySeen', recentlySeenSortTests, (test) => {
        const map = new Map(test.recentlySeen);
        const result = sortByRecentlySeen(test.symbols, map);
        const ok = result.length === test.expected.length &&
            result.every((v, i) => v === test.expected[i]);
        if (!ok) {
            return `symbols: ${JSON.stringify(test.symbols)}\n        recentlySeen: ${JSON.stringify(test.recentlySeen)}\n        expected: ${JSON.stringify(test.expected)}\n        got:      ${JSON.stringify(result)}`;
        }
        return null;
    });
    totalPassed += passed;
    totalFailed += failed;
})();

// Suite 7: getChangeClass
(function () {
    const { passed, failed } = runSuite('getChangeClass', changeClassTests, (test) => {
        const result = getChangeClass(test.change);
        const ok = result === test.expected;
        if (!ok) {
            return `change: ${test.change}\n        expected: ${test.expected}\n        got:      ${result}`;
        }
        return null;
    });
    totalPassed += passed;
    totalFailed += failed;
})();

// Suite 8: classifyParagraph
(function () {
    const { passed, failed } = runSuite('classifyParagraph', classifyParagraphTests, (test) => {
        const result = classifyParagraph(test.input);
        const ok = result === test.expected;
        if (!ok) {
            return `input: ${JSON.stringify(test.input)}\n        expected: ${test.expected}\n        got:      ${result}`;
        }
        return null;
    });
    totalPassed += passed;
    totalFailed += failed;
})();

// Suite 9: isTickerLike
(function () {
    const { passed, failed } = runSuite('isTickerLike', isTickerLikeTests, (test) => {
        const result = isTickerLike(test.input);
        const ok = result === test.expected;
        if (!ok) {
            return `input: ${test.input}\n        expected: ${test.expected}\n        got:      ${result}`;
        }
        return null;
    });
    totalPassed += passed;
    totalFailed += failed;
})();

// Suite 10: isAcceptedCode
(function () {
    const { passed, failed } = runSuite('isAcceptedCode', isAcceptedCodeTests, (test) => {
        const result = isAcceptedCode(test.input);
        const ok = result === test.expected;
        if (!ok) {
            return `input: ${test.input}\n        expected: ${test.expected}\n        got:      ${result}`;
        }
        return null;
    });
    totalPassed += passed;
    totalFailed += failed;
})();

// Suite 11: groupParagraphs
(function () {
    const { passed, failed } = runSuite('groupParagraphs', groupParagraphsTests, (test) => {
        const result = groupParagraphs(test.input);
        const simplified = result.map(g => ({ type: g.type, text: g.text }));
        const ok = simplified.length === test.expected.length &&
            simplified.every((g, i) => g.type === test.expected[i].type && g.text === test.expected[i].text);
        if (!ok) {
            return `input: ${JSON.stringify(test.input)}\n        expected: ${JSON.stringify(test.expected)}\n        got:      ${JSON.stringify(simplified)}`;
        }
        return null;
    });
    totalPassed += passed;
    totalFailed += failed;
})();

// Suite 12: getMarketSession
(function () {
    const { passed, failed } = runSuite('getMarketSession', marketSessionTests, (test) => {
        const result = getMarketSession(test.tradingPeriod, test.nowS);
        const ok = result === test.expected;
        if (!ok) {
            return `tradingPeriod: ${JSON.stringify(test.tradingPeriod)}\n        nowS: ${test.nowS}\n        expected: ${test.expected}\n        got:      ${result}`;
        }
        return null;
    });
    totalPassed += passed;
    totalFailed += failed;
})();

console.log(`\n═══════════════════════════════════════`);
console.log(`Total: ${totalPassed} passed, ${totalFailed} failed, ${totalPassed + totalFailed} total`);

// ── CLI: direct extraction test ────────────────────────────────────────────
// Usage: node run-tests.js "text to analyze"
//        echo "text" | node run-tests.js -
if (process.argv.length > 2) {
    const input = process.argv[2] === '-'
        ? fs.readFileSync('/dev/stdin', 'utf8')
        : process.argv.slice(2).join(' ');

    console.log('\n═══ Direct Extraction Test ═══');
    console.log('Input: ' + JSON.stringify(input).slice(0, 200) + (input.length > 200 ? '...' : ''));
    console.log();

    const groups = groupParagraphs(input);
    console.log('Groups:');
    for (const g of groups) {
        console.log(`  [${g.type}] ${JSON.stringify(g.text.slice(0, 100))}${g.text.length > 100 ? '...' : ''}`);
    }

    const codes = extractStockCodes({ textContent: input });
    console.log();
    console.log('Codes:', codes.sort().join(', '));
}

process.exit(totalFailed > 0 ? 1 : 0);
