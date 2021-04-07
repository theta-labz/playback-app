export const SYNC_TIMER_INTERVAL = 250 // ms
export const PLAYBACK_TIMER_INTERVAL = 250 // ms

export type ConnectionState = 'connecting' | 'connected' | 'disconnected'
export type PairingState = 'pairing' | 'paired'

export type PlaybackState = 'none' | 'paused' | 'playing'
export type PositionState = {
    duration: number
    playbackRate: number
    position: number
}

export const DEFAULT_POSITION_STATE: PositionState = {
    duration: 0,
    playbackRate: 1,
    position: 0,
}

export type CentrifugoConnectionInfo = {
    client: string
    latency: number
    transport: string
}

export type CentrifugoDisconnectionInfo = {
    reason: string
    reconnect: boolean
}

export type DiscoveryMessage = {
    kind: 'discovery'
    role: 'sender' | 'receiver'
    timeStamp: number
}

export type SyncMessage = {
    kind: 'sync'
    delta: number
    timeStamp: number
}

export type StateMessage = {
    kind: 'state'
    playbackState: PlaybackState
    positionState: PositionState
    timeStamp: number
}

export type PlaybackStateMessage = {
    kind: 'playback_state'
    playbackState: PlaybackState
}

export type SeekMessage = {
    kind: 'seek'
    position: number
}

export type SourceMessage = {
    kind: 'source'
    source: string
}

export type Message = DiscoveryMessage | SyncMessage | StateMessage | PlaybackStateMessage | SeekMessage | SourceMessage
