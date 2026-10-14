import { Globe, Music, Video, Gamepad2, MessageCircle, BookOpen, FileText, Timer, Puzzle, Calculator, NotebookPen, Dice5, Trophy } from 'lucide-react';
import { validWebAppIcon } from '../../lib/webApps';

const icons={Globe,Music,Video,Gamepad2,MessageCircle,BookOpen,FileText,Clock:Timer,Timer,Calculator,NotebookPen,Dice5,Trophy};
export function PluginIcon({icon,size=16,className}:{icon?:string;size?:number;className?:string}) {
  if(icon?.startsWith('data:') && validWebAppIcon(icon)) return <img src={icon} width={size} height={size} alt="" className={className} style={{objectFit:'contain',flexShrink:0,borderRadius:3}}/>;
  if(icon==='Chess') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}><path d="M5 20h14v2H5zM7 18c0-4 5-5 6-9l-4 3-5-2 5-7V1l4 2c5 0 7 5 5 11l-1 4"/><path d="M9 7h.01M7 18h10"/></svg>;
  const Icon=icon === '' ? Globe : icons[icon as keyof typeof icons]??Puzzle;
  return <Icon size={size} className={className} aria-hidden="true"/>;
}
