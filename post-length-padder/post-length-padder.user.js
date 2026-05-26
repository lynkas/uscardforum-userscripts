// ==UserScript==
// @name         USCardForum Length Helper
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Ensures post length is at least 4 chars (stickers count as 1) on USCardForum
// @author       Antigravity
// @match        https://www.uscardforum.com/*
// @match        https://uscardforum.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Regex to identify stickers matching the :emoji_name: pattern
    const stickerRegex = /:[a-zA-Z0-9_\-+]+:/g;
    // Regex to identify quotes [quote=...]...[/quote]
    const quoteRegex = /\[quote(?:=[^\]]+)?\][\s\S]*?\[\/quote\]/gi;

    /**
     * Recursively removes all quote blocks from the text.
     */
    function stripQuotes(text) {
        let lastText;
        do {
            lastText = text;
            text = text.replace(quoteRegex, '');
        } while (text !== lastText);
        return text;
    }

    /**
     * Calculates the "effective" length where stickers count as 1 character and quotes are ignored.
     * Whitespace is trimmed to match the forum's validation logic.
     */
    function calculateEffectiveLength(text) {
        const withoutQuotes = stripQuotes(text).trim();
        // Replace all stickers with a placeholder 'S' and then count characters
        return withoutQuotes.replace(stickerRegex, 'S').length;
    }

    /**
     * Checks if the content consists of exactly one sticker and optional surrounding whitespace,
     * ignoring any quote blocks.
     */
    function isSingleSticker(text) {
        const withoutQuotes = stripQuotes(text).trim();
        const matches = withoutQuotes.match(stickerRegex);
        // It's a single sticker if there is exactly one match and it matches the entire non-quote string
        return matches && matches.length === 1 && matches[0] === withoutQuotes;
    }

    document.addEventListener('click', function (event) {
        // Find the clicked element or its closest ancestor that has a class containing "create"
        // This matches buttons like 'Reply' or 'Create Topic'
        const target = event.target.closest('[class*="create"]');
        if (!target) return;

        // Find the composer textarea (standard Discourse class)
        const textarea = document.querySelector('textarea.d-editor-input');
        if (!textarea) return;

        const originalValue = textarea.value;

        // Apply exception: exactly one sticker is fine
        if (isSingleSticker(originalValue)) {
            return;
        }

        const effectiveLen = calculateEffectiveLength(originalValue);

        if (effectiveLen < 4) {
            const paddingNeeded = 4 - effectiveLen;
            // Append Zero-Width Space (U+200B)
            const newValue = originalValue + '\u200B'.repeat(paddingNeeded);

            textarea.value = newValue;

            // Trigger an 'input' event so the site's framework (Discourse/Ember)
            // synchronizes the state and enables the submit button
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, true); // Use capture phase to perform logic before potential submission events
})();
