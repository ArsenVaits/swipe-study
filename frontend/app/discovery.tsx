'use client'

import { ArrowLeft, ArrowUpRight, Bookmark, Clapperboard, Search, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import seedVideos from '@/lib/discovery-seeds.json'
import { listCatalog } from '@/lib/lesson-api'

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
type Video = typeof seedVideos[number]

// Server catalog videos by topic (GET /api/catalog?track=<topic in lower case>); the bundled seeds stay as extras.
function useCatalog(topic: string | null) {
  const [videos, setVideos] = useState<Record<string, Video[]>>({})
  useEffect(() => {
    if (!topic || videos[topic]) return
    const request = new AbortController()
    listCatalog(topic.toLowerCase(), request.signal)
      .then(lessons => setVideos(previous => ({
        ...previous,
        [topic]: lessons.map(item => ({
          id: item.jobId,
          topic,
          title: item.lesson.title,
          video: item.videoUrl,
          poster: item.posterUrl,
          description: [item.lesson.hook, ...item.lesson.captions].join(' '),
        })),
      })))
      .catch(() => undefined) // offline or older server: the bundled seeds still show
    return () => request.abort()
  }, [topic, videos])
  return videos
}
const bookmarkKey = 'scrolled-discovery-saved'

function readList<T>(key: string): T[] {
  try {
    const list = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export default function Discovery({
  mode, initialTopic
}: {
  mode: 'library' | 'saved'
  initialTopic?: string
}) {
  const [bookmarks, setBookmarks] = useState<Video[]>([])
  const [topic, setTopic] = useState<Topic | null>(() => topics.find(label => label === initialTopic) ?? null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<Video | null>(null)
  const [playlist, setPlaylist] = useState<Video[]>([])
  const [notice, setNotice] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  const startingIndex = useRef<number | null>(null)
  const currentId = useRef<string | null>(null)
  const scrollGesture = useRef({ at: -Infinity, direction: 0, distance: 0, consumed: false })
  const topicHeading = useRef<HTMLHeadingElement>(null)
  const catalog = useCatalog(mode === 'library' ? topic : null)

  useEffect(() => {
    setBookmarks(readList<Video>(bookmarkKey))
  }, [])

  useEffect(() => {
    if (topic) topicHeading.current?.focus()
  }, [topic])

  const words = query.toLocaleLowerCase().trim().split(/\s+/)
  const visibleTopics = categories.filter(item =>
    words.every(word => (item.label + ' ' + item.keywords).toLocaleLowerCase().includes(word)))
  const items = useMemo(() => {
    if (mode === 'saved') return bookmarks
    if (!topic) return []
    const terms = query.toLocaleLowerCase().trim().split(/\s+/)
    return [...(catalog[topic] ?? []), ...seedVideos].filter(item => item.topic === topic &&
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
      // Sound is on by default; if the browser blocks autoplay with sound, start muted instead.
      video.muted = false
      void video.play().catch(() => {
        video.muted = true
        return video.play()
      }).catch(() => undefined)
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
    const next = saved ? stored.filter(item => item.id !== video.id) : [video, ...stored]
    try {
      localStorage.setItem(bookmarkKey, JSON.stringify(next))
      setBookmarks(next)
      setNotice(saved ? 'Video removed from Saved.' : 'Video added to Saved.')
    } catch { setNotice('Could not save the video in this browser.') }
  }

  function openVideo(video: Video, button?: HTMLElement) {
    if (!dialog.current) return
    if (button) trigger.current = button
    currentId.current = video.id
    setActive(video)
    if (!dialog.current.open) {
      scrollGesture.current = { at: -Infinity, direction: 0, distance: 0, consumed: false }
      startingIndex.current = Math.max(0, items.findIndex(item => item.id === video.id))
      setPlaylist(items)
      dialog.current.showModal()
    }
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
      </>}
      {mode === 'saved' && items.length > 0 && <h2 className='saved-section-title'>Bookmarked videos</h2>}
      {mode === 'saved' && items.length > 0 ? (
        <ul className='saved-video-grid'>
          {items.map(item => (
            <li key={item.id} className='saved-video-card'>
              <video controls playsInline preload='none' src={item.video} poster={item.poster} aria-label={item.title} />
              <div className='saved-video-info'>
                <button type='button' className='saved-link' onClick={event => openVideo(item, event.currentTarget)}>
                  <strong>{item.title}</strong><span>{item.topic} · Open viewer</span>
                </button>
                <button type='button' className='icon-control' aria-label={'Remove ' + item.title} onClick={() => toggleBookmark(item)}>
                  <Bookmark size={17} fill='currentColor' />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : items.length ? (
        <ul className='discovery-grid'>
          {items.map(item => (
            <li key={item.id}>
              <button type='button' className='discovery-card' onClick={event => openVideo(item, event.currentTarget)}>
                <img src={item.poster} alt='' loading='lazy' />
                <Clapperboard className='discovery-card-icon' size={17} aria-hidden='true' />
                <span className='discovery-card-caption'><small>{item.topic}</small><strong>{item.title}</strong></span>
              </button>
            </li>
          ))}
        </ul>
      ) : mode === 'library' && topic ? <p className='empty-library' role='status'>No videos match your search.</p> : null}
      <dialog className='discovery-viewer' aria-label='Video player' ref={dialog}
        onClose={() => {
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
              const nearby = Math.abs(position - index) <= 1
              return (
                <div className='viewer-slide' key={item.id} data-active={selected || undefined}
                  inert={!selected}>
                  {nearby ? <video src={item.video} poster={item.poster}
                    playsInline loop controls={selected} preload={selected ? 'auto' : 'metadata'}
                    aria-label={item.title} /> : <img src={item.poster} alt='' />}
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
