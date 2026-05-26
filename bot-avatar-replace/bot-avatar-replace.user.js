// ==UserScript==
// @name         USCardForum Image Replacer
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Replace specific SVG icons/images within a given div on uscardforum.com with a custom image link
// @match        *://*.uscardforum.com/*
// @match        *://uscardforum.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
    'use strict';

    // 默认的替换图片链接
    const DEFAULT_IMAGE_URL = 'https://www-cdn.uscardforum.com/user_avatar/www.uscardforum.com/258/288/690799_2.png';

    // 获取设置的图片链接
    function getReplacementUrl() {
        return GM_getValue('replacementImageUrl', DEFAULT_IMAGE_URL);
    }

    // 注册设置菜单
    GM_registerMenuCommand('设置替换图片链接', () => {
        const currentUrl = getReplacementUrl();
        const newUrl = prompt('请输入新的图片链接:', currentUrl);
        if (newUrl !== null && newUrl.trim() !== '') {
            GM_setValue('replacementImageUrl', newUrl.trim());
            alert('图片链接已更新，刷新页面后生效。');
            replaceImages(); // 尝试立即替换
        }
    });

    // 我们将把相关的属性加上 !important，并用循环定时器替代 observer
    // 很多插件或者 SPA 框架（如 React/Vue）会在不同时机渲染这个组件
    // 定时检查是应对这种动态悬浮控件（z-index 很高）最稳妥的办法
    function replaceImages() {
        const replacementUrl = getReplacementUrl();

        // 查找包含指定的打开图标
        const openIcons = document.querySelectorAll('svg#openIcon');

        openIcons.forEach(openIcon => {
            const container = openIcon.parentElement;

            // 验证是否是我们要找的那个 div
            const closeIcon = container.querySelector('svg#closeIcon');
            if (container && closeIcon) {
                let img = container.querySelector('img.custom-replacer-img');

                // 如果还没有添加我们的替换图片，则进行添加
                if (!img) {
                    // 设置容器的一些属性以防止其变为方块
                    container.style.borderRadius = '50%';
                    container.style.overflow = 'hidden';

                    // 创建我们自己的替换图片
                    img = document.createElement('img');
                    img.className = 'custom-replacer-img';
                    img.src = replacementUrl;
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.objectFit = 'cover';

                    // 为了不遮挡 closeIcon，也不阻挡用户点击原来的悬浮球容器
                    img.style.position = 'absolute';
                    img.style.top = '0';
                    img.style.left = '0';
                    img.style.zIndex = '0';
                    img.style.pointerEvents = 'none'; // 【关键】让点击穿透图片

                    // 将图片插入到容器的最前面
                    container.prepend(img);

                    // 创建一个观察器，专门用来实现无延迟的状态切换
                    const observer = new MutationObserver((mutations) => {
                        let shouldSync = false;
                        for (let m of mutations) {
                            if (m.target === closeIcon || m.target === openIcon) {
                                shouldSync = true;
                                break;
                            }
                        }
                        if (shouldSync) {
                            syncImageState(img, openIcon, closeIcon);
                        }
                    });

                    // 监听原始图标属性发生变化（如 style 改变隐现状态）
                    observer.observe(container, {
                        attributes: true,
                        subtree: true,
                        attributeFilter: ['style', 'class']
                    });
                }

                // 初始化与轮询调用
                syncImageState(img, openIcon, closeIcon);
            }
        });
    }

    // 单独抽象出的状态同步逻辑
    function syncImageState(img, openIcon, closeIcon) {
        const isCloseIconVisible = closeIcon.style.display !== 'none';

        if (isCloseIconVisible) {
            // 当展开时，只显示 closeIcon，隐藏我们的自定义图片
            // 为了防止死循环，先判断当前值
            if (img.style.getPropertyValue('display') !== 'none') {
                img.style.setProperty('display', 'none', 'important');
            }
        } else {
            // 当收起时，显示我们的自定义图片，并强制隐藏原有的 openIcon
            if (img.style.getPropertyValue('display') !== 'block') {
                img.style.setProperty('display', 'block', 'important');
            }
            if (openIcon.style.getPropertyValue('display') !== 'none') {
                openIcon.style.setProperty('display', 'none', 'important');
            }
        }

        // 确保 closeIcon 层级正确不被图片遮挡
        closeIcon.style.zIndex = '10';
    }

    // 页面加载完成后执行替换
    window.addEventListener('load', replaceImages);

    // 初始化时执行一次
    replaceImages();

    // 每秒执行一次轮询，仅用来容错和兜底保证即使 DOM 被重建也会重新插入
    // 实时的无延迟体验已经由 MutationObserver 提供
    setInterval(replaceImages, 1000);
})();
