import * as d from '../../declarations';
import { pathJoin } from '../util';


export function getWritePathFromUrl(config: d.Config, outputTarget: d.OutputTargetWww, pathname: string) {
  if (pathname.startsWith(outputTarget.baseUrl)) {
    pathname = pathname.substring(outputTarget.baseUrl.length);

  } else if (outputTarget.baseUrl === pathname + '/') {
    pathname = '/';
  }

  // figure out the directory where this file will be saved
  const dir = pathJoin(
    config,
    outputTarget.dir,
    pathname
  );

  // create the full path where this will be saved (normalize for windowz)
  let filePath: string;

  if (dir + '/' === outputTarget.dir + '/') {
    // this is the root of the output target directory
    // use the configured index.html
    const basename = outputTarget.indexHtml.substr(dir.length + 1);
    filePath = pathJoin(config, dir, basename);

  } else {
    filePath = pathJoin(config, dir, `index.html`);
  }

  return filePath + PRERENDERED_SUFFIX;
}

export const PRERENDERED_SUFFIX = `.prerendered`;


export function extractResolvedAnchorUrls(anchorUrls: string[], elm: Element) {
  if (elm) {

    if (elm.nodeName === 'A') {
      const resolvedAnchorUrl = elm.getAttribute('data-resolved-path');
      if (resolvedAnchorUrl) {
        if (!anchorUrls.includes(resolvedAnchorUrl)) {
          anchorUrls.push(resolvedAnchorUrl);
        }
        elm.removeAttribute('data-resolved-path');
      }
    }

    if (elm.shadowRoot) {
      const children = elm.shadowRoot.children;
      for (let i = 0; i < children.length; i++) {
        extractResolvedAnchorUrls(anchorUrls, children[i]);
      }
    }

    const children = elm.children as any;
    if (children) {
      for (let i = 0; i < children.length; i++) {
        extractResolvedAnchorUrls(anchorUrls, children[i]);
      }
    }
  }
}


export function queuePathForPrerender(config: d.Config, outputTarget: d.OutputTargetWww, queuedPaths: string[], processingPaths: Set<string>, completedPaths: Set<string>, path: string) {
  if (typeof path !== 'string') {
    return;
  }

  const parsedUrl = config.sys.url.parse(path);

  if (!outputTarget.prerenderPathHash || !outputTarget.prerenderPathQuery) {
    const hash = (parsedUrl.hash || '').split('?')[0];
    const search = (parsedUrl.search || '').split('#')[0];

    path = path.split('?')[0].split('#')[0];

    if (search) {
      path += search;
    }

    if (hash) {
      path += hash;
    }
  }

  if (queuedPaths.includes(path)) {
    return;
  }

  if (processingPaths.has(path)) {
    return;
  }

  if (completedPaths.has(path)) {
    return;
  }

  queuedPaths.push(path);
}
