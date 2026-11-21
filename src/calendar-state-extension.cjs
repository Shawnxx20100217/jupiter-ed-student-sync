'use strict';

// Optional Calendar evidence lives inside the student's existing encrypted snapshot.
const {fingerprint} = require('./state.cjs');
const {mergeCalendarState, validateCalendarState} = require('./calendar-state.cjs');
const {mergeCalendarDateSummaries, validateCalendarDateSummaries} = require('./calendar-date-summary.cjs');

function fail(code) {
  throw Object.assign(new Error(code), {code});
}

function scopeFor(state) {
  return {scopeHash: state.scope_hash, schoolId: state.school_id,
    schoolYear: state.scope.school_year, timezone: state.timezone};
}

function counters(status) {
  return {status, months_requested: 0, complete_months: 0, failed_months: 0, independent_events: 0,
    assignment_links: 0, pending: 0, date_summaries: 0, summary_held: 0,
    summary_added: 0, summary_changed: 0, summary_unchanged: 0};
}

function assignmentReferences(links, tasks) {
  const byNumber = new Map();
  for (const task of tasks) {
    const number = task.identity.jupiter_assignment_id;
    if (!byNumber.has(number)) byNumber.set(number, []);
    byNumber.get(number).push(task);
  }
  return links.map(link => {
    const matches = byNumber.get(link.assignment_id) || [];
    const status = matches.length === 1 ? 'matched' : matches.length ? 'ambiguous' : 'not_in_assignment_snapshot';
    return {assignment_id: link.assignment_id, date: link.date,
      date_role: 'calendar_observation_not_authoritative_due', status,
      source_id: status === 'matched' ? matches[0].id : null};
  });
}

function validateExtension(state) {
  const {calendar_events: calendar, calendar_date_summaries: dates, calendar_collection_status: attempt} = state;
  const context = scopeFor(state);
  if (!attempt || !['off', 'read', 'partial', 'failed', 'blocked'].includes(attempt.status) ||
      !Number.isFinite(Date.parse(attempt.attempted_at)) ||
      !(attempt.error_code === null || /^calendar_[a-z0-9_]{1,65}$/.test(attempt.error_code)))
    fail('calendar_stored_status_invalid');
  if (Boolean(calendar) !== Boolean(dates)) fail('calendar_stored_records_incomplete');
  if (!calendar) {
    if (['read', 'partial'].includes(attempt.status)) fail('calendar_stored_records_incomplete');
    return;
  }
  validateCalendarState(calendar, context);
  validateCalendarDateSummaries(dates, context);
  if (dates.last_observed_at !== calendar.last_observed_at ||
      fingerprint(dates.coverage) !== fingerprint(calendar.coverage) ||
      fingerprint(dates.requested_range) !== fingerprint(calendar.requested_range))
    fail('calendar_stored_coverage_mismatch');
  if (['read', 'partial'].includes(attempt.status) &&
      (calendar.last_observed_at !== attempt.attempted_at || (attempt.status === 'read') !== calendar.retrieval_complete))
    fail('calendar_stored_status_mismatch');
  const links = calendar.assignment_links;
  if (!Array.isArray(calendar.assignment_references) || links.length !== calendar.assignment_references.length)
    fail('calendar_stored_assignment_links_invalid');
  for (const [index, link] of links.entries()) {
    const ref = calendar.assignment_references[index];
    if (!ref || ref.assignment_id !== link.assignment_id || ref.date !== link.date ||
        ref.date_role !== 'calendar_observation_not_authoritative_due' ||
        !['matched', 'ambiguous', 'not_in_assignment_snapshot'].includes(ref.status))
      fail('calendar_stored_assignment_links_invalid');
    if (ref.status === 'matched') {
      if (!state.tasks.some(task => task.id === ref.source_id && task.identity.jupiter_assignment_id === link.assignment_id))
        fail('calendar_stored_assignment_links_invalid');
    } else if (ref.source_id !== null) fail('calendar_stored_assignment_links_invalid');
  }
}

function attachCalendar(state, previous, observation, attempt) {
  if (previous?.calendar_collection_status) {
    validateExtension(previous);
    if (previous.calendar_events) {
      state.calendar_events = structuredClone(previous.calendar_events);
      state.calendar_date_summaries = structuredClone(previous.calendar_date_summaries);
    }
  }
  const attemptedAt = attempt?.attempted_at ?? state.last_success_at;
  const setStatus = (status, code, at = attemptedAt) => {
    const errorCode = code ? (/^calendar_[a-z0-9_]{1,65}$/.test(code) ? code : 'calendar_read_failed') : null;
    state.calendar_collection_status = {status, attempted_at: at, error_code: errorCode};
  };
  if (!observation) {
    const status = attempt ? (attempt.status === 'blocked' ? 'blocked' : 'failed') : 'off';
    setStatus(status, status === 'off' ? null : attempt?.error_code || 'calendar_observation_missing');
    return counters(status);
  }
  const context = scopeFor(state);
  try {
    const merged = mergeCalendarState(observation, previous?.calendar_events, context);
    const {calendar, summary} = merged;
    calendar.assignment_references = assignmentReferences(calendar.assignment_links, state.tasks);
    const dates = mergeCalendarDateSummaries(calendar, previous?.calendar_date_summaries, context);
    const status = calendar.retrieval_complete ? 'read' : summary.months_read ? 'partial' : 'failed';
    const monthFailure = calendar.coverage.find(month => month.error_code);
    setStatus(status, status === 'read' ? null : monthFailure?.error_code || 'calendar_coverage_incomplete', observation.observed_at);
    state.calendar_events = calendar;
    state.calendar_date_summaries = dates.state;
    return {status, months_requested: summary.months_requested, complete_months: summary.complete_months,
      failed_months: summary.failed_months, independent_events: summary.current_independent_events,
      assignment_links: summary.assignment_links, pending: summary.pending,
      date_summaries: dates.state.records.filter(record => !record.stale).length,
      summary_held: dates.summary.held, summary_added: dates.summary.added,
      summary_changed: dates.summary.changed, summary_unchanged: dates.summary.unchanged};
  } catch (error) {
    // Identity, configuration and integrity failures must never be treated as usable school data.
    if (/scope|identity|credential|sensitive|previous_|timezone|out_of_order/.test(error.code || '')) throw error;
    setStatus('failed', error.code || 'calendar_read_failed');
    return counters('failed');
  }
}

module.exports = {attachCalendar, validateExtension};
