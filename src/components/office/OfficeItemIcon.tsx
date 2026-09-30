import { Armchair, Monitor, BookOpen, Coffee, Flower2, Lamp, Server, StickyNote, Printer, GlassWater, LayoutDashboard, Headphones, Crown, HardHat, Grid2X2, Archive, Presentation } from 'lucide-react';
export function OfficeItemIcon({ type, size = 24 }: { type: string; size?: number }) {
  const Icon = ({ desk: Monitor, chair: Armchair, couch: Armchair, bookshelf: BookOpen, coffee_machine: Coffee, plant: Flower2, lamp: Lamp, server_rack: Server, poster: StickyNote, printer: Printer, water_cooler: GlassWater, task_board: LayoutDashboard, whiteboard: Presentation, filing_cabinet: Archive, headphones: Headphones, crown: Crown, cap: HardHat } as Record<string, typeof Monitor>)[type] ?? Grid2X2;
  return <Icon size={size} strokeWidth={1.5} />;
}
