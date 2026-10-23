// ==UserScript==
// @version 3.1
// @description 哪吒新版主题：把「详情」和「网络」两个 tab 合并到同一屏（详情图表 + 网络监控图上下叠放），隐藏「网络」tab，并自动开启削峰。
// @author 由 DeepSeek Harness (deepseek-v4.1-flash) 修复适配新版主题；原始思路 https://www.nodeseek.com/post-349102-1
// ==/UserScript==
//
// 原理：新版 ServerDetail 用 React 条件渲染切换 tab（旧脚本靠 display 强显已失效），
// 因此这里直接动态 import 站点自己打包的 NetworkChart chunk，用同一份 React / react-dom
// 在详情页底部挂载一个独立的 React 根，渲染出官方网络图。资源文件名带 hash，运行时解析。
(function () {
	"use strict";

	var HOST_ID = "nz-netstatus-merge-host";
	var SEL_ROOT = ".server-info";
	var SEL_TABS = ".server-info-tab";

	var mods = null; // {React, createRoot, QueryClient, Provider, NetworkChart}
	var root = null;
	var client = null;
	var mountedPath = null;
	var loading = false;

	// ---------- 资源发现（hash 会变，所以运行时解析） ----------

	function isReact(ns) {
		return (
			ns &&
			typeof ns.createElement === "function" &&
			typeof ns.useState === "function" &&
			typeof ns.useMemo === "function"
		);
	}

	function isQueryClient(v) {
		return (
			typeof v === "function" &&
			v.prototype &&
			typeof v.prototype.getQueryData === "function" &&
			typeof v.prototype.mount === "function"
		);
	}

	function isProvider(v) {
		return (
			typeof v === "function" &&
			!/^class/.test(String(v)) &&
			String(v).indexOf(".mount()") !== -1
		);
	}

	// 打包器把 React / react-dom 包成了 `()=>module.exports` 的惰性 getter，需要调一下解包
	function unwrap(v) {
		if (typeof v !== "function" || v.length !== 0) return v;
		if (!/exports/.test(String(v))) return v;
		try {
			return v();
		} catch (e) {
			return v;
		}
	}

	function scriptUrls() {
		var seen = {};
		return performance
			.getEntriesByType("resource")
			.map(function (e) {
				return e.name;
			})
			.filter(function (u) {
				if (!/\/assets\/[^/]+\.js(\?|$)/.test(u)) return false;
				if (seen[u]) return false;
				seen[u] = 1;
				return true;
			});
	}

	async function findNetworkChunk() {
		var urls = scriptUrls();
		var direct = urls.filter(function (u) {
			return /\/NetworkChart\.[^/]*\.js$/.test(u);
		});
		if (direct.length) return direct[0];

		var detailUrl = urls.filter(function (u) {
			return /\/ServerDetail[^/]*\.js$/.test(u);
		})[0];
		if (!detailUrl) return null;

		var txt = await (await fetch(detailUrl)).text();
		var m = txt.match(/\.\/(NetworkChart\.[\w-]+\.js)/);
		return m ? new URL(m[1], detailUrl).href : null;
	}

	async function loadModules() {
		if (mods) return mods;

		var netUrl = await findNetworkChunk();
		if (!netUrl) throw new Error("找不到 NetworkChart chunk");

		var urls = scriptUrls();
		if (urls.indexOf(netUrl) === -1) urls.push(netUrl);

		var found = { NetworkChart: null };
		for (var i = 0; i < urls.length; i++) {
			var m;
			try {
				m = await import(urls[i]);
			} catch (e) {
				continue;
			}
			var keys = Object.keys(m);
			for (var j = 0; j < keys.length; j++) {
				var k = keys[j];
				var raw = m[k];
				var v = unwrap(raw);

				if (!found.React && isReact(v)) found.React = v;
				if (!found.createRoot && v && typeof v.createRoot === "function")
					found.createRoot = v.createRoot;
				if (!found.QueryClient && isQueryClient(v)) found.QueryClient = v;
				if (!found.Provider && isProvider(raw)) found.Provider = raw;
				if (!found.NetworkChart && typeof raw === "function" && k === "NetworkChart")
					found.NetworkChart = raw;
			}
			if (
				found.React &&
				found.createRoot &&
				found.QueryClient &&
				found.Provider &&
				found.NetworkChart
			)
				break;
		}

		var missing = ["React", "createRoot", "QueryClient", "Provider", "NetworkChart"].filter(
			function (k) {
				return !found[k];
			},
		);
		if (missing.length) throw new Error("缺少模块: " + missing.join(","));

		mods = found;
		return mods;
	}

	// ---------- 页面操作 ----------

	function tabButtons() {
		var bar = document.querySelector(SEL_TABS);
		if (!bar) return [];
		var wrap = bar.firstElementChild;
		if (!wrap) return [];
		return Array.prototype.filter.call(wrap.children, function (el) {
			return el.tagName === "DIV" && el.querySelector("p");
		});
	}

	function isActive(btn) {
		return btn.className.indexOf("text-stone-400") === -1;
	}

	function unmount() {
		if (root) {
			try {
				root.unmount();
			} catch (e) {}
			root = null;
		}
		if (client) {
			try {
				client.clear();
			} catch (e) {}
			client = null;
		}
		var host = document.getElementById(HOST_ID);
		if (host) host.remove();
		mountedPath = null;
		peakDone = false; // 重新挂载（切回详情/换服务器）后再自动开一次
	}

	// ---------- 自动开启「削峰」 ----------

	var peakTimer = null;
	var peakDone = false;
	function ensurePeak(attempt) {
		attempt = attempt || 0;
		if (peakTimer) clearTimeout(peakTimer);
		peakTimer = setTimeout(function () {
			peakTimer = null;
			var sw = document.querySelector("#" + HOST_ID + " #Peak");
			if (!sw) {
				if (attempt < 20) ensurePeak(attempt + 1);
				return;
			}
			if (sw.getAttribute("data-state") !== "checked") {
				sw.click();
			}
			peakDone = true; // 只自动开一次，之后尊重用户手动关闭
		}, attempt === 0 ? 400 : 250);
	}

	async function mount(rootEl) {
		if (loading) return;
		loading = true;
		try {
			var m = await loadModules();
			var serverId = (location.pathname.match(/\/server\/(\d+)/) || [])[1];
			if (!serverId) return;
			if (document.getElementById(HOST_ID)) return;

			var host = document.createElement("div");
			host.id = HOST_ID;
			host.className = "w-full";
			// 网络图工具栏自带 -mt-3/-mt-5 的负上边距，会压到上面的详情卡片上，这里抵消掉
			host.style.marginTop = "1rem";
			rootEl.appendChild(host);

			if (!document.getElementById(HOST_ID + "-style")) {
				var fix = document.createElement("style");
				fix.id = HOST_ID + "-style";
				// 抵消网络图工具栏的负上边距，避免和上面的详情卡片重叠
				fix.textContent =
					"#" + HOST_ID + " > div > div:first-child{margin-top:0 !important;}";
				document.head.appendChild(fix);
			}

			client = new m.QueryClient({
				defaultOptions: { queries: { retry: false } },
			});
			var h = m.React.createElement;
			root = m.createRoot(host);
			root.render(
				h(
					m.Provider,
					{ client: client },
					h(m.NetworkChart, { server_id: Number(serverId), show: true }),
				),
			);
			mountedPath = location.pathname;
			if (!peakDone) ensurePeak();
		} catch (e) {
			console.warn("[netstatus-merge]", e);
		} finally {
			loading = false;
		}
	}

	// ---------- 自动开启「削峰」 ----------

	var peakTimer = null;
	var peakDone = false;
	function ensurePeak(attempt) {
		attempt = attempt || 0;
		if (peakTimer) clearTimeout(peakTimer);
		peakTimer = setTimeout(function () {
			peakTimer = null;
			var sw = document.querySelector("#" + HOST_ID + " #Peak");
			if (!sw) {
				if (attempt < 20) ensurePeak(attempt + 1);
				return;
			}
			if (sw.getAttribute("data-state") !== "checked") {
				sw.click();
			}
			peakDone = true; // 只自动开一次，之后尊重用户手动关闭
		}, attempt === 0 ? 400 : 250);
	}

	function apply() {
		var rootEl = document.querySelector(SEL_ROOT);
		if (!rootEl) {
			unmount();
			return;
		}

		var btns = tabButtons();
		if (btns.length < 3) return;

		var detailBtn = btns[0];
		var netBtn = btns[1];

		// 若当前停在「网络」tab（旧链接/手动点过），先切回详情
		if (isActive(netBtn)) {
			netBtn.style.display = "";
			detailBtn.click();
			return;
		}

		if (netBtn.style.display !== "none") netBtn.style.display = "none"; // 合并：隐藏「网络」tab

		if (!isActive(detailBtn)) {
			// 在「在线」tab：不显示网络图
			unmount();
			return;
		}

		if (mountedPath && mountedPath !== location.pathname) unmount();
		if (!document.getElementById(HOST_ID)) mount(rootEl);
		else {
			// React 重新渲染时可能把自己的节点插到我们后面，这里保持网络图在最后
			var host = document.getElementById(HOST_ID);
			if (host && rootEl.lastElementChild !== host) rootEl.appendChild(host);
		}
	}

	var timer = null;
	function schedule() {
		if (timer) return;
		timer = setTimeout(function () {
			timer = null;
			apply();
		}, 120);
	}

	function boot() {
		if (!document.querySelector(SEL_ROOT)) {
			setTimeout(boot, 300);
			return;
		}
		apply();
		new MutationObserver(schedule).observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["style", "class"],
		});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot);
	} else {
		boot();
	}
})();
