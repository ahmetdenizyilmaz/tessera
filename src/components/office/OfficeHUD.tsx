import { ArrowLeft, Coins, Pencil, ShoppingBag, Sparkles, Building2 } from 'lucide-react';
import { useOfficeGameStore } from '../../store/officeGameStore';
import { OFFICE_LOCATIONS, globalCoefficient } from '../../lib/officeEconomy';
import { isWorking } from '../../store/salaryEngine';

export function OfficeHUD({ onBack }: { onBack: () => void }) {
  const state = useOfficeGameStore();
  const working = Object.values(state.workers).filter(w => isWorking(w.activity)).length;
  const level = 1 + Math.floor(state.completedTasks / 10);
  return <header className="office-hud">
    <div className="office-hud__identity"><button className="office-back" onClick={onBack} aria-label="Back to panels"><ArrowLeft size={18} /></button><div><span className="office-eyebrow">YOUR AGENT STUDIO</span><h2>{OFFICE_LOCATIONS[state.location].name} <span>Lv {level}</span></h2></div></div>
    <div className="office-hud__progress"><Sparkles size={17} /><div><strong>{working} agents at work</strong><span>Global {globalCoefficient(state.companyBase).toFixed(3)} · Permanent ×{state.permanent.toFixed(3)}</span></div><div className="office-level-track"><i style={{ width: `${state.completedTasks % 10 * 10}%` }} /></div></div>
    <div className="office-hud__actions"><div className="office-wallet" title="Game coins earned from recorded token usage"><Coins size={20} /><strong data-testid="office-balance">{Math.floor(state.currency).toLocaleString()}</strong><span>coins</span></div>
      <button aria-label="Company" onClick={()=>useOfficeGameStore.setState({companyOpen:!state.companyOpen,shopOpen:false,editMode:false})}><Building2 size={16}/>Company</button>
      <button className={state.editMode ? 'active' : ''} onClick={() => state.setEditMode(!state.editMode)}><Pencil size={16} />Decorate</button>
      <button className={`office-shop-toggle ${state.shopOpen ? 'active' : ''}`} onClick={() => state.setShopOpen(!state.shopOpen)}><ShoppingBag size={16} />Shop</button></div>
  </header>;
}
