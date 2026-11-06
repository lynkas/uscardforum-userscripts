# stock-price 工具

## build-tickers.js — 生成代码清单

```bash
node stock-price/tools/build-tickers.js            # 写 stock-price/tickers.json
node stock-price/tools/build-tickers.js --dry-run  # 只打印统计
```

`tickers.json` 由 GitHub Action（`.github/workflows/update-tickers.yml`）每周一自动重新生成，不要手改。内容：

| 字段 | 含义 |
|---|---|
| `popular` | 热门代码：市值 ≥ 20 亿美元的股票、有挂牌期权的 ETF。大写或小写出现都直接识别 |
| `minor` | 其余上市代码（小盘股、冷门 ETF、权证等）。要有上下文证据才识别 |
| `commonWords` | 英文词频前 5000 里同时是代码的词（ALL、NOW、COST…）。必须大写且有证据 |
| `englishWords` | 词频 5000–20000 里同时是代码的词。小写出现时不识别 |

数据源都是公开接口，每个只请求一次：nasdaqtrader 代码清单、Cboe 期权目录、nasdaq 市值（失败时股票改按"有没有期权"分级）、[FrequencyWords](https://github.com/hermitdave/FrequencyWords) 英文词频（CC BY-SA 4.0）。

## bench.js — 在真实帖子上评测识别效果

```bash
node stock-price/tools/bench.js <评测集目录>
```

评测集是论坛帖子加人工标注，**不提交到仓库**。目录里要有：

- `texts.jsonl`：`{topic, post, kind: "title"|"post", text}`，text 是提取用的正文（去掉引用、图片说明、代码块）
- `labels.jsonl`：`{id: "topic-post-CODE", label: "yes"|"no"|"unsure"}`，表示这楼是不是在说这个代码

2026-11 用理财板块 130 个帖子、2077 楼、2660 个（楼, 代码）标注评测：

| 版本 | 准确率 | 召回率 | 误报 | 漏报 |
|---|---|---|---|---|
| 0.4（黑名单 + 段落分类） | 25% | 94% | 1331 | 27 |
| 0.5（代码清单 + 上下文证据） | 86% | 85% | 68 | 69 |

规则是在这批数据上调的，数字偏乐观；改规则后建议另抓一批帖子验证。
