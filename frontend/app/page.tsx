'use client'

import { normalizeText, type Lesson } from '@/lib/lesson'
import {
  createLessonJob,
  getLessonJob,
  getSessionId,
  LessonApiError,
  lessonErrorMessage,
  pollLessonJob,
  toLesson,
  type LessonJob
} from '@/lib/lesson-api'
import {
  sampleLesson,
  sampleName,
  samplePages,
  samplePdf,
  samplePoster,
  sampleVideo
} from '@/lib/sample'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  FileText,
  Layers3,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  X
} from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Player from './player'

type Source = {
  name: string
  count: number
  page: number
  text: string
  url: string
  pdf?: PDFDocumentProxy
}
type Entry = { id: string; lesson: Lesson; name: string; sample?: number; jobId?: string }
type Clip = { video?: string; error?: string; retryStatus?: boolean }
const examples: Entry[] = [
  { id: 'sample-1', name: sampleName, lesson: sampleLesson, sample: 1 },
  {
    id: 'sample-2',
    name: sampleName,
    lesson: {
      title: 'Practice before you speak',
      explanation:
        'Write one sentence for each part of SBI. Choose a recent moment, describe a behavior someone else could see or hear, and state the impact from your perspective. Read it aloud to catch generalizations.',
      narration:
        'Choose a recent moment you can describe. Write one sentence for the situation, the behavior, and the impact. Read your draft aloud and replace generalizations with observations someone else could have seen or heard.',
      captions: ['Pick a recent moment.', 'Write three sentences.', 'Read them aloud.'],
      quiz: {
        question: 'What should you replace generalizations with?',
        options: ['Observations.', 'Longer descriptions.', "Other people's opinions."],
        correctIndex: 0,
        explanation: 'Use observable details that another person could see or hear.'
      },
      source: {
        page: 2,
        quote: 'Read the three sentences aloud and replace generalizations with observations.'
      }
    },
    sample: 2
  }
]
const sampleMedia = [
  { video: sampleVideo, poster: samplePoster },
  { video: '/sample/practice.mp4', poster: '/sample/practice.webp' }
]
const archive = 'scrolled-library-v1'

export default function Studio() {
  const [source, setSource] = useState<Source | null>(null)
  const [entries, setEntries] = useState<Entry[]>(examples)
  const [active, setActive] = useState(examples[0].id)
  const [library, setLibrary] = useState<Entry[]>([])
  const [tab, setTab] = useState<'feed' | 'library'>('feed')
  const [panel, setPanel] = useState<'quiz' | 'source'>('quiz')
  const [selected, setSelected] = useState('')
  const [excerpt, setExcerpt] = useState('')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [clips, setClips] = useState<Record<string, Clip>>({})
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const passage = useRef<HTMLParagraphElement>(null)
  const uploadPanel = useRef<HTMLElement>(null)
  const detailPanel = useRef<HTMLElement>(null)
  const feed = useRef<HTMLDivElement>(null)
  const requestedShort = useRef<{ id: string; smooth: boolean } | null>(null)
  const currentPdf = useRef<Source | null>(null)
  const clipUrls = useRef<string[]>([])
  const renderJobs = useRef(new Set<string>())
  const creation = useRef<AbortController | null>(null)
  const videoRequests = useRef(new Map<string, AbortController>())
  const origins = useRef(new Map<string, string>())
  const documentUrls = useRef<string[]>([])
  const readVersion = useRef(0)

  useEffect(() => {
    try {
      setLibrary(JSON.parse(localStorage.getItem(archive) || '[]'))
    } catch {
      setLibrary([])
    }
    return () => {
      creation.current?.abort()
      videoRequests.current.forEach(request => request.abort())
      if (currentPdf.current?.pdf) void currentPdf.current.pdf.loadingTask.destroy()
      ;[...clipUrls.current, ...documentUrls.current].forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  const index = Math.max(
    0,
    entries.findIndex(entry => entry.id === active)
  )
  const entry = entries[index]
  const isSaved = library.some(item => item.id === entry.id)
  const sourceUrl = entry.sample ? samplePdf : origins.current.get(entry.id)

  useLayoutEffect(() => {
    const navigation = requestedShort.current
    const scroller = feed.current
    if (!navigation || !scroller) return
    const target = document.getElementById('short-' + navigation.id)
    if (!target) return
    const motion =
      navigation.smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    scroller.scrollTo({ top: target.offsetTop, behavior: motion ? 'smooth' : 'instant' })
    if (!motion || Math.abs(scroller.scrollTop - target.offsetTop) < 2)
      requestedShort.current = null
  })

  function goTo(id: string, smooth = true) {
    if (id !== active || !feed.current) requestedShort.current = { id, smooth }
    setActive(id)
    setPanel('quiz')
  }

  function onFeedScroll() {
    const scroller = feed.current
    if (!scroller) return
    const navigation = requestedShort.current
    if (navigation) {
      const target = document.getElementById('short-' + navigation.id)
      if (target && Math.abs(scroller.scrollTop - target.offsetTop) < 2)
        requestedShort.current = null
      return
    }
    const next = Math.round(scroller.scrollTop / scroller.clientHeight)
    const id = entries[next]?.id
    if (id && id !== active) {
      setActive(id)
      setPanel('quiz')
    }
  }

  function switchSource(next: Source | null) {
    const prior = currentPdf.current?.pdf
    if (prior && prior !== next?.pdf) void prior.loadingTask.destroy()
    currentPdf.current = next
    setSource(next)
    setSelected('')
    setExcerpt('')
  }

  async function loadFile(file?: File) {
    if (!file || creation.current) return
    setTab('feed')
    setDragging(false)
    setError('')
    setBusy('Opening PDF…')
    const version = ++readVersion.current
    let pdf: PDFDocumentProxy | undefined
    try {
      const reader = await import('@/lib/pdf')
      pdf = await reader.openPdf(file)
      const text = await reader.readPage(pdf, 1)
      if (version !== readVersion.current) return
      const url = URL.createObjectURL(file)
      documentUrls.current.push(url)
      switchSource({ name: file.name, count: pdf.numPages, page: 1, text, url, pdf })
      pdf = undefined
      requestAnimationFrame(() => uploadPanel.current?.scrollIntoView({ block: 'nearest' }))
    } catch (cause) {
      if (version === readVersion.current)
        setError(cause instanceof Error ? cause.message : 'This PDF could not be opened.')
    } finally {
      if (pdf) void pdf.loadingTask.destroy()
      if (version === readVersion.current) setBusy('')
      if (input.current) input.current.value = ''
    }
  }

  function openExample() {
    if (creation.current) return
    setTab('feed')
    readVersion.current++
    switchSource({
      name: sampleName,
      count: samplePages.length,
      page: 1,
      text: samplePages[0].text,
      url: samplePdf
    })
    setBusy('')
    setError('')
    goTo(examples[0].id)
    requestAnimationFrame(() => uploadPanel.current?.scrollIntoView({ block: 'nearest' }))
  }

  async function movePage(page: number) {
    if (!source || busy || page < 1 || page > source.count || page === source.page) return
    const version = ++readVersion.current
    setBusy('Reading page…')
    setError('')
    try {
      const text = source.pdf
        ? await (await import('@/lib/pdf')).readPage(source.pdf, page)
        : samplePages[page - 1].text
      if (version === readVersion.current) switchSource({ ...source, page, text })
    } catch {
      if (version === readVersion.current)
        setError('This page could not be read. Choose another page.')
    } finally {
      if (version === readVersion.current) setBusy('')
    }
  }

  function highlight() {
    const selection = window.getSelection()
    const container = selection?.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null
    setSelected(
      container && passage.current?.contains(container)
        ? normalizeText(selection?.toString() || '')
        : ''
    )
  }

  async function renderClip(item: Entry) {
    if (renderJobs.current.has(item.id)) return
    renderJobs.current.add(item.id)
    setClips(previous => ({ ...previous, [item.id]: {} }))
    try {
      const { renderRecap } = await import('@/lib/recap')
      const video = await renderRecap(item.lesson.captions)
      clipUrls.current.push(video)
      setClips(previous => ({ ...previous, [item.id]: { video } }))
    } catch (cause) {
      setClips(previous => ({
        ...previous,
        [item.id]: {
          error: cause instanceof Error ? cause.message : 'The recap could not be rendered.'
        }
      }))
    } finally {
      renderJobs.current.delete(item.id)
    }
  }

  async function loadVideo(jobId: string, initial?: LessonJob) {
    if (videoRequests.current.has(jobId)) return
    const request = new AbortController()
    videoRequests.current.set(jobId, request)
    setClips(previous => ({ ...previous, [jobId]: {} }))
    try {
      const job = await pollLessonJob(
        initial ?? (await getLessonJob(jobId, request.signal)),
        request.signal
      )
      if (request.signal.aborted) return
      const clip: Clip =
        job.status === 'ready' && job.videoUrl
          ? { video: job.videoUrl }
          : {
              error:
                job.error?.code === 'VIDEO_LIMIT_REACHED'
                  ? 'You have reached the video limit for this demo.'
                  : 'The server could not render this video.'
            }
      setClips(previous => ({ ...previous, [jobId]: clip }))
    } catch (cause) {
      if (request.signal.aborted) return
      const missing = cause instanceof LessonApiError && cause.status === 404
      const clip = {
        error: missing ? 'The video job could not be found.' : 'Could not check the video status.',
        retryStatus: !missing
      }
      setClips(previous => ({ ...previous, [jobId]: clip }))
    } finally {
      videoRequests.current.delete(jobId)
    }
  }

  async function createLesson() {
    if (!source || busy || creation.current) return
    setError('')
    if (!source.pdf && !excerpt) {
      goTo(examples[source.page - 1].id)
      document.getElementById('lesson-feed')?.scrollIntoView({ block: 'nearest' })
      return
    }
    const sourceText = (excerpt || source.text).trim()
    if (sourceText.length < 80 || sourceText.length > 12_000) {
      setError('Select a passage between 80 and 12,000 characters.')
      return
    }
    const request = new AbortController()
    creation.current = request
    setCreating(true)
    try {
      const job = await createLessonJob(
        {
          sourceTitle: source.name.trim().slice(0, 200) || 'Untitled PDF',
          sourcePage: source.page,
          sourceText,
          sessionId: getSessionId()
        },
        request.signal
      )
      if (request.signal.aborted) return
      if (!job.lesson) {
        setError(lessonErrorMessage(job.error?.code))
        return
      }
      const item: Entry = {
        id: job.jobId,
        jobId: job.jobId,
        lesson: toLesson(job.lesson),
        name: source.name
      }
      origins.current.set(item.id, source.url)
      setEntries(previous => [item, ...previous])
      setTab('feed')
      goTo(item.id, false)
      void loadVideo(job.jobId, job)
      requestAnimationFrame(() =>
        document.getElementById('lesson-feed')?.scrollIntoView({ block: 'nearest' })
      )
    } catch (cause) {
      if (request.signal.aborted) return
      setError(
        cause instanceof LessonApiError
          ? lessonErrorMessage(cause.code, cause.status)
          : lessonErrorMessage()
      )
    } finally {
      creation.current = null
      if (!request.signal.aborted) setCreating(false)
    }
  }

  function updateLibrary(next: Entry[], message: string) {
    try {
      localStorage.setItem(archive, JSON.stringify(next))
      setLibrary(next)
      setNotice(message)
    } catch {
      setNotice('Browser storage is unavailable.')
    }
  }

  function toggleSave() {
    updateLibrary(
      isSaved ? library.filter(item => item.id !== entry.id) : [entry, ...library],
      isSaved ? 'Lesson removed from saved lessons.' : 'Lesson saved.'
    )
  }

  function openSaved(item: Entry) {
    if (!entries.some(record => record.id === item.id)) {
      setEntries(previous => [item, ...previous])
      if (!item.sample && !item.jobId) void renderClip(item)
    }
    if (item.jobId) void loadVideo(item.jobId)
    setTab('feed')
    goTo(item.id, false)
  }

  return (
    <div className='site-shell'>
      <h1>TESTETSTETSTEES</h1>
      <a className='skip-link' href='#lesson-feed'>
        Skip to lesson feed
      </a>
      <header className='site-header'>
        <div className='header-inner'>
          <button
            type='button'
            className='wordmark'
            aria-label='ScrollEd home'
            onClick={() => {
              setTab('feed')
              goTo(entries[0].id, false)
            }}
          >
            <span className='brand-mark'>
              <Layers3 size={20} strokeWidth={2.4} />
            </span>
            <span>
              Scroll<span className='brand-ed'>Ed</span>
              <span className='brand-dot'>.</span>
            </span>
          </button>
          <nav aria-label='Main navigation'>
            <button
              type='button'
              aria-current={tab === 'feed' ? 'page' : undefined}
              onClick={() => {
                setTab('feed')
                goTo(active, false)
              }}
            >
              <Clapperboard size={16} /> <span>Lesson feed</span>
            </button>
            <button
              type='button'
              aria-current={tab === 'library' ? 'page' : undefined}
              onClick={() => {
                setTab('library')
                setNotice('')
              }}
            >
              <Bookmark size={16} /> <span>Saved</span>
            </button>
          </nav>
          <button
            type='button'
            className='header-action'
            aria-label='New lesson'
            disabled={creating}
            onClick={() => input.current?.click()}
          >
            <Plus size={18} /> <span>New lesson</span>
          </button>
        </div>
      </header>

      <input
        className='sr-only'
        ref={input}
        type='file'
        accept='.pdf,application/pdf'
        tabIndex={-1}
        aria-label='Choose PDF file'
        onChange={event => void loadFile(event.target.files?.[0])}
      />
      <span className='sr-only' role='status'>
        {notice}
      </span>
      {tab === 'library' ? (
        <main className='library'>
          <h1>Saved lessons</h1>
          <p>Pick up where you left off. These lessons are saved in this browser.</p>
          {library.length ? (
            <ul className='saved-list'>
              {library.map(item => (
                <li key={item.id}>
                  <Bookmark size={20} />
                  <button className='saved-link' type='button' onClick={() => openSaved(item)}>
                    <strong>{item.lesson.title}</strong>
                    <span>
                      {item.name} · Page {item.lesson.source.page}
                    </span>
                  </button>
                  <button
                    type='button'
                    className='icon-control'
                    aria-label={'Remove ' + item.lesson.title}
                    onClick={() =>
                      updateLibrary(
                        library.filter(record => record.id !== item.id),
                        'Lesson removed.'
                      )
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className='empty-library'>
              <Bookmark size={30} />
              <h2>No saved lessons yet</h2>
              <p>Save a lesson from the feed to find it here.</p>
              <button
                type='button'
                className='secondary'
                onClick={() => {
                  setTab('feed')
                  goTo(active, false)
                }}
              >
                Back to the feed <ArrowRight size={16} />
              </button>
            </div>
          )}
        </main>
      ) : (
        <main className='studio'>
          <section className='upload-panel' ref={uploadPanel} aria-labelledby='upload-title'>
            {source ? (
              <>
                <button
                  className='back-link'
                  type='button'
                  disabled={creating}
                  onClick={() => {
                    readVersion.current++
                    switchSource(null)
                    setBusy('')
                    setError('')
                  }}
                >
                  <ArrowLeft size={15} /> Change PDF
                </button>
                <h1 id='upload-title' className='editor-title'>
                  Choose a passage.
                </h1>
                <p className='editor-description'>
                  Choose a full page or highlight a passage. ScrollEd sends the chosen text and
                  document details to create your lesson.
                </p>
                <div className='document-panel'>
                  <div className='document-name'>
                    <FileText size={17} />
                    <strong title={source.name}>{source.name}</strong>
                    <a
                      href={source.url + '#page=' + source.page}
                      target='_blank'
                      rel='noreferrer'
                      aria-label='Open original PDF'
                    >
                      <ArrowUpRight size={16} />
                    </a>
                  </div>
                  <div className='page-nav'>
                    <button
                      className='icon-control'
                      type='button'
                      aria-label='Previous page'
                      disabled={source.page <= 1 || !!busy || creating}
                      onClick={() => void movePage(source.page - 1)}
                    >
                      <ChevronLeft size={17} />
                    </button>
                    <label>
                      Page{' '}
                      <select
                        aria-label='PDF page'
                        value={source.page}
                        disabled={!!busy || creating}
                        onChange={event => void movePage(Number(event.target.value))}
                      >
                        {Array.from({ length: source.count }, (_, i) => (
                          <option key={i} value={i + 1}>
                            {i + 1}
                          </option>
                        ))}
                      </select>{' '}
                      of {source.count}
                    </label>
                    <button
                      className='icon-control'
                      type='button'
                      aria-label='Next page'
                      disabled={source.page >= source.count || !!busy || creating}
                      onClick={() => void movePage(source.page + 1)}
                    >
                      <ChevronRight size={17} />
                    </button>
                  </div>
                  <p
                    className='passage'
                    tabIndex={0}
                    ref={passage}
                    onPointerUp={highlight}
                    onKeyUp={highlight}
                  >
                    {source.text ||
                      'This page has no readable text. Choose another page or use a PDF with selectable text.'}
                  </p>
                  {source.text && (
                    <div className='selection-row'>
                      {excerpt ? (
                        <>
                          <span>{excerpt.split(' ').length} words</span>
                          <button
                            type='button'
                            className='text-button'
                            disabled={creating}
                            onClick={() => {
                              setExcerpt('')
                              setError('')
                            }}
                          >
                            Use full page
                          </button>
                        </>
                      ) : (
                        <button
                          type='button'
                          className='text-button'
                          disabled={!selected || creating}
                          onClick={() => {
                            if (selected.length < 80 || selected.length > 12_000)
                              return setError('Highlight 80 to 12,000 characters.')
                            setExcerpt(selected)
                            setError('')
                            window.getSelection()?.removeAllRanges()
                          }}
                        >
                          Use highlighted text
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {excerpt && <blockquote className='selected-excerpt'>{excerpt}</blockquote>}
                <button
                  type='button'
                  className='primary create-button'
                  disabled={!!busy || creating || !source.text}
                  onClick={() => void createLesson()}
                >
                  {creating ? <LoaderCircle className='spin' size={18} /> : <Sparkles size={18} />}{' '}
                  {creating ? 'Creating lesson…' : 'Create my lesson'} <ArrowRight size={16} />
                </button>
                {(busy || creating) && (
                  <p role='status' className='support-text'>
                    {busy || 'Preparing the notes and quiz. This usually takes 10–40 seconds.'}
                  </p>
                )}
              </>
            ) : (
              <>
                <h1 id='upload-title' className='hero-title'>
                  Your PDFs.
                  <br />
                  <em>In a scroll.</em>
                </h1>
                <p className='hero-description'>
                  Turn a passage from a work PDF into a short lesson you can watch, quiz, and
                  revisit.
                </p>
                <button
                  type='button'
                  disabled={!!busy}
                  className={'dropzone' + (dragging ? ' is-dragging' : '')}
                  onClick={() => input.current?.click()}
                  onDragOver={event => {
                    event.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={event => {
                    event.preventDefault()
                    void loadFile(event.dataTransfer.files[0])
                  }}
                >
                  <span className='upload-icon'>
                    {busy ? <LoaderCircle size={21} className='spin' /> : <Upload size={21} />}
                  </span>
                  <strong>{busy || 'Upload a PDF'}</strong>
                  <small>Drag and drop or browse</small>
                </button>
                <p className='privacy'>
                  <ShieldCheck size={15} /> PDFs stay on your device
                </p>
                <button className='sample-row' type='button' onClick={openExample}>
                  <FileText size={17} />
                  <span>Try a sample PDF</span>
                  <ArrowUpRight size={16} />
                </button>
              </>
            )}
            {error && (
              <p role='alert' className='error-text'>
                {error}
              </p>
            )}
          </section>

          <section className='feed-section' aria-labelledby='feed-title' id='lesson-feed'>
            <div className='feed-heading'>
              <h2 id='feed-title'>Lesson feed</h2>
              <span className='feed-count'>
                {String(index + 1).padStart(2, '0')} <span>/</span>{' '}
                {String(entries.length).padStart(2, '0')}
              </span>
            </div>
            <div className='feed-layout'>
              <div
                className='shorts'
                ref={feed}
                tabIndex={0}
                aria-label='Vertical lesson videos'
                onScroll={onFeedScroll}
                onWheel={() => {
                  requestedShort.current = null
                }}
                onTouchStart={() => {
                  requestedShort.current = null
                }}
                onKeyDown={event => {
                  if (event.target !== event.currentTarget) return
                  if (event.key === 'ArrowDown' && entries[index + 1]) {
                    event.preventDefault()
                    goTo(entries[index + 1].id)
                  }
                  if (event.key === 'ArrowUp' && entries[index - 1]) {
                    event.preventDefault()
                    goTo(entries[index - 1].id)
                  }
                }}
              >
                {entries.map(item => {
                  const media = item.sample
                    ? sampleMedia[item.sample - 1]
                    : { video: clips[item.id]?.video, poster: undefined }
                  return (
                    <article
                      key={item.id}
                      className='short'
                      id={'short-' + item.id}
                      aria-label={item.lesson.title}
                    >
                      {media.video ? (
                        <Player
                          video={media.video}
                          poster={media.poster}
                          captions={item.lesson.captions}
                          title={item.lesson.title}
                          sample={!!item.sample}
                          serverVideo={!!item.jobId}
                          demoVideo={media.video.startsWith('/demo/')}
                          active={item.id === active}
                          onRefresh={item.jobId ? () => void loadVideo(item.jobId!) : undefined}
                        />
                      ) : (
                        <div className='recap-state' role='status' inert={item.id !== active}>
                          {clips[item.id]?.error ? (
                            <Clapperboard size={28} />
                          ) : (
                            <LoaderCircle className='spin' size={28} />
                          )}
                          <strong>
                            {clips[item.id]?.error ? 'Video unavailable' : 'Rendering your recap'}
                          </strong>
                          <p>{clips[item.id]?.error || 'The notes and quiz are ready.'}</p>
                          {clips[item.id]?.retryStatus && item.jobId && (
                            <button
                              className='secondary'
                              type='button'
                              onClick={() => void loadVideo(item.jobId!)}
                            >
                              Check status again
                            </button>
                          )}
                          {clips[item.id]?.error && !item.jobId && (
                            <button
                              className='secondary'
                              type='button'
                              onClick={() => void renderClip(item)}
                            >
                              Retry video
                            </button>
                          )}
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
              <div className='feed-rail' aria-label='Feed actions'>
                <button
                  type='button'
                  className='rail-button'
                  aria-label={isSaved ? 'Unsave lesson' : 'Save lesson'}
                  aria-pressed={isSaved}
                  onClick={toggleSave}
                >
                  <Bookmark size={20} fill={isSaved ? 'currentColor' : 'none'} />
                </button>
                <button
                  type='button'
                  className='rail-button quiz-action'
                  aria-label='Open quiz'
                  onClick={() => {
                    setPanel('quiz')
                    detailPanel.current?.scrollIntoView({ block: 'nearest' })
                  }}
                >
                  <CircleHelp size={20} />
                </button>
                <div className='feed-navigation'>
                  <button
                    type='button'
                    className='rail-button'
                    aria-label='Previous lesson'
                    disabled={!entries[index - 1]}
                    onClick={() => goTo(entries[index - 1].id)}
                  >
                    <ArrowUp size={18} />
                  </button>
                  <button
                    type='button'
                    className='rail-button'
                    aria-label='Next lesson'
                    disabled={!entries[index + 1]}
                    onClick={() => goTo(entries[index + 1].id)}
                  >
                    <ArrowDown size={18} />
                  </button>
                </div>
              </div>
            </div>
            <div className='feed-footer'>
              <span>
                <span className='feed-indicator' /> {entry.sample ? 'Sample lesson' : 'Your lesson'}
              </span>
              <span>
                Scroll for more <ArrowDown size={13} />
              </span>
            </div>
          </section>

          <section className='detail-panel' ref={detailPanel} aria-label='Lesson notes and quiz'>
            <div className='lesson-info'>
              <div className='lesson-kicker'>
                <FileText size={15} /> {entry.sample ? 'Workplace communication' : 'From your PDF'}
              </div>
              <h2>{entry.lesson.title}</h2>
              <p>{entry.lesson.explanation}</p>
              <ReadAloud key={entry.id} narration={entry.lesson.narration} />
            </div>
            <div className='detail-tabs' aria-label='Lesson details'>
              <button
                type='button'
                aria-pressed={panel === 'quiz'}
                onClick={() => setPanel('quiz')}
              >
                Quick quiz
              </button>
              <button
                type='button'
                aria-pressed={panel === 'source'}
                onClick={() => setPanel('source')}
              >
                PDF source
              </button>
            </div>
            {panel === 'quiz' ? (
              <Quiz key={entry.id} entry={entry} sourceUrl={sourceUrl} />
            ) : (
              <div className='source-panel'>
                <strong>{entry.name}</strong>
                <span>Page {entry.lesson.source.page}</span>
                <blockquote>“{entry.lesson.source.quote}”</blockquote>
                <SourceLink entry={entry} url={sourceUrl} />
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  )
}

function SourceLink({ entry, url }: { entry: Entry; url?: string }) {
  return url ? (
    <a
      className='source-link'
      href={url + '#page=' + entry.lesson.source.page}
      target='_blank'
      rel='noreferrer'
    >
      Open PDF · Page {entry.lesson.source.page} <ArrowUpRight size={15} />
    </a>
  ) : (
    <p className='support-text'>Reference: page {entry.lesson.source.page} of the original PDF.</p>
  )
}

function Quiz({ entry, sourceUrl }: { entry: Entry; sourceUrl?: string }) {
  const { lesson } = entry
  const [answer, setAnswer] = useState<number | null>(null)
  const [checked, setChecked] = useState(false)
  return (
    <form
      className='quiz'
      onSubmit={event => {
        event.preventDefault()
        if (answer !== null) setChecked(true)
      }}
    >
      <fieldset disabled={checked}>
        <legend>{lesson.quiz.question}</legend>
        {!entry.sample && !entry.jobId && (
          <blockquote className='quiz-passage'>
            {lesson.quiz.cloze ||
              lesson.source.quote.replace(lesson.quiz.options[lesson.quiz.correctIndex], '_____')}
          </blockquote>
        )}
        {lesson.quiz.options.map((option, index) => {
          const correct = checked && index === lesson.quiz.correctIndex
          const wrong = checked && answer === index && !correct
          return (
            <label
              key={index}
              className={'quiz-option' + (correct ? ' is-correct' : wrong ? ' is-wrong' : '')}
            >
              <input
                type='radio'
                name='answer'
                checked={answer === index}
                onChange={() => setAnswer(index)}
              />
              <span className='option-letter'>{['A', 'B', 'C', 'D'][index]}</span>
              <span>{option}</span>
              {correct && (
                <span className='answer-marker'>
                  <Check size={15} />
                  <span className='sr-only'>Correct answer</span>
                </span>
              )}
              {wrong && (
                <span className='answer-marker'>
                  <X size={15} />
                  <span className='sr-only'>Incorrect answer</span>
                </span>
              )}
            </label>
          )
        })}
      </fieldset>
      {checked ? (
        <div className='quiz-feedback'>
          <div role='status'>
            <strong>
              {answer === lesson.quiz.correctIndex ? 'Correct!' : 'Here is the answer'}
            </strong>
            <p>{lesson.quiz.explanation}</p>
          </div>
          <blockquote className='quiz-passage'>“{lesson.source.quote}”</blockquote>
          <SourceLink entry={entry} url={sourceUrl} />
          <button
            className='text-button'
            type='button'
            onClick={() => {
              setAnswer(null)
              setChecked(false)
            }}
          >
            Try again
          </button>
        </div>
      ) : (
        <button className='primary check-button' type='submit' disabled={answer === null}>
          Check answer <ArrowRight size={16} />
        </button>
      )}
    </form>
  )
}

function ReadAloud({ narration }: { narration: string }) {
  const [reading, setReading] = useState(false)
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    setAvailable('speechSynthesis' in window)
    return () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    }
  }, [])
  if (!available) return null
  function speak() {
    if (reading) {
      window.speechSynthesis.cancel()
      setReading(false)
      return
    }
    const utterance = new SpeechSynthesisUtterance(narration)
    utterance.lang = /\p{Script=Cyrillic}/u.test(narration) ? 'ru' : 'en'
    utterance.onend = () => setReading(false)
    utterance.onerror = () => setReading(false)
    setReading(true)
    window.speechSynthesis.speak(utterance)
  }
  return (
    <button className='text-button read-aloud' type='button' onClick={speak}>
      <Volume2 size={15} /> {reading ? 'Stop reading' : 'Read aloud'}
    </button>
  )
}
