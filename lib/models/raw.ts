/** Page text is evidence: preserve spelling, symbols and whitespace verbatim. */
export type RawFields = Record<string, string | null>

export function copyRaw(raw: RawFields): Readonly<RawFields> {
    for (const value of Object.values(raw)) {
        if (value !== null && typeof value !== "string")
            throw new TypeError('Raw source fields must be strings or null')
    }
    return Object.freeze({ ...raw })
}

/** Parsed numbers are optional adjuncts; never coerce, round or assign a scale. */
export function finiteOrNull(value: number | null): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null
}
