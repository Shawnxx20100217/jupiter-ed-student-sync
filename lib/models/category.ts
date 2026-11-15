import { RawFields, copyRaw, finiteOrNull } from "./raw"

/** Category observations; weight units remain those of the observed source. */
class Category {
    private name: string
    private grade: number | null
    private weight: number | null
    readonly raw: Readonly<RawFields>

    constructor(name: string, grade: number | null, weight: number | null, raw: RawFields = {}) {
        this.name = name
        this.grade = finiteOrNull(grade)
        this.weight = finiteOrNull(weight)
        this.raw = copyRaw(raw)
    }
}

export default Category
