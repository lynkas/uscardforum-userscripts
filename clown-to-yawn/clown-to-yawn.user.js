// ==UserScript==
// @name         USCardForum Emoji Replacer - Clown to Yawning
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Replace clown_face emoji with yawning_face in specific elements on uscardforum.com
// @author       You
// @match        *://*.uscardforum.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 替换表情的函数
    function replaceEmojis() {
        // 查找目标容器
        const containers = document.querySelectorAll('.post-users-popup, .discourse-reactions-actions');

        containers.forEach(container => {
            // 查找容器内的所有图片
            const images = container.querySelectorAll('img');

            images.forEach(img => {
                // 如果图片在 discourse-reactions-picker 内部，则跳过
                if (img.closest('.discourse-reactions-picker')) return;

                // 检查图片源是否包含 clown_face.png（忽略后面的 query 参数）
                if (img.src && img.src.includes('clown_face.png')) {
                    // 替换为 yawning_face.png，保留原有的 query 参数
                    img.src = img.src.replace('clown_face.png', 'yawning_face.png');
                }
            });
        });
    }

    // 初始运行
    replaceEmojis();

    // 因为论坛内容通常是动态加载的，我们需要使用 MutationObserver 来监听页面变化
    const observer = new MutationObserver((mutations) => {
        let shouldReplace = false;
        for (let mutation of mutations) {
            if (mutation.addedNodes.length > 0 || mutation.type === 'attributes') {
                shouldReplace = true;
                break;
            }
        }

        if (shouldReplace) {
            replaceEmojis();
        }
    });

    // 开始观察整个 body 的变化
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'class']
    });
})();
