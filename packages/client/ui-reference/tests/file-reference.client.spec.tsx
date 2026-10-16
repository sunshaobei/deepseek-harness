// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { FileReference, FolderReference } from '../src/client/FileReference.tsx'
import {
  resetReferencePathConfirmation, seedReferencePaths, setReferencePathProbe,
} from '../src/client/path-confirmation.ts'
import { en } from '../src/client/locales.ts'

const session = SessionId('file-reference-target')

beforeEach(() => {
  // The Host listed these paths, which is what makes their lexical candidates chips.
  seedReferencePaths(session, ['docs/a b.md', 'docs/'])
})
afterEach(() => {
  cleanup()
  setReferencePathProbe(undefined)
  resetReferencePathConfirmation()
})

type Props = ComponentProps<typeof FileReference>

function props(openFile: Props['openFile']): Props {
  return {
    node: { id: 'file', start: 0, end: 14, data: { path: 'docs/a b.md', label: 'a b.md' } },
    raw: '@"docs/a b.md"', interactive: true, sessionId: session, openFile, t: makeTranslate(en),
  } as Props
}

describe('FileReference', () => {
  it('opens the decoded path and leaves summaries and folders non-interactive', () => {
    const openFile = vi.fn()
    const input = props(openFile)
    const view = render(<FileReference {...input} />)
    fireEvent.click(view.getByRole('button', { name: 'a b.md' }))
    expect(openFile).toHaveBeenCalledWith('docs/a b.md')
    expect(view.queryByRole('dialog')).toBeNull()
    view.rerender(<FileReference {...input} interactive={false} />)
    expect(view.getByText('a b.md').getAttribute('title')).toBe('@"docs/a b.md"')
    expect(view.queryByRole('button')).toBeNull()
    view.rerender(<FolderReference {...input} node={{
      id: 'folder', start: 0, end: 6, data: { path: 'docs/', label: 'docs' },
    }} raw="@docs/" />)
    expect(view.getByText('docs').getAttribute('title')).toBe('@docs/')
    expect(view.queryByRole('button')).toBeNull()
  })

  it('keeps a navigation failure local and retries or closes without losing the reference', () => {
    const openFile = vi.fn()
      .mockImplementationOnce(() => { throw new Error('unavailable') })
      .mockImplementationOnce(() => { throw new Error('still unavailable') })
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => { throw new Error('unavailable again') })
    const view = render(<FileReference {...props(openFile)} />)
    fireEvent.click(view.getByRole('button', { name: 'a b.md' }))
    expect(view.getByRole('dialog', { name: 'Couldn’t open file' }).textContent).toContain('Couldn’t open “docs/a b.md”')
    fireEvent.click(view.getByRole('button', { name: 'Retry' }))
    expect(view.getByRole('dialog')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Retry' }))
    expect(view.queryByRole('dialog')).toBeNull()
    expect(openFile.mock.calls).toEqual([['docs/a b.md'], ['docs/a b.md'], ['docs/a b.md']])
    fireEvent.click(view.getByRole('button', { name: 'a b.md' }))
    fireEvent.click(view.getAllByRole('button', { name: 'Close' }).at(-1)!)
    expect(view.queryByRole('dialog')).toBeNull()
    expect(view.getByRole('button', { name: 'a b.md' })).toBeTruthy()
  })

  it('keeps an unconfirmed file candidate as the text the user typed', () => {
    const input = props(vi.fn())
    const view = render(<FileReference {...input} node={{
      id: 'file', start: 0, end: 6, data: { path: 'ceshi', label: 'ceshi' },
    }} raw="@ceshi" />)
    expect(view.container.textContent).toBe('@ceshi')
    expect(view.container.querySelectorAll('[data-ref-chip]')).toHaveLength(0)
    expect(view.queryByRole('button')).toBeNull()
  })

  it('keeps an unconfirmed folder candidate as the text the user typed', () => {
    const view = render(<FolderReference {...props(vi.fn())} node={{
      id: 'folder', start: 0, end: 15, data: { path: 'ceshi/', label: 'ceshi' },
    }} raw="@ceshi/" />)
    expect(view.container.textContent).toBe('@ceshi/')
    expect(view.container.querySelectorAll('[data-ref-chip]')).toHaveLength(0)
  })

  it('confirms a candidate against the Host and then renders the chip', async () => {
    resetReferencePathConfirmation()
    setReferencePathProbe((_sessionId, path) => Promise.resolve(path === 'docs/a b.md'))
    const input = props(vi.fn())
    const view = render(<FileReference {...input} />)
    expect(view.container.textContent).toBe('@"docs/a b.md"')
    await vi.waitFor(() => { expect(view.getByRole('button', { name: 'a b.md' })).toBeTruthy() })
  })
})
