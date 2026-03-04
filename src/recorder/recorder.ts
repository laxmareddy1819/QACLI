import type { RecordedAction, RecordingSession, RecordingOptions, ElementSelector } from '../types/index.js';
import type { Page, BrowserContext } from 'playwright-core';
import { SelectorGenerator } from './selectors.js';
import { OutputFormatter, analyzeProject } from './formatter.js';
import type { ProjectContext } from './formatter.js';
import { BrowserManager } from '../browser/launcher.js';
import { generateId, createLogger } from '../utils/index.js';

const logger = createLogger('recorder');

/**
 * Script injected into every page/frame to capture user interactions.
 *
 * IMPORTANT: Runs inside the browser — plain ES5, no imports, no Node APIs.
 */
const INJECTED_RECORDER_SCRIPT = `
(function() {
  if (window.__qabotRecorderActive) return;
  window.__qabotRecorderActive = true;

  var frameName = (window !== window.top) ? (window.name || '__iframe') : undefined;

  // ── helpers ──────────────────────────────────────────────────────────────

  function getOwnText(el) {
    var text = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3) text += el.childNodes[i].textContent;
    }
    return text.trim().slice(0, 100);
  }

  function getInnerText(el) {
    return (el.innerText || el.textContent || '').trim().slice(0, 100);
  }

  function getVisibleLabel(el) {
    var ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim().slice(0, 100);

    var labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      var parts = labelledBy.split(/\\s+/);
      var lt = '';
      for (var i = 0; i < parts.length; i++) {
        var le = document.getElementById(parts[i]);
        if (le) lt += (lt ? ' ' : '') + (le.innerText || le.textContent || '').trim();
      }
      if (lt) return lt.slice(0, 100);
    }

    var own = getOwnText(el);
    if (own && own.length > 0 && own.length < 80) return own;

    var inner = getInnerText(el);
    if (inner && inner.length > 0 && inner.length < 80) return inner;

    // When inner text is too long (>= 80 chars), extract a shorter meaningful excerpt
    if (inner && inner.length >= 80) {
      // Try: first heading inside the element (product titles are often in h2/h3)
      if (el.querySelector) {
        var heading = el.querySelector('h1, h2, h3, h4, h5, h6');
        if (heading) {
          var hText = (heading.innerText || heading.textContent || '').trim();
          if (hText && hText.length > 0 && hText.length < 80) return hText.slice(0, 100);
        }
        // Try: first <strong>, <b>, or <em> (emphasized text is often the key content)
        var bold = el.querySelector('strong, b, em');
        if (bold) {
          var bText = (bold.innerText || bold.textContent || '').trim();
          if (bText && bText.length > 0 && bText.length < 80) return bText.slice(0, 100);
        }
        // Try: first <span>, <p>, or <a> child with short text
        var shortChild = el.querySelector('span, p, a');
        if (shortChild) {
          var scText = (shortChild.innerText || shortChild.textContent || '').trim();
          if (scText && scText.length > 2 && scText.length < 80) return scText.slice(0, 100);
        }
      }
      // Last resort: truncate to first 60 chars (never return '' for text-containing elements)
      return inner.slice(0, 60);
    }

    var tag = el.tagName ? el.tagName.toLowerCase() : '';

    // For <img> elements: use alt text or src basename
    if (tag === 'img') {
      var imgAlt = el.getAttribute('alt');
      if (imgAlt && imgAlt.trim()) return imgAlt.trim().slice(0, 100);
      var imgSrc = el.getAttribute('src');
      if (imgSrc) {
        try {
          var baseName = imgSrc.split('/').pop().split('?')[0].split('#')[0];
          if (baseName && baseName.length > 2 && baseName.length < 60) return baseName;
        } catch(ignore) {}
      }
    }

    if (el.id) {
      try {
        var forLabel = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (forLabel) return (forLabel.innerText || forLabel.textContent || '').trim().slice(0, 100);
      } catch(e) {}
    }

    var closestLabel = el.closest ? el.closest('label') : null;
    if (closestLabel) {
      var clText = getOwnText(closestLabel) || getInnerText(closestLabel);
      if (clText) return clText;
    }

    if (el.title) return el.title.trim().slice(0, 100);

    if (tag === 'input' && (el.type === 'submit' || el.type === 'button') && el.value) return el.value;

    // Check for <img> child with alt text (product cards with images)
    var img = el.querySelector && el.querySelector('img[alt]');
    if (img && img.alt) return img.alt.trim().slice(0, 100);

    var svgTitle = el.querySelector && el.querySelector('svg title');
    if (svgTitle) return (svgTitle.textContent || '').trim().slice(0, 100);

    if (el.placeholder) return el.placeholder.trim().slice(0, 100);

    // For elements inside a link — try the link's text
    if (el.closest) {
      var parentLink = el.closest('a');
      if (parentLink && parentLink !== el) {
        var linkText = getOwnText(parentLink) || getInnerText(parentLink);
        if (linkText && linkText.length > 0 && linkText.length < 80) return linkText;
        // Try link's img alt
        var linkImg = parentLink.querySelector('img[alt]');
        if (linkImg && linkImg.alt) return linkImg.alt.trim().slice(0, 100);
      }
    }

    return '';
  }

  function getEffectiveRole(el) {
    var explicit = el.getAttribute('role');
    if (explicit) return explicit;

    var tag = el.tagName.toLowerCase();
    var type = (el.type || '').toLowerCase();

    if (tag === 'button') return 'button';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'input') {
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
      if (type === 'text' || type === 'email' || type === 'password' ||
          type === 'search' || type === 'tel' || type === 'url' ||
          type === 'number' || type === '' || !type) return 'textbox';
      if (type === 'range') return 'slider';
      if (type === 'file') return 'button';
    }
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'img') return 'img';
    if (tag === 'nav') return 'navigation';
    if (tag === 'header') return 'banner';
    if (tag === 'footer') return 'contentinfo';
    if (tag === 'main') return 'main';
    if (tag === 'aside') return 'complementary';
    if (tag === 'section' && el.getAttribute('aria-label')) return 'region';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'li') return 'listitem';
    if (tag === 'ul' || tag === 'ol') return 'list';
    if (tag === 'table') return 'table';
    if (tag === 'tr') return 'row';
    if (tag === 'td') return 'cell';
    if (tag === 'th') return 'columnheader';
    if (tag === 'form') return 'form';
    if (tag === 'dialog') return 'dialog';
    if (tag === 'details') return 'group';
    if (tag === 'summary') return 'button';
    if (tag === 'progress') return 'progressbar';
    return null;
  }

  function isInteractive(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toLowerCase();
    if (tag === 'a' || tag === 'button' || tag === 'input' || tag === 'select' ||
        tag === 'textarea' || tag === 'label' || tag === 'summary' || tag === 'option' ||
        tag === 'details') return true;
    var role = el.getAttribute('role');
    if (role && ['button','link','menuitem','menuitemcheckbox','menuitemradio',
        'tab','checkbox','radio','switch','option','combobox','slider',
        'spinbutton','searchbox','textbox','treeitem','gridcell',
        'listbox','menu'].indexOf(role) >= 0) return true;
    if (el.getAttribute('onclick') || el.getAttribute('onmousedown') || el.getAttribute('ontouchstart')) return true;
    if (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1') return true;
    if (el.getAttribute('data-testid') || el.getAttribute('data-test-id') ||
        el.getAttribute('data-cy') || el.getAttribute('data-test')) return true;
    try { if (window.getComputedStyle(el).cursor === 'pointer') return true; } catch(e) {}
    if (el.id && !/[a-z]+-[a-f0-9]{5,}/i.test(el.id) && el.id.length < 40) return true;
    return false;
  }

  function isCheckboxLike(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toLowerCase();
    if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) return true;
    var role = el.getAttribute('role');
    if (role === 'checkbox' || role === 'radio' || role === 'switch' ||
        role === 'menuitemcheckbox' || role === 'menuitemradio') return true;
    return false;
  }

  function getCheckedState(el) {
    if (!el) return null;
    var tag = el.tagName.toLowerCase();
    if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) {
      return el.checked;
    }
    var ariaChecked = el.getAttribute('aria-checked');
    if (ariaChecked === 'true') return true;
    if (ariaChecked === 'false') return false;
    var ariaSelected = el.getAttribute('aria-selected');
    if (ariaSelected === 'true') return true;
    if (ariaSelected === 'false') return false;
    // Heuristic: look for checked visual indicators in class names
    var cls = (el.className && typeof el.className === 'string') ? el.className.toLowerCase() : '';
    if (cls.indexOf('checked') >= 0 || cls.indexOf('selected') >= 0 || cls.indexOf('active') >= 0) return true;
    return null;
  }

  function buildCssPath(el) {
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== 'html') {
      var tag = cur.tagName.toLowerCase();
      if (cur.id && !/[a-z]+-[a-f0-9]{5,}/i.test(cur.id)) {
        try { parts.unshift('#' + CSS.escape(cur.id)); } catch(e) { parts.unshift('#' + cur.id); }
        break;
      }
      var nth = 1;
      var curTag = cur.tagName.toLowerCase();
      var sib = cur.previousElementSibling;
      while (sib) { if (sib.tagName.toLowerCase() === curTag) nth++; sib = sib.previousElementSibling; }
      var hasSame = false;
      var ns = cur.nextElementSibling;
      while (ns) { if (ns.tagName.toLowerCase() === curTag) { hasSame = true; break; } ns = ns.nextElementSibling; }
      parts.unshift((nth > 1 || hasSame) ? tag + ':nth-of-type(' + nth + ')' : tag);
      cur = cur.parentElement;
      if (parts.length > 5) break;
    }
    return parts.join(' > ');
  }

  function getElementInfo(el) {
    if (!el || !el.tagName) return null;
    var tag = el.tagName.toLowerCase();
    var role = getEffectiveRole(el);
    var label = getVisibleLabel(el);
    var ownText = getOwnText(el);
    var innerText = getInnerText(el);

    // Collect closestHref from nearest <a> ancestor (for non-link elements inside links)
    var closestHref = null;
    if (tag !== 'a' && el.closest) {
      var closestA = el.closest('a');
      if (closestA && closestA.href) closestHref = closestA.href;
    }

    return {
      tagName: tag,
      id: el.id || null,
      testId: el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-cy') || el.getAttribute('data-test') || null,
      className: (el.className && typeof el.className === 'string') ? el.className : null,
      ariaLabel: el.getAttribute('aria-label') || null,
      ariaRole: role || null,
      name: el.getAttribute('name') || null,
      placeholder: el.getAttribute('placeholder') || null,
      textContent: ownText || null,
      // Truncate long innerText to 60 chars instead of discarding — keeps partial text for selectors
      innerText: (innerText && innerText !== ownText)
        ? (innerText.length > 80 ? innerText.slice(0, 60) : innerText)
        : null,
      label: label || null,
      type: el.type || null,
      href: (tag === 'a' && el.href) ? el.href : null,
      title: el.title || null,
      value: (tag === 'input' && (el.type === 'submit' || el.type === 'button')) ? (el.value || null) : null,
      checked: (isCheckboxLike(el)) ? getCheckedState(el) : null,
      cssPath: buildCssPath(el),
      isDisabled: el.disabled || el.getAttribute('aria-disabled') === 'true' || false,
      // New fields for richer selector generation
      alt: (tag === 'img' && el.alt) ? el.alt.trim().slice(0, 100) : null,
      src: (tag === 'img' && el.src) ? (function() {
        try { return el.src.split('/').pop().split('?')[0].split('#')[0]; } catch(e) { return null; }
      })() : null,
      closestHref: closestHref,
    };
  }

  function findClickTarget(startEl) {
    if (!startEl || !startEl.tagName) return startEl;
    if (isInteractive(startEl)) return startEl;

    var tag = startEl.tagName.toLowerCase();

    // Special: media/icon elements — always look for parent link/button first
    // This is the #1 fix: image-inside-link is the dominant e-commerce pattern
    if (tag === 'img' || tag === 'svg' || tag === 'path' || tag === 'use' ||
        tag === 'picture' || tag === 'source' || tag === 'canvas') {
      var mediaParent = startEl.closest
        ? startEl.closest('a, button, [role="button"], [role="link"]')
        : null;
      if (mediaParent) return mediaParent;
    }

    // Walk up looking for interactive elements (extended to 10 levels)
    // Also track the best non-interactive ancestor with identifiable attributes
    var el = startEl.parentElement;
    var walked = 0;
    var bestCandidate = null;
    var bestScore = 0;

    while (el && el.tagName && el.tagName.toLowerCase() !== 'body' && walked < 10) {
      if (isInteractive(el)) return el;

      // Score non-interactive ancestors by identifier quality
      var score = 0;
      if (el.getAttribute('data-testid') || el.getAttribute('data-test-id') ||
          el.getAttribute('data-cy') || el.getAttribute('data-test')) score += 10;
      if (el.id && !/[a-z]+-[a-f0-9]{5,}/i.test(el.id) && el.id.length < 40) score += 8;
      if (el.getAttribute('aria-label')) score += 6;
      var elText = getOwnText(el);
      if (!elText) elText = getInnerText(el);
      if (elText && elText.length > 2 && elText.length < 80) score += 4;
      var cls = el.className && typeof el.className === 'string' ? el.className : '';
      if (cls && cls.length < 100 && !/[a-z]*[-_][a-f0-9]{4,}/i.test(cls)) score += 2;

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = el;
      }

      el = el.parentElement;
      walked++;
    }

    // If we found an ancestor with real identifiers, prefer it over bare leaf
    if (bestCandidate && bestScore >= 4) return bestCandidate;

    return startEl;
  }

  /**
   * Find a checkbox-like element from a click target.
   * Handles: native inputs, custom checkboxes (div[role=checkbox]),
   * labels wrapping checkboxes, containers with checkbox children.
   */
  function findCheckboxTarget(target) {
    // Direct checkbox
    if (isCheckboxLike(target)) return target;

    // Label wrapping or referencing a checkbox
    if (target.tagName.toLowerCase() === 'label') {
      var forAttr = target.getAttribute('for');
      if (forAttr) {
        var linked = document.getElementById(forAttr);
        if (linked && isCheckboxLike(linked)) return linked;
      }
      var nested = target.querySelector('input[type="checkbox"], input[type="radio"]');
      if (nested) return nested;
      var nestedRole = target.querySelector('[role="checkbox"], [role="radio"], [role="switch"]');
      if (nestedRole) return nestedRole;
    }

    // Look INSIDE the clicked element for a checkbox child
    if (target.querySelector) {
      var childCb = target.querySelector('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"], [role="switch"]');
      if (childCb) return childCb;
    }

    // Walk UP to find a checkbox-like ancestor
    var el = target;
    var walked = 0;
    while (el && el.tagName && walked < 4) {
      if (isCheckboxLike(el)) return el;
      el = el.parentElement;
      walked++;
    }

    return null;
  }

  // ── Debounce ──
  var inputTimers = {};
  var inputValues = {};

  // Track last action to suppress duplicate navigations
  var lastClickTime = 0;

  // Track last checkbox action to suppress duplicates (click handler + change handler)
  var lastCheckboxTime = 0;
  var CHECKBOX_DEDUP_MS = 200;

  // ── CLICK ───────────────────────────────────────────────────────────────

  document.addEventListener('click', function(e) {
    // Skip recording when assertion mode is active — assert script handles its own events
    if (window.__qabotAssertModeActive) return;
    lastClickTime = Date.now();
    var raw = e.target;
    var target = findClickTarget(raw);
    var tag = target.tagName.toLowerCase();
    var type = (target.type || '').toLowerCase();

    // Native checkbox/radio → skip, the change handler captures it
    if (tag === 'input' && (type === 'checkbox' || type === 'radio')) return;

    // Check if this click is actually a checkbox toggle (custom checkbox)
    var cbTarget = findCheckboxTarget(raw);
    if (cbTarget && cbTarget !== target) {
      // It's a custom checkbox interaction — record check/uncheck
      // IMPORTANT: Capture the BEFORE-click state NOW (synchronously)
      var beforeChecked = getCheckedState(cbTarget);
      if (typeof window.__qabot_recordAction === 'function') {
        // Mark that we're handling a checkbox from the click handler
        lastCheckboxTime = Date.now();
        // Use setTimeout to get the post-click DOM state
        setTimeout(function() {
          var afterChecked = getCheckedState(cbTarget);
          var actionType;
          if (afterChecked === true) {
            actionType = 'check';
          } else if (afterChecked === false) {
            actionType = 'uncheck';
          } else if (beforeChecked === true) {
            // Was checked, now unknown → toggled off
            actionType = 'uncheck';
          } else if (beforeChecked === false) {
            // Was unchecked, now unknown → toggled on
            actionType = 'check';
          } else {
            // Both unknown — assume clicking a filter is toggling ON (check)
            actionType = 'check';
          }
          lastCheckboxTime = Date.now();
          window.__qabot_recordAction(JSON.stringify({
            type: actionType,
            element: getElementInfo(cbTarget),
            frameName: frameName,
          }));
        }, 80);
      }
      return;
    }

    // Labels that wrap native checkboxes — skip (change fires)
    if (tag === 'label') {
      var insideCb = target.querySelector('input[type="checkbox"], input[type="radio"]');
      if (insideCb) return;
      var forAt = target.getAttribute('for');
      if (forAt) {
        var linkedInput = document.getElementById(forAt);
        if (linkedInput && (linkedInput.type === 'checkbox' || linkedInput.type === 'radio')) return;
      }
    }

    var info = getElementInfo(target);
    if (!info) return;

    if (typeof window.__qabot_recordAction === 'function') {
      window.__qabot_recordAction(JSON.stringify({
        type: 'click',
        element: info,
        position: { x: Math.round(e.clientX), y: Math.round(e.clientY) },
        frameName: frameName,
      }));
    }
  }, true);

  // ── DBLCLICK ────────────────────────────────────────────────────────────

  document.addEventListener('dblclick', function(e) {
    if (window.__qabotAssertModeActive) return;
    var target = findClickTarget(e.target);
    var info = getElementInfo(target);
    if (!info) return;
    if (typeof window.__qabot_recordAction === 'function') {
      window.__qabot_recordAction(JSON.stringify({
        type: 'dblclick',
        element: info,
        position: { x: Math.round(e.clientX), y: Math.round(e.clientY) },
        frameName: frameName,
      }));
    }
  }, true);

  // ── INPUT (debounced 800ms — captures FINAL value) ─────────────────────

  document.addEventListener('input', function(e) {
    if (window.__qabotAssertModeActive) return;
    var el = e.target;
    if (!el || !el.tagName) return;
    var tag = el.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea' && !el.isContentEditable) return;
    var elType = (el.type || '').toLowerCase();
    if (elType === 'checkbox' || elType === 'radio') return;

    var key = el.id || el.name || el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-cy') || ('__pos_' + Array.from(el.parentElement ? el.parentElement.children : []).indexOf(el));

    inputValues[key] = { el: el, value: el.value || el.textContent || '' };

    if (inputTimers[key]) clearTimeout(inputTimers[key]);
    inputTimers[key] = setTimeout(function() {
      var stored = inputValues[key];
      if (!stored) return;
      delete inputValues[key];
      delete inputTimers[key];
      var info = getElementInfo(stored.el);
      if (!info) return;
      if (typeof window.__qabot_recordAction === 'function') {
        window.__qabot_recordAction(JSON.stringify({
          type: 'fill',
          element: info,
          value: stored.value,
          frameName: frameName,
        }));
      }
    }, 800);
  }, true);

  // ── Helper: compute the same input tracking key used in the INPUT handler ──
  function getInputKey(el) {
    return el.id || el.name || el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-cy') || ('__pos_' + Array.from(el.parentElement ? el.parentElement.children : []).indexOf(el));
  }

  // ── KEYBOARD ────────────────────────────────────────────────────────────

  document.addEventListener('keydown', function(e) {
    if (window.__qabotAssertModeActive) return;
    var special = ['Enter', 'Escape'];
    if (special.indexOf(e.key) === -1) return;

    var tag = e.target.tagName ? e.target.tagName.toLowerCase() : '';

    // For Enter in input fields, flush pending input BEFORE recording the press
    if (e.key === 'Enter' && (tag === 'input' || tag === 'textarea')) {
      var elKey = getInputKey(e.target);
      if (inputTimers[elKey]) {
        clearTimeout(inputTimers[elKey]);
        var stored = inputValues[elKey];
        if (stored) {
          var info = getElementInfo(stored.el);
          if (info && typeof window.__qabot_recordAction === 'function') {
            window.__qabot_recordAction(JSON.stringify({
              type: 'fill',
              element: info,
              value: stored.value,
              frameName: frameName,
            }));
          }
          delete inputValues[elKey];
          delete inputTimers[elKey];
        }
      }
    }

    if (typeof window.__qabot_recordAction === 'function') {
      window.__qabot_recordAction(JSON.stringify({
        type: 'press',
        key: e.key,
        element: getElementInfo(e.target),
        frameName: frameName,
      }));
    }
  }, true);

  // ── CHANGE (select, checkbox, radio) ────────────────────────────────────

  document.addEventListener('change', function(e) {
    if (window.__qabotAssertModeActive) return;
    var el = e.target;
    if (!el || !el.tagName) return;
    var tag = el.tagName.toLowerCase();

    if (tag === 'select') {
      var info = getElementInfo(el);
      if (!info) return;
      var selectedText = (el.options && el.selectedIndex >= 0) ? el.options[el.selectedIndex].text : '';
      if (typeof window.__qabot_recordAction === 'function') {
        window.__qabot_recordAction(JSON.stringify({
          type: 'select',
          element: info,
          value: el.value,
          selectedText: selectedText,
          frameName: frameName,
        }));
      }
      return;
    }

    if (tag === 'input' && el.type === 'checkbox') {
      // Suppress if the click handler already recorded this checkbox action
      if (Date.now() - lastCheckboxTime < CHECKBOX_DEDUP_MS) return;
      var cinfo = getElementInfo(el);
      if (!cinfo) return;
      if (typeof window.__qabot_recordAction === 'function') {
        lastCheckboxTime = Date.now();
        window.__qabot_recordAction(JSON.stringify({
          type: el.checked ? 'check' : 'uncheck',
          element: cinfo,
          frameName: frameName,
        }));
      }
      return;
    }

    if (tag === 'input' && el.type === 'radio') {
      // Suppress if the click handler already recorded this
      if (Date.now() - lastCheckboxTime < CHECKBOX_DEDUP_MS) return;
      var rinfo = getElementInfo(el);
      if (!rinfo) return;
      if (typeof window.__qabot_recordAction === 'function') {
        lastCheckboxTime = Date.now();
        window.__qabot_recordAction(JSON.stringify({
          type: 'check',
          element: rinfo,
          frameName: frameName,
        }));
      }
      return;
    }
  }, true);

  // ── FOCUS/BLUR for contenteditable ──────────────────────────────────────

  document.addEventListener('focusin', function(e) {
    if (window.__qabotAssertModeActive) return;
    var el = e.target;
    if (el && el.isContentEditable) el.__qabotFocusValue = el.textContent || '';
  }, true);

  document.addEventListener('focusout', function(e) {
    if (window.__qabotAssertModeActive) return;
    var el = e.target;
    if (!el || !el.isContentEditable || el.__qabotFocusValue === undefined) return;
    var newVal = el.textContent || '';
    if (newVal !== el.__qabotFocusValue) {
      var info = getElementInfo(el);
      if (info && typeof window.__qabot_recordAction === 'function') {
        window.__qabot_recordAction(JSON.stringify({
          type: 'fill', element: info, value: newVal, frameName: frameName,
        }));
      }
    }
    delete el.__qabotFocusValue;
  }, true);
})();
`;

/**
 * Script injected to ENABLE assertion mode — crosshair cursor, hover highlight,
 * click shows assertion picker popup. All normal recording events are suppressed.
 *
 * IMPORTANT: Runs inside the browser — plain ES5, no imports, no Node APIs.
 */
const INJECTED_ASSERT_MODE_SCRIPT = `
(function() {
  if (window.__qabotAssertModeActive) return;
  window.__qabotAssertModeActive = true;

  var frameName = (window !== window.top) ? (window.name || '__iframe') : undefined;

  // ── Helpers (duplicated from recorder — runs in isolated context) ──

  function getOwnText(el) {
    var text = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3) text += el.childNodes[i].textContent;
    }
    return text.trim().slice(0, 100);
  }
  function getInnerText(el) {
    return (el.innerText || el.textContent || '').trim().slice(0, 100);
  }

  // ── Overlay + highlight element ──
  var overlay = document.createElement('div');
  overlay.id = '__qabot_assert_overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483646;pointer-events:none;';
  document.body.appendChild(overlay);

  var highlight = document.createElement('div');
  highlight.id = '__qabot_assert_highlight';
  highlight.style.cssText = 'position:fixed;border:2px solid #10b981;background:rgba(16,185,129,0.08);z-index:2147483646;pointer-events:none;display:none;border-radius:3px;transition:all 0.1s ease;';
  document.body.appendChild(highlight);

  var tooltip = document.createElement('div');
  tooltip.id = '__qabot_assert_tooltip';
  tooltip.style.cssText = 'position:fixed;z-index:2147483647;background:#1e293b;color:#e2e8f0;font:11px/1.4 -apple-system,sans-serif;padding:4px 8px;border-radius:4px;border:1px solid #10b981;pointer-events:none;display:none;white-space:nowrap;max-width:300px;overflow:hidden;text-overflow:ellipsis;';
  document.body.appendChild(tooltip);

  // ── Picker popup ──
  var picker = document.createElement('div');
  picker.id = '__qabot_assert_picker';
  picker.style.cssText = 'position:fixed;z-index:2147483647;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:6px 0;display:none;font:12px/1.5 -apple-system,sans-serif;color:#e2e8f0;box-shadow:0 8px 24px rgba(0,0,0,0.4);min-width:280px;';
  document.body.appendChild(picker);

  var currentTarget = null;
  var pickerVisible = false;

  function getElementSummary(el) {
    if (!el || !el.tagName) return '';
    var tag = el.tagName.toLowerCase();
    var text = getOwnText(el) || getInnerText(el);
    if (text && text.length > 40) text = text.slice(0, 37) + '...';
    var label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.title || '';
    if (label && label.length > 40) label = label.slice(0, 37) + '...';
    return text || label || (el.id ? '#' + el.id : tag);
  }

  function buildPickerOptions(el) {
    var options = [];
    var tag = el.tagName.toLowerCase();
    var text = (el.innerText || el.textContent || '').trim().slice(0, 60);
    var inputVal = (el.value !== undefined && el.value !== '') ? el.value : null;
    var isVisible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    var isInput = tag === 'input' || tag === 'textarea' || tag === 'select';
    var isCheckable = (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) || el.getAttribute('role') === 'checkbox' || el.getAttribute('role') === 'switch';
    var isLink = tag === 'a' && el.href;
    var hasClasses = el.className && typeof el.className === 'string' && el.className.trim().length > 0;
    var hasPlaceholder = el.getAttribute('placeholder');
    var hasHref = isLink && el.href;

    // ── Section: Element Assertions ──
    options.push({ section: 'Element' });

    // Text assertion — always show if there's text
    if (text && text.length > 0) {
      var displayText = text.length > 35 ? text.slice(0, 32) + '...' : text;
      options.push({ assertType: 'text', label: 'Verify contains "' + displayText + '"', icon: 'T', value: text });
      options.push({ assertType: 'not-text', label: 'Verify NOT contains "' + displayText + '"', icon: '\\u{2717}T', value: text });
    }

    // Visible/not-visible
    if (isVisible) {
      options.push({ assertType: 'visible', label: 'Verify is visible', icon: '\\u{1F441}', value: '' });
      options.push({ assertType: 'not-visible', label: 'Verify is NOT visible', icon: '\\u{1F648}', value: '' });
    }

    // Value assertion — for inputs
    if (isInput && inputVal !== null) {
      var displayVal = inputVal.length > 30 ? inputVal.slice(0, 27) + '...' : inputVal;
      options.push({ assertType: 'value', label: 'Verify value: "' + displayVal + '"', icon: '\\u{270F}', value: inputVal });
      options.push({ assertType: 'not-value', label: 'Verify value is NOT "' + displayVal + '"', icon: '\\u{2717}\\u{270F}', value: inputVal });
    }

    // Attribute assertion — always available
    options.push({ assertType: 'attribute', label: 'Verify attribute value...', icon: '\\u{2699}', value: '' });

    // Class assertion — only if element has classes
    if (hasClasses) {
      var firstClass = el.className.trim().split(/\\s+/)[0] || '';
      options.push({ assertType: 'class', label: 'Verify has class "' + firstClass + '"', icon: '\\u{1F3F7}', value: firstClass });
      options.push({ assertType: 'not-class', label: 'Verify NOT has class...', icon: '\\u{2717}\\u{1F3F7}', value: '' });
    }

    // Placeholder assertion
    if (hasPlaceholder) {
      var ph = hasPlaceholder.slice(0, 30);
      options.push({ assertType: 'placeholder', label: 'Verify placeholder: "' + ph + '"', icon: '\\u{1F4DD}', value: hasPlaceholder });
    }

    // Href assertion
    if (hasHref) {
      try {
        var hrefPath = new URL(el.href).pathname;
        options.push({ assertType: 'href', label: 'Verify href contains "' + hrefPath.slice(0, 30) + '"', icon: '\\u{1F517}', value: hrefPath });
      } catch(ex) {
        options.push({ assertType: 'href', label: 'Verify href contains...', icon: '\\u{1F517}', value: el.href });
      }
    }

    // ── Section: State Assertions ──
    if (isInput || isCheckable) {
      options.push({ section: 'State' });

      // Enabled/disabled + negatives
      if (isInput) {
        if (el.disabled) {
          options.push({ assertType: 'disabled', label: 'Verify is disabled', icon: '\\u{1F6AB}', value: '' });
          options.push({ assertType: 'not-enabled', label: 'Verify is NOT enabled', icon: '\\u{2717}\\u{2705}', value: '' });
        } else {
          options.push({ assertType: 'enabled', label: 'Verify is enabled', icon: '\\u{2705}', value: '' });
          options.push({ assertType: 'not-enabled', label: 'Verify is NOT enabled', icon: '\\u{2717}\\u{2705}', value: '' });
        }
      }

      // Checked/unchecked + negatives
      if (isCheckable) {
        var checked = el.checked || el.getAttribute('aria-checked') === 'true';
        if (checked) {
          options.push({ assertType: 'checked', label: 'Verify is checked', icon: '\\u{2611}', value: '' });
          options.push({ assertType: 'not-checked', label: 'Verify is NOT checked', icon: '\\u{2717}\\u{2611}', value: '' });
        } else {
          options.push({ assertType: 'unchecked', label: 'Verify is unchecked', icon: '\\u{2610}', value: '' });
          options.push({ assertType: 'not-checked', label: 'Verify is NOT checked', icon: '\\u{2717}\\u{2611}', value: '' });
        }
      }
    }

    // ── Section: Page Assertions ──
    options.push({ section: 'Page' });

    // Pre-compute URL path for display — use hostname if on root "/"
    var urlPath = '/';
    try { urlPath = new URL(window.location.href).pathname || '/'; } catch(ex) {}
    var urlVal = urlPath === '/' ? window.location.hostname : urlPath;
    var dispUrl = urlVal.length > 25 ? urlVal.slice(0, 22) + '...' : urlVal;

    // Pre-compute page title for display
    var pageTitle = document.title || '';
    var dispTitle = pageTitle.length > 25 ? pageTitle.slice(0, 22) + '...' : pageTitle;

    // URL assertion + negative
    options.push({ assertType: 'url', label: 'Verify URL contains "' + dispUrl + '"', icon: '\\u{1F310}', value: urlVal });
    options.push({ assertType: 'not-url', label: 'Verify URL NOT contains "' + dispUrl + '"', icon: '\\u{2717}\\u{1F310}', value: urlVal });

    // Title assertion + negative
    options.push({ assertType: 'title', label: 'Verify title contains "' + dispTitle + '"', icon: '\\u{1F4C4}', value: pageTitle });
    options.push({ assertType: 'not-title', label: 'Verify title NOT contains "' + dispTitle + '"', icon: '\\u{2717}\\u{1F4C4}', value: pageTitle });

    // ── Section: Count Assertions ──
    options.push({ section: 'Count' });

    options.push({ assertType: 'count', label: 'Verify element count equals', icon: '#', value: '' });
    options.push({ assertType: 'not-count', label: 'Verify count NOT equals', icon: '\\u{2717}#', value: '' });
    options.push({ assertType: 'min-count', label: 'Verify at least N elements', icon: '\\u{2265}', value: '' });

    return options;
  }

  function showPicker(el, x, y) {
    pickerVisible = true;
    currentTarget = el;
    var options = buildPickerOptions(el);

    picker.innerHTML = '<div style="padding:4px 12px 6px;font-weight:600;color:#10b981;font-size:11px;border-bottom:1px solid #334155;margin-bottom:2px;">Add Assertion</div>';

    var itemCount = 0;
    for (var i = 0; i < options.length; i++) {
      if (options[i].section) {
        // Section divider
        var divider = document.createElement('div');
        divider.style.cssText = 'padding:4px 12px 2px;font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;' + (i > 0 ? 'border-top:1px solid #334155;margin-top:4px;' : '');
        divider.textContent = options[i].section;
        picker.appendChild(divider);
        continue;
      }
      itemCount++;
      (function(opt) {
        var isNeg = opt.assertType.indexOf('not-') === 0;
        var item = document.createElement('div');
        item.style.cssText = 'padding:5px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;transition:background 0.15s;font-size:11.5px;' + (isNeg ? 'color:#f59e0b;' : '');
        item.innerHTML = '<span style="width:20px;text-align:center;font-size:12px;flex-shrink:0;">' + opt.icon + '</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + opt.label + '</span>';
        item.addEventListener('mouseenter', function() { item.style.background = '#334155'; });
        item.addEventListener('mouseleave', function() { item.style.background = 'transparent'; });
        item.addEventListener('click', function(e) {
          e.stopPropagation();
          e.preventDefault();

          var assertValue = opt.value;
          var assertAttribute = '';

          // Count types — count matching elements
          if (opt.assertType === 'count' || opt.assertType === 'not-count' || opt.assertType === 'min-count') {
            try {
              var cssPath = el.__qabotCssPath || el.tagName.toLowerCase();
              var count = document.querySelectorAll(cssPath).length;
              assertValue = String(count);
            } catch(ex) { assertValue = '1'; }
          }

          // Helper: build element info object for assertion recording
          function buildElInfo() {
            return {
              tagName: el.tagName.toLowerCase(),
              id: el.id || null,
              testId: el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-cy') || null,
              className: (el.className && typeof el.className === 'string') ? el.className : null,
              ariaLabel: el.getAttribute('aria-label') || null,
              ariaRole: el.getAttribute('role') || null,
              name: el.getAttribute('name') || null,
              placeholder: el.getAttribute('placeholder') || null,
              textContent: getOwnText(el) || null,
              innerText: getInnerText(el) || null,
              label: el.getAttribute('aria-label') || null,
              type: el.type || null,
              href: (el.tagName.toLowerCase() === 'a' && el.href) ? el.href : null,
              title: el.title || null,
              cssPath: el.__qabotCssPath || null,
            };
          }

          function sendAssertion(aType, aValue, aAttr) {
            if (typeof window.__qabot_recordAction === 'function') {
              window.__qabot_recordAction(JSON.stringify({
                type: 'assert',
                assertType: aType,
                expectedValue: aValue,
                actualValue: opt.value,
                assertAttribute: aAttr || undefined,
                element: buildElInfo(),
                frameName: frameName,
              }));
            }
            hidePicker();
          }

          // Attribute — show inline input for attribute name
          if (opt.assertType === 'attribute') {
            showPickerInput('Enter attribute name:', 'e.g. class, href, data-state, aria-label', function(attrName) {
              var attrVal = el.getAttribute(attrName) || '';
              sendAssertion('attribute', attrVal, attrName);
            });
            return; // Wait for input submission
          }

          // Not-class — show inline input for class name
          if (opt.assertType === 'not-class') {
            showPickerInput('Enter class name to verify NOT present:', 'e.g. active, hidden, disabled', function(className) {
              sendAssertion('not-class', className, '');
            });
            return; // Wait for input submission
          }

          // All other assertion types — send immediately
          sendAssertion(opt.assertType, assertValue, assertAttribute);
        });
        picker.appendChild(item);
      })(options[i]);
    }

    // Position picker — show it first off-screen to measure real height
    picker.style.left = '-9999px';
    picker.style.top = '0px';
    picker.style.display = 'block';
    picker.style.pointerEvents = 'auto';

    // Measure actual rendered height
    var maxH = window.innerHeight - 20;
    picker.style.maxHeight = maxH + 'px';
    picker.style.overflowY = 'auto';

    var pickerW = picker.offsetWidth || 280;
    var pickerH = picker.offsetHeight || 300;

    // Horizontal: keep within viewport
    var px = Math.min(x + 10, window.innerWidth - pickerW - 10);
    if (px < 5) px = 5;

    // Vertical: prefer below click, but if not enough space, show above
    var spaceBelow = window.innerHeight - y - 15;
    var spaceAbove = y - 15;
    var py;

    if (pickerH <= spaceBelow) {
      // Fits below click
      py = y + 10;
    } else if (pickerH <= spaceAbove) {
      // Fits above click
      py = y - pickerH - 5;
    } else {
      // Doesn't fit either way — clamp maxHeight and pin to top or bottom
      if (spaceBelow >= spaceAbove) {
        py = y + 10;
        picker.style.maxHeight = (spaceBelow - 5) + 'px';
      } else {
        picker.style.maxHeight = (spaceAbove - 5) + 'px';
        py = 10;
      }
    }

    if (py < 5) py = 5;
    picker.style.left = px + 'px';
    picker.style.top = py + 'px';
  }

  function hidePicker() {
    pickerVisible = false;
    picker.style.display = 'none';
    picker.style.pointerEvents = 'none';
    currentTarget = null;
  }

  /**
   * Replace picker content with an inline text input (avoids window.prompt
   * which is blocked by capture-phase event suppression).
   * @param {string} label — header text
   * @param {string} placeholder — input placeholder
   * @param {function} onSubmit — called with trimmed input value
   */
  function showPickerInput(label, placeholder, onSubmit) {
    picker.innerHTML = '';
    var hdr = document.createElement('div');
    hdr.style.cssText = 'padding:6px 12px;font-weight:600;color:#10b981;font-size:11px;border-bottom:1px solid #334155;';
    hdr.textContent = label;
    picker.appendChild(hdr);

    var row = document.createElement('div');
    row.style.cssText = 'padding:8px 12px;display:flex;gap:6px;align-items:center;';

    var inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = placeholder || '';
    inp.style.cssText = 'flex:1;background:#0f172a;border:1px solid #475569;color:#e2e8f0;padding:5px 8px;border-radius:4px;font-size:12px;outline:none;min-width:0;';

    var okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.style.cssText = 'background:#10b981;color:#fff;border:none;padding:5px 14px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = '\\u2715';
    cancelBtn.style.cssText = 'background:#475569;color:#fff;border:none;padding:5px 8px;border-radius:4px;cursor:pointer;font-size:11px;';

    row.appendChild(inp);
    row.appendChild(okBtn);
    row.appendChild(cancelBtn);
    picker.appendChild(row);

    setTimeout(function() { inp.focus(); }, 50);

    function submit() {
      var val = inp.value.trim();
      if (val) { onSubmit(val); }
      else { hidePicker(); }
    }

    okBtn.addEventListener('click', function(e) {
      e.stopPropagation(); e.preventDefault();
      submit();
    });
    cancelBtn.addEventListener('click', function(e) {
      e.stopPropagation(); e.preventDefault();
      hidePicker();
    });
    inp.addEventListener('keydown', function(e) {
      e.stopPropagation(); // Prevent ESC from exiting assert mode
      if (e.key === 'Enter') { submit(); }
      if (e.key === 'Escape') { hidePicker(); }
    });
  }

  // ── Event handlers ──

  function onMouseMove(e) {
    if (pickerVisible) return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlay || el === highlight || el === tooltip || el === picker || picker.contains(el)) return;

    var rect = el.getBoundingClientRect();
    highlight.style.left = rect.left + 'px';
    highlight.style.top = rect.top + 'px';
    highlight.style.width = rect.width + 'px';
    highlight.style.height = rect.height + 'px';
    highlight.style.display = 'block';

    var summary = getElementSummary(el);
    tooltip.textContent = summary;
    tooltip.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
    tooltip.style.top = Math.max(0, rect.top - 24) + 'px';
    tooltip.style.display = 'block';

    currentTarget = el;
  }

  function onClick(e) {
    // When picker is visible, let clicks INSIDE the picker pass through to item handlers
    if (pickerVisible) {
      if (picker.contains(e.target)) {
        // Don't suppress — let the picker item's own click handler fire
        return;
      }
      // Click outside picker → dismiss, suppress everything
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      hidePicker();
      return false;
    }

    // Normal assert-mode click: suppress default and show picker
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlay || el === highlight || el === tooltip) return false;

    // Store cssPath on element for count assertions
    try {
      var parts = [];
      var cur = el;
      while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== 'html') {
        var t = cur.tagName.toLowerCase();
        if (cur.id && !/[a-z]+-[a-f0-9]{5,}/i.test(cur.id)) { try { parts.unshift('#' + CSS.escape(cur.id)); } catch(ex) { parts.unshift('#' + cur.id); } break; }
        var nth = 1; var sib = cur.previousElementSibling;
        while (sib) { if (sib.tagName.toLowerCase() === t) nth++; sib = sib.previousElementSibling; }
        var hasSame = false; var ns = cur.nextElementSibling;
        while (ns) { if (ns.tagName.toLowerCase() === t) { hasSame = true; break; } ns = ns.nextElementSibling; }
        parts.unshift((nth > 1 || hasSame) ? t + ':nth-of-type(' + nth + ')' : t);
        cur = cur.parentElement;
        if (parts.length > 5) break;
      }
      el.__qabotCssPath = parts.join(' > ');
    } catch(ex) {}

    showPicker(el, e.clientX, e.clientY);
    return false;
  }

  // Use capture phase to intercept ALL clicks
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);

  // Also suppress other events to prevent normal recording
  function suppress(e) {
    if (pickerVisible && picker.contains(e.target)) return; // Allow picker interaction
    e.stopPropagation();
    e.stopImmediatePropagation();
  }
  document.addEventListener('mousedown', suppress, true);
  document.addEventListener('mouseup', suppress, true);
  document.addEventListener('dblclick', suppress, true);
  document.addEventListener('keydown', function(e) {
    // Let picker input handle its own keyboard events (Enter, Escape, typing)
    if (pickerVisible && picker.contains(e.target)) return;
    if (e.key === 'Escape') {
      if (pickerVisible) { hidePicker(); }
      else {
        // ESC exits assert mode — notify Node side
        if (typeof window.__qabot_exitAssertMode === 'function') {
          window.__qabot_exitAssertMode();
        }
      }
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  }, true);

  // Store cleanup function for when assert mode is disabled
  window.__qabotAssertCleanup = function() {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('mousedown', suppress, true);
    document.removeEventListener('mouseup', suppress, true);
    document.removeEventListener('dblclick', suppress, true);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (highlight.parentNode) highlight.parentNode.removeChild(highlight);
    if (tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
    if (picker.parentNode) picker.parentNode.removeChild(picker);
    window.__qabotAssertModeActive = false;
    delete window.__qabotAssertCleanup;
  };

  // Set cursor style on body
  document.body.style.cursor = 'crosshair';
})();
`;

/**
 * Script to DISABLE assertion mode — removes overlay/highlight/picker, restores cursor.
 */
const INJECTED_ASSERT_MODE_OFF_SCRIPT = `
(function() {
  if (typeof window.__qabotAssertCleanup === 'function') {
    window.__qabotAssertCleanup();
  }
  document.body.style.cursor = '';
})();
`;

// ── Time window: navigation events within this ms after a user action are suppressed ─
// Increased to 4s because filter checkboxes on sites like Myntra trigger async URL updates
const NAV_SUPPRESS_AFTER_CLICK_MS = 4000;

export class ActionRecorder {
  private actions: RecordedAction[] = [];
  private recording = false;
  private sessionId: string | null = null;
  private startTime = 0;
  private selectorGenerator = new SelectorGenerator();
  private formatter = new OutputFormatter();
  private browserManager: BrowserManager | null = null;
  private ownsBrowser = false;
  private actionCallback: ((action: RecordedAction) => void) | null = null;

  // Timestamp of the last user-initiated action (click, fill, press, etc.)
  // Used to suppress navigation events caused by those actions
  private lastUserActionTime = 0;

  // Track the current URL to avoid recording navigations to the same URL
  private lastRecordedUrl = '';

  // Active tab index
  private activeTabIndex = 0;

  // Assert mode state
  private assertModeActive = false;

  async start(options: RecordingOptions, externalBrowser?: BrowserManager): Promise<void> {
    this.actions = [];
    this.sessionId = generateId('rec');
    this.startTime = Date.now();
    this.recording = true;
    this.lastUserActionTime = 0;
    this.lastRecordedUrl = options.url || '';
    this.activeTabIndex = 0;

    if (externalBrowser && externalBrowser.hasActiveSession()) {
      this.browserManager = externalBrowser;
      this.ownsBrowser = false;
    } else if (externalBrowser) {
      this.browserManager = externalBrowser;
      await this.browserManager.launch({
        browser: options.browser,
        headless: options.headless,
        viewport: options.viewport,
      });
      this.ownsBrowser = false;
    } else {
      this.browserManager = new BrowserManager();
      await this.browserManager.launch({
        browser: options.browser,
        headless: options.headless,
        viewport: options.viewport,
      });
      this.ownsBrowser = true;
    }

    if (options.url && options.url !== 'about:blank') {
      await this.browserManager.navigateActive(options.url);
      this.addAction({
        id: generateId('act'),
        type: 'navigate',
        timestamp: Date.now(),
        url: options.url,
        description: `Navigate to ${options.url}`,
        tabIndex: 0,
      });
    }

    await this.attachListeners();
    logger.info(`Recording started: ${this.sessionId}`);
  }

  onAction(callback: (action: RecordedAction) => void): void {
    this.actionCallback = callback;
  }

  /**
   * Add a recorded action with intelligent deduplication:
   * - Merges consecutive fills on the same element (keeps latest value)
   * - Suppresses navigations shortly after clicks
   * - Suppresses navigations to the same URL
   */
  addAction(action: RecordedAction): void {
    if (!this.recording) return;

    // ── Smart navigation suppression ──
    if (action.type === 'navigate' && action.url) {
      const timeSinceLastAction = Date.now() - this.lastUserActionTime;

      // Suppress if a user action just happened and this is a resulting navigation
      if (this.lastUserActionTime > 0 && timeSinceLastAction < NAV_SUPPRESS_AFTER_CLICK_MS) {
        logger.debug(`Suppressed navigation to ${action.url} (${timeSinceLastAction}ms after user action)`);
        // Still update lastRecordedUrl so we track where we are
        this.lastRecordedUrl = action.url;
        return;
      }

      // Suppress duplicate navigations to the same URL
      if (action.url === this.lastRecordedUrl) {
        logger.debug(`Suppressed duplicate navigation to ${action.url}`);
        return;
      }

      this.lastRecordedUrl = action.url;
    }

    // ── Suppress duplicate check/uncheck on the same element ──
    if ((action.type === 'check' || action.type === 'uncheck') && this.actions.length > 0) {
      const lastAction = this.actions[this.actions.length - 1]!;
      if ((lastAction.type === 'check' || lastAction.type === 'uncheck') &&
          this.isSameElement(lastAction.selector, action.selector) &&
          (action.timestamp - lastAction.timestamp) < 500) {
        logger.debug(`Suppressed duplicate ${action.type} on same element (${action.timestamp - lastAction.timestamp}ms apart)`);
        return;
      }
    }

    // ── Merge consecutive fills on the same element ──
    if (action.type === 'fill' && this.actions.length > 0) {
      const lastAction = this.actions[this.actions.length - 1]!;
      if (lastAction.type === 'fill' && this.isSameElement(lastAction.selector, action.selector)) {
        // Replace the previous fill with the new one (latest value wins)
        lastAction.value = action.value;
        lastAction.description = action.description;
        lastAction.timestamp = action.timestamp;
        logger.debug(`Merged fill: "${action.value}" (replaces previous fill on same element)`);
        // Notify callback with updated action (for live UI update)
        if (this.actionCallback) {
          this.actionCallback({ ...lastAction, id: lastAction.id + '-update' });
        }
        return;
      }
    }

    // Track user action timestamps (for navigation suppression)
    if (action.type !== 'navigate') {
      this.lastUserActionTime = Date.now();
    }

    this.actions.push(action);
    logger.debug(`Recorded action: ${action.type} — total: ${this.actions.length}`);
    if (this.actionCallback) {
      this.actionCallback(action);
    }
  }

  private isSameElement(a?: ElementSelector, b?: ElementSelector): boolean {
    if (!a || !b) return false;
    return a.strategy === b.strategy && a.value === b.value;
  }

  async stop(): Promise<RecordingSession> {
    this.recording = false;
    const endTime = Date.now();

    const session: RecordingSession = {
      id: this.sessionId || generateId('rec'),
      startedAt: this.startTime,
      endedAt: endTime,
      url: this.actions.find(a => a.url)?.url || '',
      actions: [...this.actions],
      duration: endTime - this.startTime,
    };

    if (this.ownsBrowser && this.browserManager) {
      await this.browserManager.close();
      this.browserManager = null;
    }

    logger.info(`Recording stopped: ${this.actions.length} actions captured`);
    return session;
  }

  isRecording(): boolean {
    return this.recording;
  }

  getActions(): RecordedAction[] {
    return [...this.actions];
  }

  /**
   * Remove a recorded action by ID (used by the delete endpoint).
   * Returns true if found and removed.
   */
  removeAction(actionId: string): boolean {
    const idx = this.actions.findIndex(a => a.id === actionId);
    if (idx >= 0) {
      this.actions.splice(idx, 1);
      return true;
    }
    return false;
  }

  generateCode(options: {
    format: 'playwright' | 'cypress' | 'selenium' | 'puppeteer';
    language?: string;
    testName?: string;
  }): string {
    return this.formatter.formatLegacy(this.actions, {
      format: options.format,
      language: options.language || 'typescript',
      includeComments: true,
      includeImports: true,
      testName: options.testName,
    });
  }

  async generateSmartCode(options: {
    format?: 'playwright' | 'cypress' | 'selenium' | 'puppeteer';
    language?: string;
    testName?: string;
    cwd: string;
  }): Promise<{ code: string; pageCode?: string; testFile: string; pageFile?: string; projectCtx: ProjectContext }> {
    const projectCtx = await analyzeProject(options.cwd);
    const format = options.format || projectCtx.framework || 'playwright';
    const language = options.language || (projectCtx.language === 'python' ? 'python' : projectCtx.language === 'java' ? 'java' : 'typescript');

    const result = this.formatter.format(this.actions, {
      format,
      language,
      includeComments: true,
      includeImports: true,
      testName: options.testName,
    }, projectCtx);

    return { ...result, projectCtx };
  }

  getSelectorGenerator(): SelectorGenerator {
    return this.selectorGenerator;
  }

  getFormatter(): OutputFormatter {
    return this.formatter;
  }

  isAssertMode(): boolean {
    return this.assertModeActive;
  }

  /**
   * Toggle assertion mode on/off in the browser.
   * When ON: injects overlay + crosshair + hover highlight + assertion picker.
   * When OFF: removes overlay, restores normal recording.
   */
  async toggleAssertMode(enable: boolean): Promise<boolean> {
    if (!this.browserManager || !this.recording) return false;

    const page = this.browserManager.getPage();
    if (!page) return false;

    if (enable && !this.assertModeActive) {
      // Expose the exit callback (ESC key inside assert mode)
      try {
        await page.exposeFunction('__qabot_exitAssertMode', () => {
          this.toggleAssertMode(false);
          // Notify via action callback that assert mode was exited
          if (this.actionCallback) {
            this.actionCallback({
              id: generateId('sys'),
              type: 'assert',
              timestamp: Date.now(),
              description: '__assert_mode_off__',
            });
          }
        });
      } catch {
        // Already exposed
      }

      await page.evaluate(INJECTED_ASSERT_MODE_SCRIPT).catch(() => {
        logger.debug('Failed to inject assert mode script');
      });
      this.assertModeActive = true;
      logger.info('Assert mode enabled');
    } else if (!enable && this.assertModeActive) {
      await page.evaluate(INJECTED_ASSERT_MODE_OFF_SCRIPT).catch(() => {
        logger.debug('Failed to remove assert mode overlay');
      });
      this.assertModeActive = false;
      logger.info('Assert mode disabled');
    }

    return this.assertModeActive;
  }

  // ── Private: attach event listeners ──────────────────────────────────────

  private async attachListeners(): Promise<void> {
    if (!this.browserManager) return;

    const page = this.browserManager.getPage();
    if (!page) {
      logger.warn('No Playwright page available — cannot attach event listeners');
      return;
    }

    await this.attachPageListeners(page, 0);

    const context = this.browserManager.getContext();
    if (context) {
      context.on('page', async (newPage: Page) => {
        if (!this.recording) return;
        const allPages = this.browserManager!.getAllPages();
        const tabIndex = allPages.indexOf(newPage);
        logger.info(`New tab/popup detected during recording (tab ${tabIndex})`);

        await newPage.waitForLoadState('domcontentloaded').catch(() => {});

        const newTabIndex = tabIndex >= 0 ? tabIndex : (this.activeTabIndex + 1);

        // Record "switch to new tab" action
        this.activeTabIndex = newTabIndex;
        this.lastRecordedUrl = newPage.url();

        // Force-push this action (bypass nav suppression since it's a new tab)
        const switchAction: RecordedAction = {
          id: generateId('act'),
          type: 'navigate',
          timestamp: Date.now(),
          url: newPage.url(),
          description: `Switch to new tab`,
          tabIndex: newTabIndex,
        };
        this.actions.push(switchAction);
        this.lastUserActionTime = 0; // Reset so this tab's navigations work
        logger.debug(`Recorded new tab: tab ${newTabIndex} → ${newPage.url()}`);
        if (this.actionCallback) {
          this.actionCallback(switchAction);
        }

        await this.attachPageListeners(newPage, newTabIndex);
      });
    }
  }

  private async attachPageListeners(page: Page, tabIndex: number): Promise<void> {
    // Expose bridge function
    try {
      await page.exposeFunction('__qabot_recordAction', (jsonStr: string) => {
        if (!this.recording) return;
        try {
          const data = JSON.parse(jsonStr);
          const action = this.buildAction(data);
          if (action) {
            action.tabIndex = tabIndex;
            if (data.frameName) {
              action.frameName = data.frameName;
            }
            this.addAction(action);
          }
        } catch (err) {
          logger.debug(`Failed to parse recorded action: ${err}`);
        }
      });
    } catch {
      logger.debug('__qabot_recordAction already exposed on this page');
    }

    // addInitScript for reliable injection
    try {
      await page.addInitScript(INJECTED_RECORDER_SCRIPT);
    } catch {
      logger.debug('Failed to addInitScript — falling back to evaluate');
    }

    // Inject NOW
    await page.evaluate(INJECTED_RECORDER_SCRIPT).catch(() => {
      logger.debug('Failed to inject recorder script into main frame');
    });

    // Child frames
    for (const frame of page.frames()) {
      if (frame !== page.mainFrame()) {
        try {
          await frame.evaluate(INJECTED_RECORDER_SCRIPT);
        } catch {
          logger.debug(`Failed to inject recorder into child frame: ${frame.url()}`);
        }
      }
    }

    // Track navigations — but only record when NOT caused by a user click
    page.on('framenavigated', async (frame) => {
      if (!this.recording) return;

      if (frame === page.mainFrame()) {
        const url = page.url();

        // Record navigation (addAction will intelligently suppress if needed)
        this.addAction({
          id: generateId('act'),
          type: 'navigate',
          timestamp: Date.now(),
          url,
          description: `Navigate to ${url}`,
          tabIndex,
        });

        // Re-inject recorder script
        try {
          await page.evaluate(INJECTED_RECORDER_SCRIPT);
        } catch {
          logger.debug('Failed to re-inject recorder script after navigation');
        }
      } else {
        // Child frame navigated
        try {
          await frame.evaluate(INJECTED_RECORDER_SCRIPT);
        } catch {
          logger.debug(`Failed to inject recorder into navigated child frame: ${frame.url()}`);
        }
      }
    });

    // Dynamically added frames
    page.on('frameattached', async (frame) => {
      if (!this.recording) return;
      try {
        await frame.waitForLoadState('domcontentloaded').catch(() => {});
        await frame.evaluate(INJECTED_RECORDER_SCRIPT);
      } catch {
        logger.debug(`Failed to inject recorder into newly attached frame: ${frame.url()}`);
      }
    });
  }

  /**
   * Convert raw data from the injected script into a RecordedAction.
   */
  private buildAction(data: {
    type: string;
    element?: Record<string, unknown>;
    value?: string;
    key?: string;
    selectedText?: string;
    position?: { x: number; y: number };
    frameName?: string;
    assertType?: string;
    expectedValue?: string;
    actualValue?: string;
    assertAttribute?: string;
  }): RecordedAction | null {
    const id = generateId('act');
    const timestamp = Date.now();

    let selector: ElementSelector | undefined;
    if (data.element) {
      selector = this.selectorGenerator.generate(data.element as any);
    }

    const desc = this.buildNlpDescription(data);

    switch (data.type) {
      case 'click':
        return { id, type: 'click', timestamp, selector, position: data.position, description: desc };
      case 'dblclick':
        return { id, type: 'dblclick', timestamp, selector, position: data.position, description: desc };
      case 'fill':
        return { id, type: 'fill', timestamp, selector, value: data.value || '', description: desc };
      case 'press':
        return { id, type: 'press', timestamp, key: data.key, selector, description: desc };
      case 'select':
        return { id, type: 'select', timestamp, selector, value: data.value || '', description: desc };
      case 'check':
        return { id, type: 'check', timestamp, selector, description: desc };
      case 'uncheck':
        return { id, type: 'uncheck', timestamp, selector, description: desc };
      case 'assert': {
        // Auto-exit assert mode after capturing an assertion
        if (this.assertModeActive) {
          this.toggleAssertMode(false).catch(() => {});
        }
        return {
          id,
          type: 'assert',
          timestamp,
          selector,
          description: desc,
          assertType: data.assertType as any,
          expectedValue: data.expectedValue || '',
          actualValue: data.actualValue || '',
          assertAttribute: data.assertAttribute || undefined,
        };
      }
      default:
        return null;
    }
  }

  /**
   * Generate natural-language descriptions.
   * These read like BDD/Gherkin steps:
   *   "Click the 'Submit' button"
   *   "Enter 'john@email.com' in the 'Email' text field"
   *   "Check the 'Remember me' checkbox"
   *   "Select 'California' from the 'State' dropdown"
   */
  private buildNlpDescription(data: {
    type: string;
    element?: Record<string, unknown>;
    value?: string;
    key?: string;
    selectedText?: string;
    assertType?: string;
    expectedValue?: string;
    actualValue?: string;
    assertAttribute?: string;
  }): string {
    const el = data.element;
    if (!el) {
      switch (data.type) {
        case 'click': return 'Click on element';
        case 'dblclick': return 'Double-click on element';
        case 'fill': return `Enter "${(data.value || '').slice(0, 50)}"`;
        case 'press': return `Press ${data.key || 'key'}`;
        case 'select': return `Select "${data.value || ''}"`;
        case 'check': return 'Check checkbox';
        case 'uncheck': return 'Uncheck checkbox';
        default: return data.type;
      }
    }

    const label = (el.label || '') as string;
    const ariaLabel = (el.ariaLabel || '') as string;
    const text = (el.textContent || el.innerText || '') as string;
    const role = (el.ariaRole || '') as string;
    const tag = (el.tagName as string) || '';
    const type = (el.type as string) || '';
    const placeholder = (el.placeholder as string) || '';
    const elName = (el.name as string) || '';
    const title = (el.title as string) || '';

    // Best name for the element (what the user sees)
    const getName = (): string => {
      if (label) return label.slice(0, 50);
      if (ariaLabel) return ariaLabel.slice(0, 50);
      if (text && text.length < 60) return text;
      if (placeholder) return placeholder.slice(0, 40);
      if (title) return title.slice(0, 40);
      if (elName) return elName;
      if (el.testId) return String(el.testId);
      if (el.id) return String(el.id);
      return '';
    };

    // Human-readable element type (returns empty string for generic elements)
    const getType = (): string => {
      // Checkbox-like
      if (role === 'checkbox' || (tag === 'input' && type === 'checkbox')) return 'checkbox';
      if (role === 'radio' || (tag === 'input' && type === 'radio')) return 'radio option';
      if (role === 'switch') return 'toggle';

      // Buttons
      if (role === 'button' || tag === 'button' || tag === 'summary') return 'button';

      // Links
      if (role === 'link' || tag === 'a') return 'link';

      // Text inputs
      if (role === 'textbox' || tag === 'textarea' ||
          (tag === 'input' && ['text', 'email', 'password', 'search', 'tel', 'url', 'number', ''].includes(type))) {
        if (type === 'password') return 'password field';
        if (type === 'email') return 'email field';
        if (type === 'search') return 'search box';
        if (type === 'number') return 'number field';
        return 'field';
      }

      // Dropdowns
      if (role === 'combobox' || tag === 'select') return 'dropdown';

      // Navigation/structural
      if (role === 'tab') return 'tab';
      if (role === 'menuitem' || role === 'menuitemcheckbox' || role === 'menuitemradio') return 'menu item';
      if (role === 'listitem' || tag === 'li') return 'item';
      if (role === 'heading' || /^h[1-6]$/.test(tag)) return 'heading';
      if (tag === 'img' || role === 'img') return 'image';
      if (role === 'slider') return 'slider';

      // For generic div/span/p — don't say "element", return empty
      // so the description just uses the name: Click on 'Roadster'
      if (role && role !== 'generic' && role !== 'presentation') return role;
      return '';
    };

    const name = getName();
    const elType = getType();

    // Helper: format "Click the 'Name' button" or just "Click on 'Name'" when no type
    const withNameAndType = (verb: string): string => {
      if (name && elType) return `${verb} the '${name}' ${elType}`;
      if (name) return `${verb} on '${name}'`;
      if (elType) return `${verb} on ${elType}`;
      return `${verb} on element`;
    };

    switch (data.type) {
      case 'click':
        return withNameAndType('Click');
      case 'dblclick':
        return withNameAndType('Double-click');
      case 'fill': {
        const val = (data.value || '').slice(0, 50);
        if (name && elType) return `Enter "${val}" in the '${name}' ${elType}`;
        if (name) return `Enter "${val}" in '${name}'`;
        if (elType) return `Enter "${val}" in ${elType}`;
        return `Enter "${val}"`;
      }
      case 'press': {
        const key = data.key || 'key';
        if (key === 'Enter') return 'Press Enter';
        if (key === 'Escape') return 'Press Escape';
        if (key === 'Tab') return 'Press Tab';
        return `Press ${key}`;
      }
      case 'select': {
        const selectedLabel = data.selectedText || data.value || '';
        if (name && elType) return `Select '${selectedLabel}' from the '${name}' ${elType}`;
        if (name) return `Select '${selectedLabel}' from '${name}'`;
        return `Select '${selectedLabel}'`;
      }
      case 'check': {
        if (elType === 'radio option') {
          if (name) return `Select the '${name}' option`;
          return 'Select option';
        }
        if (name && elType) return `Check the '${name}' ${elType}`;
        if (name) return `Check '${name}'`;
        return 'Check checkbox';
      }
      case 'uncheck': {
        if (name && elType) return `Uncheck the '${name}' ${elType}`;
        if (name) return `Uncheck '${name}'`;
        return 'Uncheck checkbox';
      }
      case 'assert': {
        const expected = (data.expectedValue || '').slice(0, 40);
        const elRef = name ? `'${name}'` : (elType || 'element');
        const attr = data.assertAttribute || '';
        switch (data.assertType) {
          // ── Positive assertions ──
          case 'text':
            return `Verify ${elRef} contains "${expected}"`;
          case 'visible':
            return `Verify ${elRef} is visible`;
          case 'hidden':
            return `Verify ${elRef} is hidden`;
          case 'value':
            return `Verify ${elRef} has value "${expected}"`;
          case 'attribute':
            return attr
              ? `Verify ${elRef} attribute "${attr}" equals "${expected}"`
              : `Verify ${elRef} attribute matches "${expected}"`;
          case 'url':
            return `Verify URL contains "${expected}"`;
          case 'title':
            return `Verify page title contains "${expected}"`;
          case 'count':
            return `Verify ${elRef} count equals ${expected}`;
          case 'enabled':
            return `Verify ${elRef} is enabled`;
          case 'disabled':
            return `Verify ${elRef} is disabled`;
          case 'checked':
            return `Verify ${elRef} is checked`;
          case 'unchecked':
            return `Verify ${elRef} is unchecked`;
          case 'class':
            return `Verify ${elRef} has class "${expected}"`;
          case 'placeholder':
            return `Verify ${elRef} placeholder is "${expected}"`;
          case 'href':
            return `Verify ${elRef} href contains "${expected}"`;
          case 'min-count':
            return `Verify at least ${expected} ${elRef} elements`;
          // ── Negative assertions ──
          case 'not-text':
            return `Verify ${elRef} does NOT contain "${expected}"`;
          case 'not-visible':
            return `Verify ${elRef} is NOT visible`;
          case 'not-value':
            return `Verify ${elRef} value is NOT "${expected}"`;
          case 'not-enabled':
            return `Verify ${elRef} is NOT enabled`;
          case 'not-checked':
            return `Verify ${elRef} is NOT checked`;
          case 'not-url':
            return `Verify URL does NOT contain "${expected}"`;
          case 'not-title':
            return `Verify page title does NOT contain "${expected}"`;
          case 'not-count':
            return `Verify ${elRef} count is NOT ${expected}`;
          case 'not-class':
            return `Verify ${elRef} does NOT have class "${expected}"`;
          default:
            return `Verify ${elRef}`;
        }
      }
      default:
        return `${data.type} on ${name || elType || 'element'}`;
    }
  }
}
