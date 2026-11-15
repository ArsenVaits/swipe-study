'use client'

import { ArrowLeft, ArrowUpRight, Bookmark, Clapperboard, Search, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import seedVideos from '@/lib/discovery-seeds.json'

const categories = [
  { label: 'Programming', keywords: 'code coding development программирование код разработка' },
  { label: 'Mathematics', keywords: 'math algebra numbers математика алгебра числа' },
  { label: 'Geography', keywords: 'world maps countries география карты страны' },
  { label: 'AI', keywords: 'artificial intelligence machine learning ии искусственный интеллект' },
  { label: 'DevOps', keywords: 'ci cd infrastructure deployment девопс инфраструктура деплой' },
  { label: 'Science', keywords: 'physics experiments наука физика эксперименты' },
  { label: 'History', keywords: 'historical sources прошлое история' },
  { label: 'Languages', keywords: 'vocabulary english языки английский' },
  { label: 'Productivity', keywords: 'focus time habits продуктивность фокус привычки' },
  { label: 'Communication', keywords: 'feedback teamwork коммуникация общение' },
  { label: 'Design', keywords: 'ui ux visual дизайн интерфейс' },
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
  const [playlist, setPlaylist] = useState<Video[]>([])
  const [playbackError, setPlaybackError] = useState('')
  const [notice, setNotice] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const playbackRequest = useRef<AbortController | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  const startingIndex = useRef<number | null>(null)
  const currentId = useRef<string | null>(null)
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

  const index = playlist.findIndex(item => item.id === active?.id)
  const isSaved = active !== null && bookmarks.some(item => item.id === active.id)

  useLayoutEffect(() => {
    if (startingIndex.current === null || !strip.current) return
    strip.current.scrollTop = startingIndex.current * strip.current.clientHeight
    startingIndex.current = null
  }, [playlist])

  useEffect(() => {
    const video = strip.current?.querySelector<HTMLVideoElement>('[data-active] video')
    if (!video) return
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      void video.play().catch(() => undefined)
    }
    return () => video.pause()
  }, [active?.id, active?.video])

  useEffect(() => {
    const viewer = dialog.current
    if (!viewer || !playlist.length) return

    function onWheel(event: WheelEvent) {
      const viewport = strip.current
      if (!viewport || event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      event.preventDefault()
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
      if (gesture.distance < 28) return
      gesture.consumed = true
      const nearest = Math.round(viewport.scrollTop / viewport.clientHeight)
      const destination = nearest + direction
      if (playlist[destination]) scrollToSlide(viewport, destination)
    }

    viewer.addEventListener('wheel', onWheel, { passive: false })
    return () => viewer.removeEventListener('wheel', onWheel)
  }, [playlist])

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
    currentId.current = video.id
    setActive(video)
    setPlaybackError('')
    if (!dialog.current.open) {
      scrollGesture.current = { at: -Infinity, direction: 0, distance: 0, consumed: false }
      startingIndex.current = Math.max(0, items.findIndex(item => item.id === video.id))
      setPlaylist(items)
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
    const viewport = strip.current
    const targetIndex = index + offset
    if (!viewport || index < 0 || !playlist[targetIndex]) return
    scrollToSlide(viewport, targetIndex)
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
          {visibleTopics.map(({ label }) => <li key={label}>
            <button type='button' className='topic-card' onClick={() => selectTopic(label)}>
              <img className='topic-card-art' src={'/topics/' + label.toLowerCase() + '.webp'} alt='' loading='lazy' />
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
          currentId.current = null
          setPlaylist([])
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
          <div className='discovery-player' ref={strip} onScroll={event => {
            if (startingIndex.current !== null) return
            const viewport = event.currentTarget
            const visible = playlist[Math.round(viewport.scrollTop / viewport.clientHeight)]
            if (visible && visible.id !== currentId.current) openVideo(visible)
          }}>
            {playlist.map((item, position) => {
              const selected = active.id === item.id
              const video = selected ? active : item
              const nearby = Math.abs(position - index) <= 1
              return (
                <div className='viewer-slide' key={item.id} data-active={selected || undefined}
                  inert={!selected}>
                  {selected && playbackError ? <p role='status'>{playbackError}</p> :
                    nearby && video.video ? <video src={video.video} poster={video.poster}
                      playsInline muted loop controls={selected} preload={selected ? 'auto' : 'metadata'}
                      aria-label={video.title} onError={() => {
                        if (currentId.current === item.id) setPlaybackError('This video could not be played.')
                      }} /> :
                      video.poster ? <img src={video.poster} alt='' /> :
                        <p role={selected ? 'status' : undefined}>{selected ? 'Loading video…' : item.title}</p>}
                </div>
              )
            })}
          </div>
          <div className='viewer-details'>
            <div><small>{active.topic}</small><h2>{active.title}</h2></div>
            <button type='button' className='viewer-action' aria-pressed={isSaved} onClick={() => toggleBookmark(active)}>
              <Bookmark size={20} fill={isSaved ? 'currentColor' : 'none'} /> {isSaved ? 'Saved' : 'Save'}
            </button>
            {playlist.length > 1 && index >= 0 && <p className='viewer-position' aria-live='polite'>{index + 1} / {playlist.length}</p>}
          </div>
        </div>}
      </dialog>
    </section>
  )
}

function scrollToSlide(viewport: HTMLDivElement, index: number) {
  viewport.scrollTo({
    top: index * viewport.clientHeight,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  })
}
