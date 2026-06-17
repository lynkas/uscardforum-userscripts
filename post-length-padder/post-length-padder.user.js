// ==UserScript==
// @name         USCardForum Length Helper
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Ensures post length is at least 4 chars (stickers count as 1) on USCardForum
// @author       Antigravity
// @match        https://www.uscardforum.com/*
// @match        https://uscardforum.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const stickerRegex = /:[a-zA-Z0-9_\-+]+:/g;
    const quoteRegex = /\[quote(?:=[^\]]+)?\][\s\S]*?\[\/quote\]/gi;

    function stripQuotes(text) {
        let lastText;
        do {
            lastText = text;
            text = text.replace(quoteRegex, '');
        } while (text !== lastText);
        return text;
    }

    function isTextarea(el) {
        return el.tagName === 'TEXTAREA';
    }

    function getContent(el) {
        if (isTextarea(el)) return el.value;
        const clone = el.cloneNode(true);
        clone.querySelectorAll('aside.quote, blockquote, .d-editor-preview').forEach(function (q) { q.remove(); });
        return clone.textContent || '';
    }

    function calculateEffectiveLength(text) {
        const withoutQuotes = stripQuotes(text).trim();
        return withoutQuotes.replace(stickerRegex, 'S').length;
    }

    function isSingleSticker(text) {
        const withoutQuotes = stripQuotes(text).trim();
        const matches = withoutQuotes.match(stickerRegex);
        return matches && matches.length === 1 && matches[0] === withoutQuotes;
    }

    function padAndSync(editor, paddingSpaces) {
        const zw = '\u200B'.repeat(paddingSpaces);
        if (isTextarea(editor)) {
            editor.value += zw;
        } else {
            editor.appendChild(document.createTextNode(zw));
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }

    document.addEventListener('click', function (event) {
        const target = event.target.closest('[class*="create"]');
        if (!target) return;

        const editor = document.querySelector('.d-editor-input');
        if (!editor) return;

        const text = getContent(editor);
        if (isSingleSticker(text)) return;

        const len = calculateEffectiveLength(text);
        if (len < 4) {
            padAndSync(editor, 4 - len);
        }
    }, true);
})();
