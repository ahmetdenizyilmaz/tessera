import { Coins, Pencil, ShoppingCart, ArrowLeft, Users } from 'lucide-react';
import { useOfficeGameStore } from '../../store/officeGameStore';
import { isWorking, getSalaryRate } from '../../store/salaryEngine';
import { useInstanceStore } from '../../store/instanceStore';

interface OfficeHUDProps {
  onBack: () => void;
}

export function OfficeHUD({ onBack }: OfficeHUDProps) {
  const currency = useOfficeGameStore(s => s.currency);
  const totalEarned = useOfficeGameStore(s => s.totalEarned);
  const workers = useOfficeGameStore(s => s.workers);
  const editMode = useOfficeGameStore(s => s.editMode);
  const shopOpen = useOfficeGameStore(s => s.shopOpen);
  const setEditMode = useOfficeGameStore(s => s.setEditMode);
  const setShopOpen = useOfficeGameStore(s => s.setShopOpen);

  const workerCount = Object.keys(workers).length;
  const activeCount = Object.values(workers).filter(w => isWorking(w.activity)).length;

  // Calculate current earning rate
  const instances = useInstanceStore(s => s.instances);
  let earningRate = 0;
  for (const [id, worker] of Object.entries(workers)) {
    if (isWorking(worker.activity)) {
      const instance = instances.get(id);
      if (instance) {
        const provider = instance.config.llmConfig?.provider ?? 'claude';
        const model = instance.config.llmConfig?.model ?? instance.config.model;
        earningRate += getSalaryRate(provider, model);
      }
    }
  }

  return (
    <div className="office-hud">
      <div className="office-hud__left">
        <button className="office-hud__btn" onClick={onBack} title="Back to panels">
          <ArrowLeft size={18} />
          <span>Panels</span>
        </button>
      </div>

      <div className="office-hud__center">
        <div className="office-hud__workers">
          <Users size={16} />
          <span>{activeCount}/{workerCount} working</span>
        </div>
      </div>

      <div className="office-hud__right">
        <div className="office-hud__currency">
          <Coins size={18} className="office-hud__coin-icon" />
          <span className="office-hud__balance">{Math.floor(currency)}</span>
          {earningRate > 0 && (
            <span className="office-hud__rate">+{earningRate.toFixed(1)}/min</span>
          )}
        </div>

        <button
          className={`office-hud__btn ${editMode ? 'office-hud__btn--active' : ''}`}
          onClick={() => setEditMode(!editMode)}
          title="Edit mode"
        >
          <Pencil size={18} />
        </button>

        <button
          className={`office-hud__btn ${shopOpen ? 'office-hud__btn--active' : ''}`}
          onClick={() => setShopOpen(!shopOpen)}
          title="Shop"
        >
          <ShoppingCart size={18} />
        </button>
      </div>
    </div>
  );
}
