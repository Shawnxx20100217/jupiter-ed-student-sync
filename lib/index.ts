import puppeteer, { Browser, BrowserContext, LaunchOptions, ConnectOptions, Page } from "puppeteer-core"
import JupiterRequest from "./scraper/request"
import Scraper from "./scraper/scraper"
import Navigator from "./scraper/navigator"

/** Local fork: explicit browser ownership and no bundled browser downloader. */
class Jupiter {
    private contexts = new Set<BrowserContext>()

    private constructor(private browser: Browser, private ownsBrowser: boolean) {}

    public static async launch(options: LaunchOptions): Promise<Jupiter> {
        return new Jupiter(await puppeteer.launch(options), true)
    }

    public static async connect(options: ConnectOptions): Promise<Jupiter> {
        return new Jupiter(await puppeteer.connect(options), false)
    }

    /** Caller owns this page, profile, login and account identity verification. */
    public static fromAuthenticatedPage(page: Page): Scraper {
        return Scraper.fromAuthenticatedPage(page)
    }

    public async request(request: JupiterRequest): Promise<Scraper> {
        const context = await this.browser.createBrowserContext()
        this.contexts.add(context)
        try {
            const page = await context.newPage()
            return new Scraper(request, page)
        } catch (error) {
            await context.close()
            this.contexts.delete(context)
            throw error
        }
    }

    /** Never close an externally connected browser; dispose only owned contexts. */
    public async close(): Promise<void> {
        try {
            await Promise.all([...this.contexts].map(context => context.close()))
        } finally {
            this.contexts.clear()
            if (this.ownsBrowser) await this.browser.close()
            else await this.browser.disconnect()
        }
    }
}

export default Jupiter
export { Scraper, Navigator }
