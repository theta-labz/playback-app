export abstract class ReactiveElement extends HTMLElement {
    /** */
    hasBeenUpdated = false

    /** */
    isUpdatePending = false

    /**
     * Represents a queue of microtasks to update the element. Changes when
     * prompted to update an element.
     */
    updateComplete = new Promise<void>(enableUpdating => {
        this.enableUpdating = enableUpdating
    })

    /** */
    constructor() {
        super()
        this.requestUpdate()
    }

    /**
     * Called every time a custom element connects to the DOM. This happens when an
     * element is attached or moved in the DOM, and may happen before the element's
     * content have been fully parsed.
     */
    protected connectedCallback() {
        this.enableUpdating()
    }

    /**
     * Called every time a custom element disconnects from the DOM.
     */
    protected disconnectedCallback?(): void

    /** */
    protected adoptedCallback?(): void

    /** */
    protected attributeChangedCallback?(): void

    /**
     * Enables a queue of microtasks to update the element.
     */
    protected enableUpdating!: () => void

    /**
     * Requests an element update which is processed asynchronously.
     */
    protected requestUpdate() {
        // Abort the request if element update has already been requested.
        if (this.isUpdatePending) {
            return
        }

        this.updateComplete = this.__performUpdateMicrotask()
    }

    /** */
    private async __performUpdateMicrotask() {
        this.isUpdatePending = true

        try {
            // Before updating, ensure that any previous update microtask has been
            // completed. This `await` also ensures that changes are batched.
            await this.updateComplete
        } catch (reason) {
            // Refire any previous errors async so they do not disrupt the update
            // cycle. Errors are refired so developers have a chance to observe
            // them, and this can be done by implementing
            // `globalThis.onunhandledrejection`.
            Promise.reject(reason)
        }

        // Abort any update if one is not pending when this is called.
        if (!this.isUpdatePending) {
            return
        }

        try {
            // If `update` returns a Promise, we await it. This is done to
            // enable coordinating updates with a scheduler. Note, the result is
            // checked to avoid delaying an additional microtask unless we need to.
            const result = this.update?.()
            if (result instanceof Promise) {
                await result
            }
        } finally {
            // The update is no longer considered pending and further updates are now allowed.
            this.isUpdatePending = false

            if (!this.hasBeenUpdated) {
                this.hasBeenUpdated = true
                this.firstUpdatedCallback?.()
            }

            this.updatedCallback?.()
        }
    }

    /** */
    protected update?(): unknown

    /** */
    protected firstUpdatedCallback?(): unknown

    /** */
    protected updatedCallback?(): unknown
}
