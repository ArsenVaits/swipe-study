import Studio from '../studio-view'
import './studio.css'

export default async function StudioPage({
  searchParams
}: {
  searchParams: Promise<{ view?: string | string[]; topic?: string | string[] }>
}) {
  const { view, topic } = await searchParams
  const initialView = view === 'library' || view === 'saved' ? view : 'feed'
  return <Studio initialView={initialView} initialTopic={typeof topic === 'string' ? topic : undefined} />
}
