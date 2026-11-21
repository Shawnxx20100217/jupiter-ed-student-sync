'use strict';

const { fixture } = require('../tests/helpers/synthetic-state.cjs');
const { buildState } = require('../src/state.cjs');

// The same artificial source used by the offline regression tests, in memory.
const { payload, context } = fixture();
const [math, art] = payload.student.courses.map(course => course.assignments[0]);
math.name = math.name_raw = 'Graph a parabola';
art.name = art.name_raw = 'Sketchbook study';
art.due_raw = '2030-10-15';

function report(label, { summary }) {
  const { added_count, changed_count, unchanged_count } = summary;
  console.log(`${label}: ${added_count} added, ${changed_count} changed, ${unchanged_count} unchanged`);
}

console.log('Offline demo | fictional courses and assignments');
const first = buildState(payload, null, context);
report('First scan', first);
for (const { observed, inferred } of first.state.tasks) {
  const due = inferred.deadline.due_date ?? `unknown (source shows "${observed.due_text}")`;
  console.log(`  ${observed.course} | ${observed.title} | due: ${due}`);
}

payload.observed_at = '2030-10-01T13:00:00.000Z';
art.due_raw = '2030-10-16';
const revised = buildState(payload, first.state, context);
report(`New source date for "${art.name}" (${art.due_raw})`, revised);

payload.observed_at = '2030-10-01T14:00:00.000Z';
report('Same records on the next scan', buildState(payload, revised.state, context));

// Calendar notices have their own source dates and do not add another assignment.
const { attachObservation } = require('../tests/helpers/synthetic-calendar.cjs');
const calendar = fixture();
attachObservation(calendar);
const {state, summary} = buildState(calendar.payload, null, calendar.context);
console.log('School calendar | ' + summary.calendar.complete_months + ' complete fictional months');
for (const {observed} of state.calendar_date_summaries.records) {
  for (const item of observed.items) {
    console.log('  ' + observed.date + ' | ' + item.title + ' | ' +
      (observed.start_time ?? 'time unknown'));
  }
}
