import { Page } from 'puppeteer-core'

/** Only visible academic fields leave the browser; never forms, URLs or state. */
export async function captureCourseView(page: Page, expectedCourse: string): Promise<any> {
    return page.evaluate(expected => {
        const scope = document.querySelector('#mainpage')
        if (!scope) throw new Error('Course content is missing')
        const heading = Array.from(scope.querySelectorAll('.big'))
            .find(x => (x as HTMLElement).innerText.trim() === expected)
        if (!heading) throw new Error('Course identity mismatch')
        const visible = (e: Element) => Boolean(e.getClientRects().length) && getComputedStyle(e).visibility !== 'hidden'
        const owners = Array.from(scope.querySelectorAll('[click*="goassign"],[onclick*="goassign"]')).filter(visible)
        const ownerIds = new Map<Element,string>()
        for (const el of owners) {
            const handler = el.getAttribute('click') || el.getAttribute('onclick') || ''
            const match = handler.match(/^\s*goassign\(\s*(\d+)\s*\)\s*;?\s*$/)
            if (!match) throw new Error('Unrecognized assignment identity')
            ownerIds.set(el, match[1])
        }
        const rows = Array.from(scope.querySelectorAll('tr')).filter(visible).map(tr => {
            let parent: Element | null = tr
            let id: string | null = null
            while (parent && parent !== scope) {
                if (ownerIds.has(parent)) { id=ownerIds.get(parent)!;break }
                parent=parent.parentElement
            }
            return { id, cells:Array.from(tr.children).filter(c => c.tagName==='TD'||c.tagName==='TH')
                .map(c=>({text:(c as HTMLElement).innerText,cls:c.className})) }
        })
        return {
            headerText:(heading.closest('td') as HTMLElement)?.innerText || '',
            term:(document.querySelector('#termmenu_label') as HTMLElement)?.innerText || '',
            ownerIds:Array.from(new Set(ownerIds.values())),
            rows
        }
    },expectedCourse)
}
