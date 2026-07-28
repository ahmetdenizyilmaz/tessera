import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  OfficeLayout,
  OfficeWorker,
  OfficeFurniture,
  GridPosition,
  WorkerActivity,
} from '../types/office';

function getDefaultLayout(): OfficeLayout {
  return {
    width: 30,
    height: 20,
    floorTiles: {},
    wallTiles: {},
    furniture: [],
    rooms: [],
  };
}

interface OfficeGameState {
  layout: OfficeLayout;
  workers: Record<string, OfficeWorker>;
  currency: number;
  totalEarned: number;
  purchasedItems: string[];
  editMode: boolean;
  shopOpen: boolean;

  updateWorkerActivity: (instanceId: string, activity: WorkerActivity) => void;
  setWorkerTarget: (instanceId: string, target: GridPosition) => void;
  setWorkerPosition: (instanceId: string, pos: { x: number; y: number }) => void;
  setWorkerWalking: (instanceId: string, isWalking: boolean) => void;
  addWorker: (instanceId: string, assignedDesk: GridPosition) => void;
  removeWorker: (instanceId: string) => void;
  addFurniture: (furniture: OfficeFurniture) => void;
  moveFurniture: (id: string, newPosition: GridPosition) => void;
  removeFurniture: (id: string) => void;
  setFloorTile: (x: number, y: number, style: string) => void;
  earnSalary: (amount: number) => void;
  purchase: (itemId: string, cost: number) => void;
  setEditMode: (editMode: boolean) => void;
  setShopOpen: (shopOpen: boolean) => void;
  setLayout: (layout: OfficeLayout) => void;
  getWorker: (instanceId: string) => OfficeWorker | undefined;
}

export const useOfficeGameStore = create<OfficeGameState>()(
  persist(
    (set, get) => ({
      layout: getDefaultLayout(),
      workers: {},
      currency: 0,
      totalEarned: 0,
      purchasedItems: [],
      editMode: false,
      shopOpen: false,

      updateWorkerActivity: (instanceId, activity) => {
        set((state) => {
          const worker = state.workers[instanceId];
          if (!worker) return state;
          return {
            workers: { ...state.workers, [instanceId]: { ...worker, activity } },
          };
        });
      },

      setWorkerTarget: (instanceId, target) => {
        set((state) => {
          const worker = state.workers[instanceId];
          if (!worker) return state;
          return {
            workers: {
              ...state.workers,
              [instanceId]: { ...worker, targetPosition: target, isWalking: true },
            },
          };
        });
      },

      setWorkerPosition: (instanceId, pos) => {
        set((state) => {
          const worker = state.workers[instanceId];
          if (!worker) return state;
          return {
            workers: {
              ...state.workers,
              [instanceId]: { ...worker, position: pos },
            },
          };
        });
      },

      setWorkerWalking: (instanceId, isWalking) => {
        set((state) => {
          const worker = state.workers[instanceId];
          if (!worker) return state;
          return {
            workers: {
              ...state.workers,
              [instanceId]: { ...worker, isWalking },
            },
          };
        });
      },

      addWorker: (instanceId, assignedDesk) => {
        set((state) => ({
          workers: {
            ...state.workers,
            [instanceId]: {
              instanceId,
              position: { x: 1, y: 1 },
              targetPosition: { gridX: 1, gridY: 1 },
              activity: 'new' as WorkerActivity,
              assignedDesk,
              direction: 0 as const,
              isWalking: false,
            },
          },
        }));
      },

      removeWorker: (instanceId) => {
        set((state) => {
          const { [instanceId]: _, ...rest } = state.workers;
          return { workers: rest };
        });
      },

      addFurniture: (furniture) => {
        set((state) => ({
          layout: {
            ...state.layout,
            furniture: [...state.layout.furniture, furniture],
          },
        }));
      },

      moveFurniture: (id, newPosition) => {
        set((state) => ({
          layout: {
            ...state.layout,
            furniture: state.layout.furniture.map((f) =>
              f.id === id ? { ...f, position: newPosition } : f
            ),
          },
        }));
      },

      removeFurniture: (id) => {
        set((state) => ({
          layout: {
            ...state.layout,
            furniture: state.layout.furniture.filter((f) => f.id !== id),
          },
        }));
      },

      setFloorTile: (x, y, style) => {
        set((state) => ({
          layout: {
            ...state.layout,
            floorTiles: { ...state.layout.floorTiles, [`${x},${y}`]: style },
          },
        }));
      },

      earnSalary: (amount) => {
        set((state) => ({
          currency: state.currency + amount,
          totalEarned: state.totalEarned + amount,
        }));
      },

      purchase: (itemId, cost) => {
        set((state) => ({
          currency: state.currency - cost,
          purchasedItems: [...state.purchasedItems, itemId],
        }));
      },

      setEditMode: (editMode) => set({ editMode }),
      setShopOpen: (shopOpen) => set({ shopOpen }),
      setLayout: (layout) => set({ layout }),

      getWorker: (instanceId) => {
        return get().workers[instanceId];
      },
    }),
    {
      name: 'claude-gui-office',
      partialize: (state) => ({
        layout: state.layout,
        currency: state.currency,
        totalEarned: state.totalEarned,
        purchasedItems: state.purchasedItems,
      }),
    }
  )
);
