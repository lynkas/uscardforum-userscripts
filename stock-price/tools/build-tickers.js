#!/usr/bin/env node
// 生成 stock-price/tickers.json：美股代码清单 + 热门/冷门分级 + 与英文常用词撞车的代码
//
//   node stock-price/tools/build-tickers.js            # 写 stock-price/tickers.json
//   node stock-price/tools/build-tickers.js --dry-run  # 只打印统计
//
// 数据来源（都是公开接口，每个只请求一次）：
//   代码清单  https://www.nasdaqtrader.com/dynamic/SymDir/{nasdaqlisted,otherlisted}.txt
//   有期权的  https://www.cboe.com/us/options/symboldir/equity_index_options/?download=csv
//   股票市值  https://api.nasdaq.com/api/screener/stocks（失败时股票也按"有没有期权"分级）
//   英文词频  https://github.com/hermitdave/FrequencyWords（en_50k，CC BY-SA 4.0）
//
// 热门 = 市值 ≥ 20 亿的股票 + 有挂牌期权的 ETF；其余为冷门（要有上下文证据才识别）。
// 必需的来源失败就退出且不写文件，保留上一版。
'use strict';

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'tickers.json');
const BLACKLIST = path.join(__dirname, '..', 'blacklist.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const STOCK_MCAP_MIN = 2e9;     // 股票：市值 ≥ 20 亿美元算热门
const COMMON_RANK = 5000;       // 英文词频前 5000：撞车词（必须大写 + 有上下文证据）
const ENGLISH_RANK = 20000;     // 前 20000：小写时不当代码

async function get(url, type = 'text') {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const r = await fetch(url, {
                headers: { 'User-Agent': UA, Accept: type === 'json' ? 'application/json' : '*/*' },
                signal: AbortSignal.timeout(120000),
            });
            if (r.ok) return type === 'json' ? r.json() : r.text();
            if (r.status !== 429 && r.status < 500) throw new Error(`HTTP ${r.status}`);
        } catch (e) {
            if (attempt === 2) throw new Error(`${url}: ${e.message}`);
        }
        await new Promise(res => setTimeout(res, 2000 * (attempt + 1)));
    }
    throw new Error(`${url}: retries exhausted`);
}

// 普通股 / ETF / 类别股（BRK.B）；优先股（ABR$D）、带其他符号的去掉
const VALID = /^[A-Z]{1,5}(\.[A-Z])?$/;

function parseListing(text, cols) {
    const rows = [];
    for (const line of text.split('\n').slice(1)) {
        const p = line.split('|');
        if (p.length < 7 || p[0].startsWith('File Creation Time')) continue;
        if (p[cols.test] === 'Y') continue;
        const sym = p[cols.symbol].trim();
        if (VALID.test(sym)) rows.push({ sym, etf: p[cols.etf] === 'Y' });
    }
    return rows;
}

const num = v => Number(String(v || '').replace(/[$,]/g, '')) || 0;

function stripJsonc(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/,\s*([}\]])/g, '$1');
}

(async () => {
    const dryRun = process.argv.includes('--dry-run');

    const [nasdaq, other, cboe, words, screener] = await Promise.all([
        get('https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt'),
        get('https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'),
        get('https://www.cboe.com/us/options/symboldir/equity_index_options/?download=csv'),
        get('https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt'),
        get('https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true', 'json')
            .catch(e => { console.warn('market cap unavailable, falling back to optionable:', e.message); return null; }),
    ]);

    const listings = [
        ...parseListing(nasdaq, { symbol: 0, test: 3, etf: 6 }),
        ...parseListing(other, { symbol: 0, test: 6, etf: 4 }),
    ];
    const bySym = new Map(listings.map(r => [r.sym, r]));
    if (bySym.size < 8000) throw new Error(`listing too small: ${bySym.size}`);

    // Cboe 期权目录："Company Name", "Stock Symbol", …
    const optionable = new Set();
    for (const line of cboe.split('\n').slice(1)) {
        const m = line.match(/^"[^"]*","([^"]+)"/);
        if (m) optionable.add(m[1].trim().replace('/', '.'));
    }
    if (optionable.size < 3000) throw new Error(`Cboe directory too small: ${optionable.size}`);

    let mcap = null;
    if (screener?.data?.rows?.length > 5000) {
        mcap = new Map();
        for (const r of screener.data.rows) mcap.set(r.symbol.replace('/', '.'), num(r.marketCap));
    }

    const popular = [], minor = [];
    for (const r of bySym.values()) {
        const big = r.etf || !mcap ? optionable.has(r.sym) : (mcap.get(r.sym) || 0) >= STOCK_MCAP_MIN;
        (big ? popular : minor).push(r.sym);
    }
    popular.sort(); minor.sort();

    // 撞车词：只保留会被当成代码的词（清单 + blacklist 里的加密货币/法币/期货/别名）
    const bl = JSON.parse(stripJsonc(fs.readFileSync(BLACKLIST, 'utf8')));
    const codeLike = new Set([...bySym.keys(), ...(bl.cryptoCodes || []), ...(bl.fiatCodes || []),
        ...(bl.futuresCodes || []), ...Object.keys(bl.aliases || {})].map(s => s.toUpperCase()));
    const commonWords = [], englishWords = [];
    const seen = new Set();
    words.split('\n').forEach((line, rank) => {
        const w = line.split(' ')[0].toUpperCase();
        if (!w || seen.has(w) || !codeLike.has(w)) return;
        seen.add(w);
        if (rank < COMMON_RANK) commonWords.push(w);
        else if (rank < ENGLISH_RANK) englishWords.push(w);
    });
    commonWords.sort(); englishWords.sort();

    const data = {
        version: new Date().toISOString().slice(0, 10),
        note: 'Generated by stock-price/tools/build-tickers.js — do not edit by hand. ' +
            'Word lists derived from hermitdave/FrequencyWords (CC BY-SA 4.0).',
        rules: {
            stocks: mcap ? `marketCap >= ${STOCK_MCAP_MIN}` : 'optionable (market cap source unavailable)',
            etfs: 'optionable',
            commonRank: COMMON_RANK,
            englishRank: ENGLISH_RANK,
        },
        popular: popular.join(' '),
        minor: minor.join(' '),
        commonWords,
        englishWords,
    };
    const json = JSON.stringify(data, null, 1) + '\n';
    console.log(`symbols ${bySym.size} (popular ${popular.length}, minor ${minor.length}; optionable ${optionable.size}; ` +
        `stocks by ${mcap ? 'market cap' : 'optionable'})`);
    console.log(`commonWords ${commonWords.length}, englishWords ${englishWords.length}, size ${(json.length / 1024).toFixed(0)} KB`);
    if (!dryRun) fs.writeFileSync(OUT, json);
})().catch(e => { console.error('build-tickers failed:', e.message); process.exit(1); });
