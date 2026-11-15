import Category from "./category"
import Assignment from "./assignment"
import { RawFields, copyRaw, finiteOrNull } from "./raw"

/** Course observations, preserving page text separately from optional numeric parsing. */
class Course {
    private name: string
    private teacher: string
    private schedule: string
    private grade: number | null
    private categories: Category[]
    private assignments: Assignment[]
    readonly raw: Readonly<RawFields>

    constructor(name: string, teacher: string, schedule: string, grade: number | null,
                categories: Category[], assignments: Assignment[], raw: RawFields = {}) {
        this.name = name
        this.teacher = teacher
        this.schedule = schedule
        this.grade = finiteOrNull(grade)
        this.categories = categories
        this.assignments = assignments
        this.raw = copyRaw(raw)
    }

    public getName(): string { return this.name }
    public getGrade(): number | null { return this.grade }
}

export default Course
