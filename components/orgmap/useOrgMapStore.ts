import { create } from 'zustand';
import { OrgUnit, Employee } from '../../types';

export type CameraMode =
  | 'overview'
  | 'hq'
  | 'floor'
  | { type: 'room'; unitId: string }
  | { type: 'branch'; unitId: string };

interface OrgMapStore {
  // Camera
  cameraMode: CameraMode;
  setCameraMode: (mode: CameraMode) => void;

  // Room world position (for camera to zoom into correct room)
  roomWorldPos: [number, number, number] | null;
  setRoomWorldPos: (pos: [number, number, number] | null) => void;

  // Selection
  selectedEmployee: Employee | null;
  selectedUnit: OrgUnit | null;
  setSelectedEmployee: (emp: Employee | null) => void;
  setSelectedUnit: (unit: OrgUnit | null) => void;

  // UI
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  filterUnitId: string | null;
  setFilterUnitId: (id: string | null) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;

  // Active room (opens separate RoomScene)
  activeRoomId: string | null;
  setActiveRoomId: (id: string | null) => void;

  // Expanded branches
  expandedBranches: Set<string>;
  toggleBranch: (id: string) => void;
}

export const useOrgMapStore = create<OrgMapStore>((set) => ({
  cameraMode: 'overview',
  setCameraMode: (mode) => set({ cameraMode: mode }),

  roomWorldPos: null,
  setRoomWorldPos: (pos) => set({ roomWorldPos: pos }),

  selectedEmployee: null,
  selectedUnit: null,
  setSelectedEmployee: (emp) => set({ selectedEmployee: emp }),
  setSelectedUnit: (unit) => set({ selectedUnit: unit }),

  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  filterUnitId: null,
  setFilterUnitId: (id) => set({ filterUnitId: id }),
  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),

  activeRoomId: null,
  setActiveRoomId: (id) => set({ activeRoomId: id }),

  expandedBranches: new Set(),
  toggleBranch: (id) =>
    set((s) => {
      const next = new Set(s.expandedBranches);
      next.has(id) ? next.delete(id) : next.add(id);
      return { expandedBranches: next };
    }),
}));
