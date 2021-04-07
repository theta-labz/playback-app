import { customElement } from '@lit/reactive-element/decorators/custom-element.js'
import Centrifuge from 'centrifuge'
import { html, render } from 'lit-html'
import * as QRCode from 'qrcode'
import { adoptStyles, css } from 'src/internal/css-tag'
import { ReactiveElement } from 'src/internal/reactive-element'
import * as UUID from 'uuid'
import {
    CentrifugoConnectionInfo,
    CentrifugoDisconnectionInfo,
    ConnectionState,
    DiscoveryMessage,
    Message,
    PairingState,
    PlaybackStateMessage,
    SeekMessage,
    SourceMessage,
    StateMessage,
    SyncMessage,
    SYNC_TIMER_INTERVAL,
} from './constants'

@customElement('playback-receiver')
export class PlaybackReceiverElement extends ReactiveElement {
    static readonly styles = css`
        playback-receiver {
            background-color: hsl(240deg 10% 6%);
            color: hsl(0deg 0% 100%);
            display: grid;
            gap: var(--composition-gap);
            grid: auto / repeat(var(--composition-columns), 1fr);
            padding: var(--composition-margin);
        }

        .playback-receiver__connection-headline,
        .playback-receiver__pairing-headline {
            font-family: ui-sans-serif, system-ui, sans-serif;
            font-size: calc(9rem / 4);
            font-weight: 500;
            grid-column: span 4;
            margin-block: unset;
            place-self: center;
            text-align: center;
        }

        .playback-receiver__pairing-qrcode {
            border: medium solid hsl(0deg 0% 100%);
            border-radius: 1rem;
            place-self: center;
        }

        .playback-receiver__session-display {
            background-color: #000;
            border-radius: 1rem;
            block-size: calc(100vh - 2 * var(--composition-margin));
            clip-path: inset(0 round 1rem);
            inline-size: calc(100vw - 2 * var(--composition-margin));
            grid-column: 1 / -1;
        }

        @media (orientation: landscape) {
            .playback-receiver__pairing-qrcode {
                grid-column: span 5;
            }
        }

        @media (orientation: portrait) {
            .playback-receiver__pairing-qrcode {
                grid-column: span 4;
                min-block-size: calc(100vh - 2 * var(--composition-margin));
            }
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

    protected _timerId?: number
    protected _timeDelta: number = 0

    protected _onConnected(ctx: CentrifugoConnectionInfo) {
        // Set connection info.
        this._connectionState = 'connected'
        this._pairingState = 'pairing'
        this._receiverId = ctx.client
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

        // Request reactive update.
        this.requestUpdate()
    }

    protected _onSubscribe() {}

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
            if ((ctx.data as Message).kind !== 'discovery' || (ctx.data as DiscoveryMessage).role !== 'sender') {
                return
            }

            const timeStamp = performance.timeOrigin + performance.now()

            // Send discovery message.
            const discoveryMessage: DiscoveryMessage = {
                kind: 'discovery',
                role: 'receiver',
                timeStamp,
            }
            this._subscription!.publish(discoveryMessage)

            // Send sync message.
            const syncMessage: SyncMessage = {
                kind: 'sync',
                delta: timeStamp - (ctx.data as DiscoveryMessage).timeStamp,
                timeStamp,
            }
            this._subscription!.publish(syncMessage)

            // Update connection info.
            this._pairingState = 'paired'
            this._senderId = ctx.info!.client!

            // Request reactive update.
            this.requestUpdate()
            return
        }

        if (this._pairingState !== 'paired' || ctx.info?.client !== this._senderId) return

        if ((ctx.data as Message).kind === 'sync') {
            this._stopTimer()

            const timeStamp = performance.timeOrigin + performance.now()
            const delta = timeStamp - (ctx.data as SyncMessage).timeStamp

            this._timeDelta = ((ctx.data as SyncMessage).delta + delta) / 2

            this._startTimer()
            return
        }

        if ((ctx.data as Message).kind === 'playback_state') {
            const video = this.querySelector<HTMLMediaElement>('.playback-receiver__session-display')
            if (!video) return

            if ((ctx.data as PlaybackStateMessage).playbackState === 'paused' && !video.paused) {
                video.pause()
            }

            if ((ctx.data as PlaybackStateMessage).playbackState === 'playing' && video.paused) {
                video.play()
            }

            return
        }

        if ((ctx.data as Message).kind === 'seek') {
            const video = this.querySelector<HTMLMediaElement>('.playback-receiver__session-display')
            if (!video) return
            video.currentTime = (ctx.data as SeekMessage).position
            return
        }

        if ((ctx.data as Message).kind === 'source') {
            const video = this.querySelector<HTMLMediaElement>('.playback-receiver__session-display')
            if (!video) return
            video.src = (ctx.data as SourceMessage).source
            return
        }
    }

    protected _startTimer() {
        this._timerId = (setTimeout(this._onTimer.bind(this), SYNC_TIMER_INTERVAL) as unknown) as number
    }

    protected _stopTimer() {
        if (this._timerId == null) return
        clearTimeout(this._timerId)
    }

    protected _onTimer() {
        this._startTimer()

        // Send sync message.
        const syncMessage: SyncMessage = {
            kind: 'sync',
            delta: this._timeDelta,
            timeStamp: performance.timeOrigin + performance.now(),
        }
        this._subscription!.publish(syncMessage)
    }

    protected _sendState() {
        if (this._pairingState !== 'paired') return

        const video = this.querySelector<HTMLMediaElement>('.playback-receiver__session-display')
        if (!video) return

        const message: StateMessage = {
            kind: 'state',
            playbackState: video.paused ? 'paused' : 'playing',
            positionState: {
                duration: video.duration,
                playbackRate: video.playbackRate,
                position: video.currentTime,
            },
            timeStamp: performance.timeOrigin + performance.now(),
        }
        this._subscription?.publish(message)
    }

    protected _onDurationChange() {
        this._sendState()
    }

    protected _onRateChange() {
        this._sendState()
    }

    protected _onTimeUpdate() {
        // this._sendState()
    }

    protected _onEmptied() {
        this._sendState()
    }

    protected _onSeekEnd() {
        this._sendState()
    }

    protected _onPlay() {
        this._sendState()
    }

    protected _onPause() {
        this._sendState()
    }

    constructor() {
        super()
        this._connection.setToken(import.meta.env.SNOWPACK_PUBLIC_CENTRIFUGO_TOKEN)
        this._connection.on('connect', this._onConnected.bind(this))
        this._connection.on('disconnect', this._onDisconnected.bind(this))
    }

    protected connectedCallback() {
        adoptStyles(this.ownerDocument, (this.constructor as typeof PlaybackReceiverElement).styles)

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
            return html`<h1 class="playback-receiver__connection-headline">Disconnected</h1>`
        }

        if (this._connectionState === 'connecting') {
            return html`<h1 class="playback-receiver__connection-headline">Connecting to Centrifugo...</h1>`
        }

        if (this._connectionState !== 'connected') {
            return
        }

        if (this._pairingState === 'pairing') {
            return html`
                <h1 class="playback-receiver__pairing-headline">Scan the QR code to continue</h1>
                <canvas class="playback-receiver__pairing-qrcode"></canvas>
            `
        }

        if (this._pairingState !== 'paired') {
            return
        }

        return html`<video
            @durationchange="${this._onDurationChange}"
            @ratechange="${this._onRateChange}"
            @timeupdate="${this._onTimeUpdate}"
            @seeked="${this._onSeekEnd}"
            @play="${this._onPlay}"
            @pause="${this._onPause}"
            @emptied="${this._onEmptied}"
            class="playback-receiver__session-display"
            controls
        ></video>`
    }

    protected update() {
        render(this.template, this, { host: this })
    }

    protected updatedCallback() {
        if (this._connectionState !== 'connected' || this._pairingState !== 'pairing') return

        const canvas = this.querySelector('.playback-receiver__pairing-qrcode')
        if (!canvas) return

        const url = new URL('/sender', location.href)
        url.searchParams.set('channel', this._channel)

        QRCode.toCanvas(canvas, url.toString(), {
            errorCorrectionLevel: 'high',
            color: {
                dark: '#fff',
                light: '#0e0e11',
            },
            scale: 8,
        })
    }
}
