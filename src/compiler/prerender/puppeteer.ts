import * as d from '../../declarations';
import * as puppeteer from 'puppeteer'; // for types only
import { catchError } from '../util';
import { interceptRequests } from './prerender-requests';
import { startPageAnalysis, stopPageAnalysis } from './page-analysis';
import { parseHtmlToDocument } from '@stencil/core/mock-doc';


export async function prerenderPath(input: d.PrerenderInput, pageAnalysis: d.PageAnalysis) {
  let doc: HTMLDocument = null;
  let page: puppeteer.Page = null;
  let browser: puppeteer.Browser = null;

  try {
    const ptr = require('puppeteer');

    const connectOpts: puppeteer.ConnectOptions = {
      browserWSEndpoint: input.browserWsEndpoint,
      ignoreHTTPSErrors: true
    };

    browser = await ptr.connect(connectOpts);

    // start up a new page
    page = await browser.newPage();

    await createAppLoadListener(page);

    addPageListeners(page, pageAnalysis);

    await interceptRequests(input, pageAnalysis, page);

    if (input.pageAnalysisDir) {
      await startPageAnalysis(page);
    }

    await page.goto(input.url, {
      waitUntil: 'load',
      timeout: 10000
    });

    const isStencilApp = await page.evaluate(() => {
      // prerendered index.html manually adds window.stencilApp
      // so we know to wait on the app to load or not
      return !!((window as StencilWindow).stencilApp);
    });

    if (isStencilApp) {
      await page.waitForFunction('window.stencilAppLoadDuration');
    }

    if (input.pageAnalysisDir) {
      await stopPageAnalysis(input, pageAnalysis, page);
    }

    doc = await prerenderToDocument(input, page, pageAnalysis);

  } catch (e) {
    catchError(pageAnalysis.diagnostics, e);

  } finally {
    if (page) {
      await page.close();
      page = null;
    }
    if (browser) {
      await browser.disconnect();
      browser = null;
    }
  }

  return doc;
}


async function prerenderToDocument(input: d.PrerenderInput, page: puppeteer.Page, pageAnalysis: d.PageAnalysis) {
  const pageUpdateConfig: PageUpdateConfig = {
    pathQuery: input.pathQuery,
    pathHash: input.pathHash
  };

  const pageData: PageData = await page.evaluate((pageUpdateConfig: PageUpdateConfig) => {
    // BROWSER CONTEXT

    const locationUrl = new URL(location.href);

    // data object to build up and pass back from the browser to main
    const pageData: PageData = {
      html: '',
      path: locationUrl.pathname,
      stencilAppLoadDuration: (window as StencilWindow).stencilAppLoadDuration
    };

    if (pageUpdateConfig.pathQuery || pageUpdateConfig.pathHash) {
      pageData.pathname = locationUrl.pathname;

      if (pageUpdateConfig.pathQuery) {
        pageData.path += locationUrl.search;
        pageData.search = locationUrl.search;
      }

      if (pageUpdateConfig.pathHash) {
        pageData.path += locationUrl.hash;
        pageData.hash = locationUrl.hash;
      }
    }

    function setElementResolvedPath(elm: Node, href: string) {
      if (href) {
        const url = new URL(href);

        if (url.host === locationUrl.host) {
          let path = url.pathname;
          if (pageUpdateConfig.pathQuery) {
            path += url.search;
          }
          if (pageUpdateConfig.pathHash) {
            path += url.hash;
          }
          (elm as HTMLScriptElement).setAttribute('data-resolved-path', path);
        }
      }
    }

    function setResolvedPaths(elm: Element) {
      if (elm.nodeType === 1) {
        // element
        const tagName = elm.tagName.toLowerCase();

        if (tagName === 'a') {
          setElementResolvedPath(elm, (elm as HTMLAnchorElement).href);

        } else if (tagName === 'script') {
          setElementResolvedPath(elm, (elm as HTMLScriptElement).src);

        } else if (tagName === 'link' && (elm as HTMLLinkElement).rel.toLowerCase() === 'stylesheet') {
          setElementResolvedPath(elm, (elm as HTMLLinkElement).href);
        }
      }

      if (elm.shadowRoot && elm.shadowRoot.nodeType === 11) {
        setResolvedPaths(elm.shadowRoot as any);
      }

      for (let i = 0, l = elm.children.length; i < l; i++) {
        setResolvedPaths(elm.children[i]);
      }
    }

    if (document.documentElement) {
      setResolvedPaths(document.documentElement);
      pageData.html += document.documentElement.outerHTML;
    }

    return pageData;

  }, pageUpdateConfig);

  pageAnalysis.path = pageData.path;
  pageAnalysis.pathname = pageData.pathname;
  pageAnalysis.search = pageData.search;
  pageAnalysis.hash = pageData.hash;

  if (pageAnalysis.metrics) {
    pageAnalysis.metrics.appLoadDuration = pageData.stencilAppLoadDuration;
  }

  return parseHtmlToDocument(pageData.html) as HTMLDocument;
}


function addPageListeners(page: puppeteer.Page, pageAnalysis: d.PageAnalysis) {
  page.on('pageerror', (err: any) => {
    if (err) {
      if (typeof err === 'string') {
        pageAnalysis.pageErrors.push({
          message: err
        });

      } else if (err.message) {
        pageAnalysis.pageErrors.push({
          message: err.message,
          stack: err.stack
        });
      }
    }
  });

  page.on('error', err => {
    catchError(pageAnalysis.diagnostics, err);
  });
}


async function createAppLoadListener(page: puppeteer.Page) {
  // when the page creates, let's add a listener to the window
  // the "appload" event is fired by stencil when it has completed
  await page.evaluateOnNewDocument(() => {
    (window as StencilWindow).stencilWindowInit = Date.now();

    window.addEventListener('appload', () => {
      (window as StencilWindow).stencilAppLoadDuration = (Date.now() - (window as StencilWindow).stencilWindowInit);
    });
  });
}


export async function startPuppeteerBrowser(config: d.Config) {
  const ptr = config.sys.lazyRequire.require('puppeteer');

  const launchOpts: puppeteer.LaunchOptions = {
    ignoreHTTPSErrors: true,
    headless: true
  };

  const browser = await ptr.launch(launchOpts) as puppeteer.Browser;
  return browser;
}


export async function closePuppeteerBrowser(browser: puppeteer.Browser) {
  if (browser) {
    try {
      await browser.close();
    } catch (e) {}
  }
}


export async function ensurePuppeteer(config: d.Config) {
  await config.sys.lazyRequire.ensure(config.logger, config.rootDir, ['puppeteer']);
}


interface PageUpdateConfig {
  pathQuery: boolean;
  pathHash: boolean;
}


interface StencilWindow {
  stencilApp?: boolean;
  stencilAppLoadDuration?: number;
  stencilWindowInit?: number;
}


interface PageData {
  html: string;
  stencilAppLoadDuration: number;
  path: string;
  pathname?: string;
  search?: string;
  hash?: string;
}
