import { ArrowUpRight, ChevronDown, Coins, Check, Users, X } from 'lucide-react';
import { useOfficeGameStore } from '../../store/officeGameStore';
import { useInstanceStore } from '../../store/instanceStore';
import { ACTIVITY_LABELS, getProviderColor } from '../../engine/SpriteManager';
import { characterSeed } from '../../engine/officeArt';
import { officeProvider, PROVIDER_NAMES } from '../../lib/officeActivity';
import { STATION_LABELS } from '../../lib/officeSpace';
import { OFFICE_CATALOG, SLOT_LABELS, officeItem, bonusLabel } from '../../lib/officeCatalog';
import { ProviderIcon } from '../icons/ProviderIcons';
import { incomeMultiplier, modelCoefficient, modelKey, officeBonuses } from '../../lib/officeEconomy';
import { WEARABLE_SLOTS, type WorkerProfile } from '../../types/office';

export function CharacterPortrait({ id, color, wearables, provider }: { id: string; color: string; provider?:string; wearables?: WorkerProfile['wearables'] }) {
  const seed = characterSeed(id), skin = ['#f1c29c', '#bd8968', '#966747', '#e3af81'][seed % 4];
  color=officeItem(wearables?.shirt??'')?.color??color;
  const { head, face, neck } = wearables ?? {};
  return <svg viewBox="0 0 40 44" className="office-portrait" aria-hidden="true" shapeRendering="crispEdges"><rect x="8" y="24" width="24" height="20" rx="3" fill={color} /><rect x="11" y="9" width="18" height="19" rx="2" fill={skin} /><path d="M10 9H30V15H14V19H10Z" fill={['#423632', '#b6804d', '#302e39', '#8a6751'][seed % 4]} /><path d="M15 19h2v2h-2zM23 19h2v2h-2z" fill="#24343d" />
    {neck === 'tie' && <path d="M19 28h2l1 8-2 3-2-3z" fill="#c24d4d" />}{neck === 'bowtie' && <path d="M13 26l6 2-6 2zM27 26l-6 2 6 2z" fill="#c24d4d" />}{neck === 'scarf' && <path d="M9 25h22v5H9zM23 30h5v9h-5z" fill="#e28a4a" />}{neck === 'lanyard' && <><path d="M16 25l4 9 4-9" fill="none" stroke="#4aa3df" strokeWidth="1.5" /><rect x="17" y="33" width="6" height="7" fill="#f2f2f2" /></>}
    {face === 'glasses' && <path d="M13 17h6v5h-6zM21 17h6v5h-6zM19 19h2" fill="none" stroke="#24343d" strokeWidth="1.5" />}{face === 'sunglasses' && <path d="M13 17h6v5h-6zM21 17h6v5h-6zM19 19h2" fill="#1a1f26" stroke="#1a1f26" strokeWidth="1.5" />}{face === 'monocle' && <><circle cx="24" cy="20" r="3.5" fill="none" stroke="#f3ce75" strokeWidth="1.5" /><path d="M27 22l3 7" stroke="#f3ce75" strokeWidth="1" /></>}
    {head === 'headphones' && <path d="M8 18v-5Q20 0 32 13v5M8 17v9M32 17v9" fill="none" stroke="#f0bb77" strokeWidth="4" />}{head === 'cap' && <path d="M8 12L12 4H27L31 12H35V15H8Z" fill="#e7bb76" />}{head === 'beanie' && <><path d="M9 14Q20 -2 31 14V17H9Z" fill="#b75c6b" /><rect x="9" y="14" width="22" height="3" fill="#8f4452" /><circle cx="20" cy="4" r="3" fill="#f0d7a6" /></>}{head === 'beret' && <><ellipse cx="18" cy="9" rx="13" ry="5" fill="#3b4f8f" /><rect x="17" y="2" width="2" height="4" fill="#2a3a6b" /></>}{head === 'visor' && <><path d="M8 14h24l4 3H4z" fill="#3dd1a0" /><rect x="10" y="10" width="20" height="4" fill="#2fae84" /></>}{head === 'party_hat' && <><path d="M12 11L28 11L20 -5Z" fill="#7fc0e8" /><path d="M15 5h10l-1-3h-8z" fill="#f5d76e" /></>}{head === 'crown' && <path d="M10 12L8 2L15 6L20 0L25 6L32 2L30 12Z" fill="#f3ce75" />}{head === 'halo' && <ellipse cx="20" cy="3" rx="11" ry="3" fill="none" stroke="#f3ce75" strokeWidth="2" />}
    {provider && <svg x="16" y="32" width="8" height="8" viewBox="0 0 12 12" style={{color:"#fff"}}><ProviderIcon provider={provider==='codex'?'openai':provider} size={12}/></svg>}
  </svg>;
}
/** One select per slot, listing the wearables the team owns for that slot. */
export function WearablePicker({ panelId, name }: { panelId: string; name: string }) {
  const s=useOfficeGameStore(), profile=s.profiles[panelId];
  const instance=useInstanceStore(state=>state.instances.get(panelId));
  const provider=instance?officeProvider(instance):'', model=instance?.config.llmConfig?.model??instance?.config.model??'unknown';
  return <div className="office-wearables">
    <label className="office-accessory">Computer<select aria-label={`Computer for ${name}`} value={profile?.pc??'pc-0'} onChange={e=>s.equipPC(panelId,e.target.value)}>{OFFICE_CATALOG.filter(i=>i.category==='pc' && (i.id==='pc-0'||s.inventory[i.id]>0||profile?.pc===i.id)).map(i=><option key={i.id} value={i.id}>{i.name} · ×{i.pcMultiplier?.toFixed(2)}</option>)}</select></label>
    {WEARABLE_SLOTS.map(slot=>{
      const owned=OFFICE_CATALOG.filter(i=>i.slot===slot && (s.inventory[i.id]>0||profile?.wearables[slot]===i.id));
      return <label key={slot} className="office-accessory">{SLOT_LABELS[slot]}<select aria-label={`${SLOT_LABELS[slot]} wearable for ${name}`} value={profile?.wearables[slot]??''} disabled={!owned.length} onChange={e=>e.target.value?s.equip(panelId,e.target.value):s.unequip(panelId,slot)}><option value="">{owned.length?'Default':'Nothing in storage'}</option>{owned.map(i=><option key={i.id} value={i.id}>{i.name} · {bonusLabel(i)}</option>)}</select></label>;
    })}
    <details className="office-income-details"><summary>Income ×{incomeMultiplier(s,panelId,provider,model).toFixed(3)}</summary><p>Activity ×{(profile?.activity??1).toFixed(3)} · Model ×{modelCoefficient(s.modelBase[modelKey(provider,model)]??0).toFixed(3)} · Provider 1.000 + {officeBonuses(s.layout,provider).server.toFixed(3)} server</p><p>Activity stays between 1 and 2. It increases during work and gently returns to 1 while idle.</p></details>
  </div>;
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
        <CharacterPortrait id={appearance?.appearanceId ?? i.id} color={`#${getProviderColor(provider).toString(16).padStart(6, '0')}`} wearables={appearance?.wearables} provider={provider} />
        <div className="office-agent-info"><strong>{i.name}</strong><span>{PROVIDER_NAMES[provider] ?? provider} <i>·</i> Lv {1 + Math.floor((appearance?.tasks ?? 0) / 5)}</span><small data-activity={w.activity}>{ACTIVITY_LABELS[w.activity]}</small></div>
        <span className={`office-state-dot ${w.activity}`} />
      </button>;
    })}</div>
    {instance && worker ? <section className="office-agent-detail" aria-label="Agent details"><div className="office-detail-heading"><strong>{instance.name}</strong><button aria-label="Close agent details" onClick={() => onSelect(null)}><X size={15} /></button></div>
      <span className="office-detail-model">{PROVIDER_NAMES[officeProvider(instance)] ?? officeProvider(instance)} · {instance.config.llmConfig?.model ?? instance.config.model}</span>
      <div className="office-current-task"><span className="office-eyebrow">{STATION_LABELS[worker.activity]}</span><p>{worker.task || 'Ready for the next assignment.'}</p>{worker.detail && <small>{worker.detail}</small>}</div>
      <div className="office-agent-stats"><span><strong>{profile?.tasks ?? 0}</strong>turns</span><span><strong>{Math.floor(profile?.coins ?? 0)}</strong>earned</span><span><strong>{level}</strong>level</span></div>
      <WearablePicker panelId={instance.id} name={instance.name} />
      <button className="office-open-chat" onClick={() => onOpen(instance.id)}>Open chat<ArrowUpRight size={15} /></button>
    </section> : <section className="office-reward-guide"><div><Coins size={20} /><strong>Good work pays off.</strong></div><p>Reported tokens earn coins according to model value, equipment, and your company bonuses.</p><small>Keep working in your chats. Office View does not need to stay open, and idle characters earn nothing.</small></section>}
    <section className="office-recent"><div className="office-recent-title"><h4>Recent earnings</h4><span>{Math.floor(s.totalEarned).toLocaleString()} total</span></div>{s.rewards.slice(0, 4).map(reward => <div key={reward.id} className="office-reward"><span className="office-reward-check"><Check size={13} /></span><div><strong>{reward.name}</strong><span title={`${reward.task}${reward.estimated?' · Game-estimated model value':''}`}>{reward.task || 'Conversation completed'}</span></div><b>+{reward.coins.toFixed(2)}</b></div>)}{!lastReward && <p className="office-muted">Your first completed turn will appear here.</p>}</section>
    {s.syncError && <div className="office-sync-error" role="alert">{s.syncError}</div>}
    <footer className="office-team-footer">Movement follows reported actions. Coins, furniture, and accessories save on this PC.</footer>
  </aside>;
}
