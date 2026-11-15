// Topic tracks of the ready-made catalog. `id` is the stable identifier the frontend filters by.

export interface Track {
  id: string;
  title: string;
  titleRu: string;
  /** Accent colour used by the catalog videos of this track. */
  color: string;
}

export const TRACKS: Track[] = [
  { id: "programming", title: "Programming", titleRu: "Программирование", color: "#4ade80" },
  { id: "mathematics", title: "Mathematics", titleRu: "Математика", color: "#a78bfa" },
  { id: "geography", title: "Geography", titleRu: "География", color: "#2dd4bf" },
  { id: "ai", title: "AI", titleRu: "Искусственный интеллект", color: "#f472b6" },
  { id: "devops", title: "DevOps", titleRu: "DevOps", color: "#fb923c" },
  { id: "science", title: "Science", titleRu: "Наука", color: "#38bdf8" },
  { id: "history", title: "History", titleRu: "История", color: "#e0a94a" },
  { id: "languages", title: "Languages", titleRu: "Языки", color: "#f87171" },
  { id: "productivity", title: "Productivity", titleRu: "Продуктивность", color: "#facc15" },
  { id: "communication", title: "Communication", titleRu: "Коммуникация", color: "#60a5fa" },
  { id: "design", title: "Design", titleRu: "Дизайн", color: "#e879f9" },
];

export const TRACK_IDS = new Set(TRACKS.map((t) => t.id));
