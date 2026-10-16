/**
 * Presentation-side confirmation for `@` reference candidates.
 *
 * Recognition stays purely lexical: `user-text-rules.ts` turns any `@token` into a
 * file or folder candidate from the original text alone, without Facts or discovery,
 * so the parser and the composer's own `@` grammar agree on what a path looks like.
 *
 * Whether such a candidate names something real is a Host question. This module asks
 * the `fileReferences` Remote namespace once per Session and path, remembers the
 * answer, and lets each inline reference render itself as a chip only after the Host
 * confirms it. An unconfirmed candidate keeps the text the user typed, which is what
 * an `@` used as ordinary prose has to look like.
 *
 * Answers the Host already produced for the `@` menu are seeded as confirmed: those
 * rows came from a real listing, so a picked or listed path never waits on a second
 * round trip.
 *
 * @module @deepseek-ai/dsh-client-ui-reference/path-confirmation
 */

import type { UserTextNodeProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Reference shapes the file and folder rules distinguish. */
export type ReferencePathKind = 'file' | 'folder'

/** Session identity the conversation slot hands every inline node. */
export type ReferenceSessionId = UserTextNodeProps<'file'>['sessionId']

/**
 * Ask the Host whether one candidate path names a real entry.
 * @param sessionId - Session whose workspace resolves the path.
 * @param path - decoded path from the candidate, without `@` and without quotes.
 * @param kind - whether the candidate ended in a directory slash.
 * @param signal - aborts the probe when its Session or connection goes away.
 * @returns whether the Host knows this path in that Session's workspace.
 */
export type ReferencePathProbe = (
  sessionId: ReferenceSessionId,
  path: string,
  kind: ReferencePathKind,
  signal: AbortSignal,
) => Promise<boolean>

const answers = new Map<string, boolean>()
const flights = new Map<string, AbortController>()
const listeners = new Set<() => void>()
let probe: ReferencePathProbe | undefined

/** Remove a leading `./` so the composer's spelling and a listing agree. */
function normalizePath(path: string): string {
  return path.startsWith('./') ? path.slice(2) : path
}

function keyOf(sessionId: string, path: string): string {
  return `${sessionId}\u0000${normalizePath(path)}`
}

function notify(): void {
  for (const listener of [...listeners]) listener()
}

/**
 * Install the Host-backed probe; the applying plugin owns it and clears it on disposal.
 * @param next - probe to answer new questions with, or undefined to stop asking.
 */
export function setReferencePathProbe(next: ReferencePathProbe | undefined): void {
  probe = next
}

/** Cancel outstanding probes and forget every remembered answer. */
export function resetReferencePathConfirmation(): void {
  for (const flight of flights.values()) flight.abort()
  flights.clear()
  const had = answers.size > 0
  answers.clear()
  if (had) notify()
}

/**
 * Remember paths the Host itself listed, so they never wait on a confirmation round trip.
 * @param sessionId - Session whose workspace holds these paths.
 * @param paths - decoded paths exactly as the rules spell them (a directory keeps its trailing slash).
 */
export function seedReferencePaths(sessionId: ReferenceSessionId, paths: Iterable<string>): void {
  let changed = false
  for (const path of paths) {
    const key = keyOf(sessionId, path)
    if (answers.get(key) === true) continue
    answers.set(key, true)
    changed = true
  }
  if (changed) notify()
}

/**
 * Read the remembered answer.
 * @param sessionId - Session whose workspace resolves the path.
 * @param path - decoded candidate path.
 * @returns true for a confirmed entry, false for a confirmed absence, undefined while unknown.
 */
export function referencePathAnswer(sessionId: ReferenceSessionId, path: string): boolean | undefined {
  return answers.get(keyOf(sessionId, path))
}

/**
 * Subscribe to answer changes.
 * @param listener - called after any answer is recorded.
 * @returns disposer removing the listener.
 */
export function subscribeReferencePathAnswers(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Ask the installed probe about one candidate once; repeated calls share one flight.
 * A failed or aborted probe records nothing, leaving the candidate as plain text.
 * @param sessionId - Session whose workspace resolves the path.
 * @param path - decoded candidate path.
 * @param kind - whether the candidate ended in a directory slash.
 */
export function confirmReferencePath(sessionId: ReferenceSessionId, path: string, kind: ReferencePathKind): void {
  const key = keyOf(sessionId, path)
  if (answers.has(key) || flights.has(key) || probe === undefined) return
  const flight = new AbortController()
  flights.set(key, flight)
  const normalized = normalizePath(path)
  void probe(sessionId, normalized, kind, flight.signal).then(
    (exists) => {
      if (flights.get(key) !== flight) return
      flights.delete(key)
      answers.set(key, exists)
      notify()
    },
    () => {
      if (flights.get(key) !== flight) return
      flights.delete(key)
    },
  )
}
