export type BrowserSite =
  | 'chatgpt'
  | 'claude'
  | 'gemini'
  | 'perplexity'
  | 'deepseek'

export type BrowserExtensionCaptureExtract = {
  user: string
  assistant: string
}

export type BrowserExtensionCaptureRequest = {
  schema: 1
  sessionToken: string
  eventId: string
  capturedAt: string
  site: BrowserSite
  url: string
  title: string
  tabId: number
  frameId: number
  source: 'browser-extension'
  extract: BrowserExtensionCaptureExtract
  pageState?: {
    streamStable?: boolean
    visibility?: 'visible' | 'hidden' | 'prerender' | 'unknown'
  }
}

export type BrowserBridgeStatus = {
  running: boolean
  port: number | null
  requiresToken: boolean
  connected: boolean
  lastHandshakeAt: number | null
  lastCaptureAt: number | null
}

export type BrowserBridgeHealthResponse = BrowserBridgeStatus & {
  ok: boolean
}

export type BrowserBridgeHandshakeRequest = {
  token: string
  extensionVersion?: string
}

export type BrowserBridgeHandshakeResponse = {
  ok: boolean
  connected: boolean
}

export type BrowserCaptureEnvelope = {
  id: string
  receivedAt: string
  dedupeKey: string
  payload: BrowserExtensionCaptureRequest
}

export type GuideDetectionType = 'url_match' | 'manual_advance'

export type GuideStep = {
  instruction: string
  detection_type: GuideDetectionType
  match_value: string | null
}

export type ExtensionGuidePlanRequest = {
  sessionToken: string
  goal: string
}

export type ExtensionGuidePlanSuccess = {
  ok: true
  steps: GuideStep[]
}

export type ExtensionGuidePlanError = {
  ok: false
  error: string
  detail?: string
}

export type ExtensionGuidePlanResponse = ExtensionGuidePlanSuccess | ExtensionGuidePlanError
