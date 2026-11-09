/*! Category artwork adapted directly from RoUtility src/settings/settings.js::CAT_SVG.
 * Copyright (c) 2026 RoUtility. MIT.
 * Pinned commit: 403c75ed81f297e82ada6fccf084ae3fc2249def.
 * W8RLD: static DOM construction, decorative semantics, compact sizing and
 * --rt-cat-cut renamed to --w8rld-icon-cut. Original geometry is unchanged.
 * No logos, native marks, third-party images, external resources or HTML parsing.
 * Full license: ../THIRD_PARTY_NOTICES.txt. */
type Shape = {tag: 'path' | 'rect' | 'circle' | 'g'; attrs: Record<string, string>; children: Shape[]};
const CATEGORY_ICONS: Record<string, Shape[]> = {
  "General": [
    {"tag":"path","attrs":{"d":"M12 3.4 3 10.6c-.6.5-.2 1.4.5 1.4H5v7.2c0 .7.5 1.2 1.2 1.2h11.6c.7 0 1.2-.5 1.2-1.2V12h1.5c.7 0 1.1-.9.5-1.4z","fill":"currentColor"},"children":[]},
    {"tag":"rect","attrs":{"x":"10","y":"14","width":"4","height":"6.4","rx":"1","fill":"var(--w8rld-icon-cut)"},"children":[]},
  ],
  "Trading": [
    {"tag":"path","attrs":{"d":"M4 8.5h13.5M14 4.6l3.9 3.9L14 12.4","fill":"none","stroke":"currentColor","stroke-width":"2.8","stroke-linecap":"round","stroke-linejoin":"round"},"children":[]},
    {"tag":"path","attrs":{"d":"M20 15.5H6.5M10 11.6l-3.9 3.9 3.9 3.9","fill":"none","stroke":"currentColor","stroke-width":"2.8","stroke-linecap":"round","stroke-linejoin":"round","opacity":"0.7"},"children":[]},
  ],
  "Limited Items": [
    {"tag":"path","attrs":{"d":"M7.4 5.2c0-.8.6-1.4 1.4-1.4h6.4c.8 0 1.4.6 1.4 1.4v9.8H7.4z","fill":"currentColor"},"children":[]},
    {"tag":"rect","attrs":{"x":"7.4","y":"12","width":"9.2","height":"2.6","fill":"var(--w8rld-icon-cut)"},"children":[]},
    {"tag":"path","attrs":{"d":"M2.6 16.4c0-.8.7-1.4 1.6-1.4h15.6c.9 0 1.6.6 1.6 1.4 0 2-3.6 3.6-9.4 3.6S2.6 18.4 2.6 16.4z","fill":"currentColor"},"children":[]},
  ],
  "Marketplace": [
    {"tag":"rect","attrs":{"x":"3.5","y":"6.2","width":"17","height":"4","rx":"2","fill":"currentColor","opacity":"0.55"},"children":[]},
    {"tag":"circle","attrs":{"cx":"15.5","cy":"8.2","r":"3.3","fill":"currentColor"},"children":[]},
    {"tag":"rect","attrs":{"x":"3.5","y":"13.8","width":"17","height":"4","rx":"2","fill":"currentColor","opacity":"0.55"},"children":[]},
    {"tag":"circle","attrs":{"cx":"8.5","cy":"15.8","r":"3.3","fill":"currentColor"},"children":[]},
  ],
  "Inventory": [
    {"tag":"path","attrs":{"d":"M9 6.8V5.2c0-1 .8-1.8 1.8-1.8h2.4c1 0 1.8.8 1.8 1.8v1.6","fill":"none","stroke":"currentColor","stroke-width":"1.8"},"children":[]},
    {"tag":"path","attrs":{"fill-rule":"evenodd","d":"M7 6.8h10a3.4 3.4 0 0 1 3.4 3.4v8.4c0 1.3-1.1 2.4-2.4 2.4H6c-1.3 0-2.4-1.1-2.4-2.4v-8.4A3.4 3.4 0 0 1 7 6.8zm2 6.2v1.8h6V13z","fill":"currentColor"},"children":[]},
  ],
  "Profiles": [
    {"tag":"circle","attrs":{"cx":"12","cy":"8.2","r":"4.3","fill":"currentColor"},"children":[]},
    {"tag":"path","attrs":{"d":"M4 20.2c0-4.2 3.6-6.8 8-6.8s8 2.6 8 6.8z","fill":"currentColor"},"children":[]},
  ],
  "Search": [
    {"tag":"circle","attrs":{"cx":"10.5","cy":"10.5","r":"5.6","fill":"none","stroke":"currentColor","stroke-width":"3"},"children":[]},
    {"tag":"path","attrs":{"d":"M15 15l4.6 4.6","stroke":"currentColor","stroke-width":"3.4","stroke-linecap":"round"},"children":[]},
  ],
  "Friends": [
    {"tag":"circle","attrs":{"cx":"15.6","cy":"8.4","r":"3.4","fill":"currentColor","opacity":"0.6"},"children":[]},
    {"tag":"path","attrs":{"d":"M12.6 19.8c.4-3.4 1.6-5.6 4.4-5.6 2.6 0 4.6 2 4.6 5.6z","fill":"currentColor","opacity":"0.6"},"children":[]},
    {"tag":"circle","attrs":{"cx":"8.8","cy":"8","r":"3.9","fill":"currentColor"},"children":[]},
    {"tag":"path","attrs":{"d":"M2.4 20.2c0-3.9 2.9-6.2 6.4-6.2s6.4 2.3 6.4 6.2z","fill":"currentColor"},"children":[]},
  ],
  "Communities": [
    {"tag":"circle","attrs":{"cx":"5.6","cy":"9.4","r":"2.6","fill":"currentColor","opacity":"0.6"},"children":[]},
    {"tag":"circle","attrs":{"cx":"18.4","cy":"9.4","r":"2.6","fill":"currentColor","opacity":"0.6"},"children":[]},
    {"tag":"path","attrs":{"d":"M1.6 18.6c.2-2.8 1.7-4.4 4-4.4 1.4 0 2.4.5 3 1.4M22.4 18.6c-.2-2.8-1.7-4.4-4-4.4-1.4 0-2.4.5-3 1.4","fill":"currentColor","opacity":"0.6"},"children":[]},
    {"tag":"circle","attrs":{"cx":"12","cy":"8","r":"3.6","fill":"currentColor"},"children":[]},
    {"tag":"path","attrs":{"d":"M5.8 20.2c0-3.8 2.7-6.2 6.2-6.2s6.2 2.4 6.2 6.2z","fill":"currentColor"},"children":[]},
  ],
  "Experiences": [
    {"tag":"path","attrs":{"d":"M7.6 6.6h8.8c2.6 0 4.1 1.6 4.6 4l.9 5.1c.5 2.6-2.3 4-4 2l-1.8-2H7.9l-1.8 2c-1.7 2-4.5.6-4-2l.9-5.1c.5-2.4 2-4 4.6-4z","fill":"currentColor"},"children":[]},
    {"tag":"path","attrs":{"d":"M7.8 9.4v4.2M5.7 11.5h4.2","stroke":"var(--w8rld-icon-cut)","stroke-width":"1.8","stroke-linecap":"round"},"children":[]},
    {"tag":"circle","attrs":{"cx":"16","cy":"10.3","r":"1.2","fill":"var(--w8rld-icon-cut)"},"children":[]},
    {"tag":"circle","attrs":{"cx":"18","cy":"12.5","r":"1.2","fill":"var(--w8rld-icon-cut)"},"children":[]},
  ],
  "Notifications": [
    {"tag":"path","attrs":{"d":"M12 3.2c-3.6 0-6 2.7-6 6.2v3.6L4.4 16c-.4.8.1 1.6 1 1.6h13.2c.9 0 1.4-.8 1-1.6L18 13V9.4c0-3.5-2.4-6.2-6-6.2z","fill":"currentColor"},"children":[]},
    {"tag":"path","attrs":{"d":"M9.4 19.2a2.7 2.7 0 0 0 5.2 0z","fill":"currentColor"},"children":[]},
  ],
  "Privacy": [
    {"tag":"path","attrs":{"d":"M12 5.2c-5 0-8.6 4.2-9.8 6-.3.5-.3 1.1 0 1.6 1.2 1.8 4.8 6 9.8 6s8.6-4.2 9.8-6c.3-.5.3-1.1 0-1.6-1.2-1.8-4.8-6-9.8-6z","fill":"currentColor"},"children":[]},
    {"tag":"circle","attrs":{"cx":"12","cy":"12","r":"3.6","fill":"var(--w8rld-icon-cut)"},"children":[]},
    {"tag":"path","attrs":{"d":"M4 20.4 20.4 4","stroke":"var(--w8rld-icon-cut)","stroke-width":"4.4","stroke-linecap":"round"},"children":[]},
    {"tag":"path","attrs":{"d":"M4 20.4 20.4 4","stroke":"currentColor","stroke-width":"2.2","stroke-linecap":"round"},"children":[]},
  ],
  "Appearance": [
    {"tag":"path","attrs":{"d":"M12 2.8c-5.2 0-9.4 3.9-9.4 8.9 0 4.6 3.7 8.7 8.2 8.7 1.2 0 2-.8 2-1.9 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.9-1.8h2.2c2.9 0 5.3-2.3 5.3-5.2 0-3.9-4-6.1-9.2-6.1z","fill":"currentColor"},"children":[]},
    {"tag":"circle","attrs":{"cx":"7.4","cy":"11.2","r":"1.5","fill":"var(--w8rld-icon-cut)"},"children":[]},
    {"tag":"circle","attrs":{"cx":"10.2","cy":"7.2","r":"1.5","fill":"var(--w8rld-icon-cut)"},"children":[]},
    {"tag":"circle","attrs":{"cx":"14.8","cy":"7.2","r":"1.5","fill":"var(--w8rld-icon-cut)"},"children":[]},
    {"tag":"circle","attrs":{"cx":"17.6","cy":"11","r":"1.5","fill":"var(--w8rld-icon-cut)"},"children":[]},
  ],
  "Financial Tools": [
    {"tag":"rect","attrs":{"x":"4.6","y":"2.6","width":"14.8","height":"18.8","rx":"3","fill":"currentColor"},"children":[]},
    {"tag":"rect","attrs":{"x":"7.2","y":"5.2","width":"9.6","height":"3.8","rx":"1","fill":"var(--w8rld-icon-cut)"},"children":[]},
    {"tag":"g","attrs":{"fill":"var(--w8rld-icon-cut)"},"children":[{"tag":"circle","attrs":{"cx":"8.4","cy":"12.4","r":"1.25"},"children":[]},{"tag":"circle","attrs":{"cx":"12","cy":"12.4","r":"1.25"},"children":[]},{"tag":"circle","attrs":{"cx":"15.6","cy":"12.4","r":"1.25"},"children":[]},{"tag":"circle","attrs":{"cx":"8.4","cy":"16.4","r":"1.25"},"children":[]},{"tag":"circle","attrs":{"cx":"12","cy":"16.4","r":"1.25"},"children":[]},{"tag":"circle","attrs":{"cx":"15.6","cy":"16.4","r":"1.25"},"children":[]}]},
  ],
  "Advanced": [
    {"tag":"rect","attrs":{"x":"3","y":"4","width":"18","height":"16","rx":"3.2","fill":"currentColor"},"children":[]},
    {"tag":"rect","attrs":{"x":"10","y":"7","width":"8","height":"2.2","rx":"1.1","fill":"var(--w8rld-icon-cut)"},"children":[]},
    {"tag":"rect","attrs":{"x":"10","y":"11","width":"8","height":"2.2","rx":"1.1","fill":"var(--w8rld-icon-cut)"},"children":[]},
    {"tag":"rect","attrs":{"x":"10","y":"15","width":"5.5","height":"2.2","rx":"1.1","fill":"var(--w8rld-icon-cut)"},"children":[]},
    {"tag":"rect","attrs":{"x":"5.6","y":"6.6","width":"2.2","height":"10.8","rx":"1.1","fill":"var(--w8rld-icon-cut)"},"children":[]},
  ],
};

/** Decorative icon: the category's existing text supplies its accessible name. */
export function settingsCategoryIcon(category: string): SVGSVGElement | undefined {
  if (!Object.prototype.hasOwnProperty.call(CATEGORY_ICONS, category)) return;
  const ns = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(ns, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '20'); icon.setAttribute('height', '20');
  icon.setAttribute('class', 'w8rld-settings-icon');
  icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
  icon.setAttribute('data-w8rld-category-icon', category);
  const append = (parent: SVGElement, shapes: Shape[]) => {
    for (const shape of shapes) {
      const node = document.createElementNS(ns, shape.tag);
      for (const [name, value] of Object.entries(shape.attrs)) node.setAttribute(name, value);
      append(node, shape.children); parent.append(node);
    }
  };
  append(icon, CATEGORY_ICONS[category]); return icon;
}

/*! Camera artwork from RoUtility styles/routility.css::.routility-calc-icon-camera.
 * Copyright (c) 2026 RoUtility; MIT, same pinned commit/notice as category icons.
 * Geometry unchanged; static SVG nodes replace the upstream CSS data URI. */
export function proofImageIcon(): SVGSVGElement {
  const ns='http://www.w3.org/2000/svg';const icon=document.createElementNS(ns,'svg');
  for(const [key,value]of Object.entries({viewBox:'0 0 24 24',width:'16',height:'16',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false',class:'w8rld-proof-icon'}))icon.setAttribute(key,value);
  const body=document.createElementNS(ns,'path');body.setAttribute('d','M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.4-2h6.6l1.4 2h1.8A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z');
  const lens=document.createElementNS(ns,'circle');lens.setAttribute('cx','12');lens.setAttribute('cy','13');lens.setAttribute('r','3.5');icon.append(body,lens);return icon;
}

/*! Dollar geometry directly from pinned RoUtility styles/routility.css::usd-ic.
 * Material Icons "attach_money", Copyright Google LLC, Apache-2.0; the
 * upstream path/stroke are unchanged. Static SVG replaces its CSS mask.
 * Full license and modification notice: ../THIRD_PARTY_NOTICES.txt. */
export function dollarIcon(): SVGSVGElement {
  const ns='http://www.w3.org/2000/svg';const icon=document.createElementNS(ns,'svg');
  for(const [key,value] of Object.entries({viewBox:'4.4 2.4 15.2 19.2',width:'16',height:'16','aria-hidden':'true',focusable:'false',class:'w8rld-dollar-icon'}))icon.setAttribute(key,value);
  const path=document.createElementNS(ns,'path');
  path.setAttribute('d','M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z');
  path.setAttribute('fill','currentColor');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','0.9');path.setAttribute('stroke-linejoin','round');icon.append(path);return icon;
}

/** Reuse Roblox's own current sprite, as upstream similarCard does. No copied mark. */
export function nativeRobuxIcon(): HTMLSpanElement {
  const icon=document.createElement('span');icon.className='icon-robux-16x16 w8rld-robux-icon';icon.setAttribute('aria-hidden','true');return icon;
}
