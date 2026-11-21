'use strict';
// Artificial rendered announcements and assignment relationships for offline tests and the demo.
const {fingerprint} = require('../../src/state.cjs');

function notice(date, title) {
  const raw = {date_cell_id: 'c' + date, node: {attributes: {class: 'announce'}, raw_text: title, visible: true}, category_label: null};
  raw.observation_hash = fingerprint(raw);
  return {source_event_id: null, assignment_id: null, title, display_text: title, date, raw,
    evidence: {identity: {verified: false, reason: 'rendered_announcement_has_no_verified_event_id'},
      date: {verified: true, raw_text: date, method: 'exact_calendar_date_cell_id', dom_value: 'c' + date},
      calendar_scope: {verified: true, field: 'calschoolyear', raw_text: '990001 20302031',
        method: 'rendered_calendar_filter_matches_verified_school_and_academic_year'}}};
}

function link(number) {
  const date = '2030-10-03';
  return {assignment_id: number, date, raw: {handler: 'goassign(' + number + ',2)', date_container: 'show' + date},
    evidence: {assignment: {verified: number !== '0', raw_id: number, method: 'exact_rendered_goassign_handler'},
      date: {verified: true, raw_text: date, method: 'exact_day_panel_id_and_calendar_cell', dom_value: 'show' + date}}};
}

function attachObservation(f) {
  const when = f.payload.observed_at;
  const o = {schema: 'jupiter-calendar-observation.v1', observed_at: when, timezone: f.config.timezone,
    identity: {verified: true, scope_hash: fingerprint(f.scope), school_id: '990001', school_year: f.scope.school_year},
    range: {start_date: '2030-10-01', end_date: '2030-11-15'},
    months: [{month: '2030-10', status: 'complete', events: [notice('2030-10-03','Synthetic October assembly'), link('910001'), link('0')]},
      {month: '2030-11', status: 'complete', events: [notice('2030-11-03','Synthetic November assembly')]}]};
  f.payload.calendar_observation = o;
  f.payload.calendar_collection_status = {status: 'read', attempted_at: when, error_code: null};
  return o;
}

module.exports = {attachObservation, notice};
