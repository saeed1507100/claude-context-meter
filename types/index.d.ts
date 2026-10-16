export type Fill = { tokens: number; window: number; percent: number }

export type Slice = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' }

export type Group = { name: string; tokens: number }

export type Breakdown = {
  slices: Slice[]
  deferred: number
  mcpServers: Group[]
  memoryFiles: Group[]
}

export type Level = 'ok' | 'elevated' | 'high'

declare module 'claude-code' {
  interface PluginState {
    'context-meter': {
      fill: Fill | null
      breakdown: Breakdown | null
      fiveHour: number | null
      warnedLevel: Level
      isCompactPending: boolean
      isDismissed: boolean
    }
  }
}
