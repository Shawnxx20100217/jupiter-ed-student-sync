import { Page, ElementHandle } from "puppeteer-core"
import JupiterRequest from "./request"

// Runs inside the page: match known service-outage text, not colors, markup,
// retry-minute counts, or isolated words in an otherwise usable login form.
export function loginPageState(schoolName: string): boolean | 'upstream_maintenance' | 'upstream_unavailable' {
    if (!document.body) return false
    const visible = (selector: string) => {
        const element = document.querySelector(selector) as HTMLElement | null
        return Boolean(element && element.getClientRects().length)
    }
    const text = document.body.innerText.replace(/\s+/g, ' ').trim()
    const title = document.title.replace(/\s+/g, ' ').trim()
    const maintenancePage = /\b(?:Site|Server) Maintenance\b/i.test(title + ' ' + text) &&
        /\bWe are currently performing maintenance (?:of|on) our servers\b/i.test(text)
    const offlineNotice = /\bJupiter(?: Ed)? is (?:(?:currently|temporarily) )?offline while we (?:perform|are performing) maintenance on our servers\b/i.test(text)
    const serverUnavailable = /\bSorry,? the server is not responding[!.]?\s+We are working on it now[!.]?\s+Please try again later\b/i.test(text)
    if (!visible('#text_studid1') && !visible('#text_password1')) {
        if (maintenancePage || offlineNotice) return 'upstream_maintenance'
        if (serverUnavailable) return 'upstream_unavailable'
    }
    const school = document.querySelector('#text_school1')?.textContent?.trim() || ''
    const schoolId = (document.querySelector('input[name="school1"]') as HTMLInputElement | null)?.value.trim() || ''
    const namedSchool = Boolean(school) || document.body.innerText.split('\n').some(s => s.trim() === schoolName)
    return visible('#text_studid1') && visible('#text_password1') &&
        (visible('#text_city1') || /^\d+$/.test(schoolId) || namedSchool)
}

/**
 * Crawls the student front-end of Jupiter.
 */
class Navigator {
    private url = 'https://login.jupitered.com/login/'
    private page: Page
    private progress: (stage: string) => void

    /**
     * @param {Page} page - Puppeteer `Page` to navigate
     */
    constructor(page: Page, progress: (stage: string) => void = () => {}) {
        this.progress = progress
        this.page = page
    }

    private async waitForLoginForm(expected: string): Promise<void> {
        // Evaluate in the same page realm as extraction. Browser-side wait
        // pollers can retain a stale execution context during login rendering.
        const deadline = Date.now() + 20000
        while (Date.now() < deadline) {
            if (new URL(this.page.url()).origin !== 'https://login.jupitered.com')
                throw new Error('Unexpected login origin; credentials were not entered')
            const ready = await this.page.evaluate(loginPageState, expected).catch(error => {
                // A normal login redirect replaces the JavaScript context.
                // Retry DOM inspection only; no credentials have been entered.
                if (/Execution context was destroyed|Cannot find context with specified id/.test(error.message || '')) return false
                throw error
            })
            if (typeof ready === 'string') throw new Error(ready)
            if (ready) return
            await new Promise(resolve => setTimeout(resolve, 100))
        }
        const error = new Error('login_form_timeout')
        error.name = 'TimeoutError'
        throw error
    }

    /**
     * Logs in to the Jupiter web client.
     * 
     * @param {JupiterRequest} request - Login details for {@link https://login.jupitered.com/login/}
     * @returns {Promise<boolean>} Promise resolving to `true` if successful
     * 
     * @example
     * ```ts
     * const result = await navigator.login({
     *      id: '',
     *      password: '',
     *      school: '',
     *      city: '',
     *      state: ''
     * })
     * 
     * console.log(`Login status: ${result}`)
     * ```
     */
    public async login(request: JupiterRequest): Promise<boolean> {
        this.progress('login_page')
        const response = await this.page.goto(this.url, { waitUntil: 'domcontentloaded' })
        if (response) this.progress('login_http_' + response.status())
        if (new URL(this.page.url()).origin !== 'https://login.jupitered.com')
            throw new Error('Unexpected login origin; credentials were not entered')
        if (response && response.status() >= 500) {
            // A genuine maintenance response may also use HTTP 503. Inspect
            // once without entering credentials or retrying a failed request.
            const state = await this.page.evaluate(loginPageState, request.school).catch(() => false)
            if (typeof state === 'string') throw new Error(state)
            throw new Error('login_network_failure')
        }
        if (response && [401,403,429].includes(response.status())) throw new Error('login_access_denied')
        if (await this.isAuthenticated()) return true
        if (typeof request.school !== 'string' || !request.school.trim())
            throw new Error('Configured school name is required')
        if (request.schoolId !== undefined && (typeof request.schoolId !== 'string' || !/^\d+$/.test(request.schoolId)))
            throw new Error('Configured school ID must contain only digits')
        // Wait for an actual school form rather than reading a transitional layout.
        this.progress('login_form_waiting')
        await this.waitForLoginForm(request.school).catch(async error => {
            if (['upstream_maintenance', 'upstream_unavailable'].includes(error.message)) throw error
            // Only structural flags; never send page text, field values or URLs to logs.
            const probe = await this.page.evaluate(() => {
                const fields = ['text_studid1','text_password1','text_city1','text_school1']
                    .map(id => { const e = document.getElementById(id); return !e ? '0' : e.getClientRects().length ? '2' : '1' }).join('')
                const text = document.body?.innerText || ''
                const reason = /ERR_FAILED/.test(text) ? 'browser_error' : /captcha|verify you are human/i.test(text) ? 'challenge' : /access denied|forbidden/i.test(text) ? 'denied' : 'unknown'
                return fields + '_' + reason
            }).catch(() => 'unavailable')
            this.progress('login_form_probe_' + probe)
            if (probe.endsWith('_browser_error')) throw new Error('login_network_failure')
            if (probe.endsWith('_denied')) throw new Error('login_access_denied')
            if (probe.endsWith('_challenge')) throw new Error('interactive_verification_required')
            throw error
        })
        this.progress('login_form_ready')
        // Jupiter collapses city/region after a school has been selected.
        const schoolForm = await this.page.evaluate(expected => {
            const city = document.querySelector('#text_city1') as HTMLElement | null
            return { cityVisible: Boolean(city && city.getClientRects().length),
                schoolId: (document.querySelector('input[name="school1"]') as HTMLInputElement | null)?.value.trim() || '',
                school: document.querySelector('#text_school1')?.textContent?.trim() || (document.body.innerText.split('\n').some(s => s.trim() === expected) ? expected : '') }
        }, request.school)
        if (schoolForm.cityVisible) {
            this.progress('login_school')
        await this.page.locator('#text_school1').setTimeout(10000).fill(request.school)
            this.progress('login_city')
        await this.page.locator('#text_city1').setTimeout(10000).fill(request.city)
            this.progress('login_region')
        await this.page.click('#region1_closed [click]')
            const region = await this.page.$$('#menulist_region1 .menurow[val]')
            let chosen = false
            for (const item of region) {
                if (await item.evaluate(el => el.getAttribute('val')) === request.state) {
                    // This long custom menu scrolls while Puppeteer computes click
                    // coordinates. Dispatch the normal click on the exact menu row,
                    // then verify the submitted form value before credentials.
                    await item.evaluate(el => {
                        for (const type of ['mousedown', 'mouseup', 'click'])
                            el.dispatchEvent(new MouseEvent(type, {bubbles:true, cancelable:true, view:window}))
                    })
                    chosen = true; break
                }
            }
            if (!chosen) throw new Error('Requested login region is unavailable')
            await this.page.waitForFunction(expected => {
                const value = (document.querySelector('input[name="region1"]') as HTMLInputElement | null)?.value
                return value === expected
            }, {timeout:5000}, request.state)
        } else {
            const idMatches = request.schoolId !== undefined && /^\d+$/.test(schoolForm.schoolId) &&
                schoolForm.schoolId === request.schoolId
            const nameMatches = schoolForm.school === request.school
            if ((!nameMatches && (Boolean(schoolForm.school) || !idMatches)) ||
                (request.schoolId !== undefined && /^\d+$/.test(schoolForm.schoolId) && !idMatches))
                throw new Error('Remembered school does not match configured school')
        }
        // School validation must finish before entering any account credentials.
        if (new URL(this.page.url()).origin !== 'https://login.jupitered.com')
            throw new Error('Unexpected login origin; credentials were not entered')
        this.progress('login_username')
        await this.page.locator('#text_studid1').setTimeout(10000).fill(request.id)
        this.progress('login_password')
        await this.page.locator('#text_password1').setTimeout(10000).fill(request.password)
        this.progress('login_submit')
        await Promise.all([
            this.page.waitForNavigation({waitUntil:'domcontentloaded', timeout:15000})
                .catch(error => { if (error.name !== 'TimeoutError') throw error }),
            this.page.click('#loginbtn')
        ])
        await this.page.waitForFunction(() => !!document.querySelector('#schoolyeartab') &&
            !!document.querySelector('#sidebar .classnav'), {timeout:15000, polling:100}).catch(() => {})
        return this.isAuthenticated()
    }

    /** Checks only session UI and origin. Caller must also verify account identity. */
    public async isAuthenticated(): Promise<boolean> {
        if (new URL(this.page.url()).origin !== 'https://login.jupitered.com') return false
        return this.page.evaluate(() => {
            const password = document.querySelector('#text_password1') as HTMLElement | null
            const loginVisible = Boolean(password && password.getClientRects().length)
            return !loginVisible && Boolean(document.querySelector('#touchnavbtn')) &&
                Boolean(document.querySelector('.toptabnull, .navrow'))
        })
    }

    /** Reuse the same service-outage classification after read-only navigation. */
    public async assertPageAvailable(): Promise<void> {
        const state = await this.page.evaluate(loginPageState, '')
        if (typeof state === 'string') throw new Error(state)
    }

    /**
     * Opens or closes the left navbar.
     */
    public async getCourseNames(): Promise<string[]> {
        return this.page.$$eval('#sidebar .classnav', els => {
            const names = els.map(el => el.textContent?.trim() || '')
            if (!names.length || names.some(x => !x) || new Set(names).size !== names.length)
                throw new Error('Missing or duplicate course names')
            return names
        })
    }

    public async toggleNav(): Promise<void> {
        await this.page.click('#touchnavbtn')
    }

    /**
     * Navigates to course information page.
     * 
     * @remarks
     * `goCourse()` searches for `div` elements with the course name as an attribute. Since Jupiter provides no indexable information by default, it is necessary to first call `fixCourses()` to set the attributes and add this functionality.
     * 
     * @param {string} course - Exact name of the course to visit
     */
    public async goCourse(course: string) {
        const action = await this.page.evaluate(expected => {
            const name = Array.from(document.querySelectorAll('#sidebar .classnav'))
                .find(el => el.textContent?.trim() === expected)
            const row = name?.closest('.navrow,.navlit')
            if (!row) return null
            const current = Array.from(document.querySelectorAll('#mainpage .big'))
                .some(el => (el as HTMLElement).innerText.trim() === expected)
            return {handler:row.getAttribute('click') || row.getAttribute('onclick') || '', current}
        }, course)
        if (!action) throw new Error('Requested course is not present in navigation')
        if (action.current) return
        const match = action.handler.match(/^postval\('class1',\s*(\d+)\);\s*go\('grades'\);?$/)
        if (!match) throw new Error('Unsupported course navigation; stopped safely')
        await Promise.all([
            this.page.waitForNavigation({waitUntil:'domcontentloaded',timeout:20000}),
            this.page.evaluate(id => {
                const site = window as unknown as {postval:(key:string,value:number)=>void;go:(page:string)=>void}
                site.postval('class1',id); site.go('grades')
            }, Number(match[1]))
        ])
        await this.assertPageAvailable()
        await this.page.waitForFunction(expected => Array.from(document.querySelectorAll('#mainpage .big'))
            .some(el => (el as HTMLElement).innerText.trim() === expected),{timeout:20000,polling:100},course)
        if (!(await this.isAuthenticated())) throw new Error('Jupiter session expired during course navigation')
    }

    /**
     * Sets the `classname` attribute to the course name for each course listed in the navbar.
     */
    public async fixCourses(): Promise<void> {
        await this.page.$$eval('.navrow', (els: any) => {
            for (const el of els) {
                if (el.innerHTML.includes('classnav')) {
                    let name = el.innerHTML.replace(/\t+/g, '')
                    name = name.substring(22, name.indexOf('</div>', 22))
                    el.setAttribute('iscourse', 'true')
                    el.setAttribute('classname', name)
                }
            }
        })
    }

    /**
     * Retrieve the first HTML element on the page matching a query.
     * 
     * @param {string} selector - Puppeteer search query
     * @returns {Promise<ElementHandle | null>} Promise resolving to an `ElementHandle` or null if the target is not present
     */
    public async getElement(selector: string): Promise<ElementHandle | null> {
        return await this.page.$(selector)
    }

    /**
     * Retrieve all HTML elements on the page matching a query.
     * 
     * @param {string} selector - Puppeteer search query
     * @returns {Promise<ElementHandle[]>} Promise resolving to an `ElementHandle` array
     */
    public async getElements(selector: string): Promise<ElementHandle[]> {
        return await this.page.$$(selector)
    }

    /**
     * Retrieve raw HTML from an HTML `ElementHandle`.
     * 
     * @param {ElementHandle | null} element - Handle to HTML element, null-safe
     * @returns {Promise<string | undefined>} Promise resolving to raw HTML string or `undefined` if not present
     */
    public async getHtml(element: ElementHandle | null): Promise<string | undefined> {
        const handle = await element?.getProperty('innerHTML')
        const value = await handle?.jsonValue()
        return value?.trim()
    }
}

export default Navigator
