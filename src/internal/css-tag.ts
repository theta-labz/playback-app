export class CSSResult {
    /** Stores unique instances. */
    private static instanceCache = new Map<string, CSSResult>()

    readonly cssText!: string

    constructor(cssText: string = '') {
        // Ensure that cssText is string.
        cssText = String(cssText)

        // Return cached instance if possible.
        const cached = CSSResult.instanceCache.get(cssText)
        if (cached) {
            return cached
        }

        // Return & cache current instance.
        CSSResult.instanceCache.set(cssText, this)
        this.cssText = cssText
    }

    toString() {
        return this.cssText
    }

    /** Stores all cached style elements. */
    private elementCache!: WeakMap<DocumentOrShadowRoot, HTMLStyleElement>

    getElement(node: DocumentOrShadowRoot) {
        // Lazy-init style element cache.
        this.elementCache ??= new WeakMap()

        // Return cached element if possible.
        let element = this.elementCache.get(node)
        if (element) {
            return element
        }

        // Create & cache element.
        element = (node instanceof ShadowRoot ? node.ownerDocument : (node as Document)).createElement('style')
        this.elementCache.set(node, element)
        element.textContent = this.cssText

        // Return element.
        return element
    }
}

export function css(template: TemplateStringsArray, ...substitutions: unknown[]) {
    return new CSSResult(String.raw(template, ...substitutions))
}

/** Applies the given styles to the container node. */
export async function adoptStyles(node: DocumentOrShadowRoot, ...styles: CSSResult[]) {
    const targetNode = node instanceof Document ? node.head : ((node as unknown) as HTMLElement)
    targetNode.append(...styles.map(style => style.getElement(node)))
}
