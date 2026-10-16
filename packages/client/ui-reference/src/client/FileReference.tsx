/** File navigation feedback belongs to the individual inline reference that requested it. */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { UserTextNodeProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Modal, ReferenceChip, UserTextRun } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  confirmReferencePath, referencePathAnswer, subscribeReferencePathAnswers,
  type ReferencePathKind, type ReferenceSessionId,
} from './path-confirmation.ts'
import type { NS } from './locales.ts'
import type {} from './user-text-rules.ts'

/** Session-authorized synchronous navigation; document reading belongs to the preview host. */
export interface FileReferenceInjected {
  /**
   * Open or reveal a file in the current Sidebar using the originating Session's authority.
   * @param path - decoded path from the reference.
   * @throws if navigation fails; the reference keeps a local retry/close dialog.
   */
  readonly openFile: (path: string) => void
}

type FileReferenceProps = UserTextNodeProps<'file'> & InjectFace<FileReferenceInjected> & PropsLocale<typeof NS>

/**
 * Render one lexical candidate as a reference only once the Host confirms the path.
 *
 * The rule that produced this node matched the token from text alone, so an `@name`
 * that names nothing has to stay the prose the user wrote. Until the Host answers,
 * and forever after a negative answer, this renders its original spelling.
 * @param props - JSON node, interaction policy, Session-authorized navigation, and locale seat.
 * @returns the confirmed reference chip, its failure dialog, or the original text.
 */
export function FileReference({ node, raw, interactive, sessionId, openFile, t }: FileReferenceProps) {
  const [failedPath, setFailedPath] = useState<string | null>(null)
  const { path, label } = node.data
  const confirmed = useConfirmedReference(sessionId, path, 'file')
  const close = () => { setFailedPath(null) }
  const open = () => {
    try {
      openFile(path)
    } catch {
      setFailedPath(path)
      return
    }
    setFailedPath(null)
  }
  if (!confirmed) return <UserTextRun text={raw} />
  return <>
    <ReferenceChip appearance="file" label={label} title={raw} {...interactive ? { onActivate: open } : {}} />
    {interactive && failedPath === path && <Modal
      open
      onClose={close}
      closeLabel={t('fileOpen.close')}
      title={t('fileOpen.title')}
      description={t('fileOpen.failed', { path })}
      footer={<>
        <Button variant="outline" onClick={close}>{t('fileOpen.close')}</Button>
        <Button variant="primary" onClick={open}>{t('fileOpen.retry')}</Button>
      </>}
    />}
  </>
}

/**
 * Render a directory as a label, even when the containing text permits file navigation.
 * A directory candidate is recognized lexically too, so it renders its original text
 * until the Host confirms the trailing-slash path names a real directory.
 * @param props - resolved directory data and the original reference spelling.
 * @returns an inline non-interactive chip, or the original text while unconfirmed.
 */
export function FolderReference({ node, raw, sessionId }: UserTextNodeProps<'folder'>) {
  const confirmed = useConfirmedReference(sessionId, node.data.path, 'folder')
  if (!confirmed) return <UserTextRun text={raw} />
  return <ReferenceChip appearance="folder" label={node.data.label} title={raw} />
}

/**
 * Follow one candidate's Host answer and ask for it once its owner mounts.
 * @param sessionId - Session whose workspace resolves the path.
 * @param path - decoded candidate path.
 * @param kind - whether the candidate ended in a directory slash.
 * @returns whether the Host confirmed the path.
 */
function useConfirmedReference(sessionId: ReferenceSessionId, path: string, kind: ReferencePathKind): boolean {
  const answer = useSyncExternalStore(
    subscribeReferencePathAnswers,
    () => referencePathAnswer(sessionId, path),
  )
  useEffect(() => { confirmReferencePath(sessionId, path, kind) }, [sessionId, path, kind])
  return answer === true
}
