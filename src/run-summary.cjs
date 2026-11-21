'use strict';

const explanations = new Map([
  ['window_already_covered', 'The current collection window already has a snapshot.'],
  ['scheduled_reads_disabled', 'Scheduled reads are turned off.'],
  ['login_cooldown', 'The reader is waiting for the one-hour login cooldown.'],
  ['daily_login_budget', 'The reader has reached its login budget for the past 24 hours.'],
]);

// Only fixed text, canonical timestamps and counts belong on the GitHub run page.
function runSummary(result) {
  if (result.status === 'skipped') {
    const why = explanations.get(result.reason) || 'See the preflight step for the skip reason.';
    return '### Read skipped\n\n' + why + ' No new snapshot was collected.\n';
  }
  if (result.status === 'ready') return '';
  if (result.status !== 'verified' || result.actual_read !== true || result.encrypted_readback_verified !== true) {
    return '### Read stopped\n\nCheck the failed step for its error code before starting another run.\n';
  }
  const fields = [
    ['Snapshot', result.sequence], ['Courses', result.courses], ['Current records', result.current_assignments],
    ['New', result.added_count], ['Changed', result.changed_count], ['Previously seen, absent this scan', result.not_observed_count],
  ];
  const rows = fields.map(([label, value]) => '| ' + label + ' | ' + (Number.isSafeInteger(value) && value >= 0 ? value : '—') + ' |');
  const calendarLabels = new Map([
    ['read', 'Complete'], ['partial', 'Partial coverage'], ['failed', 'Read failed'],
    ['blocked', 'Read blocked'], ['off', 'Off'],
  ]);
  const calendar = result.calendar;
  const calendarRows = [];
  if (calendar) {
    const count = n => Number.isSafeInteger(n) && n >= 0 ? n : '—';
    calendarRows.push('', '#### School calendar', '', calendarLabels.get(calendar.status) || 'Coverage unverified',
      '', '| Months complete / requested | Date summaries this scan |',
      '| --- | ---: |', '| ' + count(calendar.complete_months) + ' / ' + count(calendar.months_requested) +
      ' | ' + count(calendar.date_summaries) + ' |');
  }
  return ['### Snapshot verified', '', 'Encrypted snapshot saved and read back.',
    '', '| This scan | Count |', '| --- | ---: |', ...rows, '',
    'Collected at ' + new Date(result.last_success_at).toISOString() + ' (UTC).', ...calendarRows, ''].join('\n');
}

module.exports = {runSummary};
