/**
 * 获取静态资源
 * @param {string} entry 静态资源地址
 * @returns
 */
function fetchSource(entry) {
    return fetch(entry).then(res => {
        return res.text();
    });
}

/**
 * 访问微应用资源
 * @param app 微应用实例对象
 */
function loadHtml(app) {
    fetchSource(app.entry)
        .then(html => {
        html = html
            .replace(/<head[^>]*>[\s\S]*?<\/head>/i, match => {
            // 将head标签替换为micro-app-head，因为web页面只允许有一个head标签
            return match.replace(/<head/i, "<microweb-head").replace(/<\/head>/i, "</microweb-head>");
        })
            .replace(/<body[^>]*>[\s\S]*?<\/body>/i, match => {
            // 将body标签替换为micro-app-body，防止与基座应用的body标签重复导致的问题。
            return match.replace(/<body/i, "<microweb-body").replace(/<\/body>/i, "</microweb-body>");
        });
        // 将html字符串转化为DOM结构
        const htmlDom = document.createElement("div");
        htmlDom.innerHTML = html;
        // 进一步提取和处理js、css等静态资源
        extractSourceDom(htmlDom, app);
        //获取micro-app-head元素
        const microWebHead = htmlDom.querySelector("microweb-head");
        // 如果有远程css资源，则通过fetch请求
        if (app.source.links.size) {
            fetchLinksFromHtml(app, microWebHead, htmlDom);
        }
        else {
            app.onLoad(htmlDom);
        }
        //如果有远程js资源，则通过fetch请求
        if (app.source.scripts.size) {
            fetchScriptsFromHtml(app, htmlDom);
        }
        else {
            app.onLoad(htmlDom);
        }
    })
        .catch(e => {
        console.error("加载html出错", e);
    });
}
/**
 * 递归处理每一个子元素
 * @param { Element } parent 父元素
 * @param { MicroApp } app 应用实例
 */
function extractSourceDom(parent, app) {
    const children = Array.from(parent.children); //Element.children是类数组对象，没有数组特有的方法
    //递归每一个子元素
    children.length &&
        children.forEach(child => {
            extractSourceDom(child, app);
        });
    for (const dom of children) {
        if (dom instanceof HTMLLinkElement) {
            //提取css地址
            const href = dom.getAttribute("href");
            if (dom.getAttribute("rel") === "stylesheet" && href) {
                //记入source缓存中
                app.source.links.set(href, {
                    code: "", //代码内容
                });
            }
            //删除原有元素
            parent.removeChild(dom);
        }
        else if (dom instanceof HTMLScriptElement) {
            const src = dom.getAttribute("src");
            if (src) {
                //远程script
                app.source.scripts.set(src, {
                    code: "",
                    isExternal: true, //是否远程script
                });
            }
            else if (dom.textContent) {
                //内联script
                const nonceStr = Math.random().toString(36).slice(2, 16); //生成包含(0-9a-z)随机字符串
                app.source.scripts.set(nonceStr, {
                    code: dom.textContent,
                    isExternal: false, //是否远程script
                });
            }
            parent.removeChild(dom);
        }
        else ;
    }
}
/**
 * 获取link远程资源
 * @param app 微应用实例
 * @param microWebHead microweb-head
 * @param htmlDom 微应用
 */
function fetchLinksFromHtml(app, microWebHead, htmlDom) {
    const linkEntries = Array.from(app.source.links.entries());
    //通过fetch请求所有css资源
    const fetchLinkPromise = [];
    for (const [url] of linkEntries) {
        fetchLinkPromise.push(fetchSource(url));
    }
    Promise.all(fetchLinkPromise)
        .then(res => {
        for (let i = 0, len = res.length; i < len; i++) {
            const code = res[i];
            //拿到css资源后放入style元素并插入到microweb-head中
            const linkSheetStyle = document.createElement("style");
            linkSheetStyle.textContent = code;
            microWebHead === null || microWebHead === void 0 ? void 0 : microWebHead.appendChild(linkSheetStyle);
            //将代码放入缓存，再次渲染时可以从缓存中获取
            linkEntries[i][1].code = code;
        }
        //处理完成后执行onLoad方法
        app.onLoad(htmlDom);
    })
        .catch(e => {
        console.error("加载css出错", e);
    });
}
/**
 * 获取js远程资源
 * @param app 微应用实例
 * @param htmlDom 微应用dom结构
 */
function fetchScriptsFromHtml(app, htmlDom) {
    const scriptEntries = Array.from(app.source.scripts.entries());
    //通过fetch请求所有js资源
    const fetchScriptPromise = [];
    for (const [url, info] of scriptEntries) {
        //如果是内联script，则不需要请求资源
        fetchScriptPromise.push(info.isExternal ? fetchSource(url) : Promise.resolve(info.code));
    }
    Promise.all(fetchScriptPromise)
        .then(res => {
        for (let i = 0; i < res.length; i++) {
            const code = res[i];
            //将代码放入缓存，再次渲染时可以从缓存中获取
            scriptEntries[i][1].code = code;
        }
        app.onLoad(htmlDom);
    })
        .catch(e => {
        console.error("加载js出错", e);
    });
}

var AppStatus;
(function (AppStatus) {
    AppStatus["CREATED"] = "CREATED";
    AppStatus["MOUNTED"] = "MOUNTED";
    AppStatus["UNMOUNT"] = "UNMOUNT";
    AppStatus["LOADING"] = "LOADING";
})(AppStatus || (AppStatus = {}));
//created/loading/mount/unmount

class CreateApp {
    constructor({ name, entry, container }) {
        this.loadCount = 0;
        this.status = AppStatus.CREATED; // 组件状态，包括created/loading/mounted/unmount
        this.source = {
            links: new Map(),
            scripts: new Map(),
            html: null,
        };
        this.name = name; // 应用名称
        this.entry = entry; // 应用地址
        this.container = container; //应用容器
        this.status = AppStatus.LOADING;
        loadHtml(this);
    }
    /**
     * 资源加载完时执行
     */
    onLoad(htmlDom) {
        this.loadCount = this.loadCount ? this.loadCount + 1 : 1;
        //第二次执行且组件未卸载时执行渲染
        if (this.loadCount === 2 && this.status !== AppStatus.UNMOUNT) {
            //记录DOM结构用于后续操作
            this.source.html = htmlDom;
            this.mount();
        }
    }
    /**
     * 资源加载完成后进行渲染
     */
    mount() {
        var _a;
        //克隆DOM节点
        const cloneHtml = (_a = this.source.html) === null || _a === void 0 ? void 0 : _a.cloneNode(true); //非空断言运算符，从值域中排除null、undefined
        //创建一个fragment节点作为模板，这样不会产生冗余的元素
        const fragment = document.createDocumentFragment();
        Array.from(cloneHtml.childNodes).forEach(node => {
            fragment.appendChild(node);
        });
        //将格式化后的DOM结构插入到容器中
        this.container.appendChild(fragment);
        //执行js
        this.source.scripts.forEach(info => {
            try {
                (0, eval)(info.code);
            }
            catch (error) {
                console.error("微应用执行js代码错误!", error);
            }
        });
        //标记应用为已渲染
        this.status = AppStatus.MOUNTED;
    }
    /**
     * 卸载应用
     * @param destory 是否完全销毁，删除缓存资源
     */
    unmount(destory) {
        //更新状态
        this.status = AppStatus.UNMOUNT;
        //清空容器
        this.container = null;
        //destory为true，则删除应用
        if (destory) {
            appInstanceMap.delete(this.name);
        }
    }
}
const appInstanceMap = new Map();

class MicroElement extends HTMLElement {
    static get observedAttributes() {
        return ["name", "entry"];
    }
    constructor() {
        super();
        this.appName = "";
        this.appEntry = "";
    }
    /**
     * 自定义元素被插入到DOM时执行，此时去加载子应用的静态资源并渲染
     */
    connectedCallback() {
        console.log("micro-app is connected");
        //创建微应用实例
        const app = new CreateApp({ name: this.appName, entry: this.appEntry, container: this });
        //记入缓存，用于后续功能
        appInstanceMap.set(this.appName, app);
    }
    /**
     * 自定义元素从DOM中删除时执行，此时进行一些卸载操作
     */
    disconnectedCallback() {
        console.log("micro-app has disconnected");
        //获取应用实例
        const app = appInstanceMap.get(this.appName);
        //如果有属性destory，则完全卸载应用包括缓存的文件
        app.unmount(this.hasAttribute("destory"));
    }
    /**
     * 元素属性发生变化时执行，可以获取name，entry等属性的值
     * @param attr
     * @param oldVal
     * @param newVal
     */
    attributeChangedCallback(attr, oldVal, newVal) {
        console.log(`attribute ${attr}: ${newVal}`);
        if (attr === "name" && !this.appName && newVal) {
            this.appName = newVal;
        }
        else if (attr === "entry" && !this.appEntry && newVal) {
            this.appEntry = newVal;
        }
    }
}
function defineElement() {
    //如果已经定义过，则忽略
    if (!window.customElements.get("micro-web")) {
        /**
         * 注册元素
         * 注册后，就可以像普通元素一样使用micro-web，当micro-web元素被插入或删除DOM时即可触发相应的生命周期函数。
         */
        window.customElements.define("micro-web", MicroElement);
    }
}

const MicroWeb = {
    start() {
        defineElement();
    },
};

export { MicroWeb as default };
//# sourceMappingURL=microweb.js.map
