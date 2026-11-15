import { RawFields, copyRaw, finiteOrNull } from "./raw"

/** Assignment evidence. Graded is independent of Done and formal submission. */
class Assignment {
    private due: string
    private name: string
    private score: number | null
    private points: number | null
    private category: string
    private graded: boolean | null
    readonly raw: Readonly<RawFields>

    constructor(due: string, name: string, score: number | null, points: number | null,
                category: string, raw: RawFields = {}, graded: boolean | null = null) {
        this.due = due
        this.name = name
        this.score = finiteOrNull(score)
        this.points = finiteOrNull(points)
        this.category = category
        this.graded = typeof graded === "boolean" ? graded : null
        this.raw = copyRaw(raw)
    }
}

export default Assignment
