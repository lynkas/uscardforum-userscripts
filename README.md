# 我的 USCardForum 油猴脚本

给 [USCardForum（美卡论坛）](https://www.uscardforum.com/) 写的一些 Tampermonkey 小脚本。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 点击下方各脚本的安装链接，Tampermonkey 会自动弹出安装提示

## 脚本列表

### [stock-price](./stock-price) — 股票价格显示

在理财板块的帖子里自动识别股票代码，从 Yahoo Finance 获取实时价格并内联显示。

- 支持 $EXACT 格式（`$AAPL`、`$BTC`）、独立代码、外汇对（`CADCNY`）
- 支持海外交易所代码：`9020.T`、`SHOP.TO`、`600519.SS` 等
- 盘前盘后价格显示
- 悬浮显示股票全名
- 带完整测试套件（174 个测试用例）

```bash
# 运行测试
node stock-price/run-tests.js
# 命令行提取测试
node stock-price/run-tests.js "AAPL TSLA $BTC 9020.T"
```

**安装：** [`stock-price-tampermonkey.user.js`](https://github.com/lynkas/uscardforum-userscripts/raw/main/stock-price/stock-price-tampermonkey.user.js)

### [clown-to-yawn](./clown-to-yawn) — 表情替换 🤡→🥱

把论坛帖子反应中的 🤡（clown_face）表情自动替换为 🥱（yawning_face）。

**安装：** [`clown-to-yawn.user.js`](https://github.com/lynkas/uscardforum-userscripts/raw/main/clown-to-yawn/clown-to-yawn.user.js)

### [bot-avatar-replace](./bot-avatar-replace) — 美卡助手头像替换

把右下角美卡助手悬浮球的图标替换为 258 的头像。支持通过 Tampermonkey 菜单自定义替换图片链接。

**安装：** [`bot-avatar-replace.user.js`](https://github.com/lynkas/uscardforum-userscripts/raw/main/bot-avatar-replace/bot-avatar-replace.user.js)

### [post-length-padder](./post-length-padder) — 发帖长度补全

自动补全过短的帖子内容到 4 个字符以上（论坛最低长度要求），用零宽空格填充。单独发一个表情贴纸不受影响。

**安装：** [`post-length-padder.user.js`](https://github.com/lynkas/uscardforum-userscripts/raw/main/post-length-padder/post-length-padder.user.js)
