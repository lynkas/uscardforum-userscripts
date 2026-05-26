# USCardForum Userscripts

Tampermonkey userscripts for [USCardForum](https://www.uscardforum.com/).

## stock-price

Inline stock price display for the investment category. Extracts ticker codes from forum posts and shows live prices from Yahoo Finance.

### Install

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Open `stock-price/stock-price-tampermonkey.user.js` raw file
3. Tampermonkey will prompt to install

### Test

```bash
node stock-price/run-tests.js
# CLI extraction test:
node stock-price/run-tests.js "AAPL TSLA $BTC"
```
