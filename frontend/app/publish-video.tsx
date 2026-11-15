'use client'

import { Globe2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { getSessionId } from '@/lib/lesson-api'
import { topics } from './discovery'

export default function PublishVideo({ jobId }: { jobId: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [topic, setTopic] = useState<string>(topics[0])
  const [published, setPublished] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState('')

  async function publication(value?: string | null) {
    setBusy(true)
    setFailed(false)
    try {
      const response = await fetch('/api/discovery/publication', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, sessionId: getSessionId(), topic: value }),
      })
      if (!response.ok) throw new Error('Publication unavailable')
      const result = await response.json() as { topic: string | null }
      setPublished(result.topic !== null)
      if (result.topic) setTopic(result.topic)
      if (value !== undefined) {
        setNotice(value === null ? 'Video removed from Library.' : 'Video published to Library.')
        dialog.current?.close()
      }
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return <>
    <button className='rail-button' type='button' aria-label='Publish video to Library'
      onClick={() => { dialog.current?.showModal(); void publication() }}>
      <Globe2 size={20} />
    </button>
    <span className='sr-only' role='status'>{notice}</span>
    <dialog ref={dialog} className='publish-dialog' aria-labelledby='publish-video-title'>
      <form onSubmit={event => { event.preventDefault(); void publication(topic) }}>
        <h2 id='publish-video-title'>Publish to Library</h2>
        <p>Anyone can watch the video and see its title. Review the video before sharing it.</p>
        <label>Topic <select value={topic} onChange={event => setTopic(event.target.value)} disabled={busy}>
          {topics.map(value => <option key={value}>{value}</option>)}
        </select></label>
        {failed && <p role='alert'>Could not update the publication. Check that this video was created in this browser and try again.</p>}
        {busy && <p role='status'>Updating…</p>}
        <div className='publish-actions'>
          <button className='secondary' type='button' onClick={() => dialog.current?.close()}>Close</button>
          {published && <button className='secondary' type='button' disabled={busy} onClick={() => void publication(null)}>Unpublish</button>}
          <button className='primary' type='submit' disabled={busy}>{published ? 'Update topic' : 'Publish video'}</button>
        </div>
      </form>
    </dialog>
  </>
}
