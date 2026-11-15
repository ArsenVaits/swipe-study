'use client'

import { ArrowLeft, ArrowUpRight, Atom, Bookmark, Calculator, Clapperboard, Code2, Globe2, Languages, Landmark, Layers3, MessagesSquare, Palette, Search, Server, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import seedVideos from '@/lib/discovery-seeds.json'

const categories = [
  { label: 'Programming', keywords: 'code coding development программирование код разработка', icon: Code2, hue: 248 },
  { label: 'Mathematics', keywords: 'math algebra numbers математика алгебра числа', icon: Calculator, hue: 315 },
  { label: 'Geography', keywords: 'world maps countries география карты страны', icon: Globe2, hue: 155 },
  { label: 'AI', keywords: 'artificial intelligence machine learning ии искусственный интеллект', icon: Sparkles, hue: 266 },
  { label: 'DevOps', keywords: 'ci cd infrastructure deployment девопс инфраструктура деплой', icon: Server, hue: 192 },
  { label: 'Science', keywords: 'physics experiments наука физика эксперименты', icon: Atom, hue: 219 },
  { label: 'History', keywords: 'historical sources прошлое история', icon: Landmark, hue: 31 },
  { label: 'Languages', keywords: 'vocabulary english языки английский', icon: Languages, hue: 331 },
  { label: 'Productivity', keywords: 'focus time habits продуктивность фокус привычки', icon: Layers3, hue: 49 },
  { label: 'Communication', keywords: 'feedback teamwork коммуникация общение', icon: MessagesSquare, hue: 283 },
  { label: 'Design', keywords: 'ui ux visual дизайн интерфейс', icon: Palette, hue: 12 },
] as const
export const topics = categories.map(item => item.label)
type Topic = typeof topics[number]
type Video = { id: string; title: string; topic: string; video: string; poster?: string; description?: string; publishedAt?: number }
const bookmarkKey = 'scrolled-discovery-saved'

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
  const [topic, setTopic] = useState<Topic | null>(null)
  const [query, setQuery] = useState('')
  const [loadError, setLoadError] = useState(false)
  const [active, setActive] = useState<Video | null>(null)
  const [playbackError, setPlaybackError] = useState('')
  const [notice, setNotice] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const playbackRequest = useRef<AbortController | null>(null)
  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  const scrollGesture = useRef({ at: -Infinity, direction: 0, distance: 0, consumed: false })
  const topicHeading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    setBookmarks(readList<Video>(bookmarkKey))
    return () => playbackRequest.current?.abort()
  }, [])

  useEffect(() => {
    if (topic) topicHeading.current?.focus()
  }, [topic])

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

  const catalog = useMemo(() => [...published, ...seedVideos], [published])
  const words = query.toLocaleLowerCase().trim().split(/\s+/)
  const visibleTopics = categories.filter(item =>
    words.every(word => (item.label + ' ' + item.keywords).toLocaleLowerCase().includes(word)))
  const items = useMemo(() => {
    if (mode === 'saved') return bookmarks
    if (!topic) return []
    const terms = query.toLocaleLowerCase().trim().split(/\s+/)
    return catalog.filter(item => item.topic === topic &&
      terms.every(term => [item.title, item.description].join(' ').toLocaleLowerCase().includes(term)))
  }, [bookmarks, catalog, mode, query, topic])

  const index = items.findIndex(item => item.id === active?.id)
  const isSaved = active !== null && bookmarks.some(item => item.id === active.id)

  function selectTopic(value: Topic | null) {
    setTopic(value)
    setQuery('')
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
    if (!dialog.current.open) {
      scrollGesture.current = { at: -Infinity, direction: 0, distance: 0, consumed: false }
      dialog.current.showModal()
    }
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
        {topic && <div className='discovery-topic-header'>
          <button type='button' className='secondary' onClick={() => selectTopic(null)}><ArrowLeft size={16} /> All topics</button>
          <h2 ref={topicHeading} tabIndex={-1}>{topic}</h2>
        </div>}
        <label className='discovery-search'>
          <Search size={20} aria-hidden='true' />
          <input type='search' placeholder={topic ? 'Search videos in ' + topic : 'Search topics'}
            aria-label={topic ? 'Search videos' : 'Search topics'} value={query}
            onChange={event => setQuery(event.target.value)} />
        </label>
        {!topic && (visibleTopics.length ? <ul className='discovery-grid topic-grid'>
          {visibleTopics.map(({ label, icon: Icon, hue }) => <li key={label}>
            <button type='button' className='topic-card' onClick={() => selectTopic(label)}
              style={{ background: `hsl(${hue} 52% 23%)` }}>
              <Icon className='topic-card-art' size={88} strokeWidth={1.15} aria-hidden='true' />
              <ArrowUpRight className='topic-card-arrow' size={16} aria-hidden='true' />
              <strong>{label}</strong>
            </button>
          </li>)}
        </ul> : <p className='empty-library' role='status'>No topics match your search.</p>)}
        {topic && loadError && <p role='status'>Community videos are temporarily unavailable.</p>}
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
      ) : mode === 'library' && topic ? <p className='empty-library' role='status'>No videos match your search.</p> : null}
      <dialog className='discovery-viewer' aria-label='Video player' ref={dialog}
        onClose={() => {
          playbackRequest.current?.abort()
          swipeStart.current = null
          setActive(null)
          trigger.current?.focus()
        }}
        onWheel={event => {
          if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
          const direction = Math.sign(event.deltaY)
          const gesture = scrollGesture.current
          if (event.timeStamp - gesture.at > 140 || direction !== gesture.direction) {
            gesture.distance = 0
            gesture.consumed = false
          }
          gesture.at = event.timeStamp
          gesture.direction = direction
          if (gesture.consumed) return
          const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1
          gesture.distance += Math.abs(event.deltaY) * scale
          if (gesture.distance >= 28) {
            gesture.consumed = true
            moveVideo(direction)
          }
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
            <div className='viewer-swipe-area' aria-hidden='true'
              onPointerDown={event => {
                if (!event.isPrimary || event.button !== 0) return
                swipeStart.current = { x: event.clientX, y: event.clientY }
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerUp={event => {
                const start = swipeStart.current
                swipeStart.current = null
                if (!start) return
                const distance = start.y - event.clientY
                if (Math.abs(distance) >= 35 && Math.abs(distance) > Math.abs(start.x - event.clientX)) {
                  moveVideo(Math.sign(distance))
                }
              }}
              onPointerCancel={() => { swipeStart.current = null }} />
          </div>
          <div className='viewer-details'>
            <div><small>{active.topic}</small><h2>{active.title}</h2></div>
            <button type='button' className='viewer-action' aria-pressed={isSaved} onClick={() => toggleBookmark(active)}>
              <Bookmark size={20} fill={isSaved ? 'currentColor' : 'none'} /> {isSaved ? 'Saved' : 'Save'}
            </button>
            {items.length > 1 && index >= 0 && <p className='viewer-position' aria-live='polite'>{index + 1} / {items.length}</p>}
          </div>
        </div>}
      </dialog>
    </section>
  )
}
