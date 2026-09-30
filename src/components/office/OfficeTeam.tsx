import { ArrowUpRight, ChevronDown, Coins, Check, Users, X } from 'lucide-react';
import { useOfficeGameStore } from '../../store/officeGameStore';
import { useInstanceStore } from '../../store/instanceStore';
import { ACTIVITY_LABELS, getProviderColor } from '../../engine/SpriteManager';
import { characterSeed } from '../../engine/officeArt';
import { officeProvider, PROVIDER_NAMES } from '../../lib/officeActivity';
import { STATION_LABELS } from '../../lib/officeSpace';
import { OFFICE_CATALOG } from '../../lib/officeCatalog';

export function CharacterPortrait({ id, color, accessory = '' }: { id: string; color: string; accessory?: string }) {
  const seed = characterSeed(id), skin = ['#f1c29c', '#bd8968', '#966747', '#e3af81'][seed % 4];
  return <svg viewBox="0 0 40 44" className="office-portrait" aria-hidden="true" shapeRendering="crispEdges"><rect x="8" y="24" width="24" height="20" rx="3" fill={color} /><rect x="11" y="9" width="18" height="19" rx="2" fill={skin} /><path d="M10 9H30V15H14V19H10Z" fill={['#423632', '#b6804d', '#302e39', '#8a6751'][seed % 4]} /><path d="M15 19h2v2h-2zM23 19h2v2h-2z" fill="#24343d" />{accessory === 'headphones' && <path d="M8 18v-5Q20 0 32 13v5M8 17v9M32 17v9" fill="none" stroke="#f0bb77" strokeWidth="4" />}{accessory === 'cap' && <path d="M8 12L12 4H27L31 12H35V15H8Z" fill="#e7bb76" />}{accessory === 'crown' && <path d="M10 12L8 2L15 6L20 0L25 6L32 2L30 12Z" fill="#f3ce75" />}</svg>;
}
export function OfficeTeam({ selected, onSelect, onOpen, collapsed = false, onExpand }: { selected: string | null; onSelect: (id: string | null) => void; onOpen: (id: string) => void; collapsed?: boolean; onExpand?: () => void }) {
  const s = useOfficeGameStore();
  const instances = useInstanceStore(state => state.instances);
  const instance = selected ? instances.get(selected) : undefined;
  const worker = selected ? s.workers[selected] : undefined;
  const profile = selected ? s.profiles[selected] : undefined;
  const level = 1 + Math.floor((profile?.tasks ?? 0) / 5);
  const lastReward = s.rewards[0];
  if (collapsed) return <aside className="office-team office-team--collapsed" aria-label="Office team">
    <button onClick={onExpand} aria-expanded={false} aria-label="Show office team"><Users size={15} /><strong>Your team</strong><span>{Object.keys(s.workers).length} agents</span><ChevronDown size={15} /></button>
  </aside>;
  return <aside className="office-team" aria-label="Office team">
    <div className="office-team-heading"><div><span className="office-eyebrow">AGENTS IN YOUR WORKSPACE</span><h3>Your team <span>{Object.keys(s.workers).length}</span></h3></div><span className="office-live-badge">Live</span></div>
    <div className="office-roster">{Object.values(s.workers).map(w => {
      const i = instances.get(w.instanceId); if (!i) return null;
      const provider = officeProvider(i), appearance = s.profiles[i.id];
      return <button className={`office-agent ${selected === i.id ? 'selected' : ''}`} key={i.id} onClick={() => onSelect(selected === i.id ? null : i.id)} data-office-agent={i.id}>
        <CharacterPortrait id={appearance?.appearanceId ?? i.id} color={`#${getProviderColor(provider).toString(16).padStart(6, '0')}`} accessory={appearance?.accessory} />
        <div className="office-agent-info"><strong>{i.name}</strong><span>{PROVIDER_NAMES[provider] ?? provider} <i>·</i> Lv {1 + Math.floor((appearance?.tasks ?? 0) / 5)}</span><small data-activity={w.activity}>{ACTIVITY_LABELS[w.activity]}</small></div>
        <span className={`office-state-dot ${w.activity}`} />
      </button>;
    })}</div>
    {instance && worker ? <section className="office-agent-detail" aria-label="Agent details"><div className="office-detail-heading"><strong>{instance.name}</strong><button aria-label="Close agent details" onClick={() => onSelect(null)}><X size={15} /></button></div>
      <span className="office-detail-model">{PROVIDER_NAMES[officeProvider(instance)] ?? officeProvider(instance)} · {instance.config.llmConfig?.model ?? instance.config.model}</span>
      <div className="office-current-task"><span className="office-eyebrow">{STATION_LABELS[worker.activity]}</span><p>{worker.task || 'Ready for the next assignment.'}</p>{worker.detail && <small>{worker.detail}</small>}</div>
      <div className="office-agent-stats"><span><strong>{profile?.tasks ?? 0}</strong>turns</span><span><strong>{profile?.coins ?? 0}</strong>earned</span><span><strong>{level}</strong>level</span></div>
      <label className="office-accessory">Accessory<select aria-label={`Accessory for ${instance.name}`} value={profile?.accessory ?? ''} onChange={e => s.equip(instance.id, e.target.value)}><option value="">None</option>{OFFICE_CATALOG.filter(i => i.category === 'accessory' && s.purchasedItems.includes(i.id)).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
      <button className="office-open-chat" onClick={() => onOpen(instance.id)}>Open chat<ArrowUpRight size={15} /></button>
    </section> : <section className="office-reward-guide"><div><Coins size={20} /><strong>Good work pays off.</strong></div><p>Each completed turn earns <b>30 coins</b>, plus up to 20 for reading, building, research, and other reported work.</p><small>You start with 150 coins. Waiting, errors, and token spend earn no coins.</small></section>}
    <section className="office-recent"><div className="office-recent-title"><h4>Recent earnings</h4><span>{Math.floor(s.totalEarned).toLocaleString()} total</span></div>{s.rewards.slice(0, 4).map(reward => <div key={reward.id} className="office-reward"><span className="office-reward-check"><Check size={13} /></span><div><strong>{reward.name}</strong><span title={reward.task}>{reward.task || 'Conversation completed'}</span></div><b>+{reward.coins}</b></div>)}{!lastReward && <p className="office-muted">Your first completed turn will appear here.</p>}</section>
    {s.syncError && <div className="office-sync-error" role="alert">{s.syncError}</div>}
    <footer className="office-team-footer">Movement follows reported actions. Coins, furniture, and accessories save on this PC.</footer>
  </aside>;
}
