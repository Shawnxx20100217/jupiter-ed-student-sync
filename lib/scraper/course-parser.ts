/** Pure, fail-closed parser for observed Jupiter course table cells.
 * Raw cell text is authoritative. Numeric values are optional adjuncts only.
 */
export interface CourseCell { text: string; cls?: string; [key: string]: unknown }
export interface CourseRow { id: string | null; cells: CourseCell[]; [key: string]: unknown }
export interface CourseView {
    rows: CourseRow[]
    headerText: string
    term?: string
    ownerIds?: string[]
    [key: string]: unknown
}

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()
const strictNumber = (raw: string | null): number | null => {
    if (raw === null || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw.trim())) return null
    const value = Number(raw.trim())
    return Number.isFinite(value) ? value : null
}
const percentage = (raw: string | null): number | null => {
    if (raw === null) return null
    const match = raw.trim().match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*%$/)
    return match ? strictNumber(match[1]) : null
}
const weightPercentage = (raw: string | null): number | null => {
    if (raw === null) return null
    const match = raw.trim().match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*%\s+of\s+grade$/i)
    return match ? strictNumber(match[1]) : percentage(raw)
}
const scorePair = (raw: string): { score: number | null; points: number | null } => {
    const match = raw.trim().match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*\/\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/)
    return match ? { score: strictNumber(match[1]), points: strictNumber(match[2]) }
        : { score: strictNumber(raw), points: null }
}

export function parseCourseView(view: CourseView, expectedCourse: string, expectedTerm = '1st Semester') {
    if (!view || !Array.isArray(view.rows) || typeof view.headerText !== 'string')
        throw new Error('course_view_missing_structure')
    if (view.term !== undefined && normalize(view.term) !== normalize(expectedTerm))
        throw new Error('course_term_mismatch')
    const allHeaderLines = view.headerText.split(/\r?\n/)
    const firstHeaderLine = allHeaderLines.findIndex(line => normalize(line) !== '')
    const headerLines = firstHeaderLine < 0 ? [] : allHeaderLines.slice(firstHeaderLine)
    if (!headerLines.length || normalize(headerLines[0]) !== normalize(expectedCourse))
        throw new Error('course_header_mismatch')
    const rows = view.rows
    for (const row of rows) {
        if (!Array.isArray(row.cells) || row.cells.some(cell => typeof cell.text !== 'string'))
            throw new Error('course_cell_text_missing')
    }
    const headerIndex = rows.findIndex(row => row.id === null && row.cells.length >= 4 &&
        normalize(row.cells[1].text) === 'Due' && normalize(row.cells[2].text) === 'Assignment' &&
        normalize(row.cells[3].text) === 'Score')
    if (headerIndex < 0) throw new Error('assignment_table_header_missing')
    if (rows.slice(0, headerIndex + 1).some(row => row.id !== null))
        throw new Error('assignment_owner_outside_table')
    const termRows = rows.slice(0, headerIndex).filter(row => row.id === null && row.cells.length === 7 &&
        normalize(row.cells[0].text) === normalize(expectedTerm))
    if (termRows.length !== 1) throw new Error('course_term_grade_row_missing_or_ambiguous')
    const termCells = termRows[0].cells.map(cell => cell.text)
    const termRowIndex = rows.indexOf(termRows[0])
    const categories = rows.slice(termRowIndex + 1, headerIndex).filter(row => row.id === null && row.cells.length === 7)
        .map(row => {
            const raw = row.cells.map(cell => cell.text)
            const grade = percentage(raw[2])
            const weight = weightPercentage(raw[5])
            return {
                name: normalize(raw[0]), name_raw: raw[0],
                grade, grade_raw: raw[2], grade_unit: grade === null ? null : 'percent',
                letter_grade_raw: raw[1], weight, weight_raw: raw[5], weight_unit: weight === null ? null : 'percent',
                raw: { cells: raw, name: raw[0], grade: raw[2], letter_grade: raw[1], weight: raw[5] },
            }
        })
    const owners = new Set<string>()
    const assignmentMap = new Map<string, any>()
    const bodyEvidence = new Map<string, string>()
    let duplicateRows = 0
    for (const row of rows.slice(headerIndex + 1)) {
        if (row.id === null) {
            if (row.cells.length === 13 && normalize(row.cells[2].text))
                throw new Error('assignment_row_missing_source_id')
            continue
        }
        if (typeof row.id !== 'string' || !/^\d+$/.test(row.id))
            throw new Error('assignment_source_id_invalid')
        owners.add(row.id)
        const raw = row.cells.map(cell => cell.text)
        if (raw.length === 1 && normalize(raw[0]) === '' && /\brow(?:top|bot)\b/.test(row.cells[0].cls || '')) continue
        if (raw.length !== 13) throw new Error('assignment_row_shape_changed')
        if (!normalize(raw[2])) throw new Error('assignment_title_missing')
        const evidence = JSON.stringify(raw)
        if (bodyEvidence.has(row.id)) {
            if (bodyEvidence.get(row.id) !== evidence) throw new Error('assignment_id_conflict')
            duplicateRows++
            continue
        }
        bodyEvidence.set(row.id, evidence)
        const pair = scorePair(raw[3])
        const percent = percentage(raw[4])
        assignmentMap.set(row.id, {
            id: row.id, jupiter_task_id: row.id,
            due: normalize(raw[1]) || null, due_raw: raw[1],
            name: normalize(raw[2]), name_raw: raw[2],
            category: normalize(raw[11]) || null, category_raw: raw[11],
            score: pair.score, points: pair.points, score_raw: raw[3],
            percent, percent_raw: raw[4], percent_unit: percent === null ? null : 'percent',
            letter_grade_raw: raw[5],
            worth: strictNumber(raw[7]), worth_raw: raw[7], worth_unit: null,
            impact_raw: [raw[8], raw[9]],
            status_raw: raw[3], graded: null,
            personal_done: normalize(raw[3]) === 'Done' ? true : null,
            submission_status: null,
            raw: { cells: raw, due: raw[1], name: raw[2], score: raw[3], percent: raw[4],
                letter_grade: raw[5], worth: raw[7], impact_primary: raw[8], impact_secondary: raw[9], category: raw[11] },
        })
    }
    if ([...owners].some(id => !assignmentMap.has(id))) throw new Error('assignment_owner_not_covered')
    // The DOM capture inventories owners independently of table rows. An owner
    // without any extracted row must not silently disappear from the dataset.
    if (view.ownerIds !== undefined) {
        if (!Array.isArray(view.ownerIds) || view.ownerIds.some(id => typeof id !== 'string' || !/^\d+$/.test(id)))
            throw new Error('assignment_owner_inventory_invalid')
        const capturedOwners = new Set(view.ownerIds)
        if (capturedOwners.size !== owners.size || [...capturedOwners].some(id => !owners.has(id)))
            throw new Error('assignment_owner_coverage_mismatch')
    }
    const grade = percentage(termCells[2])
    const possibleTeacher = headerLines[1] ?? null
    const teacherIsSchedule = possibleTeacher !== null && /^Period\b|^rm\./i.test(normalize(possibleTeacher))
    const teacherRaw = teacherIsSchedule ? null : possibleTeacher
    const scheduleRaw = headerLines.slice(teacherIsSchedule ? 1 : 2).join('\n') || null
    return {
        name: normalize(headerLines[0]), name_raw: headerLines[0],
        teacher: teacherRaw ? normalize(teacherRaw) || null : null,
        teacher_raw: teacherRaw,
        schedule: scheduleRaw ? normalize(scheduleRaw) || null : null,
        schedule_raw: scheduleRaw,
        term: expectedTerm, term_raw: termCells[0],
        grade, grade_raw: termCells[2], grade_unit: grade === null ? null : 'percent',
        letter_grade_raw: termCells[1],
        categories, assignments: [...assignmentMap.values()],
        coverage: { complete: true, assignment_owner_count: owners.size, parsed_assignment_count: assignmentMap.size,
            duplicate_identical_rows: duplicateRows, assignment_header_verified: true },
        raw: { header: view.headerText, term_cells: termCells, grade: termCells[2], letter_grade: termCells[1] },
    }
}
