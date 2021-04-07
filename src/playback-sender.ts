import { customElement } from '@lit/reactive-element/decorators/custom-element.js'
import Centrifuge from 'centrifuge'
import { html, render } from 'lit-html'
import { adoptStyles, css } from 'src/internal/css-tag'
import { ReactiveElement } from 'src/internal/reactive-element'
import * as UUID from 'uuid'
import {
    CentrifugoConnectionInfo,
    CentrifugoDisconnectionInfo,
    ConnectionState,
    DEFAULT_POSITION_STATE,
    DiscoveryMessage,
    Message,
    PairingState,
    PlaybackState,
    PlaybackStateMessage,
    PLAYBACK_TIMER_INTERVAL,
    SeekMessage,
    SourceMessage,
    StateMessage,
    SyncMessage,
} from './constants'

@customElement('playback-sender')
export class PlaybackSenderElement extends ReactiveElement {
    static readonly styles = css`
        playback-sender {
            background-color: hsl(240deg 10% 6%);
            color: hsl(0deg 0% 100%);
            display: grid;
            gap: var(--composition-gap);
            place-content: center;
            place-items: center;
        }

        playback-sender div {
            display: grid;
            gap: var(--composition-gap);
            grid: auto / auto-flow;
        }

        playback-sender button {
            background-color: hsl(0deg 0% 100% / 25%);
            border-style: unset;
            border-radius: 1rem;
            display: flex;
            fill: hsl(0deg 0% 100% / 96%);
            padding: 0.625rem;
            transition: 200ms cubic-bezier(0.19, 1, 0.22, 1);
        }

        playback-sender button:enabled:focus {
            outline-style: unset;
        }

        playback-sender button:enabled {
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
        }

        playback-sender button:enabled:is(:hover, :focus-visible) {
            background-color: hsl(0deg 0% 100% / 35%);
            border-style: unset;
            border-radius: 1rem;
            display: flex;
            fill: hsl(0deg 0% 100% / 96%);
            padding: 0.625rem;
        }

        playback-sender button:enabled:is(:hover, :focus-visible):active {
            opacity: 0.6;
        }
    `

    protected readonly _connection = new Centrifuge(import.meta.env.SNOWPACK_PUBLIC_CENTRIFUGO_WEBSOCKET)
    protected _subscription?: Centrifuge.Subscription

    protected _connectionState: ConnectionState = 'disconnected'
    protected _pairingState: PairingState = 'pairing'
    protected _receiverId: string = ''
    protected _senderId: string = ''
    protected _latency: number = 0

    protected readonly _channel = new URL(location.href).searchParams.get('channel') ?? UUID.v4()

    protected _playbackState: PlaybackState = 'none'
    protected _positionState = DEFAULT_POSITION_STATE
    protected _timeStamp: number = 0

    protected _timerId?: number

    protected _timeDelta: number = 0

    protected _onConnected(ctx: CentrifugoConnectionInfo) {
        // Set connection info.
        this._connectionState = 'connected'
        this._pairingState = 'pairing'
        this._senderId = ctx.client
        this._latency = ctx.latency

        // Request reactive update.
        this.requestUpdate()

        // Subscribe to session channel.
        this._subscription = this._connection.subscribe(`playback_${this._channel}`, {
            publish: this._onReceive.bind(this),
            subscribe: this._onSubscribe.bind(this),
            unsubscribe: this._onUnsubscribe.bind(this),
            error: this._onUnsubscribe.bind(this),
        })
    }

    protected _onDisconnected(_: CentrifugoDisconnectionInfo) {
        // Reset connection info.
        this._connectionState = 'disconnected'
        this._pairingState = 'pairing'
        this._receiverId = ''
        this._senderId = ''
        this._latency = 0

        // Reset internal state.
        this._playbackState = 'none'
        this._positionState = DEFAULT_POSITION_STATE
        this._timeStamp = 0
        this._timeDelta = 0

        // Request reactive update.
        this.requestUpdate()
    }

    protected _onSubscribe() {
        // Send discovery message.
        const message: DiscoveryMessage = {
            kind: 'discovery',
            role: 'sender',
            timeStamp: performance.timeOrigin + performance.now(),
        }
        this._subscription!.publish(message)
    }

    protected _onUnsubscribe() {
        // Reset subscription to session channel.
        this._subscription = undefined

        // Reset connection.
        if (this._connectionState !== 'disconnected') {
            this._connection.disconnect()
        }
    }

    protected _onReceive(ctx: Centrifuge.PublicationContext) {
        if (this._pairingState === 'pairing') {
            if ((ctx.data as Message).kind !== 'discovery' || (ctx.data as DiscoveryMessage).role !== 'receiver') {
                return
            }

            // Update connection info.
            this._pairingState = 'paired'
            this._receiverId = ctx.info!.client!

            // Request reactive update.
            this.requestUpdate()
            return
        }

        if (this._pairingState !== 'paired' || ctx.info?.client !== this._receiverId) return

        if ((ctx.data as Message).kind === 'sync') {
            const timeStamp = performance.timeOrigin + performance.now()
            const delta = timeStamp - (ctx.data as SyncMessage).timeStamp

            this._timeDelta = ((ctx.data as SyncMessage).delta + delta) / 2

            // Send sync message.
            const syncMessage: SyncMessage = {
                kind: 'sync',
                delta: this._timeDelta,
                timeStamp,
            }
            this._subscription!.publish(syncMessage)
            return
        }

        if ((ctx.data as Message).kind === 'state') {
            // Stop compute timer.
            this._stopTimer()

            const timeStamp = performance.timeOrigin + performance.now()
            const delta = timeStamp - (ctx.data as StateMessage).timeStamp

            // Update internal state.
            this._playbackState = (ctx.data as StateMessage).playbackState
            this._positionState = (ctx.data as StateMessage).positionState
            this._timeStamp =
                (ctx.data as StateMessage).timeStamp - performance.timeOrigin + this._latency + this._timeDelta + delta

            // Start compute timer.
            this._startTimer()

            // Request reactive update.
            this.requestUpdate()
            return
        }
    }

    protected _startTimer() {
        if (this._playbackState !== 'playing') return
        this._timerId = (setTimeout(this._onTimer.bind(this), PLAYBACK_TIMER_INTERVAL) as unknown) as number
    }

    protected _stopTimer() {
        if (this._timerId == null) return
        clearTimeout(this._timerId)
    }

    protected _onTimer() {
        this._startTimer()

        const timeStamp = performance.now()
        const delta = timeStamp - this._timeStamp

        // Update internal state.
        this._positionState.position += (delta * this._positionState.playbackRate) / 1000
        this._timeStamp = timeStamp

        // Request reactive update.
        this.requestUpdate()
    }

    constructor() {
        super()
        this._connection.setToken(import.meta.env.SNOWPACK_PUBLIC_CENTRIFUGO_TOKEN)
        this._connection.on('connect', this._onConnected.bind(this))
        this._connection.on('disconnect', this._onDisconnected.bind(this))
    }

    protected connectedCallback() {
        adoptStyles(this.ownerDocument, (this.constructor as typeof PlaybackSenderElement).styles)

        // Update connection state.
        this._connectionState = 'connecting'
        this._connection.connect()

        super.connectedCallback()
    }

    protected disconnectedCallback() {
        this._connection.disconnect()
    }

    get template() {
        if (this._connectionState === 'disconnected') {
            return html`<h1>Disconnected</h1>`
        }

        if (this._connectionState === 'connecting') {
            return html`<h1>Connecting to Centrifugo...</h1>`
        }

        if (this._connectionState !== 'connected') {
            return
        }

        if (this._pairingState === 'pairing') {
            return html`<h1>Pairing...</h1>`
        }

        if (this._pairingState !== 'paired') {
            return
        }

        return html`
            <h1>Paired</h1>
            <time
                >${this._formatRelativeTime(Math.min(this._positionState.position, this._positionState.duration))} /
                ${this._formatRelativeTime(this._positionState.duration)}</time
            >
            <div>
                <button @click="${this._onSeekBackwardClick}">
                    <svg viewBox="0 0 24 24" height="24" width="24">
                        <path
                            d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8zm-1.1 11h-.85v-3.26l-1.01.31v-.69l1.77-.63h.09V16zm4.28-1.76c0 .32-.03.6-.1.82s-.17.42-.29.57-.28.26-.45.33-.37.1-.59.1-.41-.03-.59-.1-.33-.18-.46-.33-.23-.34-.3-.57-.11-.5-.11-.82v-.74c0-.32.03-.6.1-.82s.17-.42.29-.57.28-.26.45-.33.37-.1.59-.1.41.03.59.1.33.18.46.33.23.34.3.57.11.5.11.82v.74zm-.85-.86c0-.19-.01-.35-.04-.48s-.07-.23-.12-.31-.11-.14-.19-.17-.16-.05-.25-.05-.18.02-.25.05-.14.09-.19.17-.09.18-.12.31-.04.29-.04.48v.97c0 .19.01.35.04.48s.07.24.12.32.11.14.19.17.16.05.25.05.18-.02.25-.05.14-.09.19-.17.09-.19.11-.32.04-.29.04-.48v-.97z"
                        />
                    </svg>
                </button>
                <button @click="${this._onPlayPauseClick}">
                    <svg viewBox="0 0 24 24" height="24" width="24">
                        <path
                            d="${this._playbackState === 'paused'
                                ? 'M10 8.64L15.27 12 10 15.36V8.64M8 5v14l11-7L8 5z'
                                : 'M6 19h4V5H6v14zm8-14v14h4V5h-4z'}"
                        />
                    </svg>
                </button>
                <button @click="${this._onSeekForwardClick}">
                    <svg viewBox="0 0 24 24" height="24" width="24">
                        <path
                            d="M18,13c0,3.31-2.69,6-6,6s-6-2.69-6-6s2.69-6,6-6v4l5-5l-5-5v4c-4.42,0-8,3.58-8,8c0,4.42,3.58,8,8,8s8-3.58,8-8H18zM14.32,11.78c-0.18-0.07-0.37-0.1-0.59-0.1s-0.41,0.03-0.59,0.1s-0.33,0.18-0.45,0.33s-0.23,0.34-0.29,0.57 s-0.1,0.5-0.1,0.82v0.74c0,0.32,0.04,0.6,0.11,0.82s0.17,0.42,0.3,0.57s0.28,0.26,0.46,0.33s0.37,0.1,0.59,0.1s0.41-0.03,0.59-0.1 s0.33-0.18,0.45-0.33s0.22-0.34,0.29-0.57s0.1-0.5,0.1-0.82V13.5c0-0.32-0.04-0.6-0.11-0.82s-0.17-0.42-0.3-0.57 S14.49,11.85,14.32,11.78z M14.33,14.35c0,0.19-0.01,0.35-0.04,0.48s-0.06,0.24-0.11,0.32s-0.11,0.14-0.19,0.17 s-0.16,0.05-0.25,0.05s-0.18-0.02-0.25-0.05s-0.14-0.09-0.19-0.17s-0.09-0.19-0.12-0.32s-0.04-0.29-0.04-0.48v-0.97 c0-0.19,0.01-0.35,0.04-0.48s0.06-0.23,0.12-0.31s0.11-0.14,0.19-0.17s0.16-0.05,0.25-0.05s0.18,0.02,0.25,0.05 s0.14,0.09,0.19,0.17s0.09,0.18,0.12,0.31s0.04,0.29,0.04,0.48V14.35z"
                        />
                        <polygon points="10.9,16 10.9,11.73 10.81,11.73 9.04,12.36 9.04,13.05 10.05,12.74 10.05,16" />
                    </svg>
                </button>
            </div>
            <div>
                <button @click="${this._onLoadVideoClick}">
                    <svg viewBox="0 0 24 24" height="24" width="24">
                        <path
                            d="M4 6.47L5.76 10H20v8H4V6.47M22 4h-4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4z"
                        />
                    </svg>
                </button>
                <button @click="${this._onLoadMusicClick}">
                    <svg viewBox="0 0 24 24" height="24" width="24">
                        <path
                            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-12.5c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 5.5c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"
                        />
                    </svg>
                </button>
            </div>
        `
    }

    protected _onPlayPauseClick() {
        if (this._pairingState !== 'paired') return

        const message: PlaybackStateMessage = {
            kind: 'playback_state',
            playbackState: this._playbackState === 'playing' ? 'paused' : 'playing',
        }
        this._subscription?.publish(message)
    }

    protected _onSeekBackwardClick() {
        if (this._pairingState !== 'paired') return

        const timeStamp = performance.now()
        const delta = (timeStamp - this._timeStamp) / 1000
        const currentTime =
            this._positionState.position +
            (this._playbackState !== 'playing' ? 0 : this._positionState.playbackRate * delta)

        const message: SeekMessage = {
            kind: 'seek',
            position: currentTime - 10,
        }
        this._subscription?.publish(message)
    }

    protected _onSeekForwardClick() {
        if (this._pairingState !== 'paired') return

        const timeStamp = performance.now()
        const delta = (timeStamp - this._timeStamp) / 1000
        const currentTime =
            this._positionState.position +
            (this._playbackState !== 'playing' ? 0 : this._positionState.playbackRate * delta)

        const message: SeekMessage = {
            kind: 'seek',
            position: currentTime + 10,
        }
        this._subscription?.publish(message)
    }

    protected _onLoadVideoClick() {
        if (this._pairingState !== 'paired') return

        const message: SourceMessage = {
            kind: 'source',
            source: import.meta.env.SNOWPACK_PUBLIC_VIDEO_SOURCE,
        }
        this._subscription?.publish(message)
    }

    protected _onLoadMusicClick() {
        if (this._pairingState !== 'paired') return

        const message: SourceMessage = {
            kind: 'source',
            source: import.meta.env.SNOWPACK_PUBLIC_AUDIO_SOURCE,
        }
        this._subscription?.publish(message)
    }

    protected update() {
        render(this.template, this, { host: this })
    }

    protected _formatRelativeTime(time: number) {
        const seconds = Math.floor(Math.abs(time))
        const minutes = Math.floor(seconds / 60)
        const hours = Math.floor(minutes / 60)

        return hours
            ? `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
            : `${minutes}:${String(seconds % 60).padStart(2, '0')}`
    }
}
