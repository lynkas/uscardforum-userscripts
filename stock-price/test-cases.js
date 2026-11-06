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
    // 0.5：英文句子里的热门代码也识别（旧规则整句跳过会漏）
    name: '英文句子含语法词',
    input: 'I bought NVDA and TSLA today',
    expected: ['NVDA', 'TSLA'],
});

extractionTests.push({
    name: '$EXACT 在英文句子中',
    input: 'I want to buy $NVDA and $TSLA',
    expected: ['NVDA', 'TSLA'],
});

extractionTests.push({
    // 0.5：MSFT 是热门代码直接识别；小写 uso 不是英文词，按 USO 识别；BUY 在排除表
    name: '$EXACT混合英文 — USO/BUY/MSFT不匹配',
    input: 'we uso buy $NvDa with $nq=f but not with $000001.SS in MSFT',
    expected: ['000001.SS', 'MSFT', 'NQ=F', 'NVDA', 'USO'],
});

extractionTests.push({
    // 0.5：撇号后的 s 仍不匹配；英文句子里的 NVDA 识别
    name: '撇号阻止s匹配',
    input: "Trump's plan for NVDA",
    expected: ['NVDA'],
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
    // 0.5：ADDED / INFO 不在代码清单里
    name: 'edit: 冒号后缀不提取（其余独立词照常）',
    input: 'edit: added more info',
    expected: [],
});

extractionTests.push({
    // 含语法词 THE → 整段判为英文句子，只认 $EXACT，所以什么都不提取
    name: 'update: 冒号后缀不提取（含 the 的英文句子整体跳过）',
    input: 'update: fixed the bug',
    expected: [],
});

extractionTests.push({
    name: '冒号后缀在中国段中也不提取',
    input: 'edit: 补充说明一下NVDA涨了',
    expected: ['NVDA'],
});

extractionTests.push({
    // 0.5：NOTE 是英文常用词，单独一行且本楼没有其他代码 → 不识别
    name: 'note: 冒号后缀不提取但独立NOTE提取',
    input: 'note: something\nNOTE',
    expected: [],
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
    // 0.5：MSFT 识别；小写 cny 不当货币（货币代码要大写）
    name: '完整帖子多段落',
    input: '测试用\n\nNvda\nwe uso buy $NvDa with $nq=f but not with $000001.SS in MSFT\nAMD\nBRK.B brkb\nBTC cny\nuso',
    expected: ['000001.SS', 'AMD', 'BRK.B', 'BRKB', 'BTC', 'MSFT', 'NQ=F', 'NVDA', 'USO'],
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
    // 0.5：英文句子里的热门代码也识别
    name: '中文段语法词短语不触发排除',
    input: 'this is a test NVDA TSLA',
    expected: ['NVDA', 'TSLA'], // English paragraph with grammar words → prose, no standalone
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
    // 0.5：英文句子里的热门代码也识别
    name: '英文散文 — 独立代码不提取',
    input: 'I bought some NVDA and TSLA today',
    expected: ['NVDA', 'TSLA'],
});

extractionTests.push({
    name: '英文散文 — $EXACT提取',
    input: 'I want to sell $NVDA and buy $TSLA',
    expected: ['NVDA', 'TSLA'],
});

extractionTests.push({
    // 0.5：英文句子里的热门代码也识别
    name: '英文散文 — 混合仅$EXACT提取独立不提取',
    input: 'My portfolio has NVDA TSLA and I added $AAPL',
    expected: ['AAPL', 'NVDA', 'TSLA'],
});

// ── 边界情况 ──

extractionTests.push({
    name: '中文段 — dram小写代码提取(非排除词)',
    input: 'dram 8% :yaoming:',
    expected: ['DRAM'],
});

extractionTests.push({
    // 0.5：BASIS 不在代码清单里
    name: '中文段 — 含数字和excludePhrases短语（basis孤立不触发cost basis排除）',
    input: '价格$100以上，买了NVDA和TSLA，成本basis',
    expected: ['NVDA', 'TSLA'],
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
    priceData: { price: 150.25, change: 2.35, extPrice: 152.00, extChange: 1.16, tradingPeriod: postTp, _nowS: 60000 },
    expected: '(150.25 +2.35%) · P152.00 +1.16%',
});

priceFormatTests.push({
    name: '盘后下跌 — 显示P价格',
    symbol: 'TSLA',
    priceData: { price: 200.50, change: -3.10, extPrice: 198.00, extChange: -1.25, tradingPeriod: postTp, _nowS: 60000 },
    expected: '(200.50 -3.10%) · P198.00 -1.25%',
});

// Pre-market TP: pre is active
priceFormatTests.push({
    name: '盘前价格 — 显示P价格',
    symbol: 'NVDA',
    priceData: { price: 800.00, change: 5.00, extPrice: 805.00, extChange: 0.63, tradingPeriod: postTp, _nowS: 33000 },
    expected: '(800.00 +5.00%) · P805.00 +0.63%',
});

// Regular session — no after-hours display
priceFormatTests.push({
    name: '盘中 — 不显示盘后',
    symbol: 'AAPL',
    priceData: { price: 150.25, change: 2.35, extPrice: 152.00, extChange: 1.16, tradingPeriod: postTp, _nowS: 45000 },
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
// 0.5 识别规则：代码清单 + 上下文证据（来自论坛真实帖子的评测，见 tools/README.md）
// 可选 ctx: { dollar: [本帖写过 $X 的代码], title: '帖子标题' }
// ============================================================================

extractionTests.push({ name: '$ 后面是金额不是代码', input: '目标价 $250K，市值 $1.5T，$NVDA 冲', expected: ['NVDA'] });
extractionTests.push({ name: '图片说明里的尺寸单位不是代码', input: 'IMG_3936 1077×569 93.8 KB', expected: [] });
extractionTests.push({ name: '数字后的单位不是代码', input: '内存 16 GB，硬盘 2 TB', expected: [] });
extractionTests.push({ name: '代码后跟价格照常识别', input: 'NVDA 135.20 TSLA 200.50', expected: ['NVDA', 'TSLA'] });
extractionTests.push({ name: '小写热门代码', input: '最近买了点nvda和pltr', expected: ['NVDA', 'PLTR'] });
extractionTests.push({ name: '小写但像英文词的代码不认', input: '打个uber去机场', expected: [] });
extractionTests.push({ name: '不在代码清单里的大写词不认', input: 'CASH BONUS OFFER LAPTOP', expected: [] });
extractionTests.push({ name: '撞车词无证据不认', input: 'COST 太高了不值', expected: [] });
extractionTests.push({ name: '撞车词旁边有交易词', input: 'COST 财报不错', expected: ['COST'] });
extractionTests.push({ name: '撞车词同一行有确定代码', input: '持仓：NVDA COST AAPL', expected: ['NVDA', 'COST', 'AAPL'] });
extractionTests.push({ name: '小写撞车词不认', input: '这个 cost 太高 买不起', expected: [] });
extractionTests.push({ name: '标题里出现过的撞车词', input: 'COST 今天怎么样', ctx: { title: 'COST 财报讨论' }, expected: ['COST'] });
extractionTests.push({ name: '本帖写过 $X 的排除词也认', input: 'NOW 不错', ctx: { dollar: ['NOW'] }, expected: ['NOW'] });
extractionTests.push({ name: '两字母代码要证据', input: 'MU 财报后涨了，AB 方案', expected: ['MU'] });
extractionTests.push({ name: '冷门代码要证据', input: 'AENT 是什么\n买了点 AENT', expected: ['AENT'] });
extractionTests.push({ name: '网址片段不算', input: '看这个 https://www.example.com/AAPL/news 和 www.cnbc.com', expected: [] });
extractionTests.push({ name: '论坛常用缩写不认', input: 'LZ 的 PS: 用 IBKR 开户要 KYC', expected: [] });
extractionTests.push({ name: '法币：说汇率时认', input: '日元又贬了 JPY 150', expected: ['JPY'] });
extractionTests.push({ name: '法币：当金额单位不认', input: '账户里有 100 USD', expected: [] });
extractionTests.push({ name: '代码列表行：只有货币也认', input: 'USD CNY', expected: ['USD', 'CNY'] });
extractionTests.push({ name: '单字母只认 $ 写法', input: 'A股 和 F 都不算，$F 算', expected: ['F'] });

// ── 缩写（真机测试"光进铜退手册"术语表帖暴露的误报） ──

extractionTests.push({ name: '缩写写了全称不认', input: 'OCS Optical Circuit Switch 光路交换机，NPO 光引擎（Near-Packaged Optics）', expected: [] });
extractionTests.push({ name: '写了全称但同句有交易词仍认', input: 'AMD 股价大跌（Advanced Micro Devices）', expected: ['AMD'] });
extractionTests.push({ name: '术语表：2–3 字母代码都当缩写，4 字母代码照常', input: 'DSP Digital Signal Processor\nOCS Optical Circuit Switch\nNPO Near Packaged Optics\nALC、COHR 都在做', expected: ['COHR'] });
extractionTests.push({ name: '普通英文里的首字母巧合不算全称', input: 'and my dad 都在拿 AMD', expected: ['AMD'] });

extractionTests.push({ name: '连字符复合词里的小写词不认', input: 'IMDD 与相干-lite 两条线，scale-up 方案', expected: [] });
extractionTests.push({ name: '缩写只有少数几处有证据不认', input: 'DSP Digital Signal Processor\n3.6T 的 DSP 在 2029 年出现\n多家 DSP 来源\nMarvell 把 DSP 卖进别人的线缆', expected: [] });

// ── 其他市场 ──

extractionTests.push({ name: '交易所后缀：日/港/伦敦', input: '古河电工 5801.T、VOD.L 以及 0700.HK', expected: ['5801.T', 'VOD.L', '0700.HK'] });
extractionTests.push({ name: '交易所后缀：加拿大/澳洲/韩国', input: 'SHOP.TO BHP.AX 005930.KS', expected: ['SHOP.TO', 'BHP.AX', '005930.KS'] });
extractionTests.push({ name: '缩写里的点不是后缀', input: 'e.g. U.S. a.m. i.e.', expected: [] });
extractionTests.push({ name: '交易所前缀', input: 'Hisense (SHA: 600060)，另外 SZ300750', expected: ['600060', '300750'] });
extractionTests.push({ name: 'A 股：沪市 + 6 位代码', input: '宁沪高速 今日沪市600377 12.21 CNY 股息年化4%', expected: ['600377'] });
extractionTests.push({ name: '港股：市场词 + 4 位代码', input: '而港股0177 9.76 HKD 股息年化5.5%', expected: ['0177'] });
extractionTests.push({ name: '韩股：6 位代码 + 交易词', input: '但我000660當初也只敢買倉位不到5%而已', expected: ['000660'] });
extractionTests.push({ name: '日股：市场词 + 4 位代码（同句有"股"，丰田也算）', input: '日股 7203 丰田最近不错', expected: ['7203', '丰田'] });
extractionTests.push({ name: '6 位数字是金额时不认', input: '买房花了600000，工资 300000 刀', expected: [] });
extractionTests.push({ name: '4 位数字没有市场词不认（年份等）', input: '2025 买了 1234 份', expected: [] });
extractionTests.push({ name: '港股后面的年份不认', input: '港股 2025年表现', expected: [] });

// ── 公司名（要有证据） ──

extractionTests.push({ name: '中文公司名 + 交易词', input: '英伟达财报超预期，台积电也涨了', expected: ['英伟达', '台积电'] });
extractionTests.push({ name: '中文公司名无证据不认', input: '苹果手机真好用', expected: [] });
extractionTests.push({ name: '长名优先：阿里巴巴不重复算阿里', input: '阿里巴巴股价', expected: ['阿里巴巴'] });
extractionTests.push({ name: '英文公司名 + 交易词', input: '对 Nike 股票实在没兴趣', expected: ['NIKE'] });
extractionTests.push({ name: '港股公司名', input: '腾讯又跌了', expected: ['腾讯'] });

// ============================================================================
// yahooCandidates：论坛写法 → 依次尝试的 Yahoo 代码
// setup：先识别这段文本（纯数字代码的市场在识别时推断）
// ============================================================================

const candidateTests = [];

candidateTests.push({ name: '港股补足 4 位', input: '700.HK', expected: ['0700.HK'] });
candidateTests.push({ name: '港股 5 位去掉前导 0', input: '09988.HK', expected: ['9988.HK'] });
candidateTests.push({ name: '.SH 写法 → Yahoo 的 .SS', input: '600519.SH', expected: ['600519.SS'] });
candidateTests.push({ name: '伦敦', input: 'VOD.L', expected: ['VOD.L'] });
candidateTests.push({ name: '美股类别股 BF.B → BF-B', input: 'BF.B', expected: ['BF-B'] });
candidateTests.push({ name: '中文公司名 → 美股', input: '英伟达', expected: ['NVDA'] });
candidateTests.push({ name: '中文公司名 → 港股', input: '腾讯', expected: ['0700.HK'] });
candidateTests.push({ name: '沪市 6 位：.SS 优先', setup: '沪市600377', input: '600377', expected: ['600377.SS', '600377.SZ', '600377.KS', '600377.KQ'] });
candidateTests.push({ name: '0 开头 6 位：.SZ 优先，再试韩股', setup: '买了000660', input: '000660', expected: ['000660.SZ', '000660.SS', '000660.KS', '000660.KQ'] });
candidateTests.push({ name: '韩股语境：.KS 优先', setup: '韩股 005930 买', input: '005930', expected: ['005930.KS', '005930.KQ', '005930.SZ', '005930.SS'] });
candidateTests.push({ name: '港股 4 位', setup: '港股0177 买', input: '0177', expected: ['0177.HK'] });
candidateTests.push({ name: '前缀 SHA', setup: 'SHA: 600060', input: '600060', expected: ['600060.SS', '600060.SZ', '600060.KS', '600060.KQ'] });

// ============================================================================
// acceptsForm：这种写法能不能当代码
// ============================================================================

const acceptsFormTests = [];

acceptsFormTests.push({ name: '大写', code: 'NVDA', raw: 'NVDA', expected: true });
acceptsFormTests.push({ name: '小写热门代码', code: 'NVDA', raw: 'nvda', expected: true });
acceptsFormTests.push({ name: '小写撞车词', code: 'COST', raw: 'cost', expected: false });
acceptsFormTests.push({ name: '大写撞车词', code: 'COST', raw: 'COST', expected: true });
acceptsFormTests.push({ name: '小写但像英文词', code: 'UBER', raw: 'uber', expected: false });
acceptsFormTests.push({ name: '公司名不限大小写', code: 'NIKE', raw: 'nike', expected: true });

priceFormatTests.push({
    name: '闭市但有盘后价（隔夜）— 显示C前缀和P价格',
    symbol: 'TSLA',
    priceData: { price: 343.69, change: -10.77, extPrice: 347.56, extChange: 1.13, tradingPeriod: postTp, _nowS: 80000 },
    expected: '(C343.69 -10.77%) · P347.56 +1.13%',
});

// ============================================================================
// parseQuoteMeta：Yahoo chart/spark 的 meta → 行情（字段取自 2026-11-06 的真实返回）
// expected 只比较列出的字段；null 表示应返回 null
// ============================================================================

const quoteMetaTests = [];

const metaTp = { pre: { start: 1, end: 2 }, regular: { start: 2, end: 3 }, post: { start: 3, end: 4 } };

quoteMetaTests.push({
    name: '常规价 + 盘后价（fulldayPrice）',
    meta: { regularMarketPrice: 343.69, chartPreviousClose: 385.19, fulldayPrice: 347.56, hasPrePostMarketData: true, longName: 'Tesla, Inc.', currentTradingPeriod: metaTp },
    expected: { name: 'Tesla, Inc.', price: 343.69, change: -10.77, extPrice: 347.56, extChange: 1.13 },
});
quoteMetaTests.push({
    name: '没有盘前盘后数据的市场不显示 P',
    meta: { regularMarketPrice: 1132000, chartPreviousClose: 1264000, fulldayPrice: 1132000, hasPrePostMarketData: false, shortName: 'SK hynix' },
    expected: { name: 'SK hynix', price: 1132000, change: -10.44, extPrice: undefined },
});
quoteMetaTests.push({
    name: 'fulldayPrice 与常规价相同不显示 P',
    meta: { regularMarketPrice: 100, chartPreviousClose: 98, fulldayPrice: 100, hasPrePostMarketData: true },
    expected: { price: 100, change: 2.04, extPrice: undefined },
});
quoteMetaTests.push({
    name: '没有昨收时用 regularMarketChangePercent',
    meta: { regularMarketPrice: 50, regularMarketChangePercent: -1.5 },
    expected: { price: 50, change: -1.5 },
});
quoteMetaTests.push({ name: '没有价格 → null', meta: { symbol: 'X' }, expected: null });
quoteMetaTests.push({ name: 'meta 缺失 → null', meta: undefined, expected: null });
