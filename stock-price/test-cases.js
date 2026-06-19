// ============================================================================
// extractStockCodes 测试用例
// 格式: { name, input, expected } — expected 是预期提取的代码数组（大写）
// ============================================================================

const extractionTests = [];

// ── 基本功能 ──

extractionTests.push({
    name: '简单独立代码',
    input: 'NVDA\nTSLA AAPL',
    expected: ['NVDA', 'TSLA', 'AAPL'],
});

extractionTests.push({
    name: '$EXACT 格式',
    input: '$NVDA $NQ=F $^GSPTSE $AC.TO',
    expected: ['NVDA', 'NQ=F', '^GSPTSE', 'AC.TO'],
});

extractionTests.push({
    name: '中文混合英文代码',
    input: '今天NVDA涨了 TSLA跌了',
    expected: ['NVDA', 'TSLA'],
});

extractionTests.push({
    name: '混合语境中文+英文+$EXACT',
    input: '今天买入NVDA和TSLA，另外$NQ=F也加了点',
    expected: ['NVDA', 'TSLA', 'NQ=F'],
});

// ── 英文句子处理 ──

extractionTests.push({
    name: '英文句子含语法词',
    input: 'I bought NVDA and TSLA today',
    expected: [],
});

extractionTests.push({
    name: '$EXACT 在英文句子中',
    input: 'I want to buy $NVDA and $TSLA',
    expected: ['NVDA', 'TSLA'],
});

extractionTests.push({
    name: '$EXACT混合英文 — USO/BUY/MSFT不匹配',
    input: 'we uso buy $NvDa with $nq=f but not with $000001.SS in MSFT',
    expected: ['NVDA', 'NQ=F', '000001.SS'],
});

extractionTests.push({
    name: '撇号阻止s匹配',
    input: "Trump's plan for NVDA",
    expected: [],
});

// ── 排除规则 ──

extractionTests.push({
    name: '1-2字母不在白名单不匹配',
    input: 'A B C AB CD EF',
    expected: [],
});

extractionTests.push({
    name: '常见英文单词被COMMON_WORDS排除',
    input: 'THE AND FOR ARE',
    expected: [],
});

extractionTests.push({
    name: 'EXCLUDE_CODES过滤',
    input: 'IPO PUT CALL',
    expected: [],
});

extractionTests.push({
    name: 'EXCLUDE_PHRASES短语排除',
    input: 'my cost basis is high',
    expected: [],
});

extractionTests.push({
    name: 'EXCLUDE_PHRASES大小写不敏感',
    input: 'my Cost Basis is high',
    expected: [],
});

extractionTests.push({
    name: '后加入的黑名单TLDR和BUY',
    input: 'TLDR BUY',
    expected: [],
});

extractionTests.push({
    name: 'emoji误提取ARROW被排除',
    input: ':down_arrow: :up_arrow:',
    expected: [],
});

extractionTests.push({
    name: 'YTD被排除',
    input: 'YTD return',
    expected: [],
});

extractionTests.push({
    name: 'edit: 冒号后缀不提取（其余独立词照常）',
    input: 'edit: added more info',
    expected: ['ADDED', 'INFO'],
});

extractionTests.push({
    name: 'update: 冒号后缀不提取（其余独立词照常）',
    input: 'update: fixed the bug',
    expected: ['FIXED'],
});

extractionTests.push({
    name: '冒号后缀在中国段中也不提取',
    input: 'edit: 补充说明一下NVDA涨了',
    expected: ['NVDA'],
});

extractionTests.push({
    name: 'note: 冒号后缀不提取但独立NOTE提取',
    input: 'note: something\nNOTE',
    expected: ['NOTE'],
});

// ── 白名单和特殊代码 ──

extractionTests.push({
    name: '2字母白名单代码',
    input: 'GE GM HP',
    expected: ['GE', 'GM', 'HP'],
});

extractionTests.push({
    name: '2字母白名单代码 CW',
    input: 'HON(229.01 +0.17%) HWM(277.66 -1.97%) CW ATRO(80.56 +0.62%)',
    expected: ['ATRO', 'CW', 'HON', 'HWM'],
});

extractionTests.push({
    name: '期货短代码加入白名单后独立匹配',
    input: 'NQ ES',
    expected: ['NQ', 'ES'],
});

extractionTests.push({
    name: 'api agi 被 excludeCodes 排除',
    input: 'api agi',
    expected: [],
});

extractionTests.push({
    name: 'API AGI 大小写也排除',
    input: 'API AGI',
    expected: [],
});

extractionTests.push({
    name: 'CUE 被 excludeCodes 排除',
    input: 'cue CUE',
    expected: [],
});

extractionTests.push({
    name: 'BRO CPI 被 excludeCodes 排除',
    input: 'bro CPI',
    expected: [],
});

extractionTests.push({
    name: 'BRO CPI 大小写也排除',
    input: 'BRO cpi',
    expected: [],
});

extractionTests.push({
    name: 'WELL DTE 被 excludeCodes 排除',
    input: 'well dte',
    expected: [],
});

extractionTests.push({
    name: 'SIZE NASA ELON 被 excludeCodes 排除',
    input: 'size nasa elon',
    expected: [],
});

extractionTests.push({
    name: '颜文字中的单字母不提取 — O被ㄒ包围',
    input: 'ㄒOㄒ',
    expected: [],
});

extractionTests.push({
    name: '颜文字中的单字母不提取 — B被包围',
    input: 'ㄒBㄒ',
    expected: [],
});

extractionTests.push({
    name: '$EXACT .INX 点号开头',
    input: '$.INX $.SPX $.DJI',
    expected: ['.INX', '.SPX', '.DJI'],
});

// ── 多段落边界 ──

extractionTests.push({
    name: '完整帖子多段落',
    input: '测试用\n\nNvda\nwe uso buy $NvDa with $nq=f but not with $000001.SS in MSFT\nAMD\nBRK.B brkb\nBTC cny\nuso',
    expected: ['000001.SS', 'AMD', 'BRK.B', 'BRKB', 'BTC', 'CNY', 'NQ=F', 'NVDA', 'USO'],
});

// ── 边界情况 ──

extractionTests.push({
    name: '空输入',
    input: '',
    expected: [],
});

extractionTests.push({
    name: '纯空格换行',
    input: '\n\n\n',
    expected: [],
});

extractionTests.push({
    name: '$EXACT ^GSPC 带^符号',
    input: '$^GSPC',
    expected: ['^GSPC'],
});

extractionTests.push({
    name: '$EXACT 带数字和点 — 中国股票代码',
    input: '$000001.SS $600036.SS',
    expected: ['000001.SS', '600036.SS'],
});

extractionTests.push({
    name: '$EXACT 大小写不敏感转大写',
    input: '$spx $nvda $TsLa',
    expected: ['SPX', 'NVDA', 'TSLA'],
});

extractionTests.push({
    name: '中文全段混合无换行',
    input: '今天NVDA涨了但是TSLA跌了AAPL持平',
    expected: ['NVDA', 'TSLA', 'AAPL'],
});

extractionTests.push({
    name: '中文段中$符号不应触发非$单词匹配',
    input: '价格$100以上，买了NVDA',
    expected: ['NVDA'],
});

extractionTests.push({
    name: '$EXACT =F期货代码',
    input: '$NQ=F $ES=F $CL=F',
    expected: ['NQ=F', 'ES=F', 'CL=F'],
});

extractionTests.push({
    name: '带BRK.B别名代码',
    input: 'BRK.B BRK.A brkb',
    expected: ['BRK.B', 'BRK.A', 'BRKB'],
});

extractionTests.push({
    name: '加密货币代码识别',
    input: '今天BTC涨了ETH跌了',
    expected: ['BTC', 'ETH'],
});

extractionTests.push({
    name: '法币代码识别',
    input: 'CNY汇率 EUR走强',
    expected: ['CNY', 'EUR'],
});

extractionTests.push({
    name: '中文段语法词短语不触发排除',
    input: 'this is a test NVDA TSLA',
    expected: [], // English paragraph with grammar words → prose, no standalone
});

extractionTests.push({
    name: '纯代码列表无语法词正常提取',
    input: 'NVDA\nTSLA\nAAPL\nMSFT',
    expected: ['NVDA', 'TSLA', 'AAPL', 'MSFT'],
});

extractionTests.push({
    name: '代码+数字混合不应提取数字',
    input: 'NVDA 135.20 TSLA 200.50',
    expected: ['NVDA', 'TSLA'],
});

extractionTests.push({
    name: '$EXACT 在中文段内不受跳过区影响',
    input: '推荐$NVDA和$TSLA',
    expected: ['NVDA', 'TSLA'],
});

// ── 数字.后缀代码 (2330.T, 000001.SS, 0700.HK 等) ──

extractionTests.push({
    name: '数字.T 台湾代码',
    input: '2330.T',
    expected: ['2330.T'],
});

extractionTests.push({
    name: '数字.SS 上海代码',
    input: '000001.SS',
    expected: ['000001.SS'],
});

extractionTests.push({
    name: '数字.HK 香港代码',
    input: '0700.HK',
    expected: ['0700.HK'],
});

extractionTests.push({
    name: '数字.SZ 深圳代码',
    input: '000001.SZ',
    expected: ['000001.SZ'],
});

extractionTests.push({
    name: '数字.KS 韩国代码',
    input: '005930.KS',
    expected: ['005930.KS'],
});

extractionTests.push({
    name: '数字.XX 后缀字母不被单独提取',
    input: '2330.T 在中文段中',
    expected: ['2330.T'],
});

extractionTests.push({
    name: '多个数字.XX混合',
    input: '2330.T 000001.SS 0700.HK',
    expected: ['2330.T', '000001.SS', '0700.HK'],
});

extractionTests.push({
    name: '数字.XX 在代码列表段落中',
    input: 'NVDA\n2330.T\nTSLA\n000001.SS',
    expected: ['NVDA', '2330.T', 'TSLA', '000001.SS'],
});

extractionTests.push({
    name: 'XX后缀不被单独提取 — T在白名单但不该出现',
    input: '买了2330.T和0700.HK',
    expected: ['2330.T', '0700.HK'],
});

extractionTests.push({
    name: '$EXACT 数字.XX 也可正常识别',
    input: '$2330.T $000001.SS',
    expected: ['2330.T', '000001.SS'],
});

extractionTests.push({
    name: '字母.TO 多伦多代码',
    input: 'TD.TO',
    expected: ['TD.TO'],
});

extractionTests.push({
    name: '字母.TO SHOP.TO',
    input: 'SHOP.TO',
    expected: ['SHOP.TO'],
});

extractionTests.push({
    name: '数字.TW 台湾代码新格式',
    input: '2330.TW',
    expected: ['2330.TW'],
});

extractionTests.push({
    name: '字母.TO在中文段中 — 后缀TO不被单独提取',
    input: '今天买了TD.TO和SHOP.TO',
    expected: ['TD.TO', 'SHOP.TO'],
});

extractionTests.push({
    name: '字母.单字母后缀不匹配 — A.T 不提取',
    input: 'A.T',
    expected: [],
});

extractionTests.push({
    name: '数字.TO 也匹配',
    input: '1234.TO',
    expected: ['1234.TO'],
});

extractionTests.push({
    name: '混合数字和字母.XX — 后缀都不单独出',
    input: '2330.TW TD.TO 000001.SS SHOP.TO',
    expected: ['2330.TW', 'TD.TO', '000001.SS', 'SHOP.TO'],
});

// ── 6-letter forex pairs ──

extractionTests.push({
    name: 'CADCNY 外汇对',
    input: 'CADCNY',
    expected: ['CADCNY'],
});

extractionTests.push({
    name: 'USDJPY 外汇对',
    input: 'USDJPY',
    expected: ['USDJPY'],
});

extractionTests.push({
    name: 'EURGBP 外汇对',
    input: 'EURGBP',
    expected: ['EURGBP'],
});

extractionTests.push({
    name: '外汇对在中文段中',
    input: '今天USDCNY涨了',
    expected: ['USDCNY'],
});

extractionTests.push({
    name: '非外汇6字母不匹配',
    input: 'ABCDEF',
    expected: [],
});

extractionTests.push({
    name: '7字母不匹配外汇对',
    input: 'USDCADX',
    expected: [],
});

extractionTests.push({
    name: '单独3字母法币正常提取',
    input: 'USD CNY',
    expected: ['USD', 'CNY'],
});

extractionTests.push({
    name: '外汇对不重复提取单独法币',
    input: 'USDCNY',
    expected: ['USDCNY'],
});

extractionTests.push({
    name: '外汇对在代码列表段落',
    input: 'NVDA\nUSDCNY\nTSLA\nEURJPY',
    expected: ['NVDA', 'USDCNY', 'TSLA', 'EURJPY'],
});

// ── 中文语境混合代码 ──

extractionTests.push({
    name: '中文段 — 混合美股中股台股港股加密外汇期货别名点码',
    input: '最近持仓$SPX涨了很多，NVDA和TSLA继续持有，A股000001.SS和600519.SS也在观望，台股2330.TW港股0700.HK不错，BTC反弹USDJPY见顶ES做多BRK.B和TD.TO加SHOP.TO',
    expected: ['000001.SS', '0700.HK', '2330.TW', '600519.SS', 'BRK.B', 'BTC', 'ES', 'NVDA', 'SHOP.TO', 'SPX', 'TD.TO', 'TSLA', 'USDJPY'],
});

extractionTests.push({
    name: '中文段 — 混合大小写代码仍应提取',
    input: '今天nvda跌了但Tsla涨了aapl也涨了',
    expected: ['AAPL', 'NVDA', 'TSLA'],
});

extractionTests.push({
    name: '中文段 — $EXACT与非$代码混合',
    input: '$NVDA涨了TSLA跌了$AAPL反弹',
    expected: ['AAPL', 'NVDA', 'TSLA'],
});

extractionTests.push({
    name: '中文段 — $EXACT期货期权代码',
    input: '期货方面$NQ=F走强$ES=F回调$CL=F反弹',
    expected: ['CL=F', 'ES=F', 'NQ=F'],
});

extractionTests.push({
    name: '中文段 — 加拿大点码TO后缀',
    input: '加拿大银行股TD.TO和SHOP.TO以及CNR.TO都还行',
    expected: ['CNR.TO', 'SHOP.TO', 'TD.TO'],
});

extractionTests.push({
    name: '中文段 — 加密货币代码',
    input: '币圈今天BTC暴跌ETH跟跌SOL还算稳DOGE飞天',
    expected: ['BTC', 'DOGE', 'ETH', 'SOL'],
});

extractionTests.push({
    name: '中文段 — 外汇对和法币混合',
    input: 'USDCNY创近期新低CADCNY也在跌EURJPY倒是涨了CNY强EUR弱JPY更弱',
    expected: ['CADCNY', 'CNY', 'EUR', 'EURJPY', 'JPY', 'USDCNY'],
});

// ── 英文代码列表段落 ──

extractionTests.push({
    name: '纯代码列表 — 美股多行',
    input: 'NVDA\nTSLA\nAAPL\nAMD\nMSFT',
    expected: ['AAPL', 'AMD', 'MSFT', 'NVDA', 'TSLA'],
});

extractionTests.push({
    name: '纯代码列表 — 数字和字母点码多行',
    input: '2330.TW\nTD.TO\n000001.SS\n0700.HK\n005930.KS',
    expected: ['000001.SS', '005930.KS', '0700.HK', '2330.TW', 'TD.TO'],
});

extractionTests.push({
    name: '纯代码列表 — 混合大小写全部提取',
    input: 'nvda\nTsla\naapl\nbrk.b',
    expected: ['AAPL', 'BRK.B', 'NVDA', 'TSLA'],
});

extractionTests.push({
    name: '纯代码列表 — 外汇对和法币多行',
    input: 'USDCNY\nCADCNY\nEURJPY\nCNY\nEUR',
    expected: ['CADCNY', 'CNY', 'EUR', 'EURJPY', 'USDCNY'],
});

extractionTests.push({
    name: '纯代码列表 — 加密货币多行',
    input: 'BTC\nETH\nSOL\nDOGE',
    expected: ['BTC', 'DOGE', 'ETH', 'SOL'],
});

// ── 英文散文 — 仅$EXACT提取 ──

extractionTests.push({
    name: '英文散文 — 独立代码不提取',
    input: 'I bought some NVDA and TSLA today',
    expected: [],
});

extractionTests.push({
    name: '英文散文 — $EXACT提取',
    input: 'I want to sell $NVDA and buy $TSLA',
    expected: ['NVDA', 'TSLA'],
});

extractionTests.push({
    name: '英文散文 — 混合仅$EXACT提取独立不提取',
    input: 'My portfolio has NVDA TSLA and I added $AAPL',
    expected: ['AAPL'],
});

// ── 边界情况 ──

extractionTests.push({
    name: '中文段 — dram小写代码提取(非排除词)',
    input: 'dram 8% :yaoming:',
    expected: ['DRAM'],
});

extractionTests.push({
    name: '中文段 — 含数字和excludePhrases短语（basis孤立不触发cost basis排除）',
    input: '价格$100以上，买了NVDA和TSLA，成本basis',
    expected: ['BASIS', 'NVDA', 'TSLA'],
});

// ============================================================================
// resolveYahooSymbol 测试用例
// 格式: { name, input, expected }
// ============================================================================

const symbolResolutionTests = [];

symbolResolutionTests.push({
    name: '普通股票原样返回',
    input: 'AAPL',
    expected: 'AAPL',
});

symbolResolutionTests.push({
    name: '普通股票 TSLA',
    input: 'TSLA',
    expected: 'TSLA',
});

symbolResolutionTests.push({
    name: 'SPX 别名映射到 ^GSPC',
    input: 'SPX',
    expected: '^GSPC',
});

symbolResolutionTests.push({
    name: 'BRK.B 别名映射到 BRK-B',
    input: 'BRK.B',
    expected: 'BRK-B',
});

symbolResolutionTests.push({
    name: 'BRKB 别名映射到 BRK-B',
    input: 'BRKB',
    expected: 'BRK-B',
});

symbolResolutionTests.push({
    name: 'BRK.A 别名映射到 BRK-A',
    input: 'BRK.A',
    expected: 'BRK-A',
});

symbolResolutionTests.push({
    name: 'BRKA 别名映射到 BRK-A',
    input: 'BRKA',
    expected: 'BRK-A',
});

symbolResolutionTests.push({
    name: '加密货币 BTC → BTC-USD',
    input: 'BTC',
    expected: 'BTC-USD',
});

symbolResolutionTests.push({
    name: '加密货币 ETH → ETH-USD',
    input: 'ETH',
    expected: 'ETH-USD',
});

symbolResolutionTests.push({
    name: '加密货币 SOL → SOL-USD',
    input: 'SOL',
    expected: 'SOL-USD',
});

symbolResolutionTests.push({
    name: '法币 CNY → CNY=X',
    input: 'CNY',
    expected: 'CNY=X',
});

symbolResolutionTests.push({
    name: '法币 EUR → EUR=X',
    input: 'EUR',
    expected: 'EUR=X',
});

symbolResolutionTests.push({
    name: '法币 JPY → JPY=X',
    input: 'JPY',
    expected: 'JPY=X',
});

symbolResolutionTests.push({
    name: '期货 ES → ES=F',
    input: 'ES',
    expected: 'ES=F',
});

symbolResolutionTests.push({
    name: '期货 NQ → NQ=F',
    input: 'NQ',
    expected: 'NQ=F',
});

symbolResolutionTests.push({
    name: '期货 CL → CL=F',
    input: 'CL',
    expected: 'CL=F',
});

symbolResolutionTests.push({
    name: '未知代码原样返回',
    input: 'MADEUP',
    expected: 'MADEUP',
});

symbolResolutionTests.push({
    name: '空字符串',
    input: '',
    expected: '',
});

symbolResolutionTests.push({
    name: '外汇对 CADCNY → CADCNY=X',
    input: 'CADCNY',
    expected: 'CADCNY=X',
});

symbolResolutionTests.push({
    name: '外汇对 USDJPY → USDJPY=X',
    input: 'USDJPY',
    expected: 'USDJPY=X',
});

symbolResolutionTests.push({
    name: '外汇对 EURGBP → EURGBP=X',
    input: 'EURGBP',
    expected: 'EURGBP=X',
});

symbolResolutionTests.push({
    name: '非外汇对6字母 → 原样返回',
    input: 'ABCDEF',
    expected: 'ABCDEF',
});

// ============================================================================
// isMarketClosed 测试用例
// 格式: { name, tradingPeriod, nowS, expected }
// ============================================================================

const marketClosedTests = [];

const makeTp = (start, end) => ({ regular: { start, end } });

// 假设 regular.start = 9:30 ET = 36000, regular.end = 16:00 ET = 57600

marketClosedTests.push({
    name: '开盘前 — 市场关闭',
    tradingPeriod: makeTp(36000, 57600),
    nowS: 30000, // 8:20am
    expected: true,
});

marketClosedTests.push({
    name: '开盘后 — 市场关闭',
    tradingPeriod: makeTp(36000, 57600),
    nowS: 60000, // 4:40pm
    expected: true,
});

marketClosedTests.push({
    name: '交易中 — 市场开放',
    tradingPeriod: makeTp(36000, 57600),
    nowS: 45000, // 12:30pm
    expected: false,
});

marketClosedTests.push({
    name: '恰好开盘 — 市场开放',
    tradingPeriod: makeTp(36000, 57600),
    nowS: 36000, // 9:30am exactly
    expected: false,
});

marketClosedTests.push({
    name: '恰好收盘 — 市场关闭',
    tradingPeriod: makeTp(36000, 57600),
    nowS: 57600, // 4:00pm exactly
    expected: true,
});

marketClosedTests.push({
    name: '正好闭市前1秒 — 市场开放',
    tradingPeriod: makeTp(36000, 57600),
    nowS: 57599, // 3:59:59pm
    expected: false,
});

marketClosedTests.push({
    name: '无 tradingPeriod — 不是关闭',
    tradingPeriod: null,
    nowS: 45000,
    expected: false,
});

marketClosedTests.push({
    name: '无 regular 字段 — 不是关闭',
    tradingPeriod: {},
    nowS: 45000,
    expected: false,
});

marketClosedTests.push({
    name: '半夜 — 市场关闭',
    tradingPeriod: makeTp(36000, 57600),
    nowS: 10000, // 2:46am
    expected: true,
});

marketClosedTests.push({
    name: '盘前几分钟 — 市场关闭',
    tradingPeriod: makeTp(36000, 57600),
    nowS: 35900, // 9:28am
    expected: true,
});

// ============================================================================
// formatPriceText 测试用例
// 格式: { name, symbol, priceData, expected }
// ============================================================================

const priceFormatTests = [];

// 开盘时段 stock — 使用遥远的未来时间确保不触发闭市
const farOpenTp = { regular: { start: 0, end: 9999999999 } };

priceFormatTests.push({
    name: '股票上涨 — 开盘时段',
    symbol: 'AAPL',
    priceData: { price: 150.25, change: 2.35, tradingPeriod: farOpenTp },
    expected: '(150.25 +2.35%)',
});

priceFormatTests.push({
    name: '股票下跌 — 开盘时段',
    symbol: 'TSLA',
    priceData: { price: 200.50, change: -3.10, tradingPeriod: farOpenTp },
    expected: '(200.50 -3.10%)',
});

priceFormatTests.push({
    name: '股票持平 — 开盘时段',
    symbol: 'MSFT',
    priceData: { price: 300.00, change: 0, tradingPeriod: farOpenTp },
    expected: '(300.00 +0.00%)',
});

// 闭市时段 stock
const closedTp = { regular: { start: 9999999999, end: 99999999999 } };

priceFormatTests.push({
    name: '股票上涨 — 闭市显示C前缀',
    symbol: 'AAPL',
    priceData: { price: 150.25, change: 2.35, tradingPeriod: closedTp },
    expected: '(C150.25 +2.35%)',
});

priceFormatTests.push({
    name: '股票下跌 — 闭市显示C前缀',
    symbol: 'TSLA',
    priceData: { price: 200.50, change: -3.10, tradingPeriod: closedTp },
    expected: '(C200.50 -3.10%)',
});

priceFormatTests.push({
    name: '无tradingPeriod — 不显示C',
    symbol: 'AAPL',
    priceData: { price: 150.25, change: 2.35 },
    expected: '(150.25 +2.35%)',
});

// 法币 — 不受闭市影响
priceFormatTests.push({
    name: '法币上涨',
    symbol: 'CNY',
    priceData: { price: 7.25, change: 0.35, tradingPeriod: closedTp },
    expected: '(1=CNY7.25 +0.35%)',
});

priceFormatTests.push({
    name: '法币下跌',
    symbol: 'EUR',
    priceData: { price: 1.08, change: -0.15, tradingPeriod: farOpenTp },
    expected: '(1=EUR1.08 -0.15%)',
});

priceFormatTests.push({
    name: '价格精度 — 整数价格',
    symbol: 'NVDA',
    priceData: { price: 800, change: 10, tradingPeriod: farOpenTp },
    expected: '(800.00 +10.00%)',
});

priceFormatTests.push({
    name: '价格精度 — 多位小数截断',
    symbol: 'AAPL',
    priceData: { price: 150.2567, change: 2.3512, tradingPeriod: farOpenTp },
    expected: '(150.26 +2.35%)',
});

// ── 盘后/盘前价格 ──

// Post-market TP: regular ended, post is active
const postTp = { pre: { start: 32400, end: 36000 }, regular: { start: 36000, end: 57600 }, post: { start: 57600, end: 72000 } };

priceFormatTests.push({
    name: '盘后上涨 — 显示P价格',
    symbol: 'AAPL',
    priceData: { price: 150.25, change: 2.35, postPrice: 152.00, postChange: 1.16, tradingPeriod: postTp, _nowS: 60000 },
    expected: '(150.25 +2.35%) · P152.00 +1.16%',
});

priceFormatTests.push({
    name: '盘后下跌 — 显示P价格',
    symbol: 'TSLA',
    priceData: { price: 200.50, change: -3.10, postPrice: 198.00, postChange: -1.25, tradingPeriod: postTp, _nowS: 60000 },
    expected: '(200.50 -3.10%) · P198.00 -1.25%',
});

// Pre-market TP: pre is active
priceFormatTests.push({
    name: '盘前价格 — 显示P价格',
    symbol: 'NVDA',
    priceData: { price: 800.00, change: 5.00, prePrice: 805.00, preChange: 0.63, tradingPeriod: postTp, _nowS: 33000 },
    expected: '(800.00 +5.00%) · P805.00 +0.63%',
});

// Regular session — no after-hours display
priceFormatTests.push({
    name: '盘中 — 不显示盘后',
    symbol: 'AAPL',
    priceData: { price: 150.25, change: 2.35, postPrice: 152.00, postChange: 1.16, tradingPeriod: postTp, _nowS: 45000 },
    expected: '(150.25 +2.35%)',
});

// Closed — no after-hours data
priceFormatTests.push({
    name: '闭市无盘后数据 — 只显示C前缀',
    symbol: 'AAPL',
    priceData: { price: 150.25, change: 2.35, tradingPeriod: postTp, _nowS: 80000 },
    expected: '(C150.25 +2.35%)',
});

// ============================================================================
// getMarketSession 测试用例
// 格式: { name, tradingPeriod, nowS, expected }
// ============================================================================

const marketSessionTests = [];

const fullTp = { pre: { start: 32400, end: 36000 }, regular: { start: 36000, end: 57600 }, post: { start: 57600, end: 72000 } };

marketSessionTests.push({
    name: '深夜 → closed',
    tradingPeriod: fullTp,
    nowS: 10000,
    expected: 'closed',
});

marketSessionTests.push({
    name: '盘前 → pre',
    tradingPeriod: fullTp,
    nowS: 33000,
    expected: 'pre',
});

marketSessionTests.push({
    name: '盘前之前 → closed',
    tradingPeriod: fullTp,
    nowS: 30000,
    expected: 'closed',
});

marketSessionTests.push({
    name: '恰好开盘 → regular',
    tradingPeriod: fullTp,
    nowS: 36000,
    expected: 'regular',
});

marketSessionTests.push({
    name: '盘中 → regular',
    tradingPeriod: fullTp,
    nowS: 45000,
    expected: 'regular',
});

marketSessionTests.push({
    name: '恰好收盘 → post',
    tradingPeriod: fullTp,
    nowS: 57600,
    expected: 'post',
});

marketSessionTests.push({
    name: '盘后 → post',
    tradingPeriod: fullTp,
    nowS: 60000,
    expected: 'post',
});

marketSessionTests.push({
    name: '盘后结束 → closed',
    tradingPeriod: fullTp,
    nowS: 72000,
    expected: 'closed',
});

marketSessionTests.push({
    name: '无 pre/post — 开盘前 → closed',
    tradingPeriod: { regular: { start: 36000, end: 57600 } },
    nowS: 30000,
    expected: 'closed',
});

marketSessionTests.push({
    name: '无 pre/post — 收盘后 → closed',
    tradingPeriod: { regular: { start: 36000, end: 57600 } },
    nowS: 60000,
    expected: 'closed',
});

marketSessionTests.push({
    name: 'null tradingPeriod → unknown',
    tradingPeriod: null,
    nowS: 45000,
    expected: 'unknown',
});
// 格式: { name, timestamp, now, ttl, expected }
// ============================================================================

const cacheExpiryTests = [];

cacheExpiryTests.push({
    name: '刚缓存 — 未过期',
    timestamp: 100000,
    now: 100050,
    ttl: 60000, // 刚过50ms
    expected: false,
});

cacheExpiryTests.push({
    name: '超过TTL — 已过期',
    timestamp: 100000,
    now: 170000,
    ttl: 60000, // 过了70s
    expected: true,
});

cacheExpiryTests.push({
    name: '恰好等于TTL — 已过期',
    timestamp: 100000,
    now: 160000,
    ttl: 60000, // 正好60s
    expected: true,
});

cacheExpiryTests.push({
    name: '差1ms到TTL — 未过期',
    timestamp: 100000,
    now: 159999,
    ttl: 60000, // 差1ms
    expected: false,
});

cacheExpiryTests.push({
    name: '零TTL — 立即过期',
    timestamp: 100000,
    now: 100000,
    ttl: 0,
    expected: true,
});

cacheExpiryTests.push({
    name: 'Timestamp在未来 — 未过期',
    timestamp: 200000,
    now: 100000,
    ttl: 60000,
    expected: false,
});

cacheExpiryTests.push({
    name: '零时间戳 — 已过期',
    timestamp: 0,
    now: 100000,
    ttl: 60000,
    expected: true,
});

// ============================================================================
// sortByRecentlySeen 测试用例
// 格式: { name, symbols, recentlySeen, expected }
// recentlySeen 是 [symbol, timestamp] 元组数组
// ============================================================================

const recentlySeenSortTests = [];

recentlySeenSortTests.push({
    name: '基本排序 — 最近看到的在前',
    symbols: ['AAPL', 'TSLA', 'NVDA'],
    recentlySeen: [['AAPL', 1000], ['TSLA', 3000], ['NVDA', 2000]],
    expected: ['TSLA', 'NVDA', 'AAPL'],
});

recentlySeenSortTests.push({
    name: '部分有记录部分无 — 空记录排在最后',
    symbols: ['AAPL', 'TSLA', 'NVDA'],
    recentlySeen: [['AAPL', 1000], ['TSLA', 3000]],
    expected: ['TSLA', 'AAPL', 'NVDA'],
});

recentlySeenSortTests.push({
    name: '单元素',
    symbols: ['AAPL'],
    recentlySeen: [['AAPL', 1000]],
    expected: ['AAPL'],
});

recentlySeenSortTests.push({
    name: '相同时间戳保持有序',
    symbols: ['NVDA', 'AAPL', 'TSLA'],
    recentlySeen: [['NVDA', 2000], ['AAPL', 2000], ['TSLA', 2000]],
    expected: ['NVDA', 'AAPL', 'TSLA'], // stable sort preserves insertion order
});

recentlySeenSortTests.push({
    name: '空列表',
    symbols: [],
    recentlySeen: [],
    expected: [],
});

recentlySeenSortTests.push({
    name: '全部无时间戳',
    symbols: ['AAPL', 'TSLA', 'NVDA'],
    recentlySeen: [],
    expected: ['AAPL', 'TSLA', 'NVDA'],
});

recentlySeenSortTests.push({
    name: '混合 — 部分有部分无',
    symbols: ['OLD', 'NEW', 'MID', 'UNSEEN'],
    recentlySeen: [['OLD', 1000], ['NEW', 5000], ['MID', 3000]],
    expected: ['NEW', 'MID', 'OLD', 'UNSEEN'],
});

// ============================================================================
// getChangeClass 测试用例
// 格式: { name, change, expected }
// ============================================================================

const changeClassTests = [];

changeClassTests.push({
    name: '正数 → sp-up',
    change: 2.35,
    expected: 'sp-up',
});

changeClassTests.push({
    name: '负数 → sp-down',
    change: -3.10,
    expected: 'sp-down',
});

changeClassTests.push({
    name: '零 → sp-flat',
    change: 0,
    expected: 'sp-flat',
});

changeClassTests.push({
    name: '极小正数 → sp-up',
    change: 0.001,
    expected: 'sp-up',
});

changeClassTests.push({
    name: '极小负数 → sp-down',
    change: -0.001,
    expected: 'sp-down',
});

// ============================================================================
// classifyParagraph 测试用例
// 格式: { name, input, expected } — expected: 'chinese' | 'prose' | 'codelist'
// ============================================================================

const classifyParagraphTests = [];

classifyParagraphTests.push({
    name: '中文字符 → chinese',
    input: '今天NVDA涨了',
    expected: 'chinese',
});

classifyParagraphTests.push({
    name: '英文句子含语法词 → prose',
    input: 'I bought NVDA and TSLA today',
    expected: 'prose',
});

classifyParagraphTests.push({
    name: '英文代码列表 → codelist',
    input: 'NVDA TSLA AAPL',
    expected: 'codelist',
});

classifyParagraphTests.push({
    name: '空行 → codelist',
    input: '',
    expected: 'codelist',
});

classifyParagraphTests.push({
    name: '纯空格 → codelist',
    input: '   ',
    expected: 'codelist',
});

classifyParagraphTests.push({
    name: '含撇号语法词 → prose',
    input: "Trump's plan for NVDA",
    expected: 'prose',
});

classifyParagraphTests.push({
    name: '全大写无语法词 → codelist',
    input: 'IPO PUT CALL',
    expected: 'codelist',
});

classifyParagraphTests.push({
    name: '含THE → prose',
    input: 'THE stock is up',
    expected: 'prose',
});

// ============================================================================
// isTickerLike 测试用例
// 格式: { name, input, expected } — input: word string
// ============================================================================

const isTickerLikeTests = [];

isTickerLikeTests.push({
    name: '全大写2字母 → true',
    input: 'NV',
    expected: true,
});

isTickerLikeTests.push({
    name: '全大写4字母 → true',
    input: 'NVDA',
    expected: true,
});

isTickerLikeTests.push({
    name: '混合大小写3字母以上 → true',
    input: 'Nvda',
    expected: true,
});

isTickerLikeTests.push({
    name: '含点号 → true',
    input: 'BRK.B',
    expected: true,
});

isTickerLikeTests.push({
    name: '单字母小写 → false',
    input: 'a',
    expected: false,
});

isTickerLikeTests.push({
    name: '白名单代码 → true',
    input: 'GE',
    expected: true,
});

isTickerLikeTests.push({
    name: '单字母不在白名单 → false',
    input: 'C',
    expected: false,
});

isTickerLikeTests.push({
    name: '别名代码 → true',
    input: 'BRKB',
    expected: true,
});

isTickerLikeTests.push({
    name: '期货代码 → true',
    input: 'ES',
    expected: true,
});

isTickerLikeTests.push({
    name: '普通小写单词 → false',
    input: 'the',
    expected: false,
});

// ============================================================================
// isAcceptedCode 测试用例
// 格式: { name, input, expected }
// ============================================================================

const isAcceptedCodeTests = [];

isAcceptedCodeTests.push({
    name: '3字母代码 → true',
    input: 'AAP',
    expected: true,
});

isAcceptedCodeTests.push({
    name: '4字母代码 → true',
    input: 'NVDA',
    expected: true,
});

isAcceptedCodeTests.push({
    name: '白名单2字母 → true',
    input: 'GE',
    expected: true,
});

isAcceptedCodeTests.push({
    name: '单字母不在白名单 → false',
    input: 'C',
    expected: false,
});

isAcceptedCodeTests.push({
    name: '期货代码 → true',
    input: 'ES',
    expected: true,
});

isAcceptedCodeTests.push({
    name: '别名代码 → true',
    input: 'BRKB',
    expected: true,
});

isAcceptedCodeTests.push({
    name: '非白名单2字母 → false',
    input: 'AB',
    expected: false,
});

isAcceptedCodeTests.push({
    name: '非白名单单字母 → false',
    input: 'D',
    expected: false,
});

// ============================================================================
// groupParagraphs 测试用例
// 格式: { name, input, expected }
// expected: [{ type, text }] (offset omitted for readability)
// ============================================================================

const groupParagraphsTests = [];

groupParagraphsTests.push({
    name: '单个中文段',
    input: '今天NVDA涨了',
    expected: [{ type: 'chinese', text: '今天NVDA涨了' }],
});

groupParagraphsTests.push({
    name: '单个代码列表',
    input: 'NVDA TSLA AAPL',
    expected: [{ type: 'codelist', text: 'NVDA TSLA AAPL' }],
});

groupParagraphsTests.push({
    name: '单个英文散文',
    input: 'I bought NVDA today',
    expected: [{ type: 'prose', text: 'I bought NVDA today' }],
});

groupParagraphsTests.push({
    name: '连续代码列表合并',
    input: 'NVDA\nTSLA\nAAPL',
    expected: [{ type: 'codelist', text: 'NVDA\nTSLA\nAAPL' }],
});

groupParagraphsTests.push({
    name: '连续散文合并',
    input: 'I bought NVDA\nand sold TSLA',
    expected: [{ type: 'prose', text: 'I bought NVDA\nand sold TSLA' }],
});

groupParagraphsTests.push({
    name: '中文段不与英文合并',
    input: '今天涨了\nNVDA TSLA',
    expected: [
        { type: 'chinese', text: '今天涨了' },
        { type: 'codelist', text: 'NVDA TSLA' },
    ],
});

groupParagraphsTests.push({
    name: '代码列表后散文不合并',
    input: 'NVDA TSLA\nI bought NVDA today',
    expected: [
        { type: 'codelist', text: 'NVDA TSLA' },
        { type: 'prose', text: 'I bought NVDA today' },
    ],
});

groupParagraphsTests.push({
    name: '三段不同类型',
    input: '今天涨了\nNVDA TSLA\nI bought it',
    expected: [
        { type: 'chinese', text: '今天涨了' },
        { type: 'codelist', text: 'NVDA TSLA' },
        { type: 'prose', text: 'I bought it' },
    ],
});

groupParagraphsTests.push({
    name: '空输入',
    input: '',
    expected: [{ type: 'codelist', text: '' }],
});

groupParagraphsTests.push({
    name: '多空行各自成组',
    input: '\n\n',
    expected: [
        { type: 'codelist', text: '' },
        { type: 'codelist', text: '' },
        { type: 'codelist', text: '' },
    ],
});
