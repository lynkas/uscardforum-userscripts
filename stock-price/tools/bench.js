#!/usr/bin/env node
// 在带标注的论坛语料上评测脚本的代码识别（用的就是脚本 #region core 里的函数）
//
//   node stock-price/tools/bench.js <评测集目录>
//
// 评测集目录（不随仓库提交，论坛内容只留在本地）：
//   texts.jsonl   {topic, post, kind: 'title'|'post', text}   text = 提取用的正文（已去掉引用、图片说明、代码块）
//   labels.jsonl  {id: 'topic-post-CODE', label: 'yes'|'no'|'unsure'}   这楼是不是在说这个代码
//
// 输出准确率 / 召回率，以及误报、漏报、未标注（新识别出、标注集里没有的）最多的代码。
'use strict';

const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) { console.error('usage: bench.js <eval-dir>'); process.exit(2); }
const ROOT = path.join(__dirname, '..');
const readLines = f => fs.readFileSync(f, 'utf8').trim().split('\n').map(JSON.parse);

const src = fs.readFileSync(path.join(ROOT, 'stock-price-tampermonkey.user.js'), 'utf8');
const coreSrc = src.match(/\/\/ #region core\n([\s\S]*?)\/\/ #endregion core/)[1];
const core = new Function(`'use strict';\n${coreSrc}\nreturn { applyRemoteData, applyTickerData, stripJsonc, stripUrls, extractStockCodes, emptyContext, titleCodes, collectExactCodes };`)();
const readJsonc = f => JSON.parse(core.stripJsonc(fs.readFileSync(path.join(ROOT, f), 'utf8')));
core.applyRemoteData(readJsonc('blacklist.json'));
core.applyTickerData(readJsonc('tickers.json'));

const texts = readLines(path.join(dir, 'texts.jsonl'));
const labels = new Map(readLines(path.join(dir, 'labels.jsonl')).map(o => [o.id, o.label]));

// 帖子线索：与脚本一致 —— 标题里的代码 + 全帖 $X
const threads = new Map();
for (const t of texts) {
    if (!threads.has(t.topic)) threads.set(t.topic, core.emptyContext());
    const ctx = threads.get(t.topic);
    if (t.kind === 'title') core.titleCodes(t.text).forEach(c => ctx.title.add(c));
    core.collectExactCodes(t.text).forEach(c => ctx.dollar.add(c));
}

const gold = new Map();   // 'topic-post' → Set(yes 的代码)
for (const [id, label] of labels) {
    if (label !== 'yes') continue;
    const k = id.split('-').slice(0, 2).join('-');
    if (!gold.has(k)) gold.set(k, new Set());
    gold.get(k).add(id.split('-').slice(2).join('-'));
}

let tp = 0, fp = 0, fn = 0;
const fps = new Map(), fns = new Map(), unl = new Map();
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
for (const t of texts) {
    const k = `${t.topic}-${t.post}`;
    const pred = new Set(core.extractStockCodes(core.stripUrls(t.text), threads.get(t.topic)));
    const g = gold.get(k) || new Set();
    for (const c of pred) {
        const label = labels.get(`${k}-${c}`);
        if (label === 'unsure') continue;
        if (g.has(c)) tp++;
        else if (label === 'no') { fp++; bump(fps, c); }
        else bump(unl, c);
    }
    for (const c of g) if (!pred.has(c)) { fn++; bump(fns, c); }
}
const P = tp / (tp + fp), R = tp / (tp + fn);
const top = m => [...m].sort((a, b) => b[1] - a[1]).slice(0, 30).map(e => e.join(':')).join(' ') || '-';
console.log(`posts ${texts.length}  labels ${labels.size}`);
console.log(`TP ${tp}  FP ${fp}  FN ${fn}  准确率 ${(P * 100).toFixed(1)}%  召回率 ${(R * 100).toFixed(1)}%  F1 ${(200 * P * R / (P + R)).toFixed(1)}`);
console.log('误报:', top(fps));
console.log('漏报:', top(fns));
console.log(`未标注 (${[...unl.values()].reduce((a, b) => a + b, 0)}):`, top(unl));
