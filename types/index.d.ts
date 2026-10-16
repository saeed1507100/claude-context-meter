export type Fill = { tokens: number; window: number; percent: number }

export type Slice = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' }

export type Group = { name: string; tokens: number }

export type Breakdown = {
  slices: Slice[]
  deferred: number
  mcpServers: Group[]
  memoryFiles: Group[]
  /** Each MCP tool's wire name to its server, so a call can be credited to the server. */
  mcpToolServer: Record<string, string>
}

export type Level = 'ok' | 'elevated' | 'high'

/** The account's two limit windows, in percent used, with their reset times in epoch ms. */
export type Limits = {
  fiveHour: number | null
  fiveHourResetsAt: number | null
  weekly: number | null
  weeklyResetsAt: number | null
}

/** Whether the session needs its biggest component, judged from what it has used. */
export type Verdict = 'needed' | 'unused' | 'too-early' | 'conversation' | 'fixed' | 'unknown'

export type Biggest = { kind: 'mcp' | 'memory' | 'messages' | 'skills' | 'system'; name: string; tokens: number; share: number; calls: number; verdict: Verdict }

export type Tip = { tone: Exclude<Level, 'ok'>; text: string }

declare module 'claude-code' {
  interface PluginState {
    'context-meter': {
      fill: Fill | null
      breakdown: Breakdown | null
      limits: Limits | null
      turnStartFiveHour: number | null
      lastTurn: number | null
      weeklyToday: number | null
      limitSource: 'live' | 'reply' | null
      warnedLevel: Level
      isCompactPending: boolean
      isDismissed: boolean
      mcpCalls: Record<string, number>
      turns: number
    }
  }
}
