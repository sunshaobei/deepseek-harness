/**
 * Path confirmation coverage: the Host probe answers once per Session and path,
 * Host-listed paths never probe, failures stay unconfirmed, and reset aborts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  confirmReferencePath, referencePathAnswer, resetReferencePathConfirmation,
  seedReferencePaths, setReferencePathProbe, subscribeReferencePathAnswers,
} from '../src/client/path-confirmation.ts'

const session = SessionId('confirmation-target')
const other = SessionId('confirmation-other')

afterEach(() => {
  setReferencePathProbe(undefined)
  resetReferencePathConfirmation()
})

describe('reference path confirmation', () => {
  it('asks the Host once per Session and path and remembers a confirmed entry', async () => {
    const probe = vi.fn(() => Promise.resolve(true))
    setReferencePathProbe(probe)
    confirmReferencePath(session, 'src/a.ts', 'file')
    confirmReferencePath(session, 'src/a.ts', 'file')
    expect(referencePathAnswer(session, 'src/a.ts')).toBeUndefined()
    expect(probe).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => { expect(referencePathAnswer(session, 'src/a.ts')).toBe(true) })
    confirmReferencePath(session, 'src/a.ts', 'file')
    expect(probe).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledWith(session, 'src/a.ts', 'file', expect.any(AbortSignal))
  })

  it('remembers an absent path as a negative answer, per Session', async () => {
    setReferencePathProbe(() => Promise.resolve(false))
    confirmReferencePath(session, 'ceshi', 'file')
    confirmReferencePath(other, 'ceshi', 'file')
    await vi.waitFor(() => { expect(referencePathAnswer(session, 'ceshi')).toBe(false) })
    await vi.waitFor(() => { expect(referencePathAnswer(other, 'ceshi')).toBe(false) })
    expect(referencePathAnswer(session, 'a-different-path')).toBeUndefined()
  })

  it('keeps a directory candidate separate from the file spelling it shares a prefix with', async () => {
    setReferencePathProbe(() => Promise.resolve(true))
    confirmReferencePath(session, 'dir/', 'folder')
    await vi.waitFor(() => { expect(referencePathAnswer(session, 'dir/')).toBe(true) })
    expect(referencePathAnswer(session, 'dir/')).toBe(true)
    expect(referencePathAnswer(session, 'dir')).toBeUndefined()
  })

  it('trusts paths the Host already listed without probing them again', () => {
    const probe = vi.fn(() => Promise.resolve(false))
    setReferencePathProbe(probe)
    seedReferencePaths(session, ['src/a.ts', 'docs/'])
    expect(referencePathAnswer(session, 'src/a.ts')).toBe(true)
    expect(referencePathAnswer(session, 'docs/')).toBe(true)
    confirmReferencePath(session, 'src/a.ts', 'file')
    confirmReferencePath(session, 'docs/', 'folder')
    expect(probe).not.toHaveBeenCalled()
  })

  it('matches a seeded path with the ordinary ./ spelling', () => {
    seedReferencePaths(session, ['./src/a.ts'])
    expect(referencePathAnswer(session, 'src/a.ts')).toBe(true)
    expect(referencePathAnswer(session, './src/a.ts')).toBe(true)
  })

  it('notifies subscribers once when an answer lands', async () => {
    setReferencePathProbe(() => Promise.resolve(true))
    const listener = vi.fn()
    const unsubscribe = subscribeReferencePathAnswers(listener)
    confirmReferencePath(session, 'src/a.ts', 'file')
    await vi.waitFor(() => { expect(listener).toHaveBeenCalledTimes(1) })
    unsubscribe()
    confirmReferencePath(session, 'src/b.ts', 'file')
    await vi.waitFor(() => { expect(referencePathAnswer(session, 'src/b.ts')).toBe(true) })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('leaves a failed probe unconfirmed so the token keeps its text', async () => {
    const probe = vi.fn(() => Promise.reject(new Error('host unavailable')))
    setReferencePathProbe(probe)
    confirmReferencePath(session, 'ceshi', 'file')
    await vi.waitFor(() => { expect(probe).toHaveBeenCalledTimes(1) })
    await Promise.resolve()
    expect(referencePathAnswer(session, 'ceshi')).toBeUndefined()
  })

  it('does nothing without an installed probe and aborts outstanding flights on reset', async () => {
    confirmReferencePath(session, 'ceshi', 'file')
    expect(referencePathAnswer(session, 'ceshi')).toBeUndefined()
    const signals: AbortSignal[] = []
    setReferencePathProbe((_sessionId, _path, _kind, signal) => {
      signals.push(signal)
      return new Promise<boolean>(() => undefined)
    })
    confirmReferencePath(session, 'src/a.ts', 'file')
    seedReferencePaths(session, ['src/b.ts'])
    expect(signals).toHaveLength(1)
    resetReferencePathConfirmation()
    expect(signals[0]?.aborted).toBe(true)
    expect(referencePathAnswer(session, 'src/a.ts')).toBeUndefined()
    expect(referencePathAnswer(session, 'src/b.ts')).toBeUndefined()
  })
})
