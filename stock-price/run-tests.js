#!/usr/bin/env node
'use strict';
// 用法：node run-tests.js            跑全部测试
//       node run-tests.js "文本"     额外打印这段文本识别出的代码
//       echo "文本" | node run-tests.js -

const fs = require('fs');
const path = require('path');

// ── 加载脚本里的 core 段（#region core … #endregion core） ───────────────────
// 测试跑的就是脚本里的原函数，不另抄一份。
const scriptSrc = fs.readFileSync(path.join(__dirname, 'stock-price-tampermonkey.user.js'), 'utf8');
const coreM = scriptSrc.match(/\/\/ #region core\n([\s\S]*?)\/\/ #endregion core/);
if (!coreM) throw new Error('Cannot find "#region core" block in script');

const CORE_EXPORTS = [
    'applyRemoteData', 'applyTickerData', 'stripJsonc', 'stripUrls',
    'extractStockCodes', 'emptyContext', 'titleCodes', 'collectExactCodes',
    'resolveYahooSymbol', 'yahooCandidates', 'getMarketSession', 'isCacheExpired', 'parseQuoteMeta',
    'getChangeClass', 'buildPriceContent', 'acceptsForm',
];
const core = new Function(`'use strict';\n${coreM[1]}\nreturn { ${CORE_EXPORTS.join(', ')} };`)();

// ── 用仓库里的 blacklist.json / tickers.json 填充配置（与线上同一套加载函数） ──
const readJsonc = f => JSON.parse(core.stripJsonc(fs.readFileSync(path.join(__dirname, f), 'utf8')));
core.applyRemoteData(readJsonc('blacklist.json'));
core.applyTickerData(readJsonc('tickers.json'));

// 帖子线索：{ dollar: ['NVDA'], title: '标题' } → emptyContext 结构
function makeContext(c) {
    const ctx = core.emptyContext();
    if (!c) return ctx;
    (c.dollar || []).forEach(s => ctx.dollar.add(s));
    if (c.title) core.titleCodes(c.title).forEach(s => ctx.title.add(s));
    return ctx;
}

const sameSet = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

// ── 用例 ───────────────────────────────────────────────────────────────────
function loadTestArrays(src) {
    let body = src.replace(/const\s+(\w+Tests)\s*=\s*\[\];?/g, 'ctx.$1 = [];');
    body = body.replace(/(\w+Tests)\.push\(/g, 'ctx.$1.push(');
    const ctx = {};
    new Function('ctx', body)(ctx);
    return ctx;
}
const T = loadTestArrays(fs.readFileSync(path.join(__dirname, 'test-cases.js'), 'utf8'));

// 每个套件：[名称, 用例, (用例) => [实际值, 期望值]]
const SUITES = [
    ['extractStockCodes', T.extractionTests, t => [
        core.extractStockCodes(core.stripUrls(t.input), makeContext(t.ctx)).sort(), [...t.expected].sort()]],
    ['resolveYahooSymbol', T.symbolResolutionTests, t => [core.resolveYahooSymbol(t.input), t.expected]],
    ['yahooCandidates', T.candidateTests, t => {
        if (t.setup) core.extractStockCodes(t.setup, core.emptyContext());   // 纯数字代码的市场在识别时推断
        return [core.yahooCandidates(t.input), t.expected];
    }],
    ['acceptsForm', T.acceptsFormTests, t => [core.acceptsForm(t.code, t.raw), t.expected]],
    ['isMarketClosed', T.marketClosedTests, t => [core.getMarketSession(t.tradingPeriod, t.nowS) === 'closed', t.expected]],
    ['getMarketSession', T.marketSessionTests, t => [core.getMarketSession(t.tradingPeriod, t.nowS), t.expected]],
    // 价格文本：去掉盘前盘后那段的 <span> 标签，只比较文字
    ['formatPriceText', T.priceFormatTests, t => [
        core.buildPriceContent(t.symbol, t.priceData, t.priceData._nowS).replace(/<[^>]+>/g, ''), t.expected]],
    ['isCacheExpired', T.cacheExpiryTests, t => [core.isCacheExpired(t.timestamp, t.now, t.ttl), t.expected]],
    // 只比较 expected 里列出的字段（涨跌幅保留两位小数）
    ['parseQuoteMeta', T.quoteMetaTests, t => {
        const q = core.parseQuoteMeta(t.meta);
        if (t.expected === null || q === null) return [q, t.expected];
        const pick = {};
        for (const k of Object.keys(t.expected)) pick[k] = typeof q[k] === 'number' ? Math.round(q[k] * 100) / 100 : q[k];
        return [JSON.stringify(pick), JSON.stringify(t.expected)];
    }],
    ['getChangeClass', T.changeClassTests, t => [core.getChangeClass(t.change), t.expected]],
];

let totalPassed = 0, totalFailed = 0;
for (const [name, tests = [], fn] of SUITES) {
    console.log(`\n── ${name} ──`);
    let passed = 0, failed = 0;
    for (const t of tests) {
        let actual, expected, ok;
        try {
            [actual, expected] = fn(t);
            ok = Array.isArray(expected) ? Array.isArray(actual) && sameSet(actual, expected) : actual === expected;
        } catch (e) {
            actual = `ERROR: ${e.message}`; ok = false;
        }
        if (ok) { passed++; console.log(`  PASS  ${t.name}`); continue; }
        failed++;
        console.log(`  FAIL  ${t.name}`);
        console.log(`        expected: ${JSON.stringify(expected)}\n        got:      ${JSON.stringify(actual)}`);
    }
    console.log(`  ${passed} passed, ${failed} failed, ${tests.length} total`);
    totalPassed += passed; totalFailed += failed;
}

console.log(`\n═══════════════════════════════════════`);
console.log(`Total: ${totalPassed} passed, ${totalFailed} failed, ${totalPassed + totalFailed} total`);

// ── 命令行：直接识别一段文本 ──
if (process.argv.length > 2) {
    const input = process.argv[2] === '-'
        ? fs.readFileSync('/dev/stdin', 'utf8')
        : process.argv.slice(2).join(' ');
    console.log('\n═══ Direct Extraction Test ═══');
    console.log('Input: ' + JSON.stringify(input).slice(0, 200) + (input.length > 200 ? '...' : ''));
    const codes = core.extractStockCodes(core.stripUrls(input), core.emptyContext());
    console.log('Codes:', codes.sort().map(c => `${c}→${core.yahooCandidates(c).join('|')}`).join(', '));
}

process.exit(totalFailed > 0 ? 1 : 0);
