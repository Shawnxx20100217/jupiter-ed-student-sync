import Course from "./course"

/** Observations only. No grade average or GPA is derived by this model. */
class Student {
    readonly name: string
    readonly gpa: null = null
    readonly official_gpa: null = null
    readonly official_gpa_reason: "not_observed" = "not_observed"
    readonly estimated_gpa: null = null
    readonly estimated_gpa_reason: "no_school_formula" = "no_school_formula"
    readonly courses: unknown[]

    constructor(name: string, courses: unknown[]) {
        this.name = name
        this.courses = courses
    }

    public toString(): string { return JSON.stringify(this) }
}

export default Student
