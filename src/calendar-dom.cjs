'use strict';

// Extract only the Calendar evidence consumed by the parser. Never copy hidden
// session fields, full scripts, arbitrary handlers or the student's full route.
function extractCalendarDom() {
  const root = document.querySelector('#mainpage');
  if (!root) throw new Error('calendar_main_missing');
  const visible = element => Boolean(element && element.getClientRects().length &&
    getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden');

  const cells = [...root.querySelectorAll('td[id^="c20"]')].filter(el => /^c\d{4}-\d{2}-\d{2}$/.test(el.id));
  const actions = root.querySelectorAll('[click],[onclick]');
  if (cells.length > 500 || actions.length > 2000) throw new Error('calendar_probe_budget_exceeded');
  function containsAssignmentAction(node) {
    const actionAttrs = ['click', 'onclick', 'script', 'href'];
    const elements = [node, ...node.querySelectorAll('[click],[onclick],[script],[href]')];
    return elements.some(el => actionAttrs.some(key => /\bgoassign\s*\(/i.test(el.getAttribute(key) || '')));
  }
  const date_cells = cells.map(cell => ({
    date_id: cell.id,
    visible: visible(cell),
    children: [...cell.children].filter(el => el.classList.contains('annlabel') || el.classList.contains('announce'))
      .map(el => ({ attributes: { class: el.className }, visible: visible(el), raw_text: el.innerText || '',
        contains_assignment_action: containsAssignmentAction(el) }))
  }));

  const controls = [];
  for (const el of actions) {
    const handler = el.getAttribute('click') || el.getAttribute('onclick') || '';
    if (!/^goassign\(\s*\d+\s*(?:,\s*\d+\s*)?\)\s*;?$/.test(handler)) continue;
    const ancestors = [];
    let parent = el;
    for (let depth = 0; parent && depth < 6; depth++, parent = parent.parentElement) {
      if (/^show\d{4}-\d{2}-\d{2}$/.test(parent.id)) ancestors.push({ id: parent.id });
    }
    controls.push({ attributes: { click: handler }, text: el.innerText || '', ancestors });
  }
  const field = name => {
    const elements = document.querySelectorAll(`input[name="${name}"]`);
    return elements.length === 1 && elements[0].type === 'hidden' ? elements[0].value : null;
  };
  function displayFlag(name) {
    const value = field(name), checked = visible(document.getElementById(name + '_check'));
    if (value === '1' && checked) return true;
    if ((value === '' || value === '0') && !checked) return false;
    return null;
  }
  const academic = field('calschoolyear');
  const selected = document.querySelector('#menulit_calview')?.getAttribute('val');
  const monthPattern = /^\s*menu\(\s*['"]calview['"]\s*,\s*['"](\d{4}-(?:0[1-9]|1[0-2]))['"]\s*,/gm;
  const months = new Set();
  if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(selected || '')) months.add(selected);
  if (!months.size) for (const el of root.querySelectorAll('script')) {
    for (const match of (el.textContent || '').matchAll(monthPattern)) months.add(match[1]);
  }
  return {
    schema: 'jupiter-calendar-dom-probe.v1',
    calendar_visible: visible(document.querySelector('#showcalendar')),
    academic_filter: /^\d+ \d{8}$/.test(academic || '') ? { field: 'calschoolyear', raw_value: academic } : null,
    display_filters: { announcements: displayFlag('showannounce'), due_dates: displayFlag('showhw') },
    selected_months: [...months],
    date_cells,
    controls
  };
}

async function captureCalendarDom(page) {
  if (new URL(page.url()).origin !== 'https://login.jupitered.com') throw new Error('calendar_probe_origin_invalid');
  return page.evaluate(extractCalendarDom);
}

module.exports = { extractCalendarDom, captureCalendarDom };
