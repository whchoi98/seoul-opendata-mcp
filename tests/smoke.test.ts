import { describe, it, expect } from 'vitest'
import { SERVER_NAME } from '../src/index.js'

describe('scaffold', () => {
  it('exports server name', () => {
    expect(SERVER_NAME).toBe('seoul-opendata-mcp')
  })
})
