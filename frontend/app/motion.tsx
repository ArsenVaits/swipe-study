'use client'

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Layers3, Menu, Play, X } from 'lucide-react'
import gsap from 'gsap'
import seeds from '@/lib/discovery-seeds.json'
import './motion.css'

const library = '/studio?view=library'
const topics = [
  { name: 'Programming', collage: ['code-debug', 'code-functions', 'devops-ci', 'devops-rollbacks'] },
  { name: 'Science', collage: ['science-controls', 'history-sources', 'geo-time'] },
  { name: 'AI & Design', collage: ['ai-grounding', 'ai-prompts', 'design-feedback', 'design-hierarchy'], topic: 'AI' },
]

const lessons = [
  { title: 'Read a PDF.', text: 'Turn your document into a series of focused lessons.', image: 'saas', link: '/studio' },
  { title: 'Make it stick.', text: 'Recall the key idea with a question and an explanation.', image: 'talking', link: '/studio#lesson-feed' },
  { title: 'Watch in Shorts.', text: 'Swipe through vertical lessons, one idea at a time.', image: 'ads', link: '/studio#lesson-feed' },
  { title: 'Explore a topic.', text: 'Find videos on code, geography, design and more.', image: '3d', link: library },
  { title: 'Check the source.', text: 'Open the original page behind the lesson.', image: 'explainer', link: '/studio#lesson-feed' },
  { title: 'Learn the numbers.', text: 'Practice percentages, averages and other essentials.', image: 'data', link: library + '&topic=Mathematics' },
]

const faqs = [
  ['What does simple study do?', 'simple study reads a text-based PDF and turns it into short videos with captions and a quiz for each lesson.'],
  ['Can I try it with my own PDF?', 'Yes. Open the studio and drop in a PDF with selectable text. You can also try the included feedback guide.'],
  ['Can I watch without uploading anything?', 'Yes. Open the Library and choose a topic. Select a clip to watch it full-screen, then swipe or scroll to the next one.'],
  ['How do I find a topic?', 'Type a topic in the Library search field. English and Russian topic keywords are supported.'],
  ['Can I check where a lesson came from?', 'The source tab shows the quote and source page. While the uploaded file is open, you can jump back to that page.'],
  ['Where do saved lessons go?', 'Open Saved to find lessons you made and clips you bookmarked in this browser.'],
  ['What happens to my PDF?', 'The file stays in your browser. simple study sends its extracted text to the server to create the lessons and render the videos.'],
  ['Do I need an account?', 'You can use the studio, Library and Saved as soon as you open the local preview.'],
]

const pathways = [
  { title: 'Sample', hint: 'See a complete lesson first.', big: '2', unit: 'sample lessons', facts: ['Workplace feedback', 'Video, quiz and source', 'Ready to watch'], button: 'Watch the example', link: '/studio#lesson-feed' },
  { title: 'Studio', hint: 'Make a lesson from your material.', big: 'PDF', unit: 'to short lesson', facts: ['Upload a PDF', 'Short video with captions', 'An answer you can verify'], button: 'Start learning', link: '/studio' },
  { title: 'Library', hint: 'Find a subject you want to learn.', big: '11', unit: 'topics', facts: ['Search by topic', 'Full-screen video feed', 'Bookmark your favourites'], button: 'Explore the library', link: library },
]

const showcase = ['ai-prompts', 'geo-time', 'code-functions', 'devops-ci', 'design-hierarchy', 'language-recall', 'math-percent', 'history-sources', 'science-controls', 'focus']
  .map(id => seeds.find(lesson => lesson.id === id)!)

type Clip = typeof seeds[number]
type Dialog = { type: 'guide' } | { type: 'clip'; clip: Clip }

function Wordmark() {
  return <a className="ms-wordmark" href="/" aria-label="simple study home">
    <span><Layers3 size={18} strokeWidth={2.5} /></span>
    <strong>simple <span>study</span></strong>
  </a>
}

function Header() {
  const [announced, setAnnounced] = useState(true)
  const [menu, setMenu] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const dropdown = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setAnnounced(sessionStorage.getItem('scrolled-motion-announcement') !== 'closed')
    const close = (event: globalThis.PointerEvent) => {
      if (!dropdown.current?.contains(event.target as Node)) setExpanded(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpanded(false)
        setMenu(false)
      }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [])

  return <>
    {announced && <div className="ms-announcement">
      Explore simple study. Your first lesson is ready to watch. <a href="/studio#lesson-feed">Try the demo</a>
      <button aria-label="Close announcement" onClick={() => {
        sessionStorage.setItem('scrolled-motion-announcement', 'closed')
        setAnnounced(false)
      }}><X size={19} /></button>
    </div>}
    <header className="ms-sticky">
      <div className="ms-header">
        <Wordmark />
        <nav aria-label="Main navigation" className="ms-nav">
          <div className="ms-dropdown" ref={dropdown} data-open={expanded || undefined}>
            <button aria-expanded={expanded} aria-controls="motion-library-menu" onClick={() => setExpanded(!expanded)}>
              Library <ChevronDown size={13} />
            </button>
            <div className="ms-dropdown-panel" id="motion-library-menu">
              <a href={library}>All topics</a>
              <a href={library + '&topic=Programming'}>Programming</a>
              <a href={library + '&topic=AI'}>AI</a>
              <a href={library + '&topic=Mathematics'}>Mathematics</a>
            </div>
          </div>
          <a href="#workflow">How it works</a>
          <a href="#features">Features</a>
          <a href="#start">Get started</a>
          <a href="#faq">Help</a>
        </nav>
        <div className="ms-header-actions">
          <a className="ms-saved-link" href="/studio?view=saved">Saved</a>
          <a className="ms-button ms-silver" href="/studio">Start learning</a>
          <button className="ms-menu-toggle" aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu} aria-controls="motion-mobile-menu" onClick={() => setMenu(!menu)}>
            {menu ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        {menu && <nav id="motion-mobile-menu" className="ms-mobile-menu" aria-label="Mobile navigation" onClick={() => setMenu(false)}>
          <a href={library}>Library</a><a href="#workflow">How it works</a><a href="#features">Features</a>
          <a href="#start">Get started</a><a href="#faq">Help</a><a href="/studio?view=saved">Saved</a>
        </nav>}
      </div>
    </header>
  </>
}

function HeroHead() {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const target = canvas.current
    const context = target?.getContext('2d')
    if (!target || !context) return

    const image = new Image()
    let disposed = false
    let cleanup = () => {}
    image.onload = () => {
      if (disposed) return
      const source = document.createElement('canvas')
      source.width = 70
      source.height = Math.round(source.width * image.height / image.width * .62)
      const pixels = source.getContext('2d', { willReadFrequently: true })
      if (!pixels) return

      pixels.drawImage(image, 0, 0, source.width, source.height)
      const data = pixels.getImageData(0, 0, source.width, source.height).data
      const stepX = target.width / source.width
      const stepY = target.height / source.height
      const chars = '.:+*#%@'
      const render = (time: number) => {
        context.clearRect(0, 0, target.width, target.height)
        context.font = '12px monospace'
        context.textBaseline = 'top'
        for (let y = 0; y < source.height; y++) {
          const scan = time ? Math.sin(y * .41 - time * 1.15) * .09 : 0
          for (let x = 0; x < source.width; x++) {
            const offset = (y * source.width + x) * 4
            const bright = (data[offset] + data[offset + 1] + data[offset + 2]) / 765
            const density = bright * data[offset + 3] / 255
            if (density < .065) continue
            const char = chars[Math.min(chars.length - 1, Math.floor(density * 8))]
            context.fillStyle = 'rgba(235,235,235,' + Math.min(.98, .2 + density * .9 + scan) + ')'
            context.fillText(char, x * stepX, y * stepY)
          }
        }
      }
      render(0)
      target.dataset.ready = 'true'
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      let frame = 0
      const tick = (time: number) => {
        if (++frame % 3 === 0) render(time)
      }
      const observer = new IntersectionObserver(([entry]) => {
        gsap.ticker.remove(tick)
        if (entry.isIntersecting) gsap.ticker.add(tick)
      })
      observer.observe(target)
      cleanup = () => { observer.disconnect(); gsap.ticker.remove(tick) }
    }
    image.src = '/motion/hero-head-front.png'
    return () => { disposed = true; cleanup() }
  }, [])

  return <div className="ms-head" aria-hidden="true">
    <img src="/motion/hero-head-back.png" alt="" width={681} height={577} />
    <img className="ms-head-fallback" src="/motion/hero-head-ascii.webp" alt="" width={681} height={577} />
    <canvas ref={canvas} width={681} height={577} />
  </div>
}

function Hero() {
  const stage = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = stage.current
    if (!node || !window.matchMedia('(prefers-reduced-motion: no-preference) and (pointer: fine)').matches) return
    const xTo = gsap.quickTo(node, 'x', { duration: .7, ease: 'power3.out' })
    const yTo = gsap.quickTo(node, 'y', { duration: .7, ease: 'power3.out' })
    const move = (event: MouseEvent) => {
      xTo((event.clientX - window.innerWidth / 2) * .018)
      yTo((event.clientY - window.innerHeight / 2) * .018)
    }
    const section = node.closest('section')
    const reset = () => { xTo(0); yTo(0) }
    section?.addEventListener('mousemove', move)
    section?.addEventListener('mouseleave', reset)
    return () => {
      section?.removeEventListener('mousemove', move)
      section?.removeEventListener('mouseleave', reset)
      xTo.tween.kill()
      yTo.tween.kill()
    }
  }, [])

  return <section className="ms-hero">
    <h1>Meet <span>simple study,</span></h1>
    <p>Turn a work PDF into short video lessons and quick quizzes.</p>
    <div className="ms-hero-actions">
      <a className="ms-button ms-silver" href="/studio"><Play size={13} fill="currentColor" /> Start learning</a>
      <a className="ms-pill" href="#workflow"><strong>From PDF</strong> to a lesson you can swipe <ArrowRight size={18} /></a>
    </div>
    <div className="ms-hero-art" ref={stage}>
      <div className="ms-hero-cards">
        {topics.map(item => <a key={item.name} href={library + '&topic=' + encodeURIComponent(item.topic || item.name)} className="ms-hero-card">
          <span className="ms-hero-collage" style={{ '--columns': item.collage.length === 3 ? 3 : 2 } as CSSProperties}>
            {item.collage.map(id => <img key={id} src={'/discover/' + id + '.webp'} alt="" />)}
          </span>
          <span>{item.name}</span>
        </a>)}
      </div>
      <div className="ms-head-chips" aria-hidden="true">{[0, 1, 2, 3].map(index =>
        <span key={index}>{index === 2 ? '11' : <i />}</span>)}
      </div>
      <HeroHead />
    </div>
  </section>
}

function Showcase({ onOpen }: { onOpen: (clip: Clip) => void }) {
  const stage = useRef<HTMLDivElement>(null)
  const position = useRef({ value: 0 })
  const drag = useRef<{ id: number; x: number; y: number; start: number; moved: boolean } | null>(null)
  const suppressed = useRef(false)
  const adjustment = useRef<gsap.core.Tween | null>(null)

  useEffect(() => {
    const container = stage.current
    if (!container) return
    const cards = [...container.querySelectorAll<HTMLButtonElement>('.ms-showcase-card')]
    const videos = cards.map(el => el.querySelector('video')!)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const wrap = gsap.utils.wrap(-cards.length / 2, cards.length / 2)
    let visible = false
    let radius = 390
    let gap = 224
    let limit = 3.8
    let lastPlay = -1

    const draw = () => {
      cards.forEach((card, index) => {
        const offset = wrap(index - position.current.value)
        const abs = Math.abs(offset)
        const x = offset * gap + offset * abs * gap * .038
        card.style.transform = `translate3d(${x}px, ${-abs * 3}px, ${abs * 13}px) rotateY(${offset * -8}deg)`
        card.style.visibility = abs > limit ? 'hidden' : 'visible'
        card.style.zIndex = String(Math.round(50 - abs * 10))
      })
    }

    const play = () => {
      const center = Math.round(position.current.value)
      if (lastPlay === center) return
      lastPlay = center
      videos.forEach((video, index) => {
        if (visible && !reduced && Math.abs(wrap(index - center)) <= 2) {
          void video.play().catch(() => {})
        } else video.pause()
      })
    }

    const measure = () => {
      const card = cards[0]
      radius = container.clientWidth
      gap = card.offsetWidth + Math.max(12, radius * .012)
      limit = Math.min(4.8, radius / (gap * 1.85) + .8)
      draw()
    }

    const tick = (_: number, delta: number) => {
      if (visible && !reduced && !drag.current && !adjustment.current?.isActive() &&
          !container.matches(':hover, :focus-within')) {
        position.current.value += Math.min(delta, 50) * .00042
      }
      draw()
      play()
    }

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      gsap.ticker.remove(tick)
      if (visible) {
        lastPlay = -1
        gsap.ticker.add(tick)
      } else videos.forEach(video => video.pause())
    }, { rootMargin: '80px' })
    const resize = new ResizeObserver(measure)
    observer.observe(container)
    resize.observe(container)
    measure()
    return () => {
      observer.disconnect()
      resize.disconnect()
      gsap.ticker.remove(tick)
      adjustment.current?.kill()
      videos.forEach(video => video.pause())
    }
  }, [])

  function snap(value: number) {
    adjustment.current?.kill()
    adjustment.current = gsap.to(position.current, {
      value, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : .43, ease: 'power3.out',
    })
  }

  function handleDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    adjustment.current?.kill()
    suppressed.current = false
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: position.current.value, moved: false }
  }

  function handleMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (!start || start.id !== event.pointerId) return
    const dx = event.clientX - start.x
    if (!start.moved && (Math.abs(dx) < 7 || Math.abs(dx) < Math.abs(event.clientY - start.y))) return
    if (!start.moved) event.currentTarget.setPointerCapture(event.pointerId)
    start.moved = true
    const card = event.currentTarget.querySelector<HTMLElement>('.ms-showcase-card')
    position.current.value = start.start - dx / ((card?.offsetWidth || 200) + 14)
  }

  function handleUp(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (!start || start.id !== event.pointerId) return
    drag.current = null
    suppressed.current = start.moved
    if (start.moved) snap(Math.round(position.current.value))
  }

  return <section id="showcase" className="ms-showcase">
    <div className="ms-section-heading ms-centered">
      <h2>Made with simple study</h2>
      <p>One idea per video. Explore short lessons from the library.</p>
      <a className="ms-button ms-outline" href={library}>Browse topics <ArrowRight size={18} /></a>
    </div>
    <div ref={stage} className="ms-ring" aria-label="Lesson carousel" tabIndex={0}
      onPointerDown={handleDown} onPointerMove={handleMove} onPointerUp={handleUp} onPointerCancel={handleUp}
      onPointerLeave={event => { if (!drag.current?.moved) handleUp(event) }}
      onKeyDown={event => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault()
          snap(Math.round(position.current.value) + (event.key === 'ArrowRight' ? 1 : -1))
        }
      }}>
      <div className="ms-ring-glow" aria-hidden="true" />
      {showcase.map((clip, index) => <button type="button" className="ms-showcase-card"
        aria-label={'Play ' + clip.title} key={clip.id}
        style={{ '--initial': index < showcase.length / 2 ? index : index - showcase.length } as CSSProperties}
        onClick={() => {
          if (!suppressed.current) onOpen(clip)
          suppressed.current = false
        }}>
        <video src={clip.video} poster={clip.poster} muted loop playsInline preload="none" aria-hidden="true" />
        <span className="ms-showcase-label"><Play size={13} fill="currentColor" /> {clip.title}</span>
      </button>)}
    </div>
  </section>
}

function Features() {
  return <>
    <section id="features" className="ms-section">
      <div className="ms-section-heading"><h2>What can you learn?</h2>
        <p>Work through your own material or jump into a topic.</p></div>
      <div className="ms-feature-grid">
        {lessons.map(({ title, text, link, image }, index) => <a key={title} href={link} className={'ms-feature-card' + (index % 2 ? ' ms-lilac' : '')}>
          <img src={'/motion/types/' + image + '.webp'} alt="" loading="lazy" />
          <div><h3>{title}</h3><p>{text}</p></div>
          <ArrowUpRight size={21} className="ms-feature-arrow" />
        </a>)}
      </div>
    </section>
    <section className="ms-section ms-kit">
      <div className="ms-section-heading"><h2>What’s in the box</h2></div>
      <a href="/studio" className="ms-kit-lead ms-tile">
        <img src="/motion/package/director.webp" alt="" loading="lazy" />
        <div><small>The studio</small><h3>The lesson<br /> builder</h3><p>Make a video recap and a quiz from a PDF.</p></div>
      </a>
      <div className="ms-kit-pair">
        <a className="ms-kit-box ms-tile" href={library}>
          <img src="/motion/package/box.webp" alt="" loading="lazy" />
          <div><strong>simple study Library</strong><i aria-hidden="true" /></div>
        </a>
        <dl className="ms-stats ms-tile">
          {[[11, 'Topics'], [seeds.length, 'Library videos'], [2, 'Sample lessons'], ['9:16', 'Video format'], [1, 'Question per lesson'], ['PDF', 'Source material']].map(([quantity, label]) => (
            <div key={label}><dt>{quantity}</dt><dd>{label}</dd></div>
          ))}
        </dl>
      </div>
      <div className="ms-kit-trio">
        {[
          ['Captions', 'Follow every short.', 'type', '/studio#lesson-feed'],
          ['Library', 'Find a new topic.', 'styles', library],
          ['Saved', 'Pick up where you left off.', 'voice', '/studio?view=saved'],
        ].map(([label, title, image, link]) => <a className="ms-kit-mini ms-tile" href={link} key={label}>
          <img src={'/motion/package/' + image + '.webp'} alt="" loading="lazy" />
          <div><small>{label}</small><h3>{title}</h3></div>
        </a>)}
      </div>
    </section>
  </>
}

function Footer() {
  return <footer className="ms-footer">
    <div className="ms-footer-inner">
      <div className="ms-footer-brand"><Wordmark /><p>Short video lessons built from your PDFs. Watch, practice and check the source.</p>
        <a className="ms-button ms-outline" href="/studio">Open the studio <ArrowRight size={17} /></a></div>
      <div><h2>Product</h2><a href="/studio">Studio</a><a href="/studio?view=saved">Saved</a><a href="#features">Features</a></div>
      <div><h2>Library</h2><a href={library}>All topics</a><a href={library + '&topic=Programming'}>Programming</a><a href={library + '&topic=AI'}>AI</a></div>
      <div><h2>Support</h2><a href="#workflow">How it works</a><a href="#faq">FAQ</a></div>
      <p className="ms-footer-note">simple study</p>
    </div>
  </footer>
}

export default function MotionHome() {
  const [tip, setTip] = useState(false)
  const [content, setContent] = useState<Dialog | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const page = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (sessionStorage.getItem('scrolled-motion-tip') === 'closed') return
    const timer = window.setTimeout(() => setTip(true), 1500)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (content && !dialog.current?.open) dialog.current?.showModal()
  }, [content])

  useEffect(() => {
    const node = page.current
    if (!node || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const animations = gsap.context(() => {
      gsap.from('.ms-hero h1, .ms-hero > p, .ms-hero-actions', {
        opacity: 0, y: 12, duration: .58, stagger: .08, ease: 'power2.out',
        clearProps: 'opacity,y'
      })
    }, node)
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        observer.unobserve(entry.target)
        animations.add(() => gsap.from(entry.target, {
          opacity: .3, y: 20, duration: .55, ease: 'power2.out', clearProps: 'opacity,transform'
        }))
      }
    }, { threshold: .12 })
    node.querySelectorAll('.ms-section-heading, .ms-feature-card, .ms-tile, .ms-plan, .ms-workflow article')
      .forEach(element => observer.observe(element))
    return () => { observer.disconnect(); animations.revert() }
  }, [])

  return <div className="ms-site" ref={page}>
    <Header />
    <main>
      <Hero />
      <Showcase onOpen={clip => setContent({ type: 'clip', clip })} />
      <Features />
      <section id="start" className="ms-section">
        <div className="ms-section-heading"><h2>Choose where to start.</h2><p>Try a lesson, bring a PDF or explore the library.</p></div>
        <div className="ms-plans">
          {pathways.map((plan, index) => <article key={plan.title} className={index === 1 ? 'ms-plan ms-plan-highlight' : 'ms-plan'}>
            {index === 1 && <span className="ms-plan-flag">Create a lesson</span>}
            <h3>{plan.title}</h3><p>{plan.hint}</p>
            <div className="ms-plan-value"><strong>{plan.big}</strong> <span>{plan.unit}</span></div>
            <a className="ms-button ms-outline" href={plan.link}>{plan.button}</a>
            <ul>{plan.facts.map(fact => <li key={fact}><Check size={15} />{fact}</li>)}</ul>
          </article>)}
        </div>
      </section>
      <section id="workflow" className="ms-section">
        <div className="ms-section-heading"><h2>From a PDF to a short.</h2><p>Pick one idea to learn and check what you remember.</p></div>
        <div className="ms-workflow">
          {[
            ['Open a PDF', 'Start with a text-based document or use the built-in feedback guide.'],
            ['Watch the recap', 'Get a short video with captions and read the explanation.'],
            ['Answer a question', 'See why the answer is right and open the source page.'],
          ].map(([title, text], index) => <article key={title}><span aria-hidden="true">{index + 1}</span><h3>{title}</h3><p>{text}</p></article>)}
        </div>
        <a className="ms-button ms-silver" href="/studio">Make a lesson <ArrowRight size={18} /></a>
      </section>
      <section id="faq" className="ms-section">
        <div className="ms-section-heading"><h2>Frequently asked questions</h2></div>
        <div className="ms-faq">
          {faqs.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}
        </div>
        <button className="ms-help-link" onClick={() => setContent({ type: 'guide' })}>
          <span><strong>Still figuring it out?</strong><small>See how a PDF turns into short lessons.</small></span><ArrowRight size={20} />
        </button>
      </section>
    </main>
    <Footer />
    {tip && <aside className="ms-tip" aria-label="Quick start">
      <button className="ms-tip-close" aria-label="Close quick start" onClick={() => {
        sessionStorage.setItem('scrolled-motion-tip', 'closed')
        setTip(false)
      }}><X size={20} /></button>
      <button className="ms-tip-link" onClick={() => setContent({ type: 'guide' })}>
        <span className="ms-tip-image"><img src="/motion/package/director.webp" alt="" /><strong>Learn<br /><em>in one swipe</em></strong><i><Play size={12} fill="currentColor" /></i></span>
        <span className="ms-tip-copy"><strong>Not sure where to start?</strong><span>See how to make your first lesson.</span><b>Watch the example →</b></span>
      </button>
    </aside>}
    <dialog ref={dialog} className="ms-dialog" aria-label={content?.type === 'clip' ? content.clip.title : 'How simple study works'}
      onClose={() => setContent(null)}
      onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close() }}>
      {content && <div className="ms-dialog-content">
        <button className="ms-dialog-close" aria-label="Close preview" onClick={() => dialog.current?.close()}><X size={22} /></button>
        <video key={content.type === 'clip' ? content.clip.id : 'guide'} src={content.type === 'clip' ? content.clip.video : '/sample/feedback.mp4'}
          poster={content.type === 'clip' ? content.clip.poster : '/sample/feedback.webp'} controls playsInline autoPlay />
        <div>
          <h2>{content.type === 'clip' ? content.clip.title : 'From a PDF to a short.'}</h2>
          <p>{content.type === 'clip' ? content.clip.description : 'Here’s a finished lesson from the feedback guide. Open the studio to try the quiz or make a short from your own PDF.'}</p>
          <a className="ms-button ms-silver" href={content.type === 'clip' ? library + '&topic=' + encodeURIComponent(content.clip.topic) : '/studio#lesson-feed'}>
            {content.type === 'clip' ? 'See more in ' + content.clip.topic : 'Open the studio'} <ArrowRight size={17} />
          </a>
        </div>
      </div>}
    </dialog>
  </div>
}
