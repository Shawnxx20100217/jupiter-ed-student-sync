import { Page } from "puppeteer-core"
import JupiterRequest from "./request"
import Student from "../models/student"
import Navigator from "./navigator"
import { captureCourseView } from "./capture-course"
import { parseCourseView } from "./course-parser"

/** Authenticated UI reads only; all grade strings are preserved by the parser. */
class Scraper {
    private request: JupiterRequest | null
    private navigator: Navigator
    private page: Page
    constructor(request: JupiterRequest | null, page: Page) {
        this.request=request; this.page=page; this.navigator=new Navigator(page)
    }
    public static fromAuthenticatedPage(page: Page): Scraper { return new Scraper(null,page) }
    public async inspectAuthenticated(): Promise<boolean> { return this.navigator.isAuthenticated() }
    public async getCourses(): Promise<string[]> { return this.navigator.getCourseNames() }
    private async getName(): Promise<string> {
        return this.page.$eval('#leftmast .toptabnull',el=>el.textContent?.trim()||'')
    }
    public async data(expectedTerm?: string): Promise<Student> {
        if(this.request){
            const request=this.request;this.request=null
            if(!(await this.navigator.login(request)))throw new Error('Jupiter authentication failed; no dataset produced')
        }
        if(!(await this.navigator.isAuthenticated()))throw new Error('Jupiter login required; no dataset produced')
        const name=await this.getName(), names=await this.getCourses(), courses=[]
        for(const courseName of names){
            await this.navigator.goCourse(courseName)
            const view=await captureCourseView(this.page,courseName)
            courses.push(parseCourseView(view,courseName,expectedTerm ?? view.term))
        }
        return new Student(name,courses)
    }
}
export default Scraper
