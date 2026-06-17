// ==UserScript==
// @name         USCardForum Length Helper
// @namespace    http://tampermonkey.net/
// @version      1.3
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

    // Injected only when the post is completely empty. The raw "<a></a>" carries
    // an alphanumeric char ("a"), so it passes TextSentinel's seems_pronounceable?
    // and entropy checks, yet renders as an empty (invisible) anchor.
    // Zero-width spaces alone fail those checks (no \p{Alnum} char), which is why
    // a fully empty reply needs this placeholder instead.
    const BLANK_PLACEHOLDER = '<a></a>';

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

    function injectBlankPlaceholder(editor) {
        if (isTextarea(editor)) {
            editor.value = BLANK_PLACEHOLDER;
        } else {
            // Rich editor (ProseMirror): focus, place caret at end, insert as HTML.
            editor.focus();
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('insertHTML', false, BLANK_PLACEHOLDER);
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
        if (len === 0) {
            // Nothing typed at all: emit an invisible placeholder
            injectBlankPlaceholder(editor);
        } else if (len < 4) {
            padAndSync(editor, 4 - len);
        }
    }, true);
})();
