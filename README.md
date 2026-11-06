# 我的 USCardForum 油猴脚本

给 [USCardForum（美卡论坛）](https://www.uscardforum.com/) 写的一些 Tampermonkey 小脚本。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 点击下方各脚本的安装链接，Tampermonkey 会自动弹出安装提示

## 脚本列表

### [stock-price](./stock-price) — 股票价格显示

在理财板块的帖子里自动识别股票代码，从 Yahoo Finance 获取实时价格并内联显示。

- 美股 / ETF：`$AAPL`、`NVDA`、小写 `nvda`；加密货币 `BTC`、期货 `NQ`、外汇对 `CADCNY`
- 其他市场：带后缀 `9020.T`、`0700.HK`、`600519.SS`、`VOD.L`、`SHOP.TO`、`005930.KS`；带前缀 `SHA: 600060`、`HK:0700`；市场词 + 数字 `港股0177`、`沪市600377`
- 公司名：`英伟达`、`台积电`、`腾讯`、`Nike` 等（需要上下文，见下）
- 盘前盘后价格显示；悬浮显示股票全名
- 带完整测试套件（直接加载脚本里的 `#region core` 段运行）

**怎么判断一个词是不是代码**：先看它是不是真实存在的代码（[`tickers.json`](./stock-price/tickers.json)，每周自动更新的美股 + ETF 清单），再看在这里是不是在说它。热门代码（NVDA、QQQ）直接识别；和英文常用词撞车的（ALL、COST）、冷门代码、公司名、纯数字代码，要有证据才识别：旁边有 股/涨/跌/买/仓/财报/call/put 之类、标题里出现过、本帖写过 `$代码`，或者同一行有别的确定代码。在 2000 多楼真实帖子上评测，误报从 0.4 版的 1331 个降到 68 个（详见 [`tools/README.md`](./stock-price/tools/README.md)）。

```bash
# 运行测试
node stock-price/run-tests.js
# 命令行提取测试
node stock-price/run-tests.js "AAPL TSLA $BTC 9020.T 港股0700"
# 重新生成代码清单（GitHub Action 每周自动跑）
node stock-price/tools/build-tickers.js
```

**安装：** [`stock-price-tampermonkey.user.js`](https://github.com/lynkas/uscardforum-userscripts/raw/main/stock-price/stock-price-tampermonkey.user.js)

### 自定义黑名单（可选）

脚本默认从[仓库的 blacklist.json](./stock-price/blacklist.json) 拉取排除列表，开箱即用。想自定义：

1. 复制 [`blacklist.json`](./stock-price/blacklist.json) 内容
2. 在自己的 GitHub 建 Gist，粘贴进去（公开）
3. 点 Gist 的 Raw → 复制 `gist.githubusercontent.com` 链接
4. 论坛页面点 Tampermonkey 扩展图标 →「⚙️ 设置黑名单同步链接…」→ 粘贴

支持字段（全部可选，出现的覆盖默认值）：

```json
{
  "excludeCodes":   ["不想识别的代码（写成 $X 时仍识别）"],
  "excludePhrases": ["不识别的短语"],
  "aliases":        { "论坛写法": "Yahoo代码" },
  "nameAliases":    { "公司名": "Yahoo代码（要有上下文才识别）" },
  "cryptoCodes":    ["加密货币"],
  "fiatCodes":      ["法币"],
  "futuresCodes":   ["期货"]
}
```

黑名单和代码清单都缓存在本地，断网时用上次的缓存。菜单「🔄 立即重新同步黑名单」会同时刷新两者；「📋 查看当前生效黑名单」把当前生效的列表打印到控制台。

### [clown-to-yawn](./clown-to-yawn) — 表情替换 🤡→🥱

把论坛帖子反应中的 🤡（clown_face）表情自动替换为 🥱（yawning_face）。

**安装：** [`clown-to-yawn.user.js`](https://github.com/lynkas/uscardforum-userscripts/raw/main/clown-to-yawn/clown-to-yawn.user.js)

### [bot-avatar-replace](./bot-avatar-replace) — 美卡助手头像替换

把右下角美卡助手悬浮球的图标替换为 258 的头像。支持通过 Tampermonkey 菜单自定义替换图片链接。

**安装：** [`bot-avatar-replace.user.js`](https://github.com/lynkas/uscardforum-userscripts/raw/main/bot-avatar-replace/bot-avatar-replace.user.js)

### [post-length-padder](./post-length-padder) — 发帖长度补全

自动补全过短的帖子内容到 4 个字符以上（论坛最低长度要求），用零宽空格填充。单独发一个表情贴纸不受影响。

**安装：** [`post-length-padder.user.js`](https://github.com/lynkas/uscardforum-userscripts/raw/main/post-length-padder/post-length-padder.user.js)
