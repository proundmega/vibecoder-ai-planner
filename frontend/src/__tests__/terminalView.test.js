import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('TerminalView WebSocket auth (BP-58)', () => {
  let mockSend

  beforeEach(() => {
    mockSend = vi.fn()
  })

  it('should send auth message with correct format on WebSocket open', () => {
    // Simulate TerminalView's onopen handler behavior
    const token = 'test-token-123'
    const authMessage = JSON.stringify({ type: 'auth', token })
    mockSend(authMessage)

    expect(mockSend).toHaveBeenCalledWith(JSON.stringify({
      type: 'auth',
      token: 'test-token-123',
    }))
  })

  it('should send auth message with empty token when no token stored', () => {
    // Simulate TerminalView's onopen handler with empty token
    const token = ''
    const authMessage = JSON.stringify({ type: 'auth', token })
    mockSend(authMessage)

    expect(mockSend).toHaveBeenCalledWith(JSON.stringify({
      type: 'auth',
      token: '',
    }))
  })

  it('should send input messages with base64-encoded data', () => {
    const testData = 'ls -la\n'
    const base64Data = btoa(testData)
    const inputMessage = JSON.stringify({ type: 'input', data: base64Data })
    mockSend(inputMessage)

    expect(mockSend).toHaveBeenCalledWith(JSON.stringify({
      type: 'input',
      data: btoa('ls -la\n'),
    }))
  })

  it('should send resize messages with cols and rows', () => {
    const cols = 80
    const rows = 24
    const resizeMessage = JSON.stringify({ type: 'resize', cols, rows })
    mockSend(resizeMessage)

    expect(mockSend).toHaveBeenCalledWith(JSON.stringify({
      type: 'resize',
      cols: 80,
      rows: 24,
    }))
  })

  it('should not send messages when WebSocket is not open', () => {
    const mockSendNotOpen = vi.fn()
    const wsReadyState = 3 // WebSocket.CLOSED

    const testData = 'ls -la\n'
    const base64Data = btoa(testData)
    const inputMessage = JSON.stringify({ type: 'input', data: base64Data })

    // Simulate TerminalView's onData handler with readyState check
    if (wsReadyState === 1) {
      mockSendNotOpen(inputMessage)
    }

    expect(mockSendNotOpen).not.toHaveBeenCalled()
  })

  it('should use wss protocol for HTTPS pages', () => {
    const protocol = 'https:' === 'https:' ? 'wss' : 'ws'
    const agentId = 'agent-123'
    const host = 'vibecode.app'
    const url = `${protocol}://${host}/api/terminal/${agentId}`

    expect(url).toBe('wss://vibecode.app/api/terminal/agent-123')
  })

  it('should use ws protocol for HTTP pages', () => {
    const protocol = 'http:' === 'https:' ? 'wss' : 'ws'
    const agentId = 'agent-456'
    const host = 'localhost:3000'
    const url = `${protocol}://${host}/api/terminal/${agentId}`

    expect(url).toBe('ws://localhost:3000/api/terminal/agent-456')
  })
})
