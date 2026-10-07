// == Nezha Dashboard IP Ping/TCPing ==

(function () {
    'use strict';

    if (!location.href.includes('/dashboard')) return;

    // ---------- 样式 ----------
    const style = document.createElement('style');
    style.textContent = `
        .nezha-ping-btn {
            display:inline-flex;
            align-items:center;
            justify-content:center;
            height:18px;
            line-height:18px;
            font-size:11px;
            padding:0 6px;
            margin-right:4px;
            border-radius:6px;
            cursor:pointer;
            user-select:none;
            border:1px solid #ccc;
            background:#f5f5f5;
            color:#000;
            text-decoration:none;
            white-space:nowrap;
        }
        .nezha-ping-btn:hover { filter:brightness(0.95); }
        html.dark .nezha-ping-btn {
            border-color:#555;
            background:#2f2f2f;
            color:#fff;
        }
        .nezha-ping-wrap {
            display:flex;
            gap:4px;
            margin-bottom:2px;
        }
    `;
    document.head.appendChild(style);

    // ---------- 解析 IP ----------
    function parseIPs(text) {
        return text.split(/[\/\s,|;]+/)
            .map(token => {
                token = token.trim();
                if (!token) return null;

                // IPv4 / IPv4:port
                if (/^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?$/.test(token)) {
                    const hasPort = /:\d+$/.test(token);
                    return {
                        ip: hasPort ? token.replace(/:\d+$/, '') : token,
                        type: 'v4',
                        hasPort,
                        token
                    };
                }

                // [IPv6]:port
                let m = token.match(/^\[([0-9a-fA-F:]+)\]:(\d+)$/);
                if (m) {
                    return {
                        ip: m[1],
                        type: 'v6',
                        hasPort: true,
                        token
                    };
                }

                // IPv6 / [IPv6]
                m = token.match(/^\[?([0-9a-fA-F:]+)\]?$/);
                if (m && token.includes(':')) {
                    return {
                        ip: m[1],
                        type: 'v6',
                        hasPort: false,
                        token
                    };
                }

                return null;
            })
            .filter(Boolean);
    }

    // ---------- 创建按钮 ----------
    function createButton(info) {
        const a = document.createElement('a');
        a.className = 'nezha-ping-btn';

        const v6 = info.type === 'v6';

        if (info.hasPort) {
            a.textContent = v6 ? 'Tcpingv6' : 'Tcpingv4';
            a.href = `https://www.itdog.cn/${v6 ? 'tcping_ipv6' : 'tcping'}/${encodeURIComponent(info.token)}`;
        } else {
            a.textContent = v6 ? 'Pingv6' : 'Pingv4';
            a.href = `https://www.itdog.cn/${v6 ? 'ping_ipv6' : 'ping'}/${encodeURIComponent(info.ip)}`;
        }

        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        return a;
    }

    function createGeoIPButton(info) {
        const a = document.createElement('a');
        a.className = 'nezha-ping-btn';
        a.textContent = 'GeoIP';
        a.href = `https://geoip.loukky.com/?ip=${encodeURIComponent(info.ip)}`;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        return a;
    }

    // ---------- 添加按钮 ----------
    function appendButtons(cell) {
        if (!cell || cell.dataset.nzPingProcessed === '1') return;

        const ips = parseIPs(cell.textContent.trim());
        if (!ips.length) return;

        const wrap = document.createElement('div');
        wrap.className = 'nezha-ping-wrap';

        ips.forEach(info => {
            wrap.appendChild(createButton(info));
            wrap.appendChild(createGeoIPButton(info));
        });

        cell.prepend(wrap);
        cell.dataset.nzPingProcessed = '1';
    }

    function processTable() {
        document.querySelectorAll('tbody tr td').forEach(appendButtons);
    }

    // ---------- 初始化 ----------
    function init() {
        processTable();

        let timer;
        new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(processTable, 50);
        }).observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });

        setTimeout(processTable, 200);
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();