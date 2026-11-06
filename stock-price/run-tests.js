#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// ── 加载脚本里的 core 段（#region core … #endregion core） ───────────────────
// 测试跑的就是脚本里的原函数，不另抄一份。
const scriptSrc = fs.readFileSync(
    path.join(__dirname, 'stock-price-tampermonkey.user.js'),
    'utf8'
);
const coreM = scriptSrc.match(/\/\/ #region core\n([\s\S]*?)\/\/ #endregion core/);
if (!coreM) throw new Error('Cannot find "#region core" block in script');

const CORE_EXPORTS = [
    'applyRemoteData', 'stripJsonc',
    'classifyParagraph', 'isTickerLike', 'isAcceptedCode', 'groupParagraphs', 'extractStockCodes',
    'resolveYahooSymbol', 'getMarketSession', 'isCacheExpired', 'sortByRecentlySeen',
    'getChangeClass', 'buildPriceContent',
];
const core = new Function(`'use strict';\n${coreM[1]}\nreturn { ${CORE_EXPORTS.join(', ')} };`)();
const {
    classifyParagraph, isTickerLike, isAcceptedCode, groupParagraphs, extractStockCodes,
    resolveYahooSymbol, getMarketSession, isCacheExpired, sortByRecentlySeen, getChangeClass,
} = core;

// ── 用仓库里的 blacklist.json 填充配置（与线上同一个加载函数） ───────────────
const configRaw = fs.readFileSync(path.join(__dirname, 'blacklist.json'), 'utf8');
core.applyRemoteData(JSON.parse(core.stripJsonc(configRaw)));

const isMarketClosed = (tp, nowS) => getMarketSession(tp, nowS) === 'closed';
// 价格文本：去掉盘前盘后那段的 <span> 标签，只比较文字
const formatPriceText = (symbol, priceData) =>
    core.buildPriceContent(symbol, priceData, priceData._nowS).replace(/<[^>]+>/g, '');

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
