'use client'

import { ArrowDown, ArrowUp, Bookmark, Clapperboard, Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import seedVideos from '@/lib/discovery-seeds.json'

export const topics = ['AI', 'DevOps', 'Productivity', 'Communication', 'Design'] as const
type Topic = typeof topics[number]
type Video = { id: string; title: string; topic: string; video: string; poster?: string; description?: string; publishedAt?: number }
const bookmarkKey = 'scrolled-discovery-saved'
const preferenceKey = 'scrolled-discovery-preferences'

function readList<T>(key: string): T[] {
  try {
    const list = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export default function Discovery({ mode }: { mode: 'library' | 'saved' }) {
  const [published, setPublished] = useState<Video[]>([])
  const [bookmarks, setBookmarks] = useState<Video[]>([])
  const [interests, setInterests] = useState<Topic[]>([])
  const [topic, setTopic] = useState<Topic | 'For you'>('For you')
  const [query, setQuery] = useState('')
  const [settings, setSettings] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [active, setActive] = useState<Video | null>(null)
  const [playbackError, setPlaybackError] = useState('')
  const [notice, setNotice] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const playbackRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    setBookmarks(readList<Video>(bookmarkKey))
    setInterests(readList<Topic>(preferenceKey))
    return () => playbackRequest.current?.abort()
  }, [])

  useEffect(() => {
    if (mode !== 'library') return
    const request = new AbortController()
    setLoadError(false)
    void fetch('/api/discovery', { cache: 'no-store', signal: request.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Catalog unavailable')
        setPublished(await response.json() as Video[])
      })
      .catch(() => { if (!request.signal.aborted) setLoadError(true) })
    return () => request.abort()
  }, [mode])

  const items = useMemo(() => {
    if (mode === 'saved') return bookmarks
    const words = query.toLocaleLowerCase().trim().split(/\s+/)
    return [...published, ...seedVideos]
      .filter(item => {
        const text = [item.title, item.topic, item.description].join(' ').toLocaleLowerCase()
        return (topic === 'For you' || item.topic === topic) && words.every(word => text.includes(word))
      })
      .sort((left, right) =>
        Number(interests.includes(right.topic as Topic)) - Number(interests.includes(left.topic as Topic)))
  }, [bookmarks, interests, mode, published, query, topic])

  const index = items.findIndex(item => item.id === active?.id)
  const isSaved = active !== null && bookmarks.some(item => item.id === active.id)

  function changeInterest(value: Topic) {
    const next = interests.includes(value) ? interests.filter(item => item !== value) : [...interests, value]
    setInterests(next)
    try { localStorage.setItem(preferenceKey, JSON.stringify(next)) }
    catch { setNotice('Preferences could not be stored in this browser.') }
  }

  function toggleBookmark(video: Video) {
    const stored = readList<Video>(bookmarkKey)
    const saved = stored.some(item => item.id === video.id)
    const bookmark = video.publishedAt ? { ...video, video: '' } : video
    const next = saved ? stored.filter(item => item.id !== video.id) : [bookmark, ...stored]
    try {
      localStorage.setItem(bookmarkKey, JSON.stringify(next))
      setBookmarks(next)
      setNotice(saved ? 'Video removed from Saved.' : 'Video added to Saved.')
    } catch { setNotice('Could not save the video in this browser.') }
  }

  function openVideo(video: Video, button?: HTMLElement) {
    if (!dialog.current) return
    playbackRequest.current?.abort()
    if (button) trigger.current = button
    setActive(video)
    setPlaybackError('')
    if (!dialog.current.open) dialog.current.showModal()
    if (mode !== 'saved' || !video.publishedAt) return
    const request = new AbortController()
    playbackRequest.current = request
    setActive({ ...video, video: '' })
    void fetch('/api/discovery/' + encodeURIComponent(video.id), { cache: 'no-store', signal: request.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Video unavailable')
        const publishedVideo = await response.json() as Video
        if (!request.signal.aborted) setActive(publishedVideo)
      })
      .catch(() => {
        if (!request.signal.aborted) setPlaybackError('This community video is unavailable.')
      })
  }

  function moveVideo(offset: number) {
    const next = index < 0 ? undefined : items[index + offset]
    if (next) openVideo(next)
  }

  return (
    <section aria-label={mode === 'library' ? 'Discover videos' : 'Bookmarked videos'}>
      <span className='sr-only' role='status'>{notice}</span>
      {mode === 'library' && <>
        <label className='discovery-search'>
          <Search size={20} aria-hidden='true' />
          <input type='search' placeholder='Search videos and topics' aria-label='Search videos and topics' value={query}
            onChange={event => setQuery(event.target.value)} />
        </label>
        <div className='discovery-filters' aria-label='Video topics'>
          <button type='button' className='topic-chip' aria-expanded={settings} aria-controls='recommendation-settings'
            aria-label='Recommendation settings' onClick={() => setSettings(!settings)}>
            <SlidersHorizontal size={18} />
          </button>
          {(['For you', ...topics] as const).map(value => (
            <button type='button' className='topic-chip' key={value} aria-pressed={topic === value}
              onClick={() => setTopic(value)}>{value}</button>
          ))}
        </div>
        {settings && <div className='discovery-preferences' id='recommendation-settings'>
          <strong>Show me more of</strong>
          <div className='discovery-filters'>
            {topics.map(value => <button type='button' className='topic-chip' key={value}
              aria-pressed={interests.includes(value)} onClick={() => changeInterest(value)}>{value}</button>)}
          </div>
          <p>Your selected topics appear first in For you.</p>
        </div>}
        {loadError && <p role='status'>Community videos are temporarily unavailable.</p>}
      </>}
      {mode === 'saved' && items.length > 0 && <h2 className='saved-section-title'>Bookmarked videos</h2>}
      {items.length ? (
        <ul className='discovery-grid'>
          {items.map(item => (
            <li key={item.id}>
              <button type='button' className='discovery-card' onClick={event => openVideo(item, event.currentTarget)}>
                {item.poster
                  ? <img src={item.poster} alt='' loading='lazy' />
                  : item.video && <video src={item.video + '#t=0.1'} muted playsInline preload='metadata' aria-hidden='true' />}
                <Clapperboard className='discovery-card-icon' size={17} aria-hidden='true' />
                <span className='discovery-card-caption'><small>{item.topic}</small><strong>{item.title}</strong></span>
              </button>
            </li>
          ))}
        </ul>
      ) : mode === 'library' ? <p className='empty-library' role='status'>No videos match your search.</p> : null}
      <dialog className='discovery-viewer' aria-label='Video player' ref={dialog}
        onClose={() => {
          playbackRequest.current?.abort()
          setActive(null)
          trigger.current?.focus()
        }}
        onKeyDown={event => {
          if (event.target instanceof HTMLVideoElement) return
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            moveVideo(event.key === 'ArrowUp' ? -1 : 1)
          }
        }}>
        <button type='button' className='viewer-close' aria-label='Close video' autoFocus onClick={() => dialog.current?.close()}><X size={25} /></button>
        {active && <div className='discovery-viewer-layout'>
          <div className='discovery-player'>
            {playbackError ? <p role='status'>{playbackError}</p> :
              active.video ? <video key={active.id} src={active.video} poster={active.poster} autoPlay={!window.matchMedia('(prefers-reduced-motion: reduce)').matches}
                playsInline muted loop controls aria-label={active.title} onError={() => setPlaybackError('This video could not be played.')} /> :
                <p role='status'>Loading video…</p>}
          </div>
          <div className='viewer-details'>
            <div><small>{active.topic}</small><h2>{active.title}</h2></div>
            <button type='button' className='viewer-action' aria-pressed={isSaved} onClick={() => toggleBookmark(active)}>
              <Bookmark size={20} fill={isSaved ? 'currentColor' : 'none'} /> {isSaved ? 'Saved' : 'Save'}
            </button>
            <div className='viewer-navigation'>
              <button type='button' className='viewer-action' aria-label='Previous video' disabled={index <= 0} onClick={() => moveVideo(-1)}><ArrowUp size={20} /></button>
              <button type='button' className='viewer-action' aria-label='Next video' disabled={index < 0 || index >= items.length - 1} onClick={() => moveVideo(1)}><ArrowDown size={20} /></button>
            </div>
          </div>
        </div>}
      </dialog>
    </section>
  )
}
